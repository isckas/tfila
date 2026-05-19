# Duplicate-rules bug — diagnosis + fix plan

## Context

The home feed at https://tfila.co was rendering BAYT's Shacharis at 8:30 AM **twice** (and same again for Chabad Gate). The user spotted it and asked for a diagnosis + plan.

Root cause confirmed via direct DB inspection (`mcp__pg-neon__query`): **7 of the 51 active shuls have multiple approved+ok data_sources, and the home feed query returns every rule from every non-rejected source — no deduplication.** When two sources extract the same minyan, the user sees the same minyan twice in the feed.

## Diagnosis — three creation patterns

Verified data (production Neon):

| Shul | data_source IDs | Pattern | Why duplicate |
|---|---|---|---|
| BAYT (41) | 41 (v1) + 99 (v2) | v2-canary | v2 canary created a NEW data_source instead of superseding v1 |
| Chabad (45) | 52 (v1) + 106 (v2) | v2-canary | same |
| Sephardic Kehila (42) | 43 + 44 | same-day double-submit | same identifier URL, both created 2026-05-12 |
| Adath Israel (47) | 59 + 60 | same-day double-submit | same identifier URL, both created 2026-05-13 |
| Shaarei Shomayim (68) | 84 + 85 | same-day double-submit | same identifier URL, both created 2026-05-14 |
| Ahavas Torah (73) | 95 + 96 + 97 | triple-submit | same URL, all created 2026-05-14 |
| Shaarei Tefillah (7) | 7 (sprint-1) + 67 (re-submit) | resubmit-after-13-days | same identifier URL, different created_at |

**Rule-level confirmation** (sample for BAYT id 41):
- Rule 841 (ds=41) and Rule 908 (ds=99) — both Shacharis, clock=08:30, days=[2], `regular`. Identical other than `data_source_id`.
- Pattern repeats for ~48 minyanim across BAYT. Every weekday Shacharis exists once in ds=41 and once in ds=99.

For Chabad (45), the v1 and v2 sources partition `days_of_week` differently (v1 grouped Tues/Wed/Fri as `[2,3,5]`, v2 split them into `[1,4]` + `[2,3]`), so naive `(tefillah, clock, days_of_week)` dedup wouldn't catch every duplicate. The semantic minyan IS the same; the encoding differs.

## Approach — three fixes, ordered by ROI

### Fix A — Pick one winning data_source per shul in the feed query (HIGHEST PRIORITY)

The home-feed query `getNearbyShulsWithRules` in `lib/queries.ts:525` currently joins rules from all approved+ok sources. Change it to:

1. Compute a "winning" data_source per shul in a CTE — pick the row with `priority DESC, last_run_at DESC, id DESC` among `review_status='approved' AND last_run_status='ok'`.
2. Only return `minyan_rule` rows whose `data_source_id` matches the winner.

This makes the feed correct **regardless of how many duplicate sources exist** — defense in depth. Solves the visible bug today without depending on data cleanup or schema changes.

The shul-detail page query `getPublicRulesForShul` (same file, search needed) probably has the same issue — apply the same fix there.

**Why this is the right primary fix:** the existing `priority` field on `data_source` already exists for this purpose (SCOPE.md memory: "Email > website > manual, higher priority wins on conflict"). The query just doesn't use it. We're closing the gap between SCOPE intent and implementation.

### Fix B — Data cleanup: mark duplicates as `superseded` (run once)

After A lands, the duplicate rows aren't visible but they still sit in the DB cluttering admin queries + the audit trail. One-time SQL (or admin script) to:

1. For each shul with >1 approved+ok source, pick the winner by the same rule used in Fix A.
2. Set `review_status='rejected'` (or add a new `superseded` value) on the losers. Drizzle migration or admin endpoint.
3. Optionally soft-delete the losers' `minyan_rule` rows by setting `deleted_at`.

Don't HARD-delete — keep the rows for audit. The `data_source` table's `review_status` enum already supports the workflow.

### Fix C — Forward fix: prevent new duplicates at creation time

Two creation paths leak duplicates today:

1. **`/api/submit`** — the existing per-domain cooldown (PROGRESS.md mentions `DOMAIN_REFIRE_COOLDOWN_MIN = 30`) didn't prevent same-day re-submits from creating new sources (Adath Israel, Ahavas Torah, Shaarei Shomayim all created within the same day). Read `app/api/submit/route.ts` to find why — likely the cooldown only blocks the LLM call, not the data_source row insertion.

2. **v2 canary path** — the canary dispatcher created NEW data_sources instead of UPDATING the existing v1 one. Likely the `build-data-source.ts` insert isn't checking for an existing same-(shul, identifier) source first. Fix: on data_source insert, check for an existing approved+ok source for the same `(shul_id, identifier)` tuple — if one exists, supersede it (mark old as `rejected` with reason='superseded') rather than creating a duplicate.

Fix C is more code surface than A or B. Lower urgency since A makes the duplicates invisible to users.

