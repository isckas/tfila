# Extraction v2 — Expanded Canary + Global Rollout

## Context

The single-shul canary (BAYT, id=41, HTML tier) succeeded on the second attempt: 54 rules at 0.92 confidence with 100% source-quote coverage, single Haiku call (~$0.07), no Sonnet/critique fallback needed. Two real bugs were caught and fixed during the canary (`shulId` not passed to dispatcher; router skipping HTML tier on calendar widgets). Both fixes are deployed on `main`.

The remaining risk: v2 has been exercised on **one HTML shul only**. The other three tiers (js_rendered, vision_image, pdf_document) and the email path are all untested in production. The active shul pool is mostly HTML (30 of 34 healthy shuls), but the long-tail tiers are exactly where v2's agent-loop + tools + critique design changes matter most. Flipping the global flag now would canary those tiers against 51 shuls' worth of real cron traffic at once — too wide a blast radius for our first cross-tier test.

The goal of this plan: **expand the per-shul canary set to cover every tier we can, hold for one weekly cron cycle (Sun 2026-05-23 → 2026-05-24 morning), then flip the global flag if no regressions surface.**

## Approach

### Phase A — Expand the canary set (today, ~10 min)

Add two more shul IDs to `EXTRACTION_V2_SHUL_IDS` so the next cron cycle runs them through v2:

| id | name | strategy | v1 baseline | what v2 stresses |
|---|---|---|---|---|
| 41 | Beth Avraham Yoseph (BAYT) | html | 48 rules @ 0.92 | already validated ✅ |
| 67 | Chevra Ahavas Yisroel | js_rendered | 5 rules @ 0.92 | Browserless render → sanitize → v2 agent loop |
| 56 | The Shul (Bal Harbour) | vision_image | 8 rules @ 0.95 | Sonnet vision + extended thinking + context preamble |

Set: `EXTRACTION_V2_SHUL_IDS=41,56,67` in Vercel production env.

No PDF candidates in the active pool. Document this gap; PDF will get its first real-world canary when a PDF-bearing shul is added (or when we manually point a test shul at a known bulletin PDF). Docling has been smoke-tested against an arxiv PDF independently, so the lib/scrapers/docling.ts integration is exercised, just not via the full v2 cascade end-to-end.

### Phase B — Manually trigger 67 + 56 (today, ~5 min)

Click "Extract now" on each in the admin UI:
- `https://tfila.co/admin/shul/[slug-for-id-67]`
- `https://tfila.co/admin/shul/[slug-for-id-56]`

After each, I query the DB and surface a comparison vs v1 baseline (same shape as the BAYT report above).

### Phase C — Wait for weekly cron (Sat 2026-05-23 → Sun 2026-05-24)

The cron fires Sat 03:00 UTC weekly. Three canary shuls run through scrape-one-shul.ts → cascade dispatcher → v2 path. Other 48 shuls keep running v1.

Observability: the Sunday-morning weekly cron-summary email (commit `165748d`, lib/inngest/functions/weekly-rescrape-summary.ts) will fire at Sun 04:00 UTC and report per-shul status. Any of the three canary shuls flipping to `broken` or `error` will surface there.

### Phase D — Global flip (Sun 2026-05-24, conditional)

If all three canary shuls' weekly-cron extractions look good Sunday morning:
- Set `EXTRACTION_PIPELINE_V2=true` in Vercel prod env
- Remove `EXTRACTION_V2_SHUL_IDS` (now redundant)
- Redeploy (automatic on env-var change)
- All 51 active shuls run v2 on next manual trigger / next cron

If anything looks wrong (broken status, dropped rules, suspect source_quotes): hold global flip; investigate the failure tier; iterate on the prompt or cascade logic; re-canary.

### Rollback

Single-action rollback at any phase:
- **In canary**: remove an id from `EXTRACTION_V2_SHUL_IDS` → that shul reverts to v1 on next extraction
- **After global flip**: unset `EXTRACTION_PIPELINE_V2` → ALL shuls revert to v1 on next extraction
- No code revert needed. v1 path is unchanged in `cascade.ts`'s `runCascadeV1Internal`.

## Critical files / refs

No code changes in this plan — pure config + verification work.

For reference if a fix becomes necessary:
- `lib/llm/cascade.ts:249` — top-level dispatcher (`shouldUseV2()` logic)
- `lib/llm/cascade-v2.ts:144` — v2 4-tier cascade (`runCascadeV2`)
- `lib/llm/extract-v2.ts` — HTML agent pipeline
- `lib/llm/extract-vision-v2.ts` — vision tier (Sonnet only)
- `lib/llm/router.ts:97` — page classifier
- `lib/inngest/functions/weekly-rescrape-summary.ts` — observability source
- `scripts/cron-summary.mjs` — on-demand digest

## Verification

After each manual trigger (Phase B) and after Sun-morning cron (Phase C), run the inspection query (template already used for BAYT):

```sql
-- Latest data_source per canary shul
SELECT id, extraction_strategy, confidence_score, last_run_status,
       config_json->'usage' AS usage,
       config_json->'cascade_attempts' AS attempts
  FROM data_source WHERE shul_id IN (41, 56, 67)
  ORDER BY id DESC LIMIT 3;

-- Rule + source_quote stats per canary
SELECT shul_id, COUNT(*) AS total, COUNT(source_quote) AS with_quote
  FROM minyan_rule
  WHERE shul_id IN (41, 56, 67) AND deleted_at IS NULL
  GROUP BY shul_id;
```

**Pass criteria for each canary:**
- `last_run_status = ok`
- `confidence_score >= v1 baseline - 0.1` (allow small drift)
- `rules_count >= v1 baseline * 0.8` (allow 20% drop max — v2 sometimes splits one v1 rule into two)
- `with_quote = total` (every v2 rule has a sourceQuote)
- Cascade `attempts` array includes the expected winning strategy (no surprise tier upgrades/downgrades)
- Cost (input + output tokens summed) within 3× v1's per-extraction baseline

**Fail criteria (any of):**
- `last_run_status != ok`
- Rules dropped by >50% vs v1
- Cost exceeds 5× v1
- Confidence < 0.5 (was previously > 0.8)

A single canary failure pauses Phase D and triggers a code-side investigation; doesn't roll back the others.

## Open question for Phase D

Whether to also wire up a "v2 vs v1 diff report" in the cron-summary email (would compare token costs + rule counts across the canary set vs prior week's v1 numbers). Useful for the global-flip decision but adds ~30 min of code work. Defer unless the canary results raise specific cost concerns.
