# tfila.co — Progress

Rolling build log. **Latest at top.** Update after every meaningful work session.

**Convention:** each entry is dated. Mark in-progress with ⏳, done with ✅, blocked with 🚫.

Three sections:
- **Now** — what's actively being worked on
- **Done** — finished slices, in reverse chronological order
- **Blocked / Needs decision** — things waiting on something

---

## Now — next session

**Last working session: 2026-06-07 evening — ENTIRE remediation P0–P5(core) SHIPPED + LIVE in prod (PR #5 + PR #6 both merged + deployed).**

### Pickup: P5 cleanup backlog (everything high-value is SHIPPED + LIVE)

**Done + deployed:** P0–P4 (PR #5 `f7fe72e`) and P5's security/observability core (PR #6 `1ad13e7`) are both merged to `main` and **LIVE in prod** — Vercel build success; landing/feed/shul/`/api/health` all 200; the SSRF redirect rewrite was runtime-tested (real redirect chains followed, metadata IP refused). The site that was 41→9 down is recovered (24 active), correct (tz-aware times), hardened (SSRF at the fetch boundary), and monitored (dead-man's switch + feed-probing health check). Four adversarial-review workflows (~50 agents) gated the work; every finding was low-severity and fixed.

**Next concrete action:** the documented **P5 cleanup backlog** (see PR #6 body) — none blocking: M11 (Inngest `onFailure`), E-D2 (cost-gate cron spend — needs a real spend-tracking mechanism, not a half-fix), M16 (Sentry source-maps), the Jina/Docling/`is_manual_edit` tier deletions + discovery→one-shot, and the lows (L3 dead `broken` UI, L4 approve-303, L5 reject-reason, L8 RUNBOOK `/api/health` drift, L10 OPEN-ISSUES, M15 `.env.local`, M17 candidate→pgEnum, M8 admin DAL authz, M9 CF-proxy allowlist, M4/M5 digest spike-gate + first_broken_at backfill). Plus the bulk "re-extract all broken" admin action (UI-5 stretch) — needs a confirm + the P0 rate gate.

**Deploy reminder:** prod deploys via **merge-to-`main`** (Vercel git-integration auto-deploys main→prod, ~45s). Direct `main` pushes are blocked → use a branch + PR. See memory `reference_deploy_mechanism`. The P3 ShulCloud-adapter pickup below is historical (descoped).

### (historical — descoped) Pickup: P3 — ShulCloud adapter

Was: research the widget structure then build a tier-0 deterministic parser. **Descoped 2026-06-07**: research showed P0 already storm-proofed the cascade and the LLM extracts ShulCloud's static HTML at 0.75–0.92, so the adapter would be equal-at-best (worse on generic "Evening Minyan" naming). Shipped E-B5 (report-wrong-time) + E-B3 (moat reframe) instead.

### (historical) Pickup: run the full stranded-shul recovery, then continue P2

Recovering from the 41→9 active-shul regression. P0 (outage fix) + P1 (pipeline consolidation + self-healing status) + P2-start (timezone correctness) are committed (8 commits) and **deployed to prod** (`tfila-bph0uab11`, smoke-green); the new v1-only pipeline is verified (shul 1 re-extracted 5 rules @0.75 + self-healed). **Next concrete action:** `node scripts/recover-stranded.mjs 50` — re-extract the ~29 remaining stranded shuls (≈$2–3, throttled, ~10 min), then set recovered shuls `shul.status='active'`. Full plan + appendices: `~/.claude/plans/reveiw-all-logs-and-reactive-locket.md` (= `docs/HOLISTIC-REMEDIATION-PLAN.md`). **Constraints:** prod aliases the BRANCH (don't push main until merge); gate the LLM-spend recovery + any destructive migration; E-DECISION-1 = v1 base.

### Historical pickup: accumulate batch in plan file, then code (SUPERSEDED — the batch was executed this session)

The geo-tz home-feed 500 fix is **designed and held** in `~/.claude/plans/i-want-you-to-fluttering-canyon.md`. User explicitly chose **batch-then-code**: surface more issues, add each to the plan, code everything in one PR when ready.

Concrete pickup steps:
1. Ask user what next issue / area to explore.
2. As issues surface, add a new section to the plan file. **Don't jump to coding yet.**
3. When user signals "ready," implement everything as one batch (one branch, one PR, one code-review).
4. Phase-1 launch checklist (UptimeRobot + test cohort + share message) is still outstanding underneath — non-code, can run in parallel.

The held fix recipe (geo-tz):
- `next.config.ts`: add `serverExternalPackages: ["geo-tz"]` + `outputFileTracingIncludes: { "/": ["./node_modules/geo-tz/data/**/*"] }`.
- `app/page.tsx:247`: wrap `findTz(lat, lng)[0] ?? "America/New_York"` in try/catch with the same fallback.

### Historical pickup notes from prior session

**2026-05-19 (UNIQUE INDEX + cross-status dedup closed via PR #3 `0aba418`).** Resume the launch-prep checklist:

1. **UptimeRobot signup** (free tier, no card) → monitor `https://tfila.co/api/health`, 5-min interval, email alerts.
2. **Pick the 3-5 person test cohort** → fill the table in `docs/FIRST-USERS-TEST-PLAN.md`.
3. **PWA install sanity test** → one iPhone + one Android.
4. **Trigger one deliberate test error** → verify Sentry receives it.
5. **Send share message** → use the template in the test plan.

### Older historical pickup notes

**Last working session: 2026-05-18 → 2026-05-19 (phase-1 launch prep + ops gates shipped; v2 went global; everything in commit `48aac17`, deploy `tfila-s3zf4v3cj`).**

See **[SESSION.md](./SESSION.md)** for the canonical pickup doc and **[DECISIONS.md](./DECISIONS.md)** for verbose rationale.

### Pickup: pick test cohort + send share message

**Current prod state (as of 2026-05-19):**
- v2 extraction pipeline is the global default (`EXTRACTION_PIPELINE_V2=true`). New submissions and the next weekly cron run v2 across all 51 active shuls.
- Launch-prep UX shipped: OG metadata on shul pages, sitemap.xml + robots.txt, special-schedule labels in feed, 44×44 tap targets, freshness chip, travel-mode date picker, tefillah filter chips, in-progress live pill.
- Ops scaffolding active: Vercel Analytics + Sentry + `/api/health` + Upstash rate limits + LLM cost-gate ($25/day default).
- PWA installable (manifest + service worker + apple-touch-icon).
- Verified live: `/api/health`, `/sitemap.xml`, `/robots.txt`, `/manifest.webmanifest`, `/sw.js` all return 200.

**To complete pre-test checklist (per `docs/FIRST-USERS-TEST-PLAN.md`):**

1. **UptimeRobot signup** (free tier, no card) → monitor `https://tfila.co/api/health`, 5-min interval, email alerts on failure.
2. **Pick the 3-5 person test cohort** → fill the table in `docs/FIRST-USERS-TEST-PLAN.md`. Aim for diversity (weekday-only, traveler, non-local, iOS+Android mix).
3. **PWA install sanity test** → one iPhone + one Android, "Add to Home Screen" works.
4. **Trigger one deliberate test error** → verify Sentry receives it.
5. **Send share message** → use the template in the test plan.

**Cadence after share message:** 1 week before iterating. Resist tweaks on the first piece of feedback.

**Decision criteria after 2 weeks:** pre-written in `docs/FIRST-USERS-TEST-PLAN.md` (Iterate / Build feature X / Scrap-and-rethink).

**Rollback (any time):**
- `vercel env rm EXTRACTION_PIPELINE_V2 production` → all shuls back to v1
- `vercel env add EXTRACTION_DISABLED true production` → halt all new LLM calls
- `vercel rollback <prior-good-deployment>` → revert to a known-good build

### `/save` + `/resume` skills installed (user-wide)

Built afternoon of 2026-05-18. See `docs/SAVE-RESUME-SKILL-PLAN.md` for full design. Quick reference:

- `/save` (deep) — end of session: SESSION.md briefing + PROGRESS.md update + DECISIONS.md prepend + auto-memory write
- `/save quick` (lightweight) — stepping away briefly OR auto-fired by PreCompact hook before context compaction
- `/resume` — start of new session: 8-line state block, recreates in-flight tasks, goal-drift check
- Pair with `claude --rename "<workstream>"` for native session-level continuity

**Test status (in_progress task #63):** skills are installed but functional test requires typing `/save` in a fresh session — the building Claude can't invoke its own skills. Test on next session start.

**PDF tier remains untested.** No PDF-bearing shuls in active pool. Docling standalone smoke test passed (arxiv PDF → 1.6 MB markdown in 89s). Defer real-world PDF canary until a PDF shul arrives organically.

**Rollback at any time:** unset `EXTRACTION_V2_SHUL_IDS` → BAYT reverts to v1. Unset `EXTRACTION_PIPELINE_V2` if it gets flipped → all 51 shuls revert. No code revert needed. See `docs/EXTRACTION-V2-ROLLOUT-PLAN.md` for the full rollout doc.

### Historical pickup notes from prior session (kept for reference)

The `extraction-v2` branch (14 commits ahead of main) is built end-to-end and typecheck-clean. v1 is untouched in main. Rollout plan (verbatim from DECISIONS.md "Rollout plan"):

The `extraction-v2` branch (14 commits ahead of main) is built end-to-end and typecheck-clean. v1 is untouched in main. Rollout plan (verbatim from DECISIONS.md "Rollout plan"):

1. Push `extraction-v2` to GitHub for a preview deploy.
2. (Optional) Deploy Docling to Fly.io. Without it v2 PDF tier silently falls back to v1's direct-PDF-to-Claude path — branch still works.
3. Set `EXTRACTION_V2_SHUL_IDS=<one trusted shul id>` in Vercel prod env.
4. Trigger "Extract now" from that shul's admin page.
5. Review the resulting data source: do the new `source` disclosures show under each rule? Confidence higher? Rules correct? Cascade attempts logged with router classification?
6. Good → widen `EXTRACTION_V2_SHUL_IDS` to 5–10 more shuls. Wait one weekly cron cycle.
7. Still good → flip `EXTRACTION_PIPELINE_V2=true` for the global rollout.
8. Monitor the Sunday-morning cron-summary email (built 2026-05-16) for v2-induced regressions.

### Phase 2 candidate pool (FEATURES.md "🚀 Phase 2 features" section)

Documented but not committed-to. Final cut TBD when traction is established. Quick list:
- Telegram chatbot
- Layered Jewish-life map (eruv / mikvah / kosher overlays)
- Multi-language UI (Hebrew, Russian, French, Spanish, Yiddish)
- Predictive "missing bulletin" admin alert
- "Make a Minyan" (ad-hoc location-based) — Isaac-flagged favorite
- **"Tfila for Shuls" gabbai portal** — added 2026-05-16; marked as the most strategically interesting candidate but also the most ambitious (requires sales motion). Triggers: ≥1000 shuls + recurring gabbai complaint, OR a strategic pivot, OR a community org asking to manage multiple shuls.

Each entry has explicit revisit triggers + design notes.

### Active deferred items (Phase 1 cleanup, not Phase 2)

- **Same-origin URL fallback only runs in HTML tier** — deferred refactor. Less urgent since the schedule-page resolver routes URLs to the right page before the cascade.
- **Vision-extractor calibration** — need ~5 more real vision extractions to assess prompt quality on stylized typography.
- **API error-response convention via `lib/http.ts`** — touches every route; deferred from the code-review night. Convention: form POST → 303 redirect with `?err=`; JSON POST → JSON response. Today the three styles are mixed.
- **Per-IP rate limit on `/submit`** — best done at the Vercel WAF level, not in code. Current per-domain cooldown handles the most common spam shape.
- **Email schedule pipeline date-handling verification** — pick up after ~2-3 weeks of real email cycles have run. Walk a real shul (Safra `id=59`) against its source bulletin. See FEATURES.md "Schedule update timing — Needs verification on live data" subsection.
- **21 broken extractions** surfaced by the 2026-05-16 cron-summary script — not yet triaged. May resolve naturally on v2 rollout; if not, walk through the broken list once v2 is the global default.

### Build-stage gaps (deferred until "build phase ends")

### Phase 2 candidate pool (FEATURES.md "🚀 Phase 2 features" section)

Documented but not committed-to. Final cut TBD when traction is established. Quick list:
- Telegram chatbot
- Layered Jewish-life map (eruv / mikvah / kosher overlays)
- Multi-language UI (Hebrew, Russian, French, Spanish, Yiddish)
- Predictive "missing bulletin" admin alert
- "Make a Minyan" (ad-hoc location-based) — Isaac-flagged favorite

Each entry has explicit revisit triggers + design notes. The next "what should we build?" conversation probably starts in this section.

### Active deferred items (Phase 1 cleanup, not Phase 2)

- **Same-origin URL fallback only runs in HTML tier** — deferred refactor. Less urgent since the schedule-page resolver routes URLs to the right page before the cascade.
- **Vision-extractor calibration** — need ~5 more real vision extractions to assess prompt quality on stylized typography.
- **API error-response convention via `lib/http.ts`** — touches every route; deferred from the code-review night. Convention: form POST → 303 redirect with `?err=`; JSON POST → JSON response. Today the three styles are mixed.
- **Per-IP rate limit on `/submit`** — best done at the Vercel WAF level, not in code. Current per-domain cooldown handles the most common spam shape.
- **Email schedule pipeline date-handling verification** — pick up after ~2-3 weeks of real email cycles have run. Walk a real shul (Safra `id=59`) against its source bulletin. See FEATURES.md "Schedule update timing — Needs verification on live data" subsection.

### Build-stage gaps (deferred until "build phase ends")

Per `[[feedback-security-cleanup-deferred]]` — three items in this category, all documented in FEATURES.md:
- Credential rotation (Neon, Inngest, Cloudflare, Google)
- Automated tests (FEATURES.md "Automated tests" gap entry — recommended starting point: 6-line hash-stability test in vitest)
- Auth model rework for co-admin (FEATURES.md "Auth model" gap entry — trigger = first real second-admin user story)

Working definition of "build phase ends" (per SESSION.md): daily active users > 50, ≥3 months without a critical bug shipped, marketing motion in flight. When 2 of 3 are true, revisit.

### Still pending user-side setup (not new)

- **Anthropic Auto-Reload + monthly cap** — recommended after the cascade work bumped per-extraction cost ~10×. The 2026-05-14 hash bug fix should reduce weekly cron LLM spend dramatically (was paying for full extraction every Saturday on every shul).

---

## Done

### 2026-06-07 (evening) — Remediation P3 + P4 complete + adversarially reviewed; PR #5 ✅

Continued the holistic remediation to completion on `fix/holistic-remediation` (PR #5). **P3:** descoped the ShulCloud deterministic adapter after research (P0 already storm-proofed the cascade; the LLM handles ShulCloud's static HTML) and shipped instead **E-B5** report-wrong-time (anonymous tap → `time_report` table, migration 0013 applied to prod → admin triage at `/admin/reports`; never auto-spends LLM) + **E-B3** moat-doc reframe (`e15f580`). **P4:** the full UI pass — UI-8 design tokens (the whole app was silently rendering in **Arial** despite Geist; blue badges → neutral; tap-target/focus floors; amber dots), UI-1 landing, UI-2 feed (date picker navigates on change, upcoming-outranks-started ordering), UI-3 shul (Today/Tomorrow tabs, map clutter cut), UI-4 (/signin + /bot rescued from dead-ends), UI-6 (admin source-quotes default), **E-F1** (the bug that hid every reviewable shul from the queue), UI-5 (admin cockpit 8 tiles → in-place filter chips absorbing /queue + /rejected), UI-7 (candidate tabs) — `d6144a1`, `6dd6ae4`, `5448116`. **Verification:** two adversarial-review workflows (21 agents, ~850k tokens) over the full diff + the admin-UI delta — every confirmed finding was LOW severity; all fixed (`094251a`, `cf7112c`). Also discovered + documented that prod deploys are manual (merge-to-main / `vercel deploy --prod`), not git-push. **Next: merge PR #5 to deploy; then P5.**

### 2026-06-07 — Holistic remediation: 3 reviews → unified plan → P0+P1+P2 to prod ✅

3 exhaustive multi-agent review workflows (error/log audit: 44 findings, 2 refuted; effectiveness: 66 recs, 0 dropped by the skeptic; UI: 53 problems + 8 360px ASCII redesigns) → one unified one-branch plan (`docs/HOLISTIC-REMEDIATION-PLAN.md`). Then executed P0–P2 on `fix/holistic-remediation` and deployed to prod. The site had silently dropped **41→9 active shuls** after the 2026-05-24 Anthropic 429 storm (transient failures → permanent demotions via a one-way trapdoor).

- **P0** `30f71b9` — geo-tz home-feed 500 fixed (next.config `serverExternalPackages`+`outputFileTracingIncludes` + try/catch); no-recovery trapdoor killed (public visibility derived from freshness; cron off `shul.status`); global Inngest concurrency cap (3) = 429-storm-proof; Biome+Vitest+HTTP-smoke safety net + scripts.
- **P1** `a52ec67`/`00fbd7b`/`dd16f89`/`46ae688`/`e910a25` — H5/M13; **v2 retired** (one pipeline, −2643 LOC, H2 resolved); transient 429s retry instead of demote; sticky `review_status` + no `shul.status` demotion → shuls **self-heal** via the weekly cron; email-channel parity (H4/M3).
- **P2 (start)** `0648bb0` — H3 tz-correct day-of-week in the feed; E-C3 code (zmanim render in shul tz on the detail page).
- **Deploy + verify** `c4c65c5` — deployed the P1+P2 batch (`tfila-bph0uab11`, smoke-green); added `scripts/recover-stranded.mjs`; verified the v1 pipeline recovers shul 1 (broken since 05-24) → 5 rules @0.75, auto-restored to approved+ok.

Outstanding next session: full stranded recovery (~29 shuls, gated LLM spend); P2 remainder (tz backfill+migration, seasonal mincha/maariv prompt, Hebcal gating, freshness=time-validity); P3 (ShulCloud adapter); P4 (8-screen UI redesign — wireframes in plan Appendix C); P5 (security/observability/cleanup). Deferred from P1: cosmetic enum-collapse migration + M1 + the `applyExtractionResult` DRY refactor. **Constraint: prod aliases the BRANCH deploy — don't push main until merge.**

---

### 2026-05-20 — `no_change`-as-healthy + async admin Extract Now + OPEN-ISSUES.md (PR #4 `1283563`) ✅

Closes the regression flagged after PR #2/#3: the freshness probe + admin queue's `hasBrokenRun` predicate + Fix CC demote logic all checked `last_run_status = 'ok'` strictly, missing `'no_change'` (which is an equally-healthy state — cron ran successfully but URL hash matched). Three shuls (Bais Menachem, Anshei Lubavitch, Nosson's Shul) were mis-flagged in the "Investigate broken extraction" inbox and their freshness chip showed "never" despite having 14/14/11 rules from approved sources. Broadened 13 reader sites to `IN ('ok', 'no_change')` / `inArray(...)` across `lib/queries.ts` (×7), `lib/freshness.ts`, `lib/inngest/functions/scrape-one-shul.ts` (×3 in Fix CC demote logic), `lib/inngest/functions/weekly-rescrape-summary.ts`, `lib/llm/tools/previous-extraction.ts`.

Also collapsed the admin "Extract Now from this URL" route from inline `await runCascade(...)` (30-120s spinner) to `inngest.send("data-source.requested", ...)` + 303 redirect with the existing `?rebuilt=1` "queued" banner. Same Inngest worker (`buildDataSource`) the per-data_source rebuild button uses. Admin can queue multiple extractions in succession without babysitting.

Seeded **`docs/OPEN-ISSUES.md`** — new rolling log with 12 entries: 2 ✅ resolved in this PR + 10 🔍 deferred (multi-calendar shul UX gaps + Discovery candidates pipeline bugs across HIGH/MEDIUM/LOW severity).

**Post-merge fix:** code review on PR #4 caught that the async refactor dropped the `unsupported → pending_review` status restore on success (was in the deleted inline route, missing from `buildDataSource`). Patched in commit `6cf58a0` (included in the squash) — added conditional restore inside `buildDataSource`'s success transaction so all 4 callers (Extract Now, rebuild, /submit, /inbound/email) auto-recover from `unsupported` when a manual re-extract succeeds.

**Commit:** `1283563 fix: no_change-as-healthy + async admin Extract Now + seed OPEN-ISSUES.md (#4)` — 8 files changed.

---

### 2026-05-19 — UNIQUE INDEX + cross-status dedup (PR #3 `0aba418`) ✅

Closes the dedup + state-machine workstream that PR #2 started. Three cross-status duplicate pairs the original dedupe script missed (it only handled approved+ok-vs-approved+ok) got cleaned up via `scripts/dedupe-cross-status.ts`: Chevra (ds#83 wins vs 3 pending losers), Anshei Lubavitch (ds#80 wins vs ds#79), The Shul (ds#101 wins vs ds#102). 5 sources superseded, 35 minyan_rule rows soft-deleted.

With prod state clean, migration 0012 added the partial UNIQUE INDEX `data_source_shul_identifier_idx ON data_source(shul_id, identifier) WHERE review_status <> 'rejected'`. The persistence layer already supersedes existing same-tuple sources on insert; the index is the DB-level belt to those suspenders. Declared in `db/schema.ts` with matching `.where()` predicate so drizzle-kit doesn't see drift.

Verification: live index has the expected predicate; 0 duplicate (shul_id, identifier) tuples among non-rejected rows.

**PR #3:** `0aba418 chore(db): UNIQUE INDEX on data_source(shul_id, identifier) + supplementary cleanup` — 5 files, +349. Squash-merged. Local `fix/duplicate-data-sources` + `chore/data-source-unique-index` branches deleted.

---

### 2026-05-18 → 2026-05-19 — Phase-1 launch prep shipped; v2 global; ops gates live (commit `48aac17`) ✅

One bundled commit + deploy that closed the implementation half of the gap audit. v2 extraction pipeline flipped to global default for all 51 shuls. Public-facing "shareable to friends" UX layer landed (travel mode + tefillah chips + in-progress live pill + freshness chip + special-schedule labels + OG metadata + sitemap + robots + tap targets). Operational scaffolding wired (Vercel Analytics + Sentry + `/api/health` + Upstash rate limits + LLM cost-gate). PWA shell installable. Three planning docs durable.

**Commit:** `48aac17 feat: phase-1 launch prep + ops gates + UX features` — 31 files changed, +2183/-77. Pushed to `origin/main`. Deploy `tfila-s3zf4v3cj`.

**Productivity setup (Step 0):**
- Vercel CLI 54.1.0 installed globally
- `fewer-permission-prompts` skill ran → added `Bash(vercel ls *)` to project allow-list (most heavy-hit commands were already auto-allowed; thin net gain confirmed honestly)
- Postgres MCP server `pg-neon` registered at user scope (`~/.claude.json`) — pointed at Neon read-only, accessible via `mcp__pg-neon__query`

**Implementation tracks (Steps 1-9 + parallel docs 10-12):**

| Step | Track | What |
|---|---|---|
| 1 | Extraction | `EXTRACTION_PIPELINE_V2=true` in Vercel prod; redeployed |
| 2 | UX bundle | dev-comment strip, OG/Twitter metadata, sitemap.ts, robots.txt, tap targets 28→44px, special-schedule labels in feed (was silent-wrong-data bug), rose→amber badge unification |
| 3 | Analytics | `@vercel/analytics` + `<Analytics />` in layout |
| 4 | Errors + Uptime | Sentry instrumentation (DSN env vars in Vercel); `/api/health` endpoint with DB latency |
| 5 | Rate limits | `lib/rate-limit.ts` via Upstash on `/submit` (5/hr/IP), `/admin/request-link` (3/hr/email + 10/hr/IP), `/inbound/email` (100/day); fail-open before env vars |
| 6 | PWA | `app/manifest.ts`, `public/sw.js`, `ServiceWorkerRegister.tsx`, apple-touch-icon metadata |
| 7 | Travel mode | `?date=YYYY-MM-DD` re-anchors feed to full-day window; inline date picker form |
| 8 | Filter chips | `components/MinyanList.tsx` became client component; Shacharis/Mincha/Maariv chips with live counts |
| 9 | Live pill | Emerald ring + "● live" badge on in-progress minyanim (30m window); 30s ticking state |
| 10 | Trust signal | Freshness `Verified Nd ago` chip — query extended, propagated through types, rendered on feed cards + shul detail header |
| 11 | Ops doc | `docs/RUNBOOK.md` — 5 scenarios (down, cron, cost, leak, DB) |
| 12 | Cost gate | `lib/llm/cost-gate.ts` — `EXTRACTION_DISABLED` kill switch + `LLM_DAILY_BUDGET_USD` soft cap (default $25/day); `docs/COST-BUDGETS.md` policy |
| 13 | Cohort doc | `docs/FIRST-USERS-TEST-PLAN.md` — cohort template + 3-question script + decision criteria |

**Service signups completed:**
- Sentry project + DSN known (in `.env.local` + Vercel prod). User pasted DSN inline in chat — note for rotation policy.
- Upstash Redis database `more-sheep-129736.upstash.io` created (free tier, no card). REST URL inferred from user-pasted `redis-cli` command; ping verified.

**Live verification after push:**
```
/api/health         → 200 {ok:true,db:{ok:true,latencyMs:712}}
/robots.txt         → 200
/sitemap.xml        → 200 (34 active+fresh shul URLs)
/manifest.webmanifest → 200
/sw.js              → 200
```

**Remaining manual step:** UptimeRobot signup → point monitor at `/api/health`. That closes the pre-test checklist.

### 2026-05-18 (afternoon) — Canary expansion complete (3 tiers verified) + `/save` + `/resume` skills built ✅

Two parallel wins in one session segment. **Canary expansion**: env var widened to `EXTRACTION_V2_SHUL_IDS=41,56,67`, redeployed (deployment `tfila-28l4n7f0c`), user re-triggered Extract Now on the new two. **Tools build**: drafted plan → web research → 12 best-practice gaps surfaced → 7 incorporated → built skills end-to-end.

**v2 canary results across 3 tiers:**

| Shul | Tier | v1 baseline | v2 result | v2Meta | sourceQuotes |
|---|---|---|---|---|---|
| #41 BAYT | html | 48 @ 0.92 | 54 @ 0.92 | ✅ | 54/54 |
| #56 The Shul | vision_image | 8 @ 0.95 | **8 @ 0.97** ↑ | ✅ | 8/8 |
| #67 Chevra Ahavas Yisroel | js_rendered | 5 @ 0.92 | 5 @ 0.92 | ✅ | 5/5 |

Vision-tier confidence actually IMPROVED on v2 (Sonnet + extended thinking + context preamble). Cascade fall-through worked correctly on The Shul (router → about_marketing → skipped HTML → JS-render 0 rules → vision 8 rules). HTML-tier-always-attempt fix from earlier (commit `c22a29c`) means router can't short-circuit valid HTML extractions.

**`/save` + `/resume` skills built:**

- `~/.claude/skills/save/SKILL.md` — deep + quick modes; 7 steps from discover → write → report; never overwrites; pure prompt-injection
- `~/.claude/skills/resume/SKILL.md` — 6 steps from gather → recreate tasks → report → drift-check → wait; includes failsafe sanity check for goal drift
- `~/.claude/skills/save/README.md` — user-facing doc
- `~/.claude/settings.json` — merged `PreCompact` hook that auto-fires `/save quick` before context compaction (so even if user forgets, the durable doc gets the critical state before the lossy compression)
- `docs/SAVE-RESUME-SKILL-PLAN.md` — full design (12 best-practice gaps researched, 7 incorporated, 5 deferred). Sources from LangChain, mem0, agentmemory, Zylos, Active Context Compression paper.

Skill design rationale + 8 specific decisions in DECISIONS.md "2026-05-18 (afternoon) — `/save` + `/resume` skill design".

**Test status:** skills are statically verified (YAML frontmatter valid, settings.json valid JSON, PreCompact hook syntax correct per Claude Code spec). Functional test requires typing `/save` in a new session (the building Claude can't invoke its own skills mid-conversation). Task #63 tracks this.

### 2026-05-18 — Extraction Pipeline v2 deployed to prod + BAYT canary verified (4 commits + 1 PR merge) ✅

Deploy day. The `extraction-v2` branch built on 2026-05-17 went live in production behind a per-shul canary flag. BAYT (id=41, HTML tier) is the first verified shul running v2 in prod. **Two real bugs found + fixed mid-canary — exactly the case for per-shul canary over global flip.** Full verbose rationale + the verify-and-rollback playbook in [DECISIONS.md](./DECISIONS.md) "2026-05-17 → 2026-05-18 — Extraction Pipeline v2 deployment + canary".

**Service infrastructure deployed:**

- **Docling on HF Spaces** — pivoted from Fly.io (Wise prepaid card rejected for CC verification) to Hugging Face Spaces in ~5 min. Space `IsKa123/tfila-docling-serve` running `quay.io/docling-project/docling-serve-cpu:latest` on free CPU Basic tier (2 vCPU, 16 GB RAM, ~30s cold start after 48h idle). Smoke-tested end-to-end against arxiv PDF: 1.6 MB clean markdown in 89s. Saved to `.env.local` + Vercel prod env as `DOCLING_URL`.
- **Jina API key** — signed up at jina.ai (free tier, 1M tokens/mo). Authed vs anonymous = 20542 vs 427 bytes on BMNMB test (48× improvement). `JINA_API_KEY` in `.env.local` + Vercel prod.
- **Anthropic billing caps** — user verified cap + spend alert in console.anthropic.com before flipping any traffic to v2.
- **Vercel CLI** — installed globally (v54.1.0), already logged in. Project linked to `prj_zetR9agnTaROAo3sm49AY3oYzUEW`.

**PR + merges:**

- `1cb6c9a` PR #1 — extraction-v2 → main (merged 2026-05-18 14:00 UTC, 16 squashed commits)
- `3c6ab71` fix(docling) — `lib/scrapers/docling.ts` matched to real docling-serve API contract (`/v1/convert/source`, `sources:[{kind:"http",url}]`, response `document.md_content`). Discovered during HF Space smoke-test that my v2 code had guessed at a `/parse` endpoint that doesn't exist. Bumped timeout 60s → 180s.
- `7aa4c73` fix — pass `shulId` to `runCascade()` from all 3 callers (admin extract route, build-data-source Inngest, scrape-one-shul Inngest). **Without this, `EXTRACTION_V2_SHUL_IDS` was a silent no-op** — `shouldUseV2(undefined)` always returned false. Caught immediately because BAYT's first Extract Now showed no v2 markers.
- `c22a29c` fix(cascade-v2) — always try HTML tier; demote `shouldRerenderJs` to advisory only. The router had been classifying `bayt.ca/calendar` as `calendar_widget` and skipping HTML tier, but v1 had successfully extracted 48 rules from that same URL via raw HTML — the schedule IS in static HTML, the router was being too clever. Removed the `shouldRerenderJs` branch entirely.

**Canary results — BAYT (data_source #99):**

| Metric | v1 baseline (ds #41) | v2 result (ds #99) |
|---|---|---|
| Strategy | html | html ✅ |
| Confidence | 0.92 | 0.92 ✅ |
| Rules | 48 | 54 (+6, more granular) |
| Rules with sourceQuote | 0 | 54/54 ✅ |
| Tokens | ~30k | 60k in / 3.6k out |
| Cost | ~$0.05 | ~$0.07 |
| Sonnet fallback | n/a | not needed (Haiku alone hit 0.92) |
| Critique pass | n/a | not triggered |

Sample source quotes: `"6:45am Shacharis"`, `"6:40pm Mincha/Maariv"`. Admin UI shows these as collapsible disclosures under each rule.

**Paused state (immediate pickup item):**

User clicked Extract Now on id=56 (The Shul) + id=67 (Chevra Ahavas Yisroel) AFTER the BAYT canary success expecting v2 to run on those too — but `EXTRACTION_V2_SHUL_IDS` was still `41` only, so both routed to v1 (data_sources #100 + #101 created with v1 output: zero sourceQuotes, no `v2Meta`). Next session: update env var to `41,56,67`, re-trigger Extract Now on those two, then proceed with the rollout plan in `docs/EXTRACTION-V2-ROLLOUT-PLAN.md`.

### 2026-05-17 — Extraction Pipeline v2 — full one-shot rewrite on `extraction-v2` branch (14 commits) ✅

Implementing the chosen one-shot plan from EXTRACTION-ONE-SHOT-PLAN.md. All 16 steps shipped end-to-end in a single day. Branch is `extraction-v2` (kept off main during the rewrite); typechecks clean throughout; v1 is dormant-untouched. **Full decision rationale in [DECISIONS.md](./DECISIONS.md) "2026-05-17 — Extraction Pipeline v2".**

**What got built (commits in order):**

- `ffb873b` Step 1 — Migration 0010 `minyan_rule.source_quote` nullable column. Applied to prod Neon without touching v1 (no code writes yet).
- `00b4e54` Step 2 — Anthropic tool definition for structured output. `extractionOutputTool` wraps the entire extraction schema; eliminates all JSON-parse failure paths.
- `b889963` Step 3 — Five mid-extraction tools: `lookupHebrewDate`, `getSunsetRange`, `getPreviousExtraction`, `validateRule`, `searchHebrewMonth`. Each is `lib/llm/tools/<name>.ts` with a `<name>Tool` export + handler.
- `9c3756e` Step 4 — `build-context.ts` — context preamble: shul metadata (name, address, timezone, nusach) + today's Hebrew date + upcoming holidays + prior extraction summary.
- `f90381a` Step 5 — `router.ts` page-type classifier (7 types) on Haiku + tool use. Skips extraction on about/blog/error pages, jumps to JS tier on calendar widgets.
- `7000743` Step 6 — `jina-reader.ts` HTML preprocessor (Jina Reader free tier, no key needed). Smoke-tested: 901 chars / 233 tokens against bmnmb-com.
- `61707b0` Step 7 — `docling.ts` PDF preprocessor wrapper. Falls back gracefully when `DOCLING_URL` unset.
- `dd88f4e` Step 8 — `agent-loop.ts` shared tool-execution loop + `extract-critique.ts` second-pass audit. Critique triggers when confidence < 0.7 OR rules dropped >50% vs prior. Loop caps at 8 iterations.
- `cc72c0e` Step 9 — `extract-v2.ts` HTML pipeline: Jina → context preamble → Haiku agent loop → Sonnet fallback with extended thinking → conditional critique.
- `b0b1c7d` Step 10 — `extract-pdf-v2.ts`: Docling preprocess → feed into `extractFromHtmlV2` (full reuse). 83 lines because of delegation.
- `91a61a6` Steps 11-12 — `extract-vision-v2.ts` (Sonnet only, extended thinking enabled, critique skipped to avoid double image cost) + `extract-email-v2.ts` (`shulId` optional since email path sometimes creates the shul).
- `4f9e9e9` Step 13 — `cascade-v2.ts` (mirrors v1's 4-tier structure with v2 extractors + router pre-step) + dispatcher in `cascade.ts`. `shouldUseV2(shulId)` reads env flags.
- `f8aeb89` Step 14 — `.env.example` documents `EXTRACTION_PIPELINE_V2`, `EXTRACTION_V2_SHUL_IDS`, `DOCLING_URL` rollout knobs.
- `53fc4d0` Steps 15-16 — `persist-submission` writes `sourceQuote` to DB; admin data-source page shows collapsible "source" disclosure under each rule.

**Architectural highlights:**
- **Source-quote required.** Every v2 rule must include a verbatim quote from the source. Reviewer no longer has to open the URL/PDF to verify each rule.
- **Free-tier tech.** Jina Reader (HTML), Docling (PDF, self-hosted), Hebcal (already installed). No new vendor billing surfaces.
- **Agent loop with 5 tools** — model can resolve Hebrew dates, check zmanim, see prior extraction, validate rules, and resolve Hebrew months during extraction instead of guessing.
- **Feature-flag canary** — `EXTRACTION_V2_SHUL_IDS=12,34` enables per-shul testing; `EXTRACTION_PIPELINE_V2=true` flips globally. v1 stays as fallback.
- **PDF strategy** — Docling preprocess → reuse HTML agent loop. Massive code reuse, single source of truth for the agent infrastructure.

**Rollout status:** branch lives locally + needs push. No env flags set in Vercel prod. v1 serves 100% of traffic. See "Now" above for the deploy sequence.

### 2026-05-16 → 2026-05-17 — Extraction research thread (4 doc commits) ✅

Three living research docs + one chosen-approach plan, written across two sessions before any code was touched:

- `e0d737d` (5-16) **EXTRACTION.md** — tech-stack survey. Firecrawl, Jina Reader, Crawl4AI, ScrapeGraphAI, LlamaParse, Reducto, Docling, Unstructured, Browserbase, Scrapfly, Anthropic tool use. Ranked top 5 swaps by ROI: (1) Anthropic tool use, (2) Jina Reader preprocess, (3) PDF preprocessor, (4) Browserbase swap (low priority), (5) Full Firecrawl replacement (don't — loses our moat).
- `fe72c9b` (5-17) **LLM-CONTEXT.md** — LLM-side strategy survey. Tool use, prompt caching, structured output schemas, citations/grounding, agent loops, extended thinking, multi-pass audit, multi-modal patterns.
- `c747d3c` (5-17) **EXTRACTION-PLAN.md** — first synthesis: a 3-phase rollout over weeks. User pushed back: "I want the best bang for my buck — best possible improvement in one shot."
- `4d1fa2b` (5-17) **EXTRACTION-ONE-SHOT-PLAN.md** — the chosen 16-step build sequence. Free tech only, branch-isolated, feature-flag-gated. This became the build above.

### 2026-05-16 — Observability: cron-summary script + weekly digest (commits `165748d`, `23251e9`) ✅

Closes part of the "no observability" gap from the 2026-05-14 code review.

- `scripts/cron-summary.mjs` — manual on-demand digest. Connects via `DATABASE_URL` from `.env.local`; queries `scrape_run` grouped by status, lists broken/error rows with shul name + slug + error, reports current stale-gate hidden count. Default 6h lookback; `--hours N` to widen. Use Sunday morning to inspect what the Saturday-night cron actually did.
- `lib/inngest/functions/weekly-rescrape-summary.ts` — fires Sundays 04:00 UTC (1h after the weekly-rescrape fan-out at Sun 03:00 UTC). 90-min lookback captures every scrape from the night. Emails `ADMIN_EMAIL` via `notifyAdmin` with counts by status, per-shul broken/error detail, and stale-gate alert if any active shul has dropped off the public surface. Subject line is information-dense: `"Weekly cron · 87 scrapes · 3 issues · 2 stale"`. Skips email entirely when `total=0` (cron didn't fire / deploy paused / `SCRAPE_ENABLED=false`).
- `23251e9` followup — full URLs in cron-summary email + script so links are clickable in Resend (relative `/admin/shul/<slug>` doesn't resolve in mail clients).

**Empirical surprise:** running the script for the first time turned up **21 broken extractions** silently failing for weeks. Sits on the "Now" pickup list — may auto-resolve on v2 rollout; if not, triage post-canary.

### 2026-05-16 — Phase 2 candidate: "Tfila for Shuls" gabbai portal (commit `5949ae8`) ✅

Documented but not committed-to. Reframe from research-mode brainstorm: stop scraping AT shuls, get shuls to PUBLISH to us. Stripe playbook — solve the gabbai's actual operational problem (manually writing weekly bulletins), structured data falls out as a side effect. Pairs structurally with "compute schedule from rules" thread.

Marked as "the most strategically interesting candidate in the Phase 2 pool — but also the most ambitious; not the right starting point unless traction + ICP justify the sales motion."

Triggers: ≥1000 shuls + recurring gabbai complaint, OR a strategic pivot, OR a community org asking to manage 30 member shuls in one tool. First concrete action when triggered: interview 5 gabbais BEFORE building anything; sketch minimum portal in 3 screens; pair-launch with a Vaad to skip the cold-start.

### 2026-05-15 — Documentation + Phase 2 brainstorm (8 doc commits) ✅

Pure documentation session. No code changes; FEATURES.md grew substantially. See [SESSION.md](./SESSION.md) for the full doc commit table.

- New FEATURES entries: schedule-update timing (with live-data verification flag), LLM extraction context exploration (5 options), automated-tests gap, auth-model gap.
- Renamed and re-framed the post-traction section as **"🚀 Phase 2 features (final cut TBD)"** to make explicit these are candidates, not commitments.
- Five Phase 2 candidates now documented with revisit triggers + design considerations: Telegram chatbot, layered Jewish-life map, multi-language UI, predictive missing-bulletin alert, "Make a Minyan" (Isaac-flagged favorite, has detailed "details that need real work" subsection).
- Analyzed 7 user-suggested ideas in conversation; the verdicts (4 skip / 1 small enhancement / 1 link-only / 1 added to Phase 2) are captured in SESSION.md.

### 2026-05-14 (evening) — Code review + 17 fix commits ✅

Full-stack code review (3 parallel agents) + worked through all findings in a single night. Migrations 0008 + 0009 applied to prod Neon. 18-row location backfill completed. See [SESSION.md](./SESSION.md) for the canonical session log.

**Commits, in order:**
- `6a61431` PR1 — `allocateUniqueSlug` shared + admin extract uses `backfillShulLocation`
- `9fbcbbb` PR2 — shared guardrails + `insertRuleFromExtraction`; **email path now respects guardrails** (bad-week emails no longer wipe rules)
- `5889428` PR3 — `persistDataSourceWithRules` + `applyShulNameAndAddressFromExtraction` — completes FEATURES.md "Unified post-ingestion pipeline"
- `f5e2239` Address-search 25-mi nearest-first + per-shul grouping (FEATURES.md "Home-page address search")
- `fe0737e` No-stale-data gate (FEATURES.md "No stale data") — public surfaces hide shuls without a successful run in 14d
- `cd761ed` Admin notes per shul (FEATURES.md "Admin notes per shul") — migration 0008
- `fa17ce3` Housekeeping (FEATURES.md entries, logo source, diag script, favicon)
- `fb06f77` `geocodeAddressIfMissingLocation` — fixes the bug where address-set email-shuls had `location IS NULL` and were invisible to ST_DWithin
- `5443c8c` Admin UX inbox overhaul — verb-first one-row-per-shul; queue/rejected became filtered views
- `c078e1f` MinyanList times in shul TZ instead of server UTC
- `c3eacbf` + `7914b6c` Tagline copy edits
- `49aeb4a` Cost: pageContentHash sanitized-vs-raw bug + Sonnet skip on Haiku zero-rules
- `acbff05` Idempotency: HTML + non-HTML rescrape paths atomic + retry-safe
- `af30511` Security: magic-link single-use + drop attacker-controlled Origin + Postmark fail-closed (migration 0009)
- `21f2b84` Security: SSRF guard + per-domain extraction cooldown on `/submit`
- `9babf55` Correctness: build/scrape race + findShulPlace disambiguation + email guardrail bail
- `282ae08` Refactor: `lib/format.ts` + `components/badges/*` — kill duplication
- `9a002c4` Zmanim TZ from lat/lng (was UTC) + a11y labels + h3 headings + RelativeTime hydration + delete dead `SearchBox`

**Prod-side migrations applied:** 0008 (`shul.admin_notes`), 0009 (`consumed_magic_link`).

**Backfill ran:** 18 shuls had `address` set but `location` NULL — all geocoded via `scripts/backfill-shul-locations.mjs`.

### 2026-05-14 — Cloudflare Worker fetch proxy (anti-bot bypass) (commit `eec5202`) ✅

Chabad of Windsor Terrace (`jewishwindsorterrace.org`) returned 403 from Vercel's outbound IPs even with a real Chrome UA — Chabad.org-hosted sites flag the us-east-1 AWS range. Same URLs work fine from residential IPs or Cloudflare's edge.

- The existing Cloudflare Worker (already deployed for inbound email at `submit@tfila.co`) gained a sibling `fetch()` handler at `/fetch?url=<encoded>`. Bearer-auth via `FETCH_PROXY_TOKEN`. Forwards a GET with a real Chrome UA + Accept headers. Returns body verbatim with upstream status in `X-Original-Status` header.
- `lib/scrapers/fetch.ts` extended with a third tier: branded UA → browser UA → if STILL 403/406, retry via the Cloudflare Worker. `FetchResult.fellBackToCfProxy` flag in the audit trail.
- Worker deployed at `https://tfila-inbound-email.tfila.workers.dev` (claimed workers.dev subdomain `tfila`). `FETCH_PROXY_URL` + `FETCH_PROXY_TOKEN` in Vercel production env.
- **Validated end-to-end**: same Windsor Terrace URL that came back as 0 rules / 403-stub previously now resolves to full 63KB schedule with extractable times.

### 2026-05-14 — Shul discovery system: Places-seeded candidate queue + schedule-page resolver (commits `52158b5`, `cd1c829`, `6f75605`, `7db9325`, `6635159`) ✅

End-to-end pipeline for proactively discovering shuls (vs waiting for URL/email submissions).

- **Ranked target list** — `docs/discovery-targets.md` + `data/discovery-targets.json` with 88 davener-weighted geographies covering ~85% of NA daveners, ~80% of European daveners, plus 35 travel destinations (Israel, Florida, Catskills, ski, Caribbean, European heritage, Asia business hubs). Each row has center lat/lng, radius, recommended Places query variants.
- **Migration 0005** — new tables: `shul_candidate` (place_id UNIQUE for natural dedup, raw_response_jsonb preserved, review_status enum: pending/approved/rejected/duplicate/deferred, no DELETEs — junk rows act as denylist on re-runs) and `discovery_run` (audit log per Places API call).
- **`scripts/run-discovery.mjs`** — CLI batch runner. Idempotent on place_id.
- **`POST /api/admin/discovery/run`** — admin-triggered Places batch query from `/admin/candidates`. Reads `GOOGLE_GEOCODING_API_KEY` server-side so no key exposure.
- **`/admin/candidates`** — listing with status filter pills (pending/approved/rejected/duplicate/deferred), target dropdown filter, URL-presence filter (has URL / no URL / any), "Recently approved · last 24h" section showing each row's current pipeline state, Run discovery picker grouped by region+tier.
- **`POST /api/admin/candidate/[id]/approve`** — creates shul + queues extraction. URL is **required** (Places-returned OR admin-pasted via `urlOverride` field). Dedup-merge into existing shul when domain matches. Address/location backfilled onto existing shul if it was missing. Redirects to `/admin/shul/[slug]` so admin watches extraction land.
- **`POST /api/admin/candidate/[id]/reject`** — required reason, row preserved as denylist signal.
- **Migration 0006/0007** — `no_url` shul status enum value added then dropped within the same session. Product decision: tfila.co only publishes shuls with live minyan times, so a row without times shouldn't exist; approve requires a URL. The one existing `no_url` row (Congregation Chevra Shas Bais Mordechai, id=61) was downgraded to `archived` during the swap.
- **`lib/discovery/find-schedule-page.ts`** — `resolveScheduleUrl(rootUrl)` hybrid resolver: tries ~15 common schedule paths first (`/schedule`, `/times`, `/minyan`, `/davening`, `/worship/shabbat`, etc., requires keyword + time-like content match), scans root page links via cheerio for schedule keywords, falls back to Claude Haiku LLM scout that picks the best link from the homepage nav. Returns the resolved URL (or root URL with low confidence as fallback). Wired into both `/api/admin/candidate/[id]/approve` and `/api/submit` so the resolved URL replaces the root in `shul.submittedUrl` + `match_domain` + extraction event payload.
- **Concrete win**: ShulCloud sites like `jewishwindsorterrace.org/templates/articlecco_cdo/aid/2710598/jewish/Times-and-Schedule.htm` whose schedule lives at an opaque numeric-AID URL — LLM scout picks it from the homepage nav and the cascade extracts from the right page first try.

### 2026-05-14 — Pipeline parity step 1: shared address backfill (commit `6afdcbb`) ✅

First slice of the FEATURES.md "Unified post-ingestion pipeline" entry. Email-derived shuls were second-class — extracted rules without `shul.address`/`shul.location` because the email path didn't call Google Places like the URL path did.

- Extracted `findShulPlace()` inline usage from `build-data-source.ts` into a reusable helper `backfillShulLocation()` in `lib/geocoding.ts` (reads shul, calls Places, writes address + location if confidence ≥ 0.7).
- `process-email.ts` now calls the same helper in a new `address-fallback` Inngest step. Uses `extraction.shulName` + the normalized `websiteUrl` (already extracted for dedup) as inputs.
- Email-derived shuls now show up in geo queries / map view alongside URL-derived ones.

### 2026-05-14 — Email-extract prompt tightening (commit `4b1fc95`) ✅

Edmond J. Safra Synagogue forwarded email landed with all 12 rules marked `ad_hoc` + `validFrom=validTo=2025-05-08/09` (also wrong year — LLM defaulted to past). Two prompt corrections:

1. Default to **regular weekly** rules. Only date-bound when TIMES themselves are unusual/labeled one-off (Tisha B'Av, Yom Kippur, fast days). Parsha + dates in the header are decoration, not a one-off signal.
2. **Date handling** — for partial dates ("May 8-9" with no year), never default to a year in the past. Use upcoming occurrence or email's own date as the floor.

Direct SQL fix on Safra's existing 12 rules: reshape to regular weekly with `daysOfWeek=[5]` (Friday) and `[6]` (Shabbos), `validFrom/To=NULL`.

### 2026-05-14 — Logo wired (commits `f3ca054`, `f3539b8`) ✅

User generated `tfila-b.png` via Gemini (drop-pin + open siddur, amber-800 on white, monotone wordmark). Built `scripts/build-logo-assets.mjs` that runs `sharp` to produce:
- `app/icon.png` (512×512, icon-only)
- `app/apple-icon.png` (180×180)
- `app/opengraph-image.png` (1200×630, full logo + "Find the next minyan near you" tagline)
- `public/favicon.ico` (32×32 PNG-as-ICO for legacy /favicon.ico clients)

Next 16 auto-wires the `app/`-rooted ones via convention. `public/favicon.ico` is a static fallback. Header text wordmark (`tfila` + amber-700 `.` + `co`) deliberately kept — scales pixel-perfect at any size, zero payload cost.

### 2026-05-14 — Inngest registration recovered + Vercel-Inngest integration installed ✅

Email forwards were landing in Inngest but never dispatching to `processEmail` — discovered Inngest's function registry was empty. Account was under `yossikassrr@gmail.com` (primary changed to `isaac.kass@gmail.com` mid-session). After installing the Vercel-Inngest marketplace integration, manually syncing the app via dashboard (`https://tfila.co/api/inngest`), and patching `INNGEST_SIGNING_KEY` in Vercel production to match the workspace, function registration stuck and the next Safra forward dispatched + persisted (shul id=59 with 12 rules, ~$0.0125 LLM cost). Vercel auto-syncs preview deploys via the integration going forward; production may need a manual click-sync after function changes.

### 2026-05-14 — Migration 0004 applied (match_domain on shul) ✅

PROGRESS.md from 2026-05-13 had migration 0004 written but never applied to production Neon. Discovered when `/admin/shul/edmond-j-safra-synagogue` 500'd because Drizzle's `SELECT *` referenced a column that didn't exist in the DB. Applied via direct `pg` connection to the production Neon branch (`phase-1-migration` — the actually-default branch; the branch literally named "production" is empty in Neon's UI). `match_domain` column + index landed; all subsequent /admin/shul pages render cleanly.

### 2026-05-14 — Shared-MTA dedup fix (commits `7bfa7bd`, `49e8f36`) ✅

Forwarded shul emails relayed through `info@myshul.com` (a shared mailing-list service that serves many shuls) ended up with `match_domain = "myshul.com"` — the next MyShul-hosted forward would silently auto-merge into the first row regardless of which shul it was actually for. Fix keys dedup off the shul's OWN domain (LLM extracts `shulWebsite`, regex fallback over body URLs), not the sender's MTA. Post-review hardening added `normalizeWebsiteUrl()` at the boundary so LLM-hallucinated shared-MTA strings or malformed URLs can't sneak through. Full design in FEATURES.md "Deduplication" amendment section.

### 2026-05-13 — Cascade verified end-to-end on real shuls ✅

- **anash.ca/daven** — JS-injected image src case. Cascade picked `vision_image` strategy via Browserless rendering. Worked.
- **theshul.org** — re-ran "Extract now" after the Places key landed in production. Google Places address backfill populated the address from the shul name + URL hint. Worked.

Both confirm the production cascade behaves as designed across the four tiers (HTML / JS-rendered / Vision / PDF) and that the address fallback fires correctly when LLM extraction doesn't surface an address.

### 2026-05-13 — Housekeeping pass (commit `<pending>`) ✅

End-of-day pass through the high-severity items from the morning review + the Bal Harbour Places miss:

- **Browserless prod warning** — `lib/scrapers/render.ts` now logs a `console.warn` when `BROWSERLESS_API_KEY` is unset in production. Misconfig in Vercel surfaces in logs instead of silently degrading the cascade.
- **NULL extractionStrategy guard** — `lib/inngest/functions/scrape-one-shul.ts` explicitly treats `null` strategy as `html` (the implicit default for pre-cascade rows). No more relying on the absence-of-failed-or-resource as the only filter.
- **`process-email.ts` Inngest step timeout** — adds an explicit step timeout so a hung concurrency-locked email processing step doesn't queue forever.
- **Zod schema for `cascade_attempts`** — `lib/llm/cascade.ts` exports a `CascadeAttemptSchema`. Admin UI (`/admin/shul/[slug]` and `/admin/data-source/[id]`) validates the array on read, so a future shape drift fails loud (Zod error) instead of silently hiding fields.
- **Typed `minyan_rule.time` insert helper** — `db/schema.ts` exports `serializeMinyanTime()` that wraps the tagged-union JSONB cast. Removes four `as unknown as object` casts across `build-data-source.ts`, `scrape-one-shul.ts`, and the admin extract route.
- **Loosened Places filter** — `lib/geocoding.ts` `findShulPlace` drops the strict `includedType: "synagogue"` filter. Now relies on existing type-scoring (`synagogue` +0.4 / `place_of_worship` +0.25 / `religious_organization` +0.15) and the 0.7 confidence threshold to filter. Recovers shuls like The Shul of Bal Harbour that Places tags as `place_of_worship` but not `synagogue`.
- **`.env.example` now tracked in git** — single-file exception in `.gitignore`. Documents `BROWSERLESS_API_KEY` and `GOOGLE_GEOCODING_API_KEY` for future contributors.
- **Docs catch-up** — PROGRESS.md, SCOPE.md, IDEAS.md all reflect current state.

### 2026-05-13 — AGENTS.md clarifying-questions rule + Places key in prod (commit `2a0c7bd`) ✅

- **AGENTS.md** — new rule: before making code changes for any **new feature**, ask 3 clarifying questions via `AskUserQuestion` to lock down scope, surface, defaults, trigger. Carve-outs: concrete bug fixes, typo/copy edits, trivial renames, continuing approved work. Lists 7 candidate topics, picks 3 most load-bearing.
- **Places API verified** — `scripts/verify-places-api.ts` runs three real shul lookups (Agudath South, The Shul of Bal Harbour, Lincoln Square Synagogue). After enabling Places API (New) on the GCP project AND adding it to the key's API restrictions, 2 of 3 returned matches with confidence ≥ 0.7. The 1 miss (Bal Harbour) prompted the filter-loosening above.
- **`GOOGLE_GEOCODING_API_KEY` added to Vercel production** — was missing entirely (reverse-geocode + address-backfill features had been silently no-oping in prod).

### 2026-05-13 — Public shul page restructure + Places address fallback (commit `1e831ef`) ✅

- **"Verify Schedule source" section split into two paragraphs**: the "Times above are extracted..." prose, then "Verify against the source directly: <URL>" on its own line. Reduces wall-of-text feel.
- **"Other days · weekly breakdown" disclosure** — site's main job is "current minyan times," so today's schedule stays as the headline. Date picker + recurring weekly table moved into a collapsed `<details>` that auto-opens when a non-today date is selected via URL.
- **Address-from-search fallback** — `lib/geocoding.ts` `findShulPlace()` (Google Places Text Search v1) by shul name + URL hint. Scored by name-token overlap + type. Wired into Inngest `buildDataSource` AND the admin manual-extract route as a post-extraction step. Applies when confidence ≥ 0.7 and shul row has no address. Admin success banner shows `📍 Address backfilled from Google Places`.

### 2026-05-13 — Weekly cron Sat 10pm ET + public "last updated" (commit `debd782`) ✅

- **Cron**: was `0 13 * * MON` (Mon 13:00 UTC ≈ 9am ET). Now `0 3 * * SUN` (Sun 03:00 UTC = **Sat 22:00 ET**). Captures shul bulletins right after motzaei Shabbos, so Sunday daveners hit fresh data.
- **Public shul page** now shows "Last updated <date/time>" in a separate paragraph below the source-attribution section. Pulls `data_source.lastRunAt` via new `getMostRecentScrapeForShul()` query.

### 2026-05-13 — Vision/PDF identifier persistence (commit `e2dfefd`) ✅

theshul.org's first successful vision extraction stored the data_source `identifier` as `Times-Bamidbar5786.png`. Next week the filename rotates to `Times-Naso5786.png` (parsha names change weekly) — weekly rescrape would chase a stale URL.

Fix: for `vision_image` and `pdf_document` strategies, `data_source.identifier` = the submitted page URL (the stable target). `configJson.last_extracted_resource` = the per-week resource URL for the audit trail. Weekly rescrapes re-target the page and re-discover the current week's resource. Three places fixed (Inngest path, admin manual route, weekly rescrape). Admin success banner now strategy-aware: "extracted this week's schedule from <resource>" instead of "consider updating your source URL" (which was exactly wrong for rotating filenames).

`scripts/backfill-resource-identifier.ts` — idempotent backfill; ran tonight against prod (1 row updated, theshul.org `ds 51`).

### 2026-05-13 — Cascade reorder: Vision before PDF + timeout bump (commit `1820270`) ✅

theshul.org's earlier cascade attempt hit Vercel's 60s function timeout because it was trying 3 multi-MB bulletin PDFs through Claude before reaching the Vision tier, where the actual clean schedule image lives.

- **Tier order is now HTML → JS-rendered → Vision → PDF → failed.** Shul-published schedule images are typically small + clean weekly snapshots; bulletin PDFs are multi-MB kitchen-sink documents. Vision is faster AND higher-signal per dollar when both are available.
- **PDF tier capped at 1 candidate** (was 3). Bulletin PDFs are slow to fetch and process; if the best-scored candidate misses, the next is unlikely to hit.
- **Admin extract `maxDuration` bumped 60 → 300.** Vercel's platform default since 2026-Q1; we were overriding to 60.

### 2026-05-13 — Cascade base64 input for robots.txt-protected CDNs (commit `9600363`) ✅

theshul.org's cascade was finding all the right resources (3 PDFs + 3 schedule images) but every Claude call failed with `400 "This URL is disallowed by the website's robots.txt file."` Anthropic's URL fetcher respects robots.txt; ShulCloud's CDN (`images.shulcloud.com`) disallows automated agents — blocks every ShulCloud-hosted shul from URL-based extraction.

- **`lib/scrapers/fetch-binary.ts`** (new) — fetches the bytes ourselves with our Tfila-Bot UA (browser-UA fallback on 403/406), 25 MB cap, returns `{bytes, mimeType, ok, fellBackToBrowserUa}`.
- **`extract-pdf.ts` + `extract-vision.ts`** now fetch the resource locally then pass `Base64PDFSource` / `Base64ImageSource` to Claude. Anthropic only enforces robots.txt when it's the fetcher; daveners are legitimately viewing the shul's published bulletin.

### 2026-05-13 — Cascade dual-HTML scan (commit `1cb340b`) ✅

theshul.org's cascade reported "no .pdf links found" even though the weekly-magazine PDF is in the static curl-fetched HTML. Browserless's rendered output evidently strips/transforms those `<a href="*.pdf">` links during rendering.

- **`findPdfCandidates` and `findImageCandidates`** now accept an array of HTML sources (static + rendered) and dedupe by absolute URL. Catches theshul.org case (PDF in static, stripped by Browserless) AND helps the inverse anash.ca case (image src empty in static, populated by JS in rendered).
- **`scripts/reset-shul-status.ts`** (new) — un-marks shuls from `unsupported` → `pending_review` so admin can retry after a cascade bug fix lands.

---

### 2026-05-13 — Cascade extraction bug fixes (commit `139000d`) ✅

Diagnosed and fixed the three issues that surfaced on the first theshul.org extraction attempt:

- **Removed assistant-message prefill** from all 5 extractors (HTML, email, address, PDF, vision). Anthropic returned 400 "model does not support assistant message prefilling" on some calls; the tolerant `extractJsonObject` parser (PR 21) already handles prose preambles, so prefill was belt-and-suspenders.
- **Made PDF/image candidate regex permissive** — previously required text-only `<a href="*.pdf">text</a>`, missed links wrapped around `<img>` thumbnails (which is how most shul sites publish weekly bulletin PDFs).
- **Cascade now ALWAYS records an attempt entry** — previously when a tier found 0 candidates or had no HTML, no `attempts[]` entry was pushed and admin couldn't see the tier was reached.
- **Verbose admin breakdown UI**: both `/admin/shul/[slug]` (when latest data_source is `failed`) and `/admin/data-source/[id]` now show a per-tier cascade-attempt list with strategy, status, rules count, confidence, resource URL, and error message. The data-source detail page highlights the winning tier with a green "winner" badge.
- **Diagnostic scripts**: `scripts/inspect-failed-extraction.ts` (DB query for latest failed extractions), `scripts/debug-cascade.ts` (run cascade with full per-tier output, no DB writes), `scripts/verify-migration-0003.ts` (sanity check migration applied).

**Result on theshul.org**: cascade now runs all 4 tiers but PDF tier reports "no .pdf links found" — see "Now" section above for the next fix.

### 2026-05-13 — Extraction cascade: HTML → JS → PDF → Vision → failed (commit `ce0fae6`) ✅

Implements the layered extraction pipeline the user designed. Each tier is more expensive than the last; the cascade only fires the next tier on a real miss. The winning strategy is persisted on `data_source.extraction_strategy` (new enum) so weekly rescrapes skip the cascade and go straight to the known-good tier. Sites where every tier fails get `shul.status='unsupported'` and the weekly cron skips them entirely.

- **`lib/llm/cascade.ts`** (new) — orchestrator with PDF/image candidate scoring. Favors `schedule|bulletin|minyan` keywords in URL + alt text; penalizes `donation|sponsor|membership`. Bounded at 3 candidates per tier per page.
- **`lib/scrapers/render.ts`** (new) — Browserless `/content` integration. Waits for `networkidle2`. Silently no-ops if `BROWSERLESS_API_KEY` is unset.
- **`lib/llm/extract-pdf.ts`** (new) — Claude PDF input via `URLPDFSource` document block. Haiku → Sonnet escalation. Native PDF handling = OCRs scanned PDFs automatically.
- **`lib/llm/extract-vision.ts`** (new) — Claude vision via `URLImageSource` image block. Sonnet only (Haiku vision is too weak for handwritten / stylized schedules).
- **Migration `0003_extraction_strategy.sql`** — new `extraction_strategy` enum + column on `data_source`, plus `'unsupported'` added to `shul_status`. Backfills 46 existing website data sources to `extraction_strategy='html'`.
- **Wired into**: `buildDataSource` (Inngest, new submissions), `/api/admin/shul/[id]/extract` (manual admin trigger), `scrapeOneShul` (weekly cron — skips failed/unsupported, pins to stored strategy for non-HTML).
- **Admin UI**: strategy chip on `/admin/data-source/[id]` with hover description, strategy chip on each data_source row in `/admin/shul/[slug]`, `'Unsupported'` added to status labels + filter on `/admin/shuls`.
- **User-side setup completed tonight**: `BROWSERLESS_API_KEY` added to Vercel production env, migration 0003 run on Neon (verified by `scripts/verify-migration-0003.ts` — 46 rows backfilled, all checks pass).

Test cases on the menu for tomorrow: theshul.org (PDF tier), anash.ca/daven (JS-rendered + PDF/vision).

### 2026-05-13 — Light-mode CSS fix (commit `f5f71f7`) ✅

Phone screenshots showed black page background with white tiles floating. Cause: `create-next-app` boilerplate `globals.css` had a `@media (prefers-color-scheme: dark)` block setting `--background: #0a0a0a`. The body's `background: var(--background)` (unlayered selector) won over Tailwind's `bg-stone-50` utility (in `@layer utilities`). We never designed a real dark theme, so OS dark mode exposed an inconsistency.

Fixed by removing the dark-mode block from `globals.css` and adding `viewport.colorScheme = "light"` to `app/layout.tsx` (Next 16 pattern, emits `<meta name="color-scheme" content="light">`). Latter also blocks Chrome on Android's "Force Dark for Web" setting from inverting the page.

### 2026-05-13 — Add-a-shul tile becomes functional + STYLE.md (commit `5501aa3`) ✅

The Add tile now embeds the URL submit form (POSTs to `/api/submit`, no client JS) and shows `submit@inbound.tfila.co` inline in an amber pill. `/submit` is reserved for the optional auto-forward setup walkthrough only. Aligns Add with the Find + Look-up cards as a functional widget.

**`STYLE.md`** (new) — codifies the project's UX north star: minimal clicking, simple clean aesthetics. Documents the form-on-card pattern, no-auto-redirects rule, palette (`amber-800` accent only), density/spacing, copy voice, and a "done" checklist. Future UI changes should reference this.

### 2026-05-13 — Live fuzzy shul lookup + reachable home (commit `5fa44ab`) ✅

Two issues off real-use feedback:

1. **Home page reachable when location is saved.** Previously `FindCard` auto-redirected on mount, so clicking the logo bounced back to the feed. Removed auto-redirect. New `ResumeBanner` shows at the top of the landing if a saved location exists, with one-click `Resume →` and `Clear` actions.
2. **Look-up tile has live fuzzy search embedded.** Client-side subsequence matching (same algorithm as VSCode's command palette) — type "agdh sth" and "Agudath South" matches. Scoring favors exact substrings, name over address, word-boundary hits. Shows up to 8 results, each → `/shul/[slug]`. Shul list (~150 rows) fetched once on SSR, zero API roundtrip per keystroke.

### 2026-05-13 — Three-card home + sticky feed header (commit `4ba8ebd`) ✅

Reworked the home page to surface tfila.co's three jobs (Find a minyan, Look up a shul, Add a shul) as equal-weight cards on the landing. Stacked on mobile, 3-col on tablet+.

- **No-location landing**: three cards — Find (functional: `📍 Use my location` button + address-input fallback), Look-up (nav tile → `/find`), Add (nav tile → `/submit`).
- **Feed view (with location)**: new sticky `FeedHeader` keeps the three jobs reachable on every scroll — logo, 🔍 search, `+ Add shul`, place chip with reverse-geocoded name ("Crown Heights, NY") instead of raw `lat,lng`. Drops the awkward "Switch:" inline search and the lat/lng coord line.
- **Reverse geocoding** added to `lib/geocoding.ts` via Google's `latlng` API.
- **Zmanim tooltips** added to `ZmanimStrip` — hover any chip to see the full name + meaning of "Sof Tef", "Plag", "Mincha G", etc.

### 2026-05-13 — Admin: Rejected section + unreject (commit `167e05d`) ✅

Rejected data_sources previously had no way back into the review flow. New `/admin/rejected` page lists every rejected data_source with three actions per row:
- Review rules → opens detail page
- Move back to pending → new `/api/admin/data-source/[id]/unreject` route flips status back to pending so it shows in the queue again
- Approve → same direct-approve flow as the queue

Data-source detail page now shows "Move back to pending" instead of "Reject" when the data_source is already rejected. New "Rejected" nav link in the admin header.

---

### 2026-05-12 — PR 21: same-origin candidate-URL fallback for LLM extraction ✅

Diagnosed why `https://www.bethshalomaustin.org/calendar` returned 0 rules: it's a Reform shul on ShulCloud where `/calendar` is the events widget (Torah Study, social programs) and the actual service times live at `/worship/shabbat`. Our extractor faithfully reported "no minyan content found here", which was correct — but unhelpful. Now if the submitted URL yields nothing useful, we try a short list of well-known service-times paths on the same origin and pick the best result.

- **`lib/llm/extract-with-fallback.ts`** (new): wraps `extractFromHtml` with a per-origin candidate cascade. Trigger: `confidence < 0.4` OR `rules.length === 0`. Candidates (in order): `/worship/shabbat`, `/services`, `/service-times`, `/schedule`, `/minyan`. Short-circuits as soon as a candidate hits `confidence ≥ 0.6` AND has rules. If no candidate beats the submitted URL, returns the original result. Tracks per-URL `attempts[]` (status + httpStatus + confidence + rulesCount) for the audit trail. Worst case: 6 LLM extractions per submission (still bounded; most pages succeed on the first try).
- **`lib/inngest/functions/build-data-source.ts`**: replaces the two-step `fetch-html` + `llm-extract` with a single `fetch-and-extract` step using the new helper. `data_source.identifier` and `configJson.page_url` now store the **winning URL** (not the submitted one), so weekly rescrapes hit the URL that actually had the data. `configJson` also gets `submitted_url`, `used_fallback`, and `fallback_attempts[]` for the admin reasoning trail.
- **`app/api/admin/shul/[id]/extract/route.ts`**: same swap. On success, redirect carries `?from=<winningUrl>` when a fallback was used.
- **`app/admin/shul/[slug]/page.tsx`**: success banner now shows the winning fallback URL when applicable, with a hint to update the source URL to match (so future rescrapes have a stable submitted URL too).

**Why this is OK to ship without re-extracting existing data:** the change only affects new extractions. Existing data_source rows keep their original `identifier`. To rebuild bethshalomaustin.org, click "Extract now from this URL" on the admin page — it'll now find `/worship/shabbat` automatically.

---

### 2026-05-12 — PR 11: forward-an-email ingestion (gabbai-free) ✅ (app code; inbound vendor pending user setup)

Closes the "Phase 2" email-newsletter source loop SCOPE.md called for, with the user-revised flow: **any davener forwards their shul's weekly email once, the LLM auto-creates the data_source keyed by the original sender's email, and subsequent forwards from the same original sender keep the rules fresh — gabbai never touches anything**. Special-schedule emails (Tisha B'Av, three weeks, Yom Tov) add date-bounded rules without overwriting the routine weekly pattern.

- **`lib/inbound/extract-original-sender.ts`**: heuristic that finds the original "From: …" line in a forwarded body. Handles Gmail (`---------- Forwarded message ----------`), Outlook (`________`), Apple Mail (`Begin forwarded message:`), and Yahoo (`----- Forwarded Message -----`) forward markers. Returns `{email, name|null}` or null. No LLM call.
- **`lib/llm/extract-email.ts`**: email-tuned extractor. Reuses the PR 3 Zod schema but with a flat-text, date-aware system prompt and 3 inline few-shot examples (routine weekly, Tisha B'Av, non-schedule). Haiku 4.5 → Sonnet 4.6 fallback below 0.4 confidence. Prompt-cache flag on the system block.
- **`POST /api/inbound/email`**: Postmark-shaped JSON webhook receiver. HTTP Basic auth via `POSTMARK_INBOUND_USERNAME` + `POSTMARK_INBOUND_PASSWORD` env vars (skipped when either is unset, for local dev / synthetic tests). Validates payload, extracts original sender from the body, fires Inngest event `email.received`. Returns 202 without waiting for LLM (webhook responses must be fast). `maxDuration=30s`.
- **`lib/inngest/events.ts`**: added `email.received` typed payload.
- **`lib/inngest/functions/process-email.ts`** (registered alongside the four existing Inngest functions): looks up data_source by `(kind=email_newsletter, identifier=originalSenderEmail)`. **First-time sender → creates a new shul + data_source with `status=pending_review`** (lands in your admin queue). Existing sender → just refreshes rules. The persistence layer is careful:
  - **Regular rules REPLACE** existing regular rules for the data_source (latest email is authoritative for weekly pattern).
  - **Special-schedule rules ADD** to whatever's there (priority 10, with `validFrom`/`validTo` set by the LLM from email date context).
  - Per-shul concurrency cap of 1 (no race when multiple weekly emails arrive simultaneously).
- **`/submit` rewritten** with two clearly-labeled options: "Submit a URL" (existing form) and "Or, forward your shul's weekly email" (showing `submit@inbound.tfila.co` in a copy-friendly amber pill + collapsible auto-forward setup instructions for Gmail and Outlook). Explicit copy: "no gabbai action is needed for either".
- **`/admin/queue`**: email-newsletter entries now render with a `mailto:` link on the identifier (since for email kind, the identifier IS an email address, not a URL).
- **`scripts/test-inbound-email.ts`**: posts a synthetic Postmark-shaped forwarded email payload to the local `/api/inbound/email`. Lets you exercise the whole pipeline (sender extraction → Inngest dispatch → LLM → DB persist) without setting up Postmark first.
- **Build verified**: 16 routes (+/api/inbound/email).

**What's left for production (user-side setup):**
1. Sign up at [postmarkapp.com](https://postmarkapp.com) → create an Inbound stream
2. Configure DNS — Postmark walks you through 3 MX/CNAME records for `inbound.tfila.co` (or use Postmark's bare `xxx@inbound.postmarkapp.com` address as a quick start with no DNS)
3. In Postmark's inbound stream settings: webhook URL = `https://tfila.vercel.app/api/inbound/email`, optionally set HTTP Basic Auth credentials (and mirror them in Vercel env as `POSTMARK_INBOUND_USERNAME` + `POSTMARK_INBOUND_PASSWORD`)
4. Update the displayed address on `/submit` (currently hardcoded to `submit@inbound.tfila.co`) to whatever Postmark gives you, if different. Already lifted out as a constant in `app/submit/page.tsx`.

### 2026-05-12 — PR 10: location search + UX polish ✅

- **`/api/search?q=…`**: server route that geocodes free-text via existing Google API and 303-redirects to `/?lat=X&lng=Y`. Handles empty input + no-results + API errors with proper error params.
- **`components/SearchBox.tsx`**: plain HTML form, no client JS. Two variants — `full` (label + helper text, used in LocationGate) and `compact` (inline, used in feed header).
- **LocationGate updated**: search field appears below the "Use my location" button as an `or` alternative. Users who don't want to grant browser geolocation can now type a city/zip/address.
- **Feed header updated**: compact search box always visible so users can swap locations in one click without going back to the gate.
- **`components/ChangeLocationButton.tsx`** (new client component): replaces the static `<Link href="/">change location</Link>` which was broken — clicking it bounced back instantly because LocationGate auto-redirects from localStorage. The new button explicitly clears localStorage before navigating to `/`, so the gate actually shows.
- **Visual refresh**: cream background (`bg-stone-50` on body), softer ambers (`amber-700`/`amber-800` accents for brand wordmark + "Submit your shul" CTAs), more generous padding (`px-5 py-6/12`), rounder cards.
- **Submit + About links** now visible in home-page header and footer in both location-gate and feed states.

### 2026-05-12 — PR 9: production Inngest + Resend wired ✅

- Inngest: signed up under `isckas`, generated Test-env Event Key + Signing Key, added both to Vercel production env vars. Redeployed. `/api/inngest` now returns 401 to unauthenticated curl (was 500) — the expected response from a signature-protected handler. User still needs to sync the app URL inside the Inngest dashboard (one-time step) and switch to Production-env keys when ready for the real cron.
- Resend: API key added to Vercel + `AUTH_EMAIL_FROM=onboarding@resend.dev` (until tfila.co domain is verified in Resend). Admin magic-link emails now actually deliver to the inbox.

### 2026-05-12 — PR 8: public submission form + admin approve/reject ✅

Closes the data-input loop. Anyone can submit a shul URL; you (admin) can approve or reject the extracted config from `/admin/queue`.

- **`/submit` page**: simple HTML form (URL + optional contact email). No JS, no client-side state. Success / error states via query string.
- **`POST /api/submit`**: validates URL, checks for duplicates, fetches the page, calls `extractFromHtml` (PR 3 extractor), tries to find an address too (`extractAddressFromHtml` from PR 6 + Google geocode + `geo-tz` timezone), persists shul + data_source + minyan_rules in a single transaction with `status=pending_review` and `review_status=pending`. Synchronous — takes ~10-30s per submission but that's fine UX for a one-time form. (Inngest is wired in code for async, but until production Inngest keys are set we run inline. Easy switch later.)
- **`/api/admin/data-source/[id]/approve`**: auth-gated, flips data_source.review_status to approved AND flips shul.status to active. Records reviewer email + timestamp in reviewer_notes.
- **`/api/admin/data-source/[id]/reject`**: auth-gated, flips review_status to rejected. Rules stay soft-linked but the feed query excludes them.
- **`/admin/queue` rewritten** from read-only table to a list of cards with inline Approve / Reject form buttons.
- **Build verified**: 14 routes registered (+/submit + /api/submit + /api/admin/data-source/[id]/{approve,reject}).

### 2026-05-12 — PR 7: data-quality backfill (timezones + LLM-re-extracted rules) ✅

Two one-shot scripts that fix the two data-quality issues uncovered by the PR 5 smoke test, plus a small home-page UX tweak.

- **`scripts/backfill-timezones.ts`** (new): for each shul with location set and timezone null, derive timezone via `geo-tz` package (`find(lat, lng)`) and persist. Idempotent. **29 of 29** shuls now have correct timezones (America/New_York, America/Los_Angeles, America/Chicago, America/Detroit, America/Toronto). Fixes the zmanim resolver for non-Eastern shuls.
- **`scripts/reextract-rules.ts`** (new): for each shul with location, re-fetches submitted_url, runs `extractFromHtml` (the PR 3 LLM extractor), and replaces the sprint-1-era rules with fresh ones. Upgrades existing data_source rows from `kind=shulcloud_website` to `kind=website_llm` with `review_status=approved` (skips the queue — this is the admin-authoritative refresh). Soft-deletes old rules in the same transaction.
  - **15 of 29** successfully re-extracted (confidences 0.75–0.92, 67 fresh rules)
  - **9** skipped (confidence < 0.5 or 0 rules — pages without parseable schedules)
  - **12** failed near the end with Anthropic `400 invalid_request_error` (looks like API credit limit). Top up at `console.anthropic.com` and re-run; the script is idempotent.
  - Cost: ~$0.93 in Haiku 4.5 tokens (858K input / 15K output)
- **Home page window widened**: `app/page.tsx` `FUTURE_WINDOW_MIN` from 6h → 24h, added `MAX_ITEMS = 25` cap. Previously the feed was empty for anyone visiting at off-peak times (e.g. 9 PM ET when today's evening minyanim are done and tomorrow's morning is >6h away). Now you see the next ~25 minyanim in the next day.

**Known residual data-quality issue (not blocking, follow-up):** Some sprint-1 ShulCloud calendar pages produce LLM extractions with fixed clock times (e.g. "Mincha 7:35") rather than zmanim-relative (e.g. "Mincha 18 min before shkia"). The LLM sees the resolved time on the calendar widget for *this week* and faithfully reports it. Times will drift week-to-week. Fix is per-shul: improve the prompt for ShulCloud-specific inputs, or pivot to a shul's static schedule page when available.

### 2026-05-12 — PR 6: address backfill (29 / 39 shuls geocoded) ✅

One-shot script that closed the biggest blocker on PR 5 — every sprint-1 shul had `location = NULL` because addresses were never captured. Now 29/39 (74%) have real lat/lng + a normalized street address.

- **`lib/llm/extract-address.ts`**: focused Haiku 4.5 call (~1500-token prompt, no caching needed). Output schema is `{address: string|null, confidence: number, reasoning: string}` via Zod. Cheaper than the full schedule extractor (`lib/llm/extract.ts`) for the single-purpose pass.
- **`scripts/backfill-addresses.ts`**: for each shul with `location IS NULL` and a `submitted_url`, tries up to 6 candidate URLs in order (the submitted URL, root, `/contact`, `/contact-us`, `/about`, `/directions`). First high-confidence (≥0.55) address wins. Calls `lib/geocoding.ts` (Google Geocoding API) to convert address → lat/lng. Updates `shul.address` + `shul.location` (PostGIS GEOGRAPHY) in a single statement. Idempotent — re-running picks up where it left off because the WHERE clause excludes shuls that already have a location.
- **Same `stripJsonFences` fix** applied to `lib/llm/extract.ts` and the new `lib/llm/extract-address.ts` — Haiku wraps JSON in `\`\`\`json … \`\`\`` fences sometimes; the regex now handles arbitrary whitespace and optional CR.
- **Bumped `AddressExtractionSchema.reasoning` max from 300 → 1000 chars** — Haiku's reasoning can be verbose, especially for "no address found" explanations. Same fix would apply to the main extractor if we hit it.
- **Results**:
  - 11 shuls geocoded in this session (on top of 18 from a prior partial run)
  - 11 shuls skipped — addresses genuinely not findable on their public sites (would need manual entry / Google Places lookup / different strategy)
  - Total LLM cost: ~$0.71 in Haiku 4.5 calls (679K input / 6.7K output tokens)
  - Geocoding cost: ~$0.15 for 29 successful geocodes
- **Smoke tested** the live feed at `https://tfila.vercel.app/?lat=...&lng=...` near Fair Lawn and Calabasas. The pipeline (LocationGate → spatial query → rule resolution → render) works end to end.

**Two data-quality issues surfaced during smoke test — separate fixes, not PR 6 scope:**
1. `shul.timezone` is NULL for all sprint-1 shuls. The zmanim resolver falls back to `America/New_York`, so non-Eastern shuls show times 1-3 hours off. Fix: derive timezone from `lat/lng` (e.g. `geo-tz` or `tz-lookup` library) and backfill via a similar script.
2. Some `minyan_rule.time` entries from sprint-1 look like *calculated daily zmanim* (e.g. an LA shul with Mincha at "12:52") rather than recurring rule times. The sprint-1 ShulCloud calendar parser likely grabbed that day's resolved times. Fix: re-run the new LLM extractor (PR 3) against the homepages we now have addresses for, replacing the sprint-1 rules with fresh ones.

Both fixes are natural follow-ups. Neither blocks PR 6's value: the geocoded shuls + working pipeline give us a real demo path.

### 2026-05-11 — PR 5: public "next minyan near me" feed ✅

The product becomes visible. `/` goes from placeholder to a real geolocated feed of upcoming minyanim, sorted by start time, with a zmanim strip header.

- **`lib/zmanim/resolve.ts`**: `resolveRuleTime(time, geo, date)` — maps a `MinyanTime` (fixed or zmanim-relative) to a concrete UTC `Date`. Fixed times are interpreted as wall-clock in the shul's timezone with proper DST handling (no dep on tz libs — uses `Intl.DateTimeFormat.formatToParts`). Zmanim anchors map to `@hebcal/core` Zmanim methods (shkia/netz/alos/misheyakir/chatzos/mincha_gedolah/plag_mincha/tzeis_72/tzeis_42/sof_zman_shma_{gra,mga}/sof_zman_tefillah_{gra,mga}/candle_lighting).
- **`lib/zmanim/strip.ts`**: `computeZmanimStrip(geo, date)` returns the full snapshot used by the header (alos, netz, sof shma gra/mga, sof tefillah gra/mga, chatzos, mincha gedolah, plag, shkia, tzeis 72, candle-lighting, havdalah).
- **`lib/queries.ts`** add `getNearbyShulsWithRules(lat, lng, radiusMeters)` — PostGIS `ST_DWithin` join over shul + minyan_rule, filtered to active shuls, non-deleted live rules, non-rejected data_sources. Projects `location` to `{lat, lng}` via ST_X/ST_Y at read time. Returns ordered by distance ascending.
- **`components/LocationGate.tsx`** (client): asks `navigator.geolocation.getCurrentPosition`, stores result in `localStorage`, redirects to `/?lat=X&lng=Y`. Auto-redirects on mount if localStorage already has a saved location. Handles denied/error states with clear UI.
- **`components/RelativeTime.tsx`** (client): re-renders every 30s. Shows "in 12m" / "starting now" / "started 4m ago" with color coding (in-progress = amber, imminent = emerald, distant = neutral, long-past = muted).
- **`components/MinyanList.tsx`** (server): list view with shul name, tefillah, absolute time, relative time, distance in miles. Empty state notes the address-backfill gap explicitly.
- **`components/ZmanimStrip.tsx`** (server): horizontal pill bar of the major zmanim. Compact, scrollable on narrow screens.
- **`app/page.tsx`** rewritten: reads `?lat&lng` from `searchParams` (async per Next 16). Without coords → LocationGate. With coords → nearby query (2-mile radius), resolve all rules against today's date, filter to a window (30 min back for late-arrival + 6 hours forward), sort by start ISO, render. Day-of-week filter via JS `Date.getDay()`. Special-schedule-kind rules (yom_tov, three_weeks, etc.) are skipped for now — only `regular` rules appear in the feed.
- **Cost-side defaults**: `dynamic = 'force-dynamic'`, no caching yet. Every page hit is a fresh PostGIS query. At ~30 shuls and a 2-mile radius this is fast (<10ms in Neon).
- **Build verified**: 11 routes still register.

**Empty state today**: the 39 sprint-1 shuls have no addresses or lat/lng yet, so the feed renders "Nothing in the next few hours within walking distance" for any location. The LocationGate and ZmanimStrip work regardless. Address backfill (LLM-extract address from each shul's homepage, then geocode) is the next natural slice — that's the gap that unlocks real demo data.

### 2026-05-11 — PR 4: weekly cron + per-shul re-scrape ✅

The freshness engine. Mondays 13:00 UTC, every active+approved data_source gets re-fetched. Hash-based change detection skips the LLM call when nothing changed; when something did change, the extractor re-runs with broken-detection guardrails.

- **`lib/inngest/events.ts`**: added `shul.scrape.requested` typed event (`{shulId, dataSourceId, reason: 'weekly' | 'manual'}`).
- **`lib/inngest/functions/scrape-one-shul.ts`**: per-shul re-scrape function. Concurrency keyed by `shulId` (limit 1) so a single shul never scrapes itself in parallel. Pipeline:
  1. Load data_source row
  2. Fetch page (existing `fetchHtml`)
  3. Hash the truncated content (sha256, same algorithm as `extract.ts`)
  4. **If hash == previous hash** → write `scrape_run status=no_change`, update `last_run_*` on data_source, done. **No LLM call.**
  5. **If hash differs** → call `extractFromHtml`
  6. **Broken-detection** (any of these → mark broken + flip data_source.review_status=pending, leave old rules in place):
     - confidence < 0.6
     - new rule count == 0 while previous had any
     - new count < 50% of old count when old ≥ 3
  7. Otherwise → soft-delete every live rule on this data_source, insert fresh rules from the extraction, update data_source `config_json` with new hash + reasoning + usage. Write `scrape_run status=ok` with `rules_added`/`rules_removed` counts.
  - Always writes exactly one `scrape_run` audit row per execution
  - Honors `SCRAPE_ENABLED=false` kill-switch
- **`lib/inngest/functions/weekly-rescrape.ts`**: cron-triggered (`0 13 * * MON`). Queries every `(active shul, approved data_source)` pair, fan-outs one `shul.scrape.requested` event each. The per-shul function's concurrency cap throttles execution.
- **`app/api/inngest/route.ts`**: registers `scrapeOneShul` + `weeklyRescrape` alongside the PR 0/3 functions. Four functions total.
- **Build verified**: 11 routes still register.

**Cost profile**: At ~$0.025 per LLM extraction and 30 shuls with ~weekly hash-stable pages, expected weekly cost is roughly $0.10-$0.30 (just the shuls whose pages actually changed). Unchanged pages: $0 (no LLM call).

**Why the broken-detection matters**: a shul redesigning their site (different selectors, swapped layout) typically produces an extraction with way fewer rules or low confidence. Without the guardrail, we'd silently soft-delete every rule and the public feed would go blank. The guardrail leaves the previous schedule live until you approve the new extraction from the admin queue.

### 2026-05-11 — Deploy ✅
- GitHub: pushed to https://github.com/isckas/tfila (private)
- Vercel: live at **https://tfila.vercel.app**, auto-deploys on push to `main`
- Smoke-tested: `/`, `/bot`, `/signin`, `/admin/queue` (gates to /signin), `/shul/[slug]`, 404 — all working with prod Neon DB
- `/api/inngest` returns 500 in prod until `INNGEST_EVENT_KEY` + `INNGEST_SIGNING_KEY` are set (expected — code refuses to start without signing keys). Won't affect public routes.

### 2026-05-11 — PR 3: LLM schema-builder Inngest function ✅

The core differentiator. New submission → Inngest event → page fetch → Claude extracts minyan rules into validated JSON → persisted to `data_source` + `minyan_rule` with `review_status='pending'` so it lands in the admin queue. Haiku 4.5 first-pass with prompt caching; Sonnet 4.6 fallback when confidence is low.

- **`lib/llm/schema.ts`** (Zod): discriminated-union `TimeSchema` (fixed/zmanim), per-rule `RuleSchema`, top-level `ExtractionSchema` (confidence, reasoning, rules[], optional shulName/shulAddress). Mirrors the DB schema's `MinyanTime`.
- **`lib/llm/prompts.ts`**: ~4500-token system prompt (long enough to cross Haiku 4.5's prompt-cache floor of 4096 tokens). Includes role definition, what counts as a minyan vs. shiur, fixed vs. zmanim-relative time formats, days-of-week conventions, special-schedule taxonomy, confidence calibration ladder, and 5 detailed few-shot examples covering clean tables, mixed minyan+shiur lists, Yom Tov sections, non-schedule pages, and prose-only seasonal schedules.
- **`lib/llm/extract.ts`**: `extractFromHtml(html)` calls Haiku 4.5 with `cache_control: ephemeral` on the system prompt. Strips JSON fences if the model wraps output. Zod-validates with detailed errors. Falls back to Sonnet 4.6 when Haiku confidence < 0.4; returns the higher-confidence result. Captures token usage including cache-read/cache-write counts.
- **`lib/inngest/events.ts`**: typed event payloads (`data-source.requested`, `hello.test`).
- **`lib/inngest/functions/build-data-source.ts`**: Inngest function. Triggers on `data-source.requested`. Per-URL concurrency cap of 2 (so we never DDoS one host). Honors `SCRAPE_ENABLED=false`. Three steps: fetch-html → llm-extract → persist. Persistence creates a new `data_source` row with `review_status='pending'`, inserts one `minyan_rule` per extracted rule, and (if LLM detected one) backfills `shul.address` when currently null.
- **`app/api/inngest/route.ts`**: registers `buildDataSource` alongside `helloProofOfLife`.
- **`scripts/test-llm-extract.ts`**: manual ground-truth CLI. Takes a URL, fetches, runs the extractor, prints model used, confidence, reasoning, extracted rules (table), and token usage including cache stats. Doesn't touch the DB. Use this to validate prompt quality before approving a real submission.
- **Build verified**: 11 routes still register, types clean, Anthropic SDK v0.95.2 in deps.

**Deferred (logged in IDEAS.md)**: R2/S3 raw I/O archive. SCOPE.md asked for archiving raw HTML + raw LLM input/output so we can re-process when prompts improve. Skipped to keep PR 3 small and avoid the AWS SDK dependency. Page content hash is already stored on `data_source`, so we can re-fetch as a degraded fallback. Add when we have ~100+ extractions and want offline prompt A/B iteration.

**To exercise locally** (needs `ANTHROPIC_API_KEY` in `.env.local`):
1. **Quick test** (no DB, no Inngest, no side effects): `npx tsx scripts/test-llm-extract.ts https://example-shul.org/services`. Prints what the extractor would emit.
2. **End-to-end** (writes to DB via Inngest dev server):
   - Terminal 1: `npx inngest-cli@latest dev`
   - Terminal 2: `npm run dev`
   - Fire an event from the Inngest dashboard (http://localhost:8288) — name `data-source.requested`, data `{"shulId": 1, "url": "https://example-shul.org/services", "sourceKind": "website_llm"}`
   - Watch the function run; check `/admin/queue` (after sign-in) for the new pending row.

### 2026-05-11 — PR 2: queries layer + stateless magic-link admin auth ✅

Replaces sprint-1 query helpers with new-schema versions, stubs public pages, ships an admin-only `/admin/queue` skeleton behind a from-scratch magic-link auth flow. Zero new packages.

- **`lib/queries.ts` rewritten**:
  - `listActiveShuls()`, `getShulBySlug()` (projects `location` to `{lat, lng}` via PostGIS ST_X/ST_Y at read time), `getLiveRulesForShul()` (filters `deletedAt IS NULL`, orders by priority desc)
  - `listPendingDataSources()` (admin queue — joins shul, sorts by confidence asc), `getDataSourceById()`, `countByShulStatus()`
- **Stateless magic-link auth** (`lib/auth.ts`, ~120 LOC, no new packages):
  - HMAC-SHA256-signed tokens using `AUTH_SECRET` (node `crypto` stdlib only)
  - Magic-link tokens: 15-min expiry, `kind: "magic"`, email allowlist via `ADMIN_EMAIL`
  - Session cookie: `tfila_admin`, httpOnly, sameSite lax, 30-day, `kind: "session"`, secure-in-prod, signed with same secret
  - `requireAdmin()` server helper → reads cookie → verifies → `redirect("/signin")` on failure
  - Constant-time signature comparison via `timingSafeEqual`
- **`lib/email.ts`**: Resend HTTP API client. **Dev fallback**: if `RESEND_API_KEY` absent, prints magic links to server console. Means you can use the auth flow locally with zero email-provider setup.
- **Routes**:
  - `POST /api/admin/request-link` — accepts `email`, sends link if on allowlist, always redirects to `/signin?sent=1` (no allowlist disclosure)
  - `GET /api/admin/verify-link?token=...` — verifies, sets session cookie, redirects to `/admin/queue`
  - `POST /api/admin/logout` — clears cookie, redirects to `/`
- **Pages**:
  - `/signin` — email form, success + error states via query string
  - `/admin/layout.tsx` — auth-gates all `/admin/*` via `requireAdmin()`, shows header with email + sign-out
  - `/admin/queue` — server component listing pending data_sources, sorted by confidence asc. Read-only for PR 2; approve/reject actions land in PR 6.
- **Public-side stubs** (full UI in PR 5): `/`, `/shul/[slug]`, `/shul/[slug]/print` rewritten as placeholders that exercise the new queries layer so the build doesn't break.
- **Env vars added** (`.env.example`): `ADMIN_EMAIL`, `AUTH_URL`, `RESEND_API_KEY`. Removed the AUTH_EMAIL_SERVER stub from PR 0 (not needed for the roll-your-own approach).
- **Removed**: sprint-1 `scripts/seed.ts` (obsolete — new pipeline is submission form → LLM schema-build → Inngest). Sprint-1 `lib/format.ts` (referenced old enum types). Both preserved in git history.
- **Added**: `migrate:sprint1` npm script for re-running the data migration if needed.
- **Build**: ✅ 11 routes registered. New routes: `/admin/queue`, `/signin`, `/api/admin/{request-link,verify-link,logout}`.

**To exercise locally** (once you set `AUTH_SECRET` + `ADMIN_EMAIL` in `.env.local`):
1. `npm run dev`
2. Visit `/signin`, enter your `ADMIN_EMAIL`
3. Watch the server console — the magic link prints there (no email provider needed in dev)
4. Click it; you're at `/admin/queue` (which is empty until PR 3 starts pushing data_source rows)

### 2026-05-11 — PR 1: PostGIS + new schema + data migration ✅ PROMOTED

Production-grade schema is live on the migration branch. All sprint-1 data successfully migrated into the new shape. PostGIS GIST index verified queryable via `EXPLAIN`.

- **Neon branch**: `phase-1-migration` (`br-spring-recipe-amtoew79`) created from main via Neon API. Copy-on-write — prod completely untouched. Connection string in `.env.local` as `DATABASE_URL_BRANCH`; both `db/client.ts` and `drizzle.config.ts` honor it as override over `DATABASE_URL`.
- **PostGIS 3.5.0**: `CREATE EXTENSION` applied to branch.
- **New schema** (`db/schema.ts` full rewrite): four tables — `shul` (GEOGRAPHY(Point,4326) + `shul_location_gix` GIST index), `data_source` (1:N from shul, replaces sprint-1 scrape_config concept, kinds = shulcloud_website/website_llm/email_newsletter/manual), `minyan_rule` (tagged-union `time` JSONB, soft-delete, special_schedule_kind, priority for date conflicts), `scrape_run` (linked to data_source). All inferred Drizzle types exported.
- **Migration SQL**: hand-written in `db/migrations/0001_phase_1_new_schema.sql`. New tables created alongside sprint-1 tables (no name conflicts: `shul` vs `shuls`). Drizzle generator skipped because it's interactive on enum collisions.
- **Data migration** (`scripts/migrate-sprint1-to-phase1.ts`, transactional + idempotent):
  - 39 sprint-1 shuls → 39 `shul` rows (status `active` for the 39 with `scrape_enabled=true`)
  - 39 `data_source` rows (one per shul, kind=`shulcloud_website`, priority=30, review_status=`approved`)
  - 503 sprint-1 minyanim → **167** `minyan_rule` rows
  - **336 dropped** as zmanim, not minyanim: 198 candles + 138 havdalah. These will be displayed via the Phase 1 zmanim panel (computed dynamically via `@hebcal/core`), not stored.
- **Geocoding utility** (`lib/geocoding.ts`): Google Geocoding API client with proper error types. **Not invoked yet** — sprint-1 data has zero addresses and zero lat/lng, so there's nothing to geocode against. Geocoding will run once the scrape pipeline extracts addresses (PR 3 or PR 4).
- **Verification passes**:
  - Counts correct (39 / 39 / 167 / 0)
  - Tefillah breakdown matches sprint-1 (50 shacharis + 112 mincha + 5 maariv)
  - Drill-down sample looks structurally right (tagged-union time, days_of_week array)
  - `EXPLAIN` confirms `shul_location_gix` GIST index is used by `ST_DWithin` (not a seq scan) — performance guarantee in place from day 1

**Branch status:** all 167 rules live, all locations NULL, GIST index queryable, sprint-1 tables still present alongside new tables.

**Promotion (2026-05-11):** `phase-1-migration` branch set as Neon default via API. `DATABASE_URL` in `.env.local` now points at the promoted branch's endpoint (`ep-cool-sky-am29sxh9...`). Old default branch (`ep-young-king-am3sfyha...`) preserved as a rollback snapshot. `DATABASE_URL_BRANCH` and `NEON_BRANCH_ID` cleaned out of env.

**Pending cleanup**: `db/migrations/0002_drop_sprint1.sql` drops the legacy `shuls`/`minyanim`/`scrape_runs`/`edit_proposals`/`users` tables. Not auto-run — apply when you're confident we won't need to reference sprint-1 data. (Apply instructions in the file header.)

### 2026-05-11 — PR 0: scaffolding ✅

### 2026-05-11 — PR 0: scaffolding ✅

Production-grade scaffolding for the Phase 1 pivot. Everything no-ops cleanly in dev when secrets are absent.

- **Repo identity**: `package.json` name `daven-site` → `tfila`. `README.md` rewritten to describe pivoted product + Phase 1 conventions. `app/layout.tsx` metadata refreshed (title template, description, `metadataBase`).
- **Env template** (`.env.example`): expanded from 2 vars to a full Phase-1 surface — `DATABASE_URL`, `SCRAPER_USER_AGENT` (now `Tfila-Bot/1.0`), `SCRAPE_ENABLED` (kill switch), Inngest pair, Sentry quartet, `ANTHROPIC_API_KEY`, `GOOGLE_GEOCODING_API_KEY`, Auth.js trio, R2 quartet. Postmark inbound vars commented for Phase 2.
- **Sentry** (`@sentry/nextjs` 10.52): `instrumentation.ts` at root with `register()` (Node + edge runtimes) + `onRequestError` exporter, both gated on `SENTRY_DSN` presence so dev needs no setup. `instrumentation-client.ts` at root gated on `NEXT_PUBLIC_SENTRY_DSN`, with `onRouterTransitionStart` re-export.
- **Inngest** (v4.4): client at `lib/inngest/client.ts`. Proof-of-life function `helloProofOfLife` at `lib/inngest/functions/hello.ts` listening for `hello.test` event. Serve handler at `app/api/inngest/route.ts` exporting `GET`/`POST`/`PUT`. Used v4-style triggers-in-options API (was a 1-line gotcha vs. v3 examples in training data).
- **`/bot` page** (`app/bot/page.tsx`): static page describing `Tfila-Bot/1.0`, listing what we do / don't do, retention policy, contact email. Linked from the User-Agent string.
- **Kill switch**: `scripts/scrape-shulcloud.ts` checks `process.env.SCRAPE_ENABLED === "false"` and aborts before any work. Future Phase 1 scraper pathways will honor the same flag.
- **Build verified**: `npm run build` passes. Six routes registered: `/`, `/_not-found`, `/api/inngest`, `/bot`, `/shul/[slug]`, `/shul/[slug]/print`.

**Notes / gotchas**:
- Inngest v4 collapsed the v3-style `(opts, trigger, handler)` 3-arg API into `(optsWithTriggers, handler)` 2 arg. Existing third-party tutorials are stale.
- Next.js 16: `instrumentation.ts` lives at project root (NOT in `app/`).
- Existing scrape script's `pg` driver emitted an SSL-mode warning during build — informational only, addressed in Drizzle migration (PR 1) when we move to `verify-full` explicitly.

### 2026-05-11 — Scope locked ✅
- 8-step scoping framework completed. Output: `SCOPE.md` at repo root.
- Domain locked: **tfila.co** (registered by user)
- Pivot from sprint-1 static directory to "next minyan near me" PWA confirmed
- Production-grade stack chosen: Next.js 16 + Neon w/ PostGIS + Inngest + Anthropic + Sentry/Axiom/Better Stack
- Multi-source data model (`data_source` table) replaces sprint-1 `scrape_config`; email source designed-for in Phase 1, built in Phase 2
- Phase 1 success criteria locked (100+ shuls seeded, weekly cron unattended 2+ weeks, 3-5 real daveners)

### 2026-05-01 — Sprint 1 ✅
- Next.js 16 + Tailwind + TypeScript scaffold
- Neon Postgres with 5-table schema (sprint-1 shape — being replaced in PR 1)
- ShulCloud scraper with iCal-feed fallback (77% hit rate)
- `/`, `/shul/[slug]`, `/shul/[slug]/print` pages working
- **Seeded: 30 shuls, 503 minyanim**
- Pivot decision made at end of sprint after pages-built reveal

---

## Blocked / Needs decision

- ⏸️ **Zmanim edge-case validation** (open from SCOPE.md §8 #5): pick one northern-latitude shul (Toronto / UK) and validate zmanim math during PR 5. Not blocking earlier PRs.

---

## Scope changes log

### 2026-05-11
- **Phase 1 zmanim**: thin strip → **full panel** (alos, netz, sof zman shema/tefillah, chatzos, mincha gedolah, plag mincha, shkia, tzeis, candle-lighting, havdalah) on dedicated `/zmanim` page + condensed strip on home feed. SCOPE.md §4 and §5 updated.
- **Torah-study sidebar (Phase 2)**: parsha + daf yomi + mishna yomi + halacha yomi + nach yomi with Sefaria links. SCOPE.md §4 non-goal qualified (no Halacha lookups / no kaddish lists; contextual study sidebar IS in scope).
