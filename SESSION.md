# Session log

**Pickup doc.** Latest session at top. If you're returning to this project, read the **latest session** below first, then `DECISIONS.md` for verbose rationale, then `PROGRESS.md` "Now" if you need more depth.

---

## 2026-05-18 (evening) — QUICK SAVE (pre-compaction or manual)

- Branch: main; latest commit: c22a29c fix(extraction-v2): always try HTML tier, demote shouldRerenderJs to advisory
- Working tree: 3 modified (SESSION/PROGRESS/DECISIONS), 2 untracked plan docs (EXTRACTION-V2-ROLLOUT-PLAN.md + SAVE-RESUME-SKILL-PLAN.md) — same as session start; no new commits this session
- In-flight tasks: #1 Verify /save quick + /save deep on daven-site (still pending; quick mode being tested by this very save)
- Last user intent (one sentence): Pivoted from v2-rollout-only to full project gap audit; locked an 11-task implementation plan (v2 flip → launch-prep → analytics → Sentry → rate limits → PWA → travel mode → filter chips → in-progress countdown → freshness badge → /save verify)
- Next action: User to review plan at `~/.claude/plans/i-want-you-to-fluttering-canyon.md` + decide whether to ExitPlanMode or refine further. If approved, Step 1 is the v2 global flag flip in Vercel prod.
- Key decisions locked this session: repo is private (cred rotation stays deferred); test cohort ready in 1-2 weeks (launch-prep is pre-launch blocker); no analytics today (add Vercel Analytics as part of launch-prep); PWA + Travel mode UI both verified missing as Phase-1 completeness gaps

---

## 2026-05-18 (afternoon) — Canary expansion complete + `/save` + `/resume` skills built

### Briefing for next session (read first)

- **Where we are:** All 3 v2 canary shuls (BAYT/html, The Shul/vision, Chevra Ahavas Yisroel/js_rendered) are running v2 in prod and verified — every rule has a sourceQuote, every data_source has `v2Meta`. Also built two new user-scope Claude Code skills (`/save` + `/resume`) plus a PreCompact hook for auto-save before context compaction.
- **Next concrete action:** Wait for Sat 2026-05-23 03:00 UTC weekly cron → Sun 2026-05-24 morning cron-summary email. If all three canary shuls still `ok` Sunday, flip `EXTRACTION_PIPELINE_V2=true` globally. Until then, no v2 work needed.
- **Constraints to preserve:** Don't flip global flag until canary survives one weekly cron cycle. Don't revoke any credentials yet (still in build phase). Don't commit any changes without explicit user OK.
- **Critical data:** BAYT v2 = data_source #99; The Shul v2 = data_source #102; Chevra v2 = data_source #104. PR #1 merged at 1cb6c9a. New skills at `~/.claude/skills/save/` + `~/.claude/skills/resume/`. Skill design rationale in `docs/SAVE-RESUME-SKILL-PLAN.md` + DECISIONS.md.

### Done this session (since the earlier 2026-05-18 save)