## Critical files to modify

- `lib/queries.ts:525-614` — `getNearbyShulsWithRules` (Fix A — winning data_source CTE)
- `lib/queries.ts` `getPublicRulesForShul` (Fix A — same change for shul detail)
- `lib/queries.ts` `listShulsForLookup` (already filtered by EXISTS, but probably needs the winner concept too if downstream consumers care)
- `lib/inngest/functions/build-data-source.ts:127-181` (Fix C — supersede on insert)
- `app/api/submit/route.ts` (Fix C — check existing source before creating placeholder)
- New script `scripts/dedupe-data-sources.ts` (Fix B — one-time cleanup)

## Verification

After Fix A ships:
1. Load https://tfila.co?lat=43.8137&lng=-79.4551&radius=2 — should see ONE 8:30 AM Shacharis at BAYT instead of two
2. Run via `mcp__pg-neon__query`:
   ```sql
   -- Should return at most one rule per (shul_id, tefillah, clock_time, days_of_week)
   -- at query time, across the feed's underlying join
   SELECT s.id, COUNT(DISTINCT mr.id) AS rule_count
     FROM shul s
     JOIN minyan_rule mr ON mr.shul_id = s.id
     JOIN data_source ds ON ds.id = mr.data_source_id
    WHERE s.id IN (41, 42, 45, 47, 7, 68, 73)
      AND ds.review_status = 'approved'
      AND ds.last_run_status = 'ok'
      AND mr.deleted_at IS NULL
      AND mr.special_schedule_kind = 'regular'
    GROUP BY s.id
    ORDER BY s.id;
   ```
   Verify the count for BAYT drops from ~100 (48 + 54) to ~54 (the v2 winner).
3. Spot-check shul detail at https://tfila.co/shul/bayt-ca — weekly breakdown should not double up minyanim.

After Fix B ships:
1. The dedupe-by-shul query above should return ≤1 approved+ok data_source per shul.
2. The admin queue at /admin/queue should NOT show the superseded sources as pending review.

After Fix C ships:
1. Re-trigger Extract Now on a canary shul — should NOT create a new data_source, should update the existing one's `last_run_at` + rules in-place (or supersede the prior atomically).
2. Submit the same URL twice via `/submit` — second submission should attach to the same data_source, not create a new one.

## Locked sequencing (per user answers)

All three fixes ship in **one feature branch** → PR against main → `/code-review:code-review` runs against the PR → merge after addressing review findings.

### Single PR contents

1. **Fix A** — `lib/queries.ts` `getNearbyShulsWithRules` + `getPublicRulesForShul` updated to pick a winning data_source per shul via CTE (`priority DESC, last_run_at DESC, id DESC` among approved+ok rows). Only return minyan_rule rows whose `data_source_id` matches the winner.

2. **Fix B** — new `scripts/dedupe-data-sources.ts` (or inngest one-shot function) that:
   - Finds shuls with >1 approved+ok data_source
   - For each, picks the same winner (priority DESC, last_run_at DESC, id DESC)
   - Marks each loser: `review_status='rejected'`, `reviewer_notes='superseded by ds#<winner_id> on <YYYY-MM-DD>'` — reuses existing enum, no migration
   - Soft-deletes each loser's minyan_rule rows (`deleted_at = NOW()`) so future queries skip them even if a regression in Fix A bypasses the winner-selection
   - Script is idempotent — running it twice produces no change
   - Run once against prod after Fix A is verified

3. **Fix C** — `lib/pipeline/persist-submission.ts` (or wherever `persistDataSourceWithRules` lives) gets a pre-insert supersede check:
   - Before inserting a new data_source for `(shul_id, identifier)`, look up any existing approved+ok source with that same tuple
   - If one exists: in the same transaction, mark the OLD one `review_status='rejected'`, `reviewer_notes='superseded by [will-be-ds#N] on <date>'`, soft-delete its minyan_rule rows, then insert the new one
   - Net effect: subsequent submissions/extractions for the same URL replace rather than accumulate
   - Also touches `/api/submit/route.ts` if the placeholder shul creation path needs adjustment to not pre-create a parallel data_source row

## Process

Per code-review lesson from earlier today:

1. Create feature branch off `main` (suggested name: `fix/duplicate-data-sources`)
2. Implement A + B + C; type-check clean
3. Commit + push the branch
4. `gh pr create` against main with a body describing the diagnosis + the three fixes + the verification plan
5. Run `/code-review:code-review` on the PR — this fires the 5 review agents and posts a comment
6. Address any ≥80-confidence findings in additional commits on the same branch
7. Once review-clean, merge via `gh pr merge` (squash or merge — operator choice)
8. After merge + auto-deploy, run the Fix B cleanup script once against prod
9. Re-verify via the SQL in the Verification section

The PR also serves as durable documentation of the bug + the fix; future-Isaac reading the merged commit will see the full story.

## Open follow-ups (deliberately deferred)

