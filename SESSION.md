# Session log

**Pickup doc.** Latest session at top. If you're returning to this project, read the **latest session** below first, then `DECISIONS.md` for verbose rationale, then `PROGRESS.md` "Now" if you need more depth.

---

## 2026-06-07 (late) — ENTIRE remediation + P5 backlog COMPLETE and LIVE

### Briefing for next session (read first)
- **Where we are:** The whole remediation is **done and live in prod** — P0–P5 *and the full P5 cleanup backlog* — across 5 merged PRs (#5 P0–P4, #6 P5 core, #7 docs, #8 P5 cleanup A+B, #9 P5 cleanup C+D+E). The site that was silently down 41→9 is recovered (24 active), correct, hardened, monitored, and cleaned up. Every batch was adversarially reviewed (≈6 review workflows total); reviews caught real bugs (worker `fc`/`fd` false-positive, `onFailure` wrong runId, cost-gate over-count) — all fixed before merge. Each deploy smoke-checked green.
- **Next concrete action:** Nothing outstanding/blocking. The remediation is complete. If picking up new work, `main` is clean + `origin/main`-synced.
- **Deliberately NOT done (kept as working features, not dead code):** `is_manual_edit` (rescrape soft-delete "Fix EE" admin-override protection + dedup ordering — removing risks the just-stabilized rescrape + needs a destructive DROP COLUMN) and the **PDF cascade tier** (working fallback; 0 current PDF sources). **M16** (Sentry source-maps) deferred for build-env risk. See PR #9 body.
- **Critical data:** Prod deploys = merge to `main` (Vercel git-integration auto-deploys, ~45–75s; see [[reference_deploy_mechanism]]). Migrations applied to prod: 0013 (time_report), 0014 (shul_candidate review CHECK). Active count = 24.

### Done since the entry below (P5 + backlog, PRs #6/#8/#9)
- **P5 core** (#6): SSRF at fetch boundary (H6/M10, runtime-tested), dead-man's switch (H8), `/api/health` feed probe (H9), `notifyAdmin` critical (M12).
- **P5 cleanup A+B** (#8): M9 (CF-proxy SSRF guard), M11 (Inngest `onFailure` ×5), M4 (digest spike-gate), M5 (first_broken_at backfill), L3, L8.
- **P5 cleanup C+D+E** (#9): M8 (per-page admin auth ×11), M17 (candidate CHECK), Jina/Docling delete + H7, E-D2 (cost-gate counts cron spend), bulk re-extract (confirm + rate-gated).

---

## 2026-06-07 (evening) — P3 + P4 complete + 2 adversarial reviews; PR #5 open, ready to merge

### Briefing for next session (read first)
- **Where we are:** The full holistic remediation **P0–P4 is done and on PR #5** (`fix/holistic-remediation` → `main`). P3 = report-wrong-time feature (ShulCloud adapter **descoped** — research showed P0 already storm-proofed the cascade + the LLM handles ShulCloud's static HTML at 0.75–0.92; the deterministic parser would be equal-at-best, worse on generic "Evening Minyan" naming). P4 = the full UI pass (UI-1..8 + E-F1). **Two adversarial-review workflows** (21 agents) over the whole diff + the admin-UI delta found ONLY low-severity items; all fixed. typecheck + full build green.
- **Next concrete action:** ✅ **DONE — PR #5 (P0–P4) and PR #6 (P5 core) are both merged + deployed; the entire P0–P5(core) remediation is LIVE in prod** (Vercel git-integration auto-deploys main→prod, confirmed ~45s + smoke-green; the deploy-mechanism worry didn't apply — see [[reference_deploy_mechanism]]). P5 shipped SSRF-at-fetch-boundary (H6/M10, runtime-tested), the dead-man's switch (H8), the feed-probing health check (H9), and M12. **Next = the P5 cleanup backlog** (PR #6 body: M11, E-D2, M16, the tier deletions, the lows) — none blocking.
- **Constraints to preserve:** Bulk "re-extract all broken" (UI-5 stretch) deliberately NOT shipped — re-triggers the 429 storm, needs a confirm + the P0 rate gate. Migration 0013 (time_report) is additive + already applied to prod. AdminInbox + deriveAdminShulState are server-only (import db) — can't be used in client components. gate LLM spend + destructive migrations.
- **Critical data:** PR #5 = https://github.com/isckas/tfila/pull/5. Commits this session: `e15f580` (P3), `d6144a1`+`6dd6ae4` (P4), `094251a` (review-1 fixes), `5448116` (UI-5/UI-7), `cf7112c` (review-2 fixes). New: `app/api/report-time`, `app/admin/reports`, `components/{ReportWrongTime,FeedDatePicker}.tsx`, `scripts/apply-migration.mjs`. Active count = 24.

### Done this session
- **P3** `e15f580`: time_report table (migration 0013, applied to prod) + anonymous report-wrong-time tap + admin triage `/admin/reports`; moat-doc reframe [E-B5/E-B3]. ShulCloud adapter descoped (user decision).
- **P4** `d6144a1`/`6dd6ae4`/`5448116`: UI-8 tokens (Geist font fix — app was all-Arial; blue→neutral; tap/focus floors; amber dots), UI-1 landing, UI-2 feed (onChange picker, upcoming-first ordering), UI-3 shul (Today/Tomorrow tabs, map cut), UI-4 (/signin+/bot rescue), UI-6 (admin source-quotes default), E-F1 (review-queue fix), UI-5 (cockpit filter chips), UI-7 (candidate tabs).
- **Reviews** `094251a`/`cf7112c`: applied all confirmed low-sev findings (tap floors, spoofable-XFF in clientIp, ?state= validation, redirect repointing, stale docstrings, color consistency).

---

## 2026-06-07 17:57 UTC — QUICK SAVE (pre-compaction)
- Branch: `fix/holistic-remediation`; latest commit: `b89767a` reextract-active + re-run 19 active shuls under new prompt
- Working tree: 4 modified (DECISIONS.md, FEATURES.md, PROGRESS.md, SESSION.md) + untracked `docs/HOLISTIC-REMEDIATION-PLAN.md`
- In-flight: E-C2 (Hebcal gating, needs user input); P3 ShulCloud adapter (research-then-build); verify the 19-shul re-extract landed
- Last user intent: continuing holistic remediation — recovery + P2 evening-times work just shipped; P3 is next
- Next action: P3 — research real ShulCloud minyan widgets before building a tier-0 deterministic parser (see latest deep-save entry below for full detail)

---

## 2026-06-07 (cont.) — Recovery complete (9→24 active) + P2 evening-times shipped; P3 = next

### Briefing for next session (read first)

- **Where we are:** Continued the holistic remediation (the entry below has the P0/P1/P2-start detail). Since then: **ran the full stranded-shul recovery → directory restored 9→24 active** (14 recovered + re-activated; ~11 hard-tail broken need P3/admin); **backfilled `shul.timezone` for 32 shuls**; shipped **E-C1** (prompt now emits `zmanim` for evening times the source describes relative to a zman) + **E-C4** (feed flags fixed evening times "may shift seasonally"); **deployed** (`tfila-8o4kv51e4`) and **re-extracted 19 active shuls** under the new prompt. Branch `fix/holistic-remediation` = 13 commits, all live; site fully functional.
- **Next concrete action:** **P3 — ShulCloud adapter.** RESEARCH FIRST (don't guess — that sank v2's Docling): fetch real ShulCloud minyan widgets across a few sites (the path varies — `/minyanim` 404'd; try the site's "Minyan Times"/zmanim nav link), confirm the DOM/feed structure (likely JS-rendered → use the Browserless render path), THEN build a deterministic tier-0 parser keyed on `lib/scrapers/fingerprint.ts` platform, mapping ShulCloud's internal fixed/zmanim/holiday rules → `minyan_rule`. Fixes BAYT-style frozen evening times + recovers most of the 11 hard-tail broken ShulCloud shuls.
- **Constraints to preserve:** Same as below — prod aliases the BRANCH deploy (don't push `main` until merge); deploy straight to prod (Preview env lacks `DATABASE_URL`); gate LLM spend + destructive migrations; E-DECISION-1 = v1 base. This session locked: **E-C1 = "option 2"** (zmanim only when the source describes it relatively — never auto-guess a bare clock; the ShulCloud pre-computed-clock case is P3's job); re-extract scope = all-active-with-fixed-evening; freshness = keep "Verified N ago" + the seasonal note (done).
- **Critical data:** Tools added: `scripts/recover-stranded.mjs`, `reactivate-recovered.mjs`, `reextract-active.mjs` (all idempotent, throttled by the global concurrency cap). Active count = **24** (was 9). The re-extract of 19 was draining at save time — verify it landed (zmanim count should rise; ShulCloud ones stay fixed). E-C2 (Hebcal gating) still open + wants user input. Plan: `docs/HOLISTIC-REMEDIATION-PLAN.md`.

### Done since the entry below
- Full recovery: `recover-stranded.mjs` over 28 sources → 14 recovered + re-activated → **9→24 active** (`2664948`, `c4c65c5`).
- `shul.timezone` backfill: 32 shuls via `backfill-timezones.ts` (E-C3 data part).
- E-C1 + E-C4 evening-times prompt + seasonal note (`4e9d2d6`); re-extracted 19 active shuls (`b89767a`).
- tz-correct day-of-week + zmanim on shul page (`0648bb0`, H3/E-C3).

### In-flight tasks (recreate with TaskCreate on /resume)
- **E-C2** Hebcal special-day gating — nuanced; wants user input (which kinds gate on the calendar vs date-brackets).
- **P3** ShulCloud adapter — next; research-then-build. **P4** UI redesign (8 screens, wireframes in plan Appendix C). **P5** security/observability/cleanup.
- Deferred from P1: cosmetic enum-collapse migration + M1 + `applyExtractionResult` DRY refactor.

### Paused / blocked
- Re-extract of 19 active shuls was draining at save — verify the zmanim conversion landed.
- P3 needs ShulCloud-widget research before building.

### Code commits — 2026-06-07 (cont.)
| Hash | Type | Summary |
|---|---|---|
| `b89767a` | chore(p2) | reextract-active + re-run 19 active shuls |
| `4e9d2d6` | fix(p2) | evening→zmanim prompt + seasonal note [E-C1/E-C4] |
| `2664948` | chore(p0.5) | full recovery 9→24 + reactivate + tz backfill |
| `c4c65c5` | chore(p0.5) | recover-stranded + v1 verify in prod |
| `0648bb0` | fix(p2) | tz day-of-week + zmanim tz [H3/E-C3] |

---

## 2026-06-07 — Holistic remediation: 3 reviews → unified plan → P0+P1+P2 shipped to prod

### Briefing for next session (read first)

- **Where we are:** Ran 3 exhaustive multi-agent reviews (error/log audit, effectiveness, UI) → one unified one-branch plan at `~/.claude/plans/reveiw-all-logs-and-reactive-locket.md` (copied to `docs/HOLISTIC-REMEDIATION-PLAN.md`). Then EXECUTED it on branch `fix/holistic-remediation`: **P0 (outage fix) + P1 (pipeline consolidation + self-healing status) + P2-start (timezone correctness)** are committed (8 commits) and **deployed to prod** (deploy `tfila-bph0uab11`, aliased to tfila.co, smoke-green). The new **v1-only** pipeline is **verified in prod** (shul 1 re-extracted 5 rules @0.75 and self-healed to approved+ok).
- **Next concrete action:** Run the full stranded-shul recovery — `node scripts/recover-stranded.mjs 50` — to re-extract the ~29 remaining `pending_review`+`broken` shuls (≈$2–3 LLM spend, throttled to 3-concurrent). User was about to approve when /save fired. After it drains: set recovered shuls' `shul.status='active'` and report the new active count (was 9, target ~30+).
- **Constraints to preserve:** (1) **Prod is aliased to the BRANCH deployment, NOT main** — do NOT push `main` until the branch merges, or the next main deploy reverts everything. (2) Vercel **PREVIEW env lacks `DATABASE_URL`** → preview builds fail; deploy straight to prod (`vercel deploy --prod`). (3) Gate the two destructive/costly steps: the LLM-spend recovery and any enum/column migration. (4) The unified plan is the single source of truth — **P0–P5 are build-order, NOT waves**; everything ships on the one branch except the 2 refuted findings + the "keep as-is" list. (5) **E-DECISION-1 LOCKED: v1 base + v2's 2 wins** (tool-schema output + `sourceQuote`; the latter not yet folded in — `tools/extraction-output.ts` kept for it).
- **Critical data:** Branch `fix/holistic-remediation` (pushed to origin/isckas/tfila). Prod deploy `tfila-bph0uab11`. Plan: `~/.claude/plans/reveiw-all-logs-and-reactive-locket.md`. Recovery tool: `scripts/recover-stranded.mjs`. **Root cause of the 41→9 active-shul drop: the 2026-05-24 weekly cron (first under global v2) hit an Anthropic 429 storm — transient, NOT a clean v2 canary; verified from `config_json.cascade_attempts`.** `EXTRACTION_PIPELINE_V2` in Vercel prod is now a no-op (safe to unset). Read-only prod DB via `mcp__pg-neon__query`.

### Done this session
- **3 multi-agent review workflows** (read-only, adversarially verified): bug audit (44 findings, 2 refuted), effectiveness (66 recs, 0 dropped by the skeptic), UI (53 problems + 8 360px ASCII redesigns) → one unified branch plan.
- **P0** `30f71b9` — geo-tz 500 fixed (next.config `serverExternalPackages`+`outputFileTracingIncludes` + try/catch at page.tsx); no-recovery trapdoor killed (public visibility now derived from freshness, cron drives off `review_status='approved' AND shul.status<>'archived'`); global Inngest concurrency cap (3) = 429-storm-proof; Biome + Vitest + HTTP smoke safety net + `typecheck`/`lint`/`test`/`smoke` scripts. Deployed + smoke-verified (incl. Jerusalem geo-tz case).
- **P1** `a52ec67`/`00fbd7b`/`dd16f89`/`46ae688`/`e910a25` — H5 unreject unique-index guard + M13 candidates reader; **v2 retired** (one pipeline, −2643 LOC, H2 resolved); transient 429s retry instead of demote; sticky `review_status` + no `shul.status` demotion (shuls self-heal); email-channel parity (H4/M3).
- **P2** `0648bb0` — H3 tz-correct day-of-week in feed; E-C3 code (zmanim render in shul tz on the detail page).
- **Deploy + verify** `c4c65c5` — deployed P1+P2 batch to prod; `recover-stranded.mjs`; verified the v1 pipeline recovers shul 1 end-to-end.

### Decisions made
See DECISIONS.md "2026-06-07 — holistic remediation" (plan structure & one-branch/no-waves; E-DECISION-1 = v1 base; code-only status-model behavior with deferred cosmetic migration; prod-fastest execution + the two gates).

### In-flight tasks (recreate with TaskCreate on /resume)
- **P0.5** (pending) — full stranded recovery; 1/30 done as the verify. Run `node scripts/recover-stranded.mjs 50`; awaiting user "go" (LLM spend). Then re-activate recovered shuls.
- **P2** (in_progress) — done: H3, E-C3 code. Remaining: `shul.timezone` backfill + non-null migration (gated), E-C1 seasonal mincha/maariv prompt rework, E-C2 Hebcal special-day gating, E-C4 freshness=time-validity.
- **P1 deferred** — cosmetic enum-collapse migration (shul.status→{live,archived}, review_status→{approved,rejected}) + drop `first_broken_at`; M1 confidence dead-band; `applyExtractionResult` DRY refactor.
- **P3 / P4 / P5** (pending) — acquisition portfolio (ShulCloud adapter), UI redesign (8 screens, wireframes in plan Appendix C), security/observability/cleanup.

### Paused / blocked
- Full recovery — awaiting user "go" (≈$2–3 LLM spend).
- Destructive migrations (P1 enum collapse, P2 timezone non-null) — gated on user.
- Branch → main merge — deferred; prod tracks the branch deploy meanwhile.

### Code commits — 2026-06-07
| Hash | Type | Summary |
|---|---|---|
| `c4c65c5` | chore | recover-stranded script + v1 verify in prod |
| `0648bb0` | fix(p2) | tz-correct day-of-week + zmanim tz [H3/E-C3] |
| `e910a25` | fix(p1) | email-channel parity [H4/M3] |
| `46ae688` | fix(p1) | sticky review_status + no shul.status demotion [E-A2/A4] |
| `dd16f89` | fix(p1) | transient retry instead of demote [C1/M2] |
| `00fbd7b` | refactor(p1) | retire v2, one pipeline (−2643 LOC) [E-DECISION-1] |
| `a52ec67` | fix(p1) | unreject guard + candidates reader [H5/M13] |
| `30f71b9` | fix(p0) | stop the outage — geo-tz/trapdoor/429/safety net |

---

## 2026-05-19 → 2026-06-03 — PR #4 shipped; home-feed 500 diagnosed; geo-tz fix held for batch

### Briefing for next session (read first)

- **Where we are:** PR #4 shipped (`1283563`) — `no_change`-as-healthy fix + async admin Extract Now + seeded `docs/OPEN-ISSUES.md`. Then investigated a production home-feed 500 reported at `?lat=43.8030364&lng=-79.4429928&radius=2`. Root cause **verified via Sentry API**: `geo-tz` reads its `.geo.dat` timezone-boundary data files via `fs.openSync`; bundling it into a Turbopack SSR chunk breaks `__dirname`-relative resolution → `ENOENT` on coords whose tile needs polygon precision. Fix is fully designed and held in the plan file `~/.claude/plans/i-want-you-to-fluttering-canyon.md`. **User chose to accumulate more issues and code as one batch** (same pattern as OPEN-ISSUES bundle for PR #4).
- **Next concrete action:** Surface the next issue(s) the user wants to add to the batch. When the batch is ready, implement all at once: (a) `next.config.ts` add `serverExternalPackages:["geo-tz"]` + `outputFileTracingIncludes: { "/": ["./node_modules/geo-tz/data/**/*"] }`; (b) `app/page.tsx:247` wrap `findTz` in try/catch with America/New_York fallback; (c) any other batched fixes; (d) typecheck + branch + PR.
- **Constraints to preserve:** Batch-then-code pattern is locked — DON'T jump to coding when a new issue comes up; add it to the plan file and ask what else. No route-level `error.tsx` (user chose targeted defense only). When investigating prod errors with no obvious static cause, **pull stack trace from Sentry API first** rather than over-investigating statically.
- **Critical data:** PR #4 = commit `1283563` (squash-merged). Sentry: org slug `ik-c7`, project `javascript-nextjs-tfila`, US region (`us.sentry.io`), token in `.env.local` as `SENTRY_AUTH_TOKEN` (works for `/projects/` + `/events/`, lacks `org:read`). The verified Sentry event id `e685e66e093a4d7091c2bd22cbbb7799`. The 500 is purely a geo-tz/Vercel bundling bug — query, resolver, components are all defensive.

### Done this session

| Item | Where |
|---|---|
| PR #4 shipped (no_change-as-healthy + async admin Extract Now + OPEN-ISSUES.md seed) | `1283563` squash-merge |
| PR #4 code review found + fixed regression: `unsupported → pending_review` restore on success | Added inside `lib/inngest/functions/build-data-source.ts` success transaction. All 4 callers benefit (Extract Now, rebuild, /submit, /inbound/email) |
| `docs/OPEN-ISSUES.md` created with 12 seed entries | repo root; 2 ✅ resolved this PR + 10 🔍 deferred (multi-calendar + Discovery pipeline) |
| Home-feed 500 root cause verified via Sentry API stack trace | event `e685e66e093a4d7091c2bd22cbbb7799` — `c.find` (geo-tz) → `fs.openSync` ENOENT |
| Fix recipe designed, held in plan file (not coded) | `~/.claude/plans/i-want-you-to-fluttering-canyon.md` |
| HebCal-grounded LLM context exploration entry added to FEATURES.md | uncommitted; intentionally out of PR #4 scope |

### Decisions made

See DECISIONS.md "2026-06-03 — home-feed 500 + batch-then-code workflow" (3 decisions: pull stack trace from Sentry API not static reading; bundle the fix as `serverExternalPackages` + `outputFileTracingIncludes` + try/catch; hold designed fixes in plan file and code multiple together).

### In-flight tasks

None on the task list — the geo-tz fix is held in the plan file, will be implemented as part of the next batch.

### Paused / blocked

- **Geo-tz home-feed 500 fix** — designed, awaiting batch. Holds: `next.config.ts` change + `app/page.tsx` try/catch.
- **HebCal-grounded LLM context** — exploration entry in FEATURES.md; not committed; awaiting decision on test-set work.
- **UptimeRobot signup + test cohort** — still on the phase-1 launch checklist.
- **PDF tier real-world test** — still waiting on organic PDF-bearing submission.

### Code commits — 2026-05-20 → 2026-06-03

| Hash | Type | Summary |
|---|---|---|
| `1283563` | fix | no_change-as-healthy + async admin Extract Now + seed OPEN-ISSUES.md (PR #4, includes review-fix for status restore) |

---

## 2026-05-19 — UNIQUE INDEX shipped; dedup workstream closed

### Briefing for next session (read first)

- **Where we are:** Dedup + state-machine fix workstream is fully closed in prod. PR #2 (`aca0de9`) shipped the 29-fix bundle; PR #3 (`0aba418`) added the DB-level partial UNIQUE INDEX on `data_source(shul_id, identifier) WHERE review_status <> 'rejected'`. All 3 cross-status duplicate pairs cleaned up (5 sources superseded, 35 rules soft-deleted). Working tree on `main`, only modified file is SESSION.md from this save.
- **Next concrete action:** Resume the phase-1 launch checklist from PROGRESS.md "Now": (a) sign up for UptimeRobot (free) and point a 5-min monitor at `https://tfila.co/api/health`; (b) fill the test-cohort table in `docs/FIRST-USERS-TEST-PLAN.md`; (c) send share message.
- **Constraints to preserve:** No auto-retry / no auto-retire on broken sources (cost-first policy). Build-phase deferrals still hold (no tests, no auth rework, no cred rotation while private). Future migrations: use the surgical-applier pattern (`scripts/apply-migration-NNNN.ts`) rather than `drizzle-kit push`, because the schema.ts has accumulated drift drizzle-kit wants to "fix" unrelatedly.
- **Critical data:** PR #3 = commit `0aba418` (5 files, +349 lines); live index verified with predicate `WHERE (review_status <> 'rejected'::data_source_review_status)`. Both feature branches deleted (local + remote). Postgres MCP `pg-neon` works for ad-hoc SQL via `mcp__pg-neon__query`.

### Done this session

| Step | What shipped | Where |
|---|---|---|
| 1 | Cross-status dedup ran against prod | `scripts/dedupe-cross-status.ts`; 5 losers superseded (ds#79, #100, #102, #104, #105), 35 minyan_rule rows soft-deleted |
| 2 | Migration 0012 created + applied to prod | `db/migrations/0012_data_source_unique_identifier.sql` + `scripts/apply-migration-0012.ts` |
| 3 | Schema declaration matches live index | `db/schema.ts:200` — `uniqueIndex(...).on(...).where(sql\`...\`)` so drizzle-kit sees no drift |
| 4 | PR #3 opened + squash-merged | `0aba418` (5 files, +349); `fix/duplicate-data-sources` + `chore/data-source-unique-index` deleted |

### Decisions made

See DECISIONS.md "2026-05-19 — UNIQUE INDEX + cross-status dedup" (3 decisions: approved-status as PRIMARY dedup sort key not tiebreaker; partial-index declared with `.where()` to prevent drizzle-kit drift; skip code review on migration-already-live PRs).

### In-flight tasks

None. All 60 tasks from prior session list completed.

### Paused / blocked

- **UptimeRobot signup** — user said done last session but actual monitor not confirmed in `/api/health`. Re-verify before sharing site externally.
- **PDF tier real-world test** — still waiting on an organic PDF-bearing shul submission.

### Code commits — 2026-05-19

| Hash | Type | Summary |
|---|---|---|
| `0aba418` | chore(db) | UNIQUE INDEX on data_source(shul_id, identifier) + supplementary cleanup (PR #3) |
| `aca0de9` | fix | state-machine + dedup + cascade adaptation bundle (PR #2) — already from prior turn |

---

## 2026-05-19 HH:MM UTC — QUICK SAVE (pre-compaction, auto-triggered)
- Branch: `fix/duplicate-data-sources`; latest commit: `ed54ff7 fix: address review findings on PR #2 (recovery + mark-broken consistency)`
- Working tree: 2 untracked (`scripts/apply-migration-0011.ts`, `scripts/dedupe-cross-status.ts`) — review before discarding; likely tied to dedup/migration 0011 work on this branch.
- In-flight tasks: none active in this turn (PreCompact hook fired on session start with no user prompt yet).
- Last user intent: PreCompact auto-save; prior session worked on PR #2 review-fixes bundle (state-machine + dedup + cascade adaptation) on the `fix/duplicate-data-sources` branch.
- Next action: On /resume, decide whether the two untracked scripts should be committed, archived, or deleted; then continue PR #2 review cycle or move to next item from `PROGRESS.md` "Now".

---

## 2026-05-18 → 2026-05-19 — Phase-1 launch prep shipped; v2 global; ops gates live

### Briefing for next session (read first)

- **Where we are:** Commit `48aac17` is live in prod (`tfila-s3zf4v3cj`). v2 extraction pipeline is the global default (`EXTRACTION_PIPELINE_V2=true`). The "shareable to friends" UX layer landed in one batch: travel-mode date picker, tefillah filter chips, in-progress live pill, freshness chip, special-schedule labels, OG metadata, sitemap, robots.txt, tap targets. Ops scaffolding active: Vercel Analytics + Sentry + `/api/health` + Upstash rate limits + LLM cost-gate. PWA shell installable. Working tree is clean; main is in sync with origin.
- **Next concrete action:** Pick the 3-5 person test cohort + fill the table in `docs/FIRST-USERS-TEST-PLAN.md`. Sign up for UptimeRobot (free tier), point a monitor at `https://tfila.co/api/health`. After that the pre-test checklist is complete and you can send the share message.
- **Constraints to preserve:** Cost-gate defaults to $25/day LLM spend — bump `LLM_DAILY_BUDGET_USD` env var before any planned bulk imports. Rate limits are LIVE (Upstash wired): 5/hr/IP on `/submit`, 3/hr/email + 10/hr/IP on `/admin/request-link`, 100/day total on `/inbound/email`. `EXTRACTION_DISABLED=true` is the kill switch. Build-phase deferrals still hold (no tests, no auth-model rework, no cred rotation while private repo).
- **Critical data:** Commit `48aac17` (31 files, +2183/-77); prod deploy `tfila-s3zf4v3cj`; Sentry DSN exposed inline in chat (consider rotating); Upstash DB `more-sheep-129736.upstash.io`; Postgres MCP `pg-neon` installed at user scope (use `mcp__pg-neon__query` for ad-hoc SQL); plan file at `~/.claude/plans/i-want-you-to-fluttering-canyon.md` + durable copy at `docs/PHASE-1-LAUNCH-PREP-PLAN.md`.

### Done this session

| Step | What shipped | Where |
|---|---|---|
| 0a | Vercel CLI 54.1.0 installed globally | `npm i -g vercel` |
| 0b | `fewer-permission-prompts` skill ran | Added `Bash(vercel ls *)` to `.claude/settings.json` |
| 0c | Postgres MCP server added (user scope) | `pg-neon` → Neon read-only via `mcp__pg-neon__query` |
| 1 | `EXTRACTION_PIPELINE_V2=true` flipped globally | Vercel prod env; redeploy `tfila-fjqyz9uqg` |
| 2 | Launch-prep batch (6 sub-items) | MinyanList, FeedHeader, sitemap.ts, robots.txt, OG, special-schedule labels |
| 3 | Vercel Analytics installed | `@vercel/analytics`, `<Analytics />` in `app/layout.tsx` |
| 4 | Sentry DSN env vars + `/api/health` | `SENTRY_DSN` + `NEXT_PUBLIC_SENTRY_DSN` set in Vercel prod |
| 5 | Upstash rate limits live | `lib/rate-limit.ts`; env vars set; verified `{"result":"PONG"}` |
| 6 | PWA shell | `app/manifest.ts`, `public/sw.js`, `ServiceWorkerRegister.tsx`, apple-touch-icon |
| 7 | Travel mode UI | `?date=YYYY-MM-DD` accepted, date picker, full-day window |
| 8 | Tefillah filter chips | `components/MinyanList.tsx` → client component with chip toggle |
| 9 | In-progress live pill + ring | 30m window, emerald accent, 30s ticker |
| 10 | Freshness badge | `lib/format.ts` helper, query extended, chip on cards + detail |
| 11 | `docs/RUNBOOK.md` | 5 scenarios (down, cron, cost, leak, DB) |
| 12 | Cost-tripwire | `lib/llm/cost-gate.ts` + `docs/COST-BUDGETS.md` |
| 13 | `docs/FIRST-USERS-TEST-PLAN.md` | cohort template + decision criteria |
| — | Commit `48aac17` (31 files, +2183/-77) pushed | `c22a29c..48aac17 main -> main` |
| — | Verified live: `/api/health`, `/sitemap.xml`, `/robots.txt`, `/manifest`, `/sw.js` all 200 |

### Decisions made

See DECISIONS.md "2026-05-18 → 2026-05-19 — phase-1 launch prep + ops gates" (8 decisions: one-commit-not-split bundle, v2-global-before-cron-cycle, fail-open rate limit + cost-gate, amber-over-rose for special-schedule, single SW for installability, Vercel Analytics over Plausible, Upstash REST URL inference from redis-cli command, build-phase deferral re-confirmed).

### In-flight tasks (recreate with TaskCreate on /resume)

- #1 (now completable) — Verify `/save quick` + `/save` deep on daven-site. Both have been run successfully against this project this session; mark done.

### Paused / blocked

- **UptimeRobot signup** — needs user action (free tier, no card). Monitor target = `https://tfila.co/api/health`.
- **First-users cohort selection** — fill the table in `docs/FIRST-USERS-TEST-PLAN.md` before sending share message.
- **Sentry DSN rotation** — user pasted DSN inline in this chat; rotate if transcript may be shared.
- **`.env.local` housekeeping** — duplicate `INNGEST_API_KEY` lines (9 + 35); user may want to clean. Non-urgent.

### Code commits — 2026-05-18 → 2026-05-19

| Hash | Type | Summary |
|---|---|---|
| `48aac17` | feat | phase-1 launch prep + ops gates + UX features (31 files, +2183/-77) |

### Live infrastructure (current prod state)

- **Vercel deploy**: `tfila-s3zf4v3cj` (commit `48aac17`), aliased to `https://tfila.co`
- **Env vars set this session**: `EXTRACTION_PIPELINE_V2=true`, `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`
- **Services wired**: Vercel Analytics, Sentry, Upstash Redis (rate-limit backing), Postmark inbound, Resend transactional, Anthropic API (Haiku + Sonnet), Jina Reader, Docling on HF Spaces, Cloudflare Worker fetch proxy
- **Cost ceiling**: $25/day LLM spend (default) — adjust via `LLM_DAILY_BUDGET_USD`
- **Kill switch**: `vercel env add EXTRACTION_DISABLED true production` halts all new LLM calls

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