- Updated Vercel prod env: `EXTRACTION_V2_SHUL_IDS=41` → `41,56,67`. Redeployed (deployment `tfila-28l4n7f0c`).
- User re-triggered Extract Now on id=56 (The Shul) + id=67 (Chevra Ahavas Yisroel). Both confirmed v2 (v2Meta present, 100% sourceQuote coverage).
- **Vision tier canary** — The Shul: 8 rules at **0.97 confidence** (UP from v1's 0.95). Router correctly classified homepage as `about_marketing`, skipped HTML, JS-render returned 0, vision tier found the schedule image.
- **JS-rendered tier canary** — Chevra Ahavas Yisroel: 5 rules at 0.92 confidence (matches v1 exactly). HTML tier got 0 rules at 0.15 then fell through cleanly to JS-render.
- Built `/save` + `/resume` skills at user scope (`~/.claude/skills/`) following 4-phase plan-mode workflow with web research for best practices (12 gaps surfaced, 7 incorporated).
- Added PreCompact hook to `~/.claude/settings.json` so context-compaction auto-fires `/save quick`.
- Wrote user-facing README for the skills at `~/.claude/skills/save/README.md`.

### Decisions made

- See DECISIONS.md "2026-05-18 (afternoon) — `/save` + `/resume` skill design" (8 decisions covering scope, mode split, hook safety net, drift detection, etc.)

### In-flight tasks (recreate with TaskCreate on /resume)

- #63 (in_progress) — skill 5: Verify `/save quick` + `/save` deep on daven-site. Pending: user needs to type the commands in a fresh Claude Code session to test (skills can't be invoked from inside a tool call by the building Claude).

### Paused / blocked

- v2 global rollout — blocked by Sat 2026-05-23 weekly cron + Sun 2026-05-24 morning verification. ~5 days from now.
- PDF tier real-world canary — blocked by no PDF-bearing shul in active pool. Will surface organically when one is added.
- Email tier canary — blocked by no current path to trigger; defer until next email forward lands.

### Code commits — none this session segment

Only doc + config edits. No code changes touched git.

### Files touched (uncommitted)

- `SESSION.md` (this prepend)
- `PROGRESS.md` (Now section + new Done entry)
- `DECISIONS.md` (new section prepended)
- `~/.claude/projects/<...>/memory/project_pickup_2026_05_18_pm.md` (NEW)
- `~/.claude/settings.json` (PreCompact hook merged in)
- `~/.claude/skills/save/SKILL.md` (NEW)
- `~/.claude/skills/save/README.md` (NEW)
- `~/.claude/skills/resume/SKILL.md` (NEW)
- `docs/SAVE-RESUME-SKILL-PLAN.md` (NEW — durable copy of scratch plan)

---

## 2026-05-17 → 2026-05-18 — Extraction Pipeline v2 deploy + BAYT canary

**Headline:** v2 is live in `main` and verified end-to-end on BAYT (id=41, HTML tier). All 16 build steps shipped + 2 mid-canary bug fixes. Expanded canary (vision + js_rendered) is mid-stream — env var update pending.

**Next pickup**: update `EXTRACTION_V2_SHUL_IDS=41` → `41,56,67` in Vercel prod env, re-trigger Extract Now on id=56 + id=67 admin pages, verify, then wait for Sat 2026-05-23 weekly cron, then conditionally flip `EXTRACTION_PIPELINE_V2=true` globally.

PR: https://github.com/isckas/tfila/pull/1 (merged 2026-05-18 14:00 UTC)

### What runs in prod right now

| | |
|---|---|
| Branch | `main` (16 v2 commits + 2 mid-canary fixes merged) |
| `EXTRACTION_V2_SHUL_IDS` | `41` (BAYT only) |
| `EXTRACTION_PIPELINE_V2` | unset (global flag dormant) |
| `DOCLING_URL` | `https://iska123-tfila-docling-serve.hf.space` |
| `JINA_API_KEY` | set |
| Behavior | BAYT runs v2 on next extraction; 50 other active shuls run v1 |

Rollback at any time: unset/edit `EXTRACTION_V2_SHUL_IDS` → BAYT reverts to v1. Unset `EXTRACTION_PIPELINE_V2` if it gets flipped globally → all revert.

### Verified canary results (BAYT data_source #99)

| Metric | v1 baseline (ds #41) | v2 result (ds #99) |
|---|---|---|
| Strategy | html | html ✅ |
| Confidence | 0.92 | 0.92 ✅ |
| Rules | 48 | 54 (+6, more granular) |
| Rules with sourceQuote | 0 | 54/54 ✅ |
| Tokens | ~30k | 60k in / 3.6k out |
| Cost | ~$0.05 | ~$0.07 |
| Sonnet fallback | n/a | not needed |
| Critique pass | n/a | not triggered |

Sample source quotes captured correctly: `"6:45am Shacharis"`, `"6:40pm Mincha/Maariv"`. Admin UI shows these as collapsible disclosures under each rule (commit `53fc4d0`).

### What's paused mid-stream (immediate to-do)

User clicked Extract Now on id=56 (The Shul, vision tier) + id=67 (Chevra Ahavas Yisroel, js_rendered tier) on 2026-05-18 ~14:24 UTC expecting v2 to run. **Both routed to v1** because `EXTRACTION_V2_SHUL_IDS=41` only whitelists BAYT. New data sources #100 + #101 created with v1 output — confirmed v1 by absence of `v2Meta` in `config_json.usage` and zero sourceQuotes.

Resume sequence:
1. `vercel env rm EXTRACTION_V2_SHUL_IDS production` then re-add with value `41,56,67`
2. Vercel auto-redeploys (~1 min)
3. User re-clicks Extract Now on `/admin/shul/chevra-ahavas-yisroel` and `/admin/shul/theshul-org`
4. Verify both new data_sources have `v2Meta` in `config_json.usage` and 100% sourceQuotes
5. Wait for Sat 2026-05-23 weekly cron → Sun 2026-05-24 morning cron-summary email
6. If all 3 canaries `ok` → flip `EXTRACTION_PIPELINE_V2=true` globally

PDF tier remains untested. No active PDF-bearing shuls in the pool. Docling has been smoke-tested standalone (against arxiv PDF; success, 1.6MB markdown back in 89s). Defer PDF tier real-world canary until a PDF shul arrives.

### The two bugs caught + fixed during canary

**Bug 1 — `shulId` never reached the dispatcher** (commit `7aa4c73`)

`EXTRACTION_V2_SHUL_IDS=41` was a SILENT no-op because three `runCascade()` call sites didn't pass `opts.shulId`. Without it, `shouldUseV2(undefined)` always returned `false`. Three callers fixed:

- `app/api/admin/shul/[id]/extract/route.ts:67` — added `shulId: s.id`
- `lib/inngest/functions/build-data-source.ts:56` — added `shulId`
- `lib/inngest/functions/scrape-one-shul.ts:346` — added `shulId: args.shulId`

**Lesson:** per-shul canary caught this immediately ("v2 didn't seem to run on BAYT first try"). Global flip would have silently kept everything on v1 with no signal.

**Bug 2 — Router skipped HTML tier on legitimate calendar pages** (commit `c22a29c`)

My v2 router classified `bayt.ca/calendar` as `calendar_widget` and the cascade had a branch that skipped the HTML tier on that hint, jumping straight to JS-render. But v1 had successfully extracted 48 rules from the SAME URL via raw HTML — proving the schedule WAS in static HTML. The router was being too clever.

Fix: removed the `shouldRerenderJs` branch entirely in `cascade-v2.ts`. Router is now advisory; HTML tier always attempts unless `shouldSkipExtraction` flags the page as non-schedule (about/blog/error). If HTML returns 0 rules, the cascade still falls through to JS-render → vision → PDF as before.

**Lesson:** the router is meant to OPTIMIZE not REPLACE the cascade. Don't let it skip valid tiers.

### Service infrastructure deployed today

#### Docling on Hugging Face Spaces

- **Space**: `IsKa123/tfila-docling-serve` at `https://iska123-tfila-docling-serve.hf.space`
- **Image**: `quay.io/docling-project/docling-serve-cpu:latest` wrapped in our own Dockerfile that overrides entrypoint with `--host 0.0.0.0 --port 7860` (HF requires port 7860 and the base image's env-var port override didn't take)
- **Tier**: free CPU Basic (2 vCPU, 16 GB RAM)
- **Cold start**: ~30s after 48h idle
- **Smoke test**: arxiv 9-page PDF → 1.6 MB markdown returned in 89s, status=success
- **Auth**: none (public; `DOCLING_TOKEN` env var is unset, which is correct — server-to-server use)
- **Decision rationale**: see DECISIONS.md "Docling host: HF Spaces over Fly.io" — Fly required CC, Wise prepaid rejected
- **Build hiccups** (both fixed): `CORS_ORIGINS=["*"]` env var broke pydantic-settings JSON parser (removed; not needed for server-to-server); `DOCLING_SERVE_PORT` env var was ignored by the base image (overrode entrypoint with CLI flag instead)

#### Jina Reader

- Signed up at jina.ai, free tier (1M tokens/month)
- Authed vs anonymous: 20542 bytes vs 427 bytes on BMNMB smoke test (48× improvement — anonymous gets rate-limited stubs)
- `JINA_API_KEY` set in both `.env.local` and Vercel prod env

#### Vercel CLI

- Installed globally (v54.1.0)
- Already logged in as `isaackass-4389`
- Project linked to `prj_zetR9agnTaROAo3sm49AY3oYzUEW` (already linked from prior work)

#### Anthropic billing posture

- User confirmed cap + alert set in console.anthropic.com (didn't share the specific number — likely $30/mo cap, $15/mo alert per my recommendation)
- v2 worst case is 3–5× v1 per-extraction tokens; the cron-driven workload (~150 extractions/week) makes total cost containment less risky than ad-hoc usage

### Why HF Spaces won over Fly.io (saved for next time)

Original plan was Fly.io because it's the Docker hosting sweet spot — fast deploys, sane defaults, auto-stop. **Fly required a real credit card and rejected the user's Wise prepaid card** during signup verification. We pivoted to HF Spaces in ~5 min: HF account created → write token → API to duplicate template fork failed (the `ds4sd/docling-serve` template I'd cited doesn't actually exist on HF — only third-party forks exist) → API to create-from-scratch Docker Space → push Dockerfile via git → 5 min build → smoke test.

**New default per [[feedback-no-credit-card-services]]:** when proposing infra, filter to no-CC services first (HF Spaces, Koyeb, Cloudflare Workers/Pages, Vercel hobby, Neon free, Resend free, Render free). Mention CC-required options only when no-CC equivalent can't meet the need.

### Tasks state (rolling task list — copy for pickup)

- #53 v2 setup 1.1 — HF account + write token (replaces Fly.io) — **completed**
- #54 v2 setup 1.2 — Create + deploy Docling HF Space — **completed**
- #55 v2 setup 2 — Jina API key signup + save — **completed**
- #56 v2 setup 3 — Anthropic billing posture verify — **completed**
- #57 v2 setup 4 — Vercel env wiring + push extraction-v2 — **completed**
- #58 v2 setup 5 — Canary verify on one shul — **in_progress** (BAYT verified; id=56 + id=67 still need real v2 runs after env var update)

### Code commits — 2026-05-17 (extraction-v2 branch build)

| Commit | Step | Summary |
|---|---|---|
| `ffb873b` | 1 | Migration 0010 — `minyan_rule.source_quote` nullable column |
| `00b4e54` | 2 | Anthropic tool definition for structured output |
| `b889963` | 3 | Five mid-extraction tools (`lookupHebrewDate`, `getSunsetRange`, `getPreviousExtraction`, `validateRule`, `searchHebrewMonth`) |
| `9c3756e` | 4 | `build-context.ts` — shul metadata + Hebcal preamble |
| `f90381a` | 5 | `router.ts` — page-type classifier |
| `7000743` | 6 | `jina-reader.ts` HTML preprocessor |
| `61707b0` | 7 | `docling.ts` PDF preprocessor wrapper |
| `dd88f4e` | 8 | `agent-loop.ts` + `extract-critique.ts` |
| `cc72c0e` | 9 | `extract-v2.ts` — full HTML pipeline |
| `b0b1c7d` | 10 | `extract-pdf-v2.ts` — Docling reuse |
| `91a61a6` | 11–12 | `extract-vision-v2.ts` + `extract-email-v2.ts` |
| `4f9e9e9` | 13 | `cascade-v2.ts` + dispatcher in `cascade.ts` |
| `f8aeb89` | 14 | `.env.example` v2 flag documentation |
| `53fc4d0` | 15–16 | `persist-submission` + admin source disclosure |

### Code commits — 2026-05-18 (deploy + canary)

| Commit | Type | Summary |
|---|---|---|
| `3c6ab71` | fix | `lib/scrapers/docling.ts` — match real docling-serve API contract (`/v1/convert/source`, `sources:[{kind:"http",url}]`, response.`document.md_content`). Bumped timeout 60s → 180s. |
| `1cb6c9a` | merge | PR #1 — extraction-v2 → main |
| `7aa4c73` | fix | Pass `shulId` to `runCascade()` from all 3 callers — without this `EXTRACTION_V2_SHUL_IDS` was silently ignored |
| `c22a29c` | fix | `cascade-v2.ts` — always try HTML tier; demote `shouldRerenderJs` to advisory only. Was skipping legitimate calendar pages whose schedule lived in static HTML. |

### Working-tree state

- Working dir is on `main`. `extraction-v2` branch preserved on origin for safety (can delete after a week if no rollback needed).
- Uncommitted as of pickup time: status doc edits (this file, PROGRESS.md, DECISIONS.md, MEMORY.md changes).
- `.env.local` gained: `HF_TOKEN`, `JINA_API_KEY`, `DOCLING_URL` (plus prior set unchanged).
- Scratch plan at `C:\Users\Yossi\.claude\plans\majestic-zooming-puddle.md` — saved into project as `docs/EXTRACTION-V2-ROLLOUT-PLAN.md` so it survives session end.

### Active deferred items (Phase 1 cleanup, unchanged from prior session)

- Vision-extractor calibration — need ~5 more real vision extractions to assess prompt quality on stylized typography. v2 canary on id=56 will be one of those once we get it running properly.
- API error-response convention via `lib/http.ts` — touches every route; deferred from the code-review night.
- Per-IP rate limit on `/submit` — best done at Vercel WAF, not in code.
- Email schedule pipeline date-handling verification — pick up after ~2-3 weeks of real email cycles have run.
- 21 broken extractions surfaced by the 2026-05-16 cron-summary script — may resolve naturally on v2 rollout; triage post-global-flip if not.
- PDF tier real-world canary — Docling deployed but no PDF shuls in active pool. Wait for one to arrive organically OR manually point a test shul at a known bulletin PDF.

---

## 2026-05-14 → 2026-05-15 — Code-review night + Phase 2 brainstorm

This session spans two working days that flowed together:
- **2026-05-14 evening** — code work: pipeline parity, address search, no-stale gate, admin notes, admin UX overhaul, code review with all critical findings fixed
- **2026-05-15** — documentation + brainstorming: Phase 2 candidate pool, gap analyses, exploration entries

---

## Headline

**27 commits live in prod, two migrations applied, one data backfill, one full-stack code review with all critical findings fixed, and a comprehensive Phase 2 candidate pool documented in FEATURES.md.**

The product is in a stable, shippable state. Next pickup is the Phase 2 selection conversation OR routine maintenance — your call when you're back.

---

## Code commits — 2026-05-14 evening

| Commit | Type | Summary |
|---|---|---|
| `6a61431` | refactor | PR1 — `allocateUniqueSlug` shared; admin extract uses `backfillShulLocation` |
| `9fbcbbb` | refactor + fix | PR2 — shared guardrails + `insertRuleFromExtraction`; **email path now respects guardrails** |
| `5889428` | refactor | PR3 — `persistDataSourceWithRules` + `applyShulNameAndAddressFromExtraction` (completes "Unified post-ingestion pipeline") |
| `f5e2239` | feat | Address-search 25-mi radius, nearest-first, per-shul grouping |
| `fe0737e` | feat | No-stale-data gate — public surfaces hide shuls without a successful run in 14d |
| `cd761ed` | feat | Admin notes per shul — migration 0008 |
| `fa17ce3` | chore | Housekeeping (FEATURES.md entries, logo source, diag script, favicon) |
| `fb06f77` | fix | `geocodeAddressIfMissingLocation` — fixes the bug where address-set email-shuls had `location IS NULL` |
| `5443c8c` | feat | Admin UX inbox overhaul — verb-first one-row-per-shul; queue + rejected became filtered views |
| `c078e1f` | fix | MinyanList times in shul TZ instead of server UTC |
| `c3eacbf` + `7914b6c` | copy | Tagline copy edits |
| `49aeb4a` | fix (cost) | `pageContentHash` sanitized-vs-raw bug + Sonnet skip on Haiku zero-rules |
| `acbff05` | fix | Idempotency: HTML + non-HTML rescrape paths atomic + retry-safe |
| `af30511` | fix (security) | Magic-link single-use + drop attacker-controlled Origin + Postmark fail-closed (migration 0009) |
| `21f2b84` | fix (security) | `/submit` SSRF guard + per-domain extraction cooldown |
| `9babf55` | fix | Build/scrape race + `findShulPlace` disambiguation + email guardrail bail to 0.5 |
| `282ae08` | refactor | `lib/format.ts` + `components/badges/*` — kill duplication |
| `9a002c4` | fix | Zmanim TZ from lat/lng (was UTC) + a11y labels + `<h3>` headings + RelativeTime hydration + delete dead `SearchBox` |

## Documentation commits — 2026-05-15

| Commit | Summary |
|---|---|
| `203d9c0` | First SESSION.md + PROGRESS/FEATURES status updates after the code-review night |
| `8028109` | FEATURES: "Schedule update timing" — how email vs cron updates flow + where date columns live |
| `cc210c8` | FEATURES: flag email-schedule date handling as needing live-data verification |
| `6fd8c28` | FEATURES: exploration entry — LLM extraction context / skill / prompt (5 options ranked) |
| `264a733` | FEATURES: gap entries — automated tests, single-admin auth model |
| `38e5e62` | FEATURES: Phase 2 candidates — Telegram bot, layered Jewish-life map |
| `309fb9f` | FEATURES: Phase 2 candidates — multi-language UI, predictive missing-bulletin alert |
| `93dc983` | FEATURES: rename "Long-term ideas" → "Phase 2 features"; add Make-a-Minyan as Isaac-flagged Phase 2 candidate |

---

## Migrations applied to prod Neon

- **0008** — `shul.admin_notes`, `shul.admin_notes_updated_by`, `shul.admin_notes_updated_at`
- **0009** — `consumed_magic_link` table (token_hash PK, consumed_at + index)

Both ran via Neon SQL editor on the `phase-1-migration` branch.

## Data ops run

- `scripts/backfill-shul-locations.mjs` — 18 shuls had `address` set but `location` NULL → all geocoded, written. Bais Menachem (id=57), theshul.org (56), bayt.ca (41), thornhillshul (40), and 14 others.

---

## What to verify post-deploy (still relevant for any new work)

1. **Zmanim render in shul timezone** — `/?lat=25.8900949&lng=-80.1867138&via=address&q=North+Miami` → Alos ~5:19 AM (was 9:19 AM UTC).
2. **Minyan times in shul timezone** — same page → Bais Menachem mincha ~7:49 PM (was 11:49 PM UTC).
3. **Magic-link single-use** — sign out → request → click (works) → click again → `/signin?error=already-used`.
4. **Per-domain cooldown** — submit a URL whose domain matches a shul extracted in the last 30 min. Should accept but skip the Inngest event.
5. **Admin inbox** — `/admin` shows tiles + verb-first row list; click into a shul; back out; verify no shul appears twice across inbox / queue / rejected.
6. **Saturday cron** — first cron after 2026-05-17 22:00 ET should show way fewer LLM extractions (hash bug fix lets unchanged pages hit the `no_change` short-circuit).

---

## Phase 2 candidate pool (FEATURES.md "🚀 Phase 2 features" section)

Five candidates documented as Phase 2 — to be revisited after traction is established. **Final cut TBD.** Each entry has explicit revisit triggers, design considerations, and why-deferred reasoning:

- **Telegram chatbot** — chat-first interface for find-near-me + flyer submission. Trigger: ≥3 users asking for an app/WhatsApp version in a single month.
- **Layered Jewish-life map** (minyanim + eruv + mikvah + kosher) — Google-Maps-style layers. Trigger: explicit user requests OR community volunteer offering to maintain eruv data.
- **Multi-language UI** (Hebrew, Russian, French, Spanish, Yiddish) — analytics-driven trigger (≥10% Hebrew or ≥5% any non-English in `Accept-Language`).
- **Predictive "missing bulletin" admin alert** — per-sender cadence learning + alert. Trigger: ≥30 active email senders with ≥8 weeks of cadence each.
- **"Make a Minyan" (ad-hoc location-based)** — Isaac-flagged favorite. Detailed design questions captured ("Details that need real work"). Depends on Telegram bot + auth rework being live first.

Plus **2 noted gaps** captured in FEATURES.md (not in the Phase 2 section but tracked as deferred):
- **Automated tests** — typecheck is the only safety net today; 4 concrete prior-art bugs cited that would have been caught
- **Auth model** — single-admin works today, will need rework for any co-admin

---

## 7 user-suggested ideas — analyzed (not in FEATURES.md, kept as session record)

User asked to analyze 7 specific ideas. Verdicts:

| # | Idea | Verdict |
|---|---|---|
| 1 | Siddur download | Small enhancement only — link to existing free siddurim (Open Siddur Project, Sefaria); don't host content |
| 2 | Candle-lighting times | Already 80% built — extend the existing zmanim strip with candle-lighting + havdalah |
| 3 | Daily Dvar Torah feed | **Skip** — off-scope, dilutes brand; cross-link existing sources if anything |
| 4 | Generic Jewish AI bot | **Skip — pushed back actively** — halachic liability + brand risk + better existing solutions (Sefaria, ChatGPT) |
| 5 | Kaddish-on-my-behalf | Adjacent product; deserves separate focus, not a tfila.co feature |
| 6 | chabad.org zmanim feed | **Skip** — already done better via Hebcal; would add dependency for less control |
| 7 | "Make a Minyan" (ad-hoc) | **Phase 2 candidate** (Isaac flagged as favorite) — added to FEATURES.md with full design |

---

## Outstanding (deferred, not done in this session)

**Code-review items deferred by design**
- API error-response convention via `lib/http.ts` (touches every route — focused PR)
- Per-IP rate limit on `/submit` (better at Vercel WAF level than in code)

**Pre-existing items (rolling)**
- Same-origin URL fallback only runs in HTML tier (less urgent post-resolver)
- Vision-extractor calibration — needs 5 more real vision extractions
- Anthropic Auto-Reload + monthly cap (operational; the hash-bug fix should reduce burn rate substantially)

**Live-data verification (blocked on time, not effort)**
- Email schedule pipeline date handling — walk a real shul (e.g. Safra `id=59`) end-to-end against its source bulletin once 2-3 weeks of email cycles have run. See FEATURES.md "Schedule update timing — Needs verification on live data."

**Build-stage cleanup** (deferred per user instruction — don't surface during build phase)
- Credential rotation (Neon API key, Neon DB password, Inngest signing key, Cloudflare token, Google API key)
- Automated tests (FEATURES.md gap entry; recommended starting point: 6-line hash-stability test in vitest)
- Auth model rework (FEATURES.md gap entry; trigger = first real second-admin user story)

---

## Memory updates from this session

- New: `feedback-minimize-user-work` — default to scripts/APIs over web-UI walkthroughs; ask for credentials, user keeps them in `.env.local`.
- New: `feedback-security-cleanup-deferred` — don't list credential rotation as outstanding while the project is in build stage.
- Updated: `project-pickup-2026-05-14` — current state pointer.

---

## How to resume

1. **Read this file** (you're doing it). Top half = what shipped. Bottom half = what's deferred + Phase 2 pool.
2. **PROGRESS.md "Now"** — deferred items (cross-references SESSION.md and FEATURES.md).
3. **FEATURES.md** is the historical decision record. Every entry now has a Status line (`BUILT 2026-05-XX (commit X)` or `Phase 2 candidate` or `Principle locked. TBD.`).
4. **The 🚀 Phase 2 section in FEATURES.md** is the candidate pool. The next "what should we build?" conversation probably starts here — pick one based on which trigger has fired.
5. **If you need credentials / DB access** to run a script, ask Isaac directly. He keeps prod credentials in `.env.local` (gitignored). Per `[[feedback-minimize-user-work]]`, default to writing a script he can run locally rather than routing him through web dashboards.
6. **Don't mention credential rotation** in "what's outstanding" lists per `[[feedback-security-cleanup-deferred]]` — that's deferred until build phase ends.

## What "build phase ends" means (for the deferred decisions)

The deferred-during-build items (tests, auth model, credential rotation, multi-language) all have implicit triggers. Rough working definition of "build phase ends":
- Daily active users > 50 (signal: real product fit, not just self-use)
- ≥3 months without a critical bug shipped
- Marketing motion in flight (vs pure organic discovery)

When 2 of those 3 are true, time to revisit the deferred items.