- Special-schedule rule dedup when the same Yom Tov override exists in multiple sources — will surface naturally after C lands. Defer until then.
- Cross-shul-merged duplicates (one shul's data accidentally under another shul) — not surfaced in current data.
- Pre-existing 21-broken-extractions backlog — unrelated, separate workstream.
- A `superseded` enum value (vs reusing `rejected`) — only if admin UI tells the two apart in a confusing way. Reuse for now; migrate later if friction surfaces.

## Additional symptom — admin state inconsistency on Nosson's Shul (2026-05-19)

Same root cause family. Nosson's Shul (`/admin/shul/nosson-s-shul`) has two approved data_sources but the per-surface logic disagrees on whether the shul is healthy.

### Confirmed state in DB

- ds #92 — `identifier=https://www.nossonsshul.com/` (root), `extraction_strategy='failed'`, `last_run_status='broken'`, `review_status='approved'`, 0 rules
- ds #93 — `identifier=.../Shul-Schedule.htm` (resolved), `extraction_strategy='html'`, `last_run_status='no_change'`, `review_status='approved'`, 11 rules @ 0.92 conf

### Four surfaces, four different stories

| Surface | What it says | Why |
|---|---|---|
| Shul detail "Active" pill | Active | `shul.status='active'` — correct in isolation |
| Per-source list on shul page | ds #92 approved + failed | Both fields are independently true. Confusing display, real conflict in state semantics. |
| Recent scrape_runs row | "no_change" status with error `"skipped: data_source marked failed / shul unsupported"` | `weekly-rescrape` skipped ds #92 because strategy='failed'; logged as `no_change` instead of a proper `skipped` status |
| Admin home inbox | "Investigate broken extraction" | Shul-level state derived from MAX-badness across sources instead of ANY-good-source reduction |

### Bug list this surfaces (separate from but related to the duplicate-feed-rules bug)

- **Bug D — auto-approval of failed extractions.** When the cascade returns `strategy='failed'` with 0 rules, the persistence path still inserts the data_source with `review_status='approved'`. Should auto-reject (or use a new `auto_rejected` state) so the human-review queue isn't polluted.
- **Bug E — discovery-resolved URL doesn't supersede the original-submitted URL.** When `/submit` (or a discovery candidate) submits `https://example.com/` and `resolveScheduleUrl` lands on `https://example.com/schedule.html`, the system creates TWO data_sources rather than retiring the root-URL one or extracting once at the resolved URL. Same supersede gap as the v2-canary-duplicates case from earlier in this plan, just in a different code path.
- **Bug F — `weekly-rescrape` skip logged as `no_change`.** `lib/inngest/functions/weekly-rescrape.ts` (or `scrape-one-shul.ts`) writes a scrape_run row with status='no_change' when it bails because the source is already `strategy='failed'`. Should be a proper `skipped` status (would need a schema migration to add the enum value), or at minimum carry a different convention so the cron-summary doesn't double-count skips as healthy no-changes.
- **Bug G — shul-level health reduction is broken.** The admin inbox + the "X shuls need attention" counter aggregate health by MAX-of-worst across the shul's data_sources. Should be ANY-of-good: a shul is healthy if it has at least one approved+ok+fresh source. Bug G is the user-visible compounding of B + D + E.

### Where the fix touches

Add to the existing fix list:

- `lib/pipeline/persist-submission.ts` — when `strategy === 'failed'`, set `review_status='rejected'` + `reviewer_notes='auto-rejected: cascade failed on creation'`. Closes Bug D.
- `app/api/submit/route.ts` + `lib/discovery/find-schedule-page.ts` — if the resolver lands on a different URL than what was submitted, EITHER skip the root-URL data_source creation entirely (preferred — only persist for the resolved URL) OR mark the root-URL data_source as rejected with `reviewer_notes='superseded by resolver → ds#N'`. Closes Bug E.
- `lib/inngest/functions/scrape-one-shul.ts` or sibling — the skip-because-failed path should not write a `no_change` scrape_run. Either write `skipped` (after enum migration) or don't write at all (return early before the audit insert, since the source already records its failure state on its own row). Closes Bug F.
- `app/admin/page.tsx` or whatever query feeds "X shuls need attention" — change reduction logic so a shul is in the "broken" inbox ONLY if NO data_source for that shul has `review_status='approved' AND last_run_status='ok' AND fresh`. Bonus: hide approved-broken sources from the per-shul detail page entirely (they're zombie state). Closes Bug G.

### Implication for the consolidated PR

The dedupe plan (A+B+C from above) already touches the persistence path and the admin-feed query. Adding D-G keeps the same code surface but expands the change footprint. Recommend handling D, E, F, G in the SAME PR as A+B+C since the fix is structurally about "what should the supervisor-of-data-sources logic do, and where does that logic live." Splitting would leave the same problem half-fixed.

## What this plan does NOT cover

- Special-schedule rule deduplication when same Yom Tov has multiple sources — defer until C lands and we've seen behavior in practice.
- Cross-shul-merged duplicates (one shul whose data lives under another shul's id) — different bug, not surfaced by current data.
- Email-source vs website-source priority resolution per SCOPE.md (email wins) — Fix A's priority-based winner selection naturally implements this since email sources are stamped `priority=50` (vs website at 40), so when both exist email wins by the same DESC sort.

---

## 2026-05-19 — Comprehensive state-machine audit (3 parallel investigators)

User asked: "look through the whole website for these inconsistencies... how do ds stages affect shul status... how do we handle older ds... how do we restart the extraction schema when a shul page changes... what else should we look at?"

Three Explore agents + DB spot-checks ran in parallel. **Result: 12 additional bugs surfaced**, organized into 4 themes. Plus alarming production-state stats that confirm this isn't a rounding error.

### Production state stats (2026-05-19)

- **27 of 106 data_sources have `extraction_strategy='failed'`** (25%) — these are sources the cascade gave up on and weekly cron now permanently skips
- **44 of 106 data_sources have `last_run_status='broken'`** (41%) — repeated failures, no escalation, no retirement
- **58 of 106 sources are `review_status='approved'`** but only **51 have `last_run_status='ok'`** — so 7+ "approved" sources never produced rules
- **21 of 57 scrape_runs in last 30d were `broken`** (37%) — and most of those probably also got logged as `no_change` skip-rows that the cron-summary email counts as healthy
- **9 shuls stuck in `shul.status='unsupported'`** with no documented recovery path

### Theme 1 — State-machine cleanup (auto-approval, status reduction, audit hygiene)

| # | Bug | Where | Fix |
|---|---|---|---|
| D | Failed extractions get auto-approved at insert time | `lib/pipeline/persist-submission.ts:137-155` + `app/api/admin/shul/[id]/extract/route.ts:88-125` | When `strategy='failed'`, set `review_status='rejected'` + `reviewer_notes='auto-rejected: cascade failed on creation'` |
| F | Skipped weekly runs logged as `status='no_change'` | `lib/inngest/functions/scrape-one-shul.ts:74-90` | Either add `scrape_run.status='skipped'` enum + migration, or don't write a scrape_run row at all on skip |
| G | Admin inbox reduces shul-health by MAX-bad across sources | `lib/admin-state.ts:98-102` + `lib/queries.ts:452-462` + `app/admin/page.tsx` | Change reduction to ANY-good: shul is in "broken" inbox ONLY if no data_source is approved+ok+fresh |
| M | `/api/admin/data-source/[id]/approve` doesn't validate `strategy !== 'failed'` | `app/api/admin/data-source/[id]/approve/route.ts:40-47` | Refuse approval when `extraction_strategy='failed'`. Failed sources must be rejected, not approved. |
| N | `shul.status='unsupported'` is a one-way door — no UI path to flip out | `lib/inngest/functions/build-data-source.ts:144-146` + admin layer | Either auto-recover on next successful extraction OR add an admin "reset status" affordance |
| P | Broken-with-pending-rules state shows stale rules on public feed | `lib/inngest/functions/scrape-one-shul.ts:234-256` + `lib/freshness.ts` | When `last_run_status='broken' AND review_status='pending'`, treat as stale on public surfaces |

### Rule-level dedup vs source-level — the key design decision

DB probe confirmed: 81 rules are true exact-duplicates across 2+ sources for the same shul, but 266 rules are unique to a single source. The original plan said "pick a winning data_source per shul" — that would DROP all 266 unique-to-loser-source rules in shuls with multiple approved sources. The correct fix is **rule-level dedup** which handles all three cases:

- Same rule in 2 sources → keep one (winner by priority/recency)
- Unique rule in source A → keep
- Unique rule in source B → keep (no conflict → both shown)

This is the SCOPE.md-aligned design ("Email > website priority, rule-level conflict resolution"). Implementation is a single CTE in the two affected queries; complexity is similar to source-level dedup.

### Theme 2 — Supersede / dedupe (already mostly captured in A-E above)

| # | Bug | Where | Fix |
|---|---|---|---|
| A | Feed query returns rules from ALL approved sources per shul (no dedup) | `lib/queries.ts:525-614` `getNearbyShulsWithRules` | **Rule-level dedup via CTE with ROW_NUMBER()**. Partition by `(shul_id, tefillah, time->>'clock', days_of_week, special_schedule_kind, valid_from, valid_to)`; order by `ds.priority DESC, ds.last_run_at DESC NULLS LAST, ds.id DESC`; keep `rn = 1`. **Not winning-source-per-shul** — that would drop unique rules from loser sources (266 of 347 rules are unique to a single source, per DB probe). |
| A' | Shul detail + print page have same issue | `lib/queries.ts` `getPublicRulesForShul` (line 101) — used by `app/shul/[slug]/page.tsx` AND `app/shul/[slug]/print/page.tsx` | Same rule-level dedup CTE. Confirmed: print page uses same query so fix transfers automatically. |
| B | 7 shuls have ≥2 approved-ok sources right now | n/a — data state | One-time `scripts/dedupe-data-sources.ts` marks losers `review_status='rejected'` + `reviewer_notes='superseded by ds#N'` |
| C | New extractions don't supersede existing same-(shul, identifier) source | `lib/pipeline/persist-submission.ts` | Pre-insert check: if approved+ok source exists for same tuple, reject it in same transaction |
| C' | Missing UNIQUE INDEX on (shul_id, identifier) | `db/schema.ts:157-185` | Add `uniqueIndex("data_source_shul_identifier_idx").on(t.shulId, t.identifier)`. Requires migration + the dedupe script from Fix B to run first so the migration can succeed |
| E | Discovery-resolver creates 2 sources (root URL + resolved URL) | `app/api/submit/route.ts` + `lib/discovery/find-schedule-page.ts` | If resolver lands on different URL than submitted, skip the root-URL source entirely OR mark it superseded |

### Theme 3 — Cascade adaptation (the "page-shape changed, system doesn't notice" theme)

This is the answer to your "how do we restart the extraction schema from first to fourth level when a shul page changes" question. The system today **does not adapt**. Investigation findings:

| # | Bug | Where | Fix |
|---|---|---|---|
| **H** | HTML rescrape calls `extractFromHtml()` directly instead of `runCascade()` — bypasses tier fallback entirely | `lib/inngest/functions/scrape-one-shul.ts:164-166` (the just-edited line) | Change to `runCascade(submittedUrl, { preferredStrategy: 'html', shulId })`. The cascade will try HTML first; on failure, fall through to JS-rendered, vision, PDF. **This is the single highest-impact fix** for the user's stated question. |
| K | Failed sources permanently skipped — admin has no surface to triage chronic vs new | `lib/inngest/functions/scrape-one-shul.ts:74-90` | **Policy (user-locked): never auto-retry; cost discipline first.** Instead, the existing admin "Broken" inbox shows them, AND the weekly digest email separates "new fails this week" from "chronic" so admin gets a triage-friendly view. See Theme 5 below. |
| L | Broken sources can stay `broken+pending` indefinitely | `lib/inngest/functions/scrape-one-shul.ts:219-265` | **Policy (user-locked): never auto-retire either.** Same handling as K — surface in admin Broken inbox + weekly digest. Admin decides whether to reject (mark dead), edit URL, or retry manually. |
| J | `find-schedule-page` resolver only runs at initial submission, never re-invoked on rescrape failure | `lib/discovery/find-schedule-page.ts` + `lib/inngest/functions/scrape-one-shul.ts` | Defer — once H lands, admin "Extract Now" already runs full cascade + resolver. Re-invoking the resolver on weekly cron failure could be added later but adds LLM cost and the user-locked policy says cost-first. Park as a follow-up. |
| I | Hash-match short-circuits even after a 0-rule extraction | `lib/inngest/functions/scrape-one-shul.ts:138-161` | When prior extraction returned 0 rules (broken state), DON'T trust the hash — force re-evaluation. Hash optimization should only apply to a known-good prior state. |
| O | `isUseful` threshold rejects pinned tier silently — no fall-through on borderline confidence | `lib/llm/cascade.ts:114-116` MIN_USEFUL_CONFIDENCE=0.4 + `cascade.ts:316,382,446` | Already handled implicitly by H: once H lands, the cascade is invoked instead of the bare extractor, so fall-through-on-borderline-confidence is the cascade's existing job. Verify via the verification step. |

### Theme 4.5 — Broken-source triage (user-locked policy: cost-first)

User decision: no auto-retry, no auto-retire on failed/broken sources. The recovery loop is **admin-driven via a weekly digest + the existing Broken inbox**. Implementation:

| # | Item | Where | Purpose |
|---|---|---|---|
| Q | Add `data_source.first_broken_at` timestamp column | `db/schema.ts` + migration | Tracks WHEN a source first went broken in its current broken streak. Set when `last_run_status` transitions from `ok`/null → `broken` or `failed`. Cleared when it goes back to `ok`. |
| Q' | Writer side: set/clear `first_broken_at` on status transitions | `lib/inngest/functions/scrape-one-shul.ts` (mark-broken step) + `lib/pipeline/persist-submission.ts` | Single point where these state changes happen. |
| R | Weekly digest extension — separate "New fails this week" vs "Chronic broken" | `lib/inngest/functions/weekly-rescrape-summary.ts` | Subject line: `Weekly cron · 87 scrapes · 3 NEW broken · 12 chronic · 2 stale`. Body groups new (first_broken_at > 7 days ago) vs chronic separately. |
| S | Admin Broken inbox — sort by first_broken_at DESC; show "Broken since: X days ago" badge | `app/admin/page.tsx` + `lib/queries.ts` listAdminShuls | Newer breakages float to top of inbox. Chronic ones drop down but stay visible. |

This pattern preserves cost discipline (no extra LLM calls) AND closes the visibility gap (admin sees what changed this week vs what's chronic).

### Theme 4 — UI consumer cleanup (already absorbed into themes above)

Each surface that shows "broken / active / approved" gets touched once:
- Admin home inbox: change reduction logic (covered by G)
- Per-shul detail page: hide zombie approved-failed sources from main view (or render them clearly as "auto-rejected: failed")
- Public feed: respect winning-source selection (covered by A)
- Public shul page: same (covered by A')
- Cron-summary email: stop counting `no_change` skips as healthy (covered by F)

### Things to look at that this audit did NOT yet cover

You asked "what else should we look at?" Below are the surfaces we have **not** investigated yet — worth a separate pass before locking the fix scope:

- **Email-path lifecycle** — `lib/inngest/functions/process-email.ts`. Does the email-newsletter source follow the same patterns? Quick check: do email sources also have the auto-approval / no-supersede / no-retry-on-failed problems?
- **The 42 pending-review data_sources** — how long have they been pending? Is there a stale-pending reaper? If admin abandoned the queue, those rows pile up indefinitely.
- **The 14-day stale window** in `hasFreshDataSourceForShul` — when a shul flips from ok→broken, daveners keep seeing old rules for up to 14 days. Is that the right TTL? Should `last_run_status='broken'` flip to stale immediately?
- **The pre-existing 21 broken extractions** flagged 2026-05-16 in PROGRESS.md — were any triaged? Are they still in the 44-broken count?
- **`shul.status` transitions** — full audit of every code path that writes `shul.status`. The state machine has 5 values (`pending_review`, `active`, `broken`, `archived`, `unsupported`) but no documented transition rules. Likely transitions happen ad hoc across multiple writers.
- **Manual rule editing in admin** — does it exist? If yes, what happens to manually-edited rules when the weekly cron re-extracts and replaces them? Are admin edits durable?
- **Postmark inbound dedup** — same-email-forwarded-twice scenarios. The inbound dedup uses sender email; what if Gmail forwards the same shul newsletter from two different inboxes?
- **The `lib/admin-state.ts` `deriveAdminShulState` function** — this is the single point that decides shul-health-label. Worth a focused unit-of-attention since 4+ admin UIs depend on it.

## Consolidated implementation plan (single PR scope)

Per earlier locked decisions: feature branch + PR + `/code-review:code-review` skill before merge. One PR. Estimated 600-1000 LOC across ~12 files.

### Order of operations within the PR

1. **DB migration** — add `uniqueIndex("data_source_shul_identifier_idx").on(t.shulId, t.identifier)`. Requires the dedupe script to have already run, so we sequence the cleanup BEFORE this migration even though they ship in the same PR. Order in deploy:
   1. Deploy the PR's code (cleanup script available but not yet executed)
   2. Run `npm run db:dedupe-sources` (Fix B) once against prod
   3. Run `npm run db:push` to apply the migration
2. **Persistence-layer fixes** — `persistDataSourceWithRules` auto-rejects failed, supersedes existing same-(shul, identifier) sources (Fixes C, D, E)
3. **Query-layer fixes** — `getNearbyShulsWithRules` + `getPublicRulesForShul` + `listShulsForLookup` use winning-source CTE (Fixes A, A')
4. **Cron-layer fixes** — `scrape-one-shul.ts` HTML path uses runCascade, hash-check respects 0-rule history, auto-retry counter, broken-escalation counter (Fixes H, I, K, L)
5. **Cascade-layer fixes** — pinned-tier fallback on borderline confidence, resolver re-invocation on rescrape failure (Fixes J, O)
6. **API-layer fixes** — approve endpoint rejects strategy='failed' (Fix M); shul-unsupported recovery path (Fix N)
7. **UI-layer fixes** — admin inbox reduction logic, hide broken-pending rules on public surfaces (Fixes G, P)
8. **scrape_run audit hygiene** — `status='skipped'` enum value + writer updates (Fix F)

### Verification plan

After all fixes ship:

```sql
-- Sanity-check counts after dedupe + state cleanup
SELECT 'duplicate (shul,identifier) pairs' AS check,
       COUNT(*) FROM (
         SELECT shul_id, identifier FROM data_source
         GROUP BY shul_id, identifier HAVING COUNT(*) > 1
       ) x;  -- expect 0

SELECT 'approved sources with strategy=failed' AS check,
       COUNT(*) FROM data_source
        WHERE review_status='approved' AND extraction_strategy='failed';  -- expect 0

SELECT 'shuls with >1 approved-ok source' AS check,
       COUNT(*) FROM (
         SELECT shul_id FROM data_source
          WHERE review_status='approved' AND last_run_status='ok'
          GROUP BY shul_id HAVING COUNT(*) > 1
       ) x;  -- expect 0
```

Plus the per-bug verification steps in each section above.

### Theme 5 — Admin pages (queue / rejected / shul detail / data_source detail / candidates)

Independent audit pass on 2026-05-19. Email path was also audited and came back clean — no parity bugs there beyond the existing themes. Admin pages surfaced 7 bugs:

| # | Bug | Where | Fix |
|---|---|---|---|
| T | Queue page includes zombie failed extractions | `lib/queries.ts` `listAdminShuls` `hasPendingSource = bool_or(review_status='pending')` | Add `AND extraction_strategy != 'failed'` to the predicate. DB confirms 20+ such zombies polluting the queue today. |
| U | Approve / reject redirect always to `/admin/queue`, breaking the per-shul multi-source workflow | `app/api/admin/data-source/[id]/approve/route.ts:50`, `.../reject/route.ts:31` | Use `?from=` param or Referer header to redirect back to originating page (`/admin/shul/[slug]` or `/admin/queue`) |
| V | `hasBrokenRun = bool_or(last_run_status='broken')` flags a shul broken even when it has another approved+ok source | `lib/queries.ts:459` + `lib/admin-state.ts:102` | Reduce to ANY-good per Bug G in Theme 1; or, more precisely: the shul-level broken flag should be `(approved_ok_count = 0)` not `(any_source_broken)` |
| W | No global view of all rejected data_sources | n/a (missing page) | After the dedupe script in Fix B marks many sources rejected, admin needs a "rejected sources" audit view. Add `/admin/data-sources/rejected` or extend `/admin/rejected` to optionally show source-level (not just shul-level) rejections |
| X | Failed-extraction sources visually peer with approved sources on shul detail | `app/admin/shul/[slug]/page.tsx:450-530` | Render `extraction_strategy='failed'` sources in a collapsed/grayed "Failed extractions" section below the main source list. Already partly badged but not visually demoted. |
| Y | Candidates page has no post-approval outcome tracking | `app/admin/candidates/page.tsx` | Add "Recent approvals with failed extraction" section (last 7d, `shul.status='unsupported'`) so the discovery → approval → extraction loop has visible feedback |
| Z | Changelog isn't an audit trail of admin actions (approvals, rejections, rebuilds) | `app/admin/changelog/page.tsx` | Defer. Current changelog reads CHANGELOG.md (feature notes). A separate audit-log surface (using `reviewer_notes` + `updated_at` on data_source) would help for compliance but isn't urgent. |

### Pending-review backlog (DB-confirmed, 2026-05-19)

| Age | n | of which failed | of which broken |
|---|---|---|---|
| <7d | 28 | 20 | 23 |
| 7-30d | 14 | 0 | 14 |
| >30d | 0 | — | — |

34 of 42 pending sources are un-approvable zombies. Fix T removes them from the queue surface immediately. Fix D prevents new ones from accumulating going forward.

### Bug count summary

After 3 audit rounds:
- Theme 1 (state-machine cleanup): **6 bugs** — D, F, G, M, N, P
- Theme 2 (supersede / dedupe): **6 bugs** — A, A', B, C, C', E
- Theme 3 (cascade adaptation): **2 bugs** — H, I (K + L deferred to policy; J deferred to follow-up; O absorbed by H)
- Theme 4.5 (broken-source triage + weekly digest): **4 items** — Q, Q', R, S
- Theme 5 (admin pages): **7 bugs** — T, U, V, W, X, Y, Z

**~25 actionable items** for one consolidated PR. Total touch surface: ~12-15 files, schema migration, one-time dedupe script, weekly-digest extension.

### Theme 6 — `shul.status` state-machine + legacy data (third audit round, 2026-05-19)

#### Cohort insight (the biggest reframe in this audit)

DB query partitioned the 44 broken sources by creation date:

| Cohort | website_llm | shulcloud_website | All-failed strategy | Notes |
|---|---|---|---|---|
| pre-2026-05-16 (sprint-1 migration era) | 30 | 12 | 25 | Legacy data |
| created after 2026-05-16 | 2 | 0 | 2 | New bad submissions |

**42 of 44 broken sources are LEGACY from the sprint-1 migration.** The "44 broken / 27 failed" disaster isn't an ongoing flow problem — it's stale state that never got cleaned up after the platform migration. Implication: most of the fix's heavy lifting is **one-time cleanup**, not continuous-defense.

#### shul.status bugs

| # | Bug | Where | Fix |
|---|---|---|---|
| AA | `shul.status='broken'` value exists in schema but **no code path ever writes it** | Schema vs. all writers | Either retire the enum value (and update SCOPE.md), OR add a writer (e.g., weekly cron sets it when all sources broken). User decision: probably retire — current "Broken" admin tile reduces from data_source state anyway, so shul.status='broken' is dead weight. |
| BB | `data-source/approve` route flips `shul.status='active'` without checking FROM state | `app/api/admin/data-source/[id]/approve/route.ts:42-46` | Add `.where(eq(shul.id, X) AND inArray(shul.status, ['pending_review', 'unsupported']))`. Refuse to flip an `archived` shul back to active via source-approval. |
| CC | No `active`→`pending_review` demotion when all sources go bad | Missing in scrape-one-shul | When weekly cron leaves a shul with zero approved+ok sources, demote shul.status to `pending_review` (or keep `active` and let stale-gate hide the public surface — design choice). |

#### ShulCloud-specific finding

Surprising: there's a fully-functional `lib/scrapers/shulcloud-calendar.ts` parser (hard-coded 0.92 confidence, ShulCloud-specific HTML schema) that is **never invoked anywhere in the cascade**. The sprint-1 migration script created data_sources with `kind='shulcloud_website'` but didn't wire them to use this parser. Weekly cron tried generic LLM HTML extraction on these sources and most got broken.

| # | Bug | Decision needed |
|---|---|---|
| DD | ShulCloud parser is dead code; 12 ShulCloud sources broken as a side effect | **LOCKED: retire `lib/scrapers/shulcloud-calendar.ts`.** Delete the file. Let the v2 LLM cascade handle ShulCloud sites like any other HTML site. The 12 broken legacy sources get cleaned up via the same dedupe + cascade-retry flow as other broken sources. Removes ~200 LOC of dead code. |

#### Manual rule editing finding

Grep confirmed manual edit endpoints exist: `app/api/admin/rule/[id]/edit/route.ts` + `.../delete/route.ts` + `lib/inngest/functions/scrape-one-shul.ts` writes rules + `lib/pipeline/persist-submission.ts` writes rules.

| # | Bug | Where | Fix |
|---|---|---|---|
| EE | Weekly cron rule rewrite may clobber admin-edited rules | `scrape-one-shul.ts` rule-replacement path + `persist-submission.ts` rule writers + manual edit endpoints | **LOCKED: add `is_manual_edit` flag, cron preserves flagged rules.** New column `minyan_rule.is_manual_edit BOOLEAN DEFAULT false`. The two manual edit endpoints (`app/api/admin/rule/[id]/edit` + `.../delete`) set the flag on the affected row. Rule-replacement path in `scrape-one-shul.ts` + `persist-submission.ts` adds `WHERE is_manual_edit = false` to its soft-delete-old-rules step. Manual edits become durable across cron runs. |

#### Stale TTL design call

| Item | Today | Question |
|---|---|---|
| `hasFreshDataSourceForShul` | 14 days since last `ok` run | Should `last_run_status='broken'` immediately flip to stale, or stay grandfathered 14 days? |

Recommendation: stay 14 days. Daveners see stale rules during the grace period — but stale rules are usually correct (schedules don't change weekly). Flipping to stale immediately on broken would hide a shul from the public feed even when the prior week's rules are still valid. The freshness chip ("Verified N days ago") already tells users when data was last verified.

### Final bug count + scope

| Theme | Items | Status |
|---|---|---|
| 1 — state-machine cleanup | D, F, G, M, N, P (6) | All locked |
| 2 — supersede / dedupe | A, A', B, C, C', E (6) | All locked |
| 3 — cascade adaptation | H, I (2; J/K/L policy-locked, O absorbed by H) | Locked |
| 4.5 — broken-source triage + weekly digest | Q, Q', R, S (4) | Policy locked |
| 5 — admin pages | T, U, V, W, X, Y (Z deferred) (6) | Locked |
| 6 — `shul.status` machine + legacy + ShulCloud + manual edits | AA, BB, CC, DD, EE (5) | All locked |

**Total: 29 actionable items.** Scope is substantial but bounded. Cleanup phase (Fix B + DD retirement + AA retirement of dead enum) does most of the heavy lifting against the 42 legacy broken sources.

### First implementation step

Copy this plan to `docs/STATE-MACHINE-FIX-PLAN.md` so the durable diagnosis survives the scratch path. The repo doc is the durable artifact; the `~/.claude/plans/` file is the working draft.

### Still NOT investigated (next-round candidates)

You asked for thorough; here's what's left if you want one more pass before lock:

- **`shul.status` state-machine** — every code path that writes `shul.status` (pending_review / active / broken / archived / unsupported). 5 states, no documented transitions. Likely scattered writers.
- **The 12 `shulcloud_website` pending+broken sources** — these came from the sprint-1 ShulCloud scraper, different code path from the LLM cascade. Worth confirming they slot into the same fix or need their own.
- **The 14-day stale TTL** in `hasFreshDataSourceForShul` — design decision. Should `last_run_status='broken'` flip to "stale" immediately, or grandfathered for 14 days?
- **Manual rule editing** — does the admin UI allow editing rules directly? If yes, how does it interact with the weekly cron's rule rewrite?
- **The 21 broken extractions from PROGRESS.md (2026-05-16)** — overlap with current 44 broken? Are any of those still in our set?

### Open items needing user decisions before code starts

A few real choices remain. Worth a final round of clarification before lock-in.
