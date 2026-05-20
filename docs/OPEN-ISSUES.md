# Open Issues & Edge Cases

Rolling log of known edge cases, UX gaps, and "things that work but should be better."
**Latest at top.** Each entry: title + date logged + status + body.

Status legend:

| Glyph | Meaning |
|---|---|
| 🔍 | captured — diagnosed, not yet locked for a fix |
| 🎯 | fix-locked — design agreed; not yet building |
| 🚧 | in-progress — fix is being built right now |
| ✅ | resolved (date / PR) |

This doc is the durable home for known problems. PR-level discussion lives on the PR; this is what survives.

---

## ✅ `no_change` mis-classified as broken in admin queue + freshness probe — PR #4

**Logged 2026-05-19 · resolved 2026-05-19.**

PR #2 added `hasBrokenRun = (approved_ok_count = 0)` and `active → pending_review` demote logic using `last_run_status = 'ok'` strictly. The `data_source_run_status` enum has 4 values: `ok`, `no_change`, `broken`, `error`. **`ok` and `no_change` are both successful states** — `no_change` means "cron ran, URL hash matched the prior run, no re-extraction needed." Strict `='ok'` mis-flagged three shuls today: Bais Menachem (ds#53), Anshei Lubavitch (ds#80), Nosson's Shul (ds#93) — all approved sources with rules + recent successful runs.

Fixed by broadening 13 reader sites to `IN ('ok', 'no_change')` (raw SQL) or `inArray(..., ["ok", "no_change"])` (Drizzle ORM): `lib/queries.ts` (×7), `lib/freshness.ts` (×1), `lib/inngest/functions/scrape-one-shul.ts` (×3), `lib/inngest/functions/weekly-rescrape-summary.ts` (×1), `lib/llm/tools/previous-extraction.ts` (×1). Writer sites (those that set `lastRunStatus: "ok"` on a fresh run) left untouched — they're correct.

---

## ✅ Admin "Extract Now from this URL" ran synchronously — PR #4

**Logged 2026-05-19 · resolved 2026-05-19.**

The shul-header Extract Now button awaited `runCascade(...)` inline inside the HTTP handler (`app/api/admin/shul/[id]/extract/route.ts`); page spinner held the admin captive for 30-120s, and closing the tab mid-run risked losing the result banner (and, on Vercel graceful-shutdown, the transaction).

The sibling per-data_source "Re-extract from source" button was already async via `inngest.send("data-source.requested", ...)` → handled by `lib/inngest/functions/build-data-source.ts`. Fixed by collapsing the shul-level Extract Now to the same pattern: auth check → `inngest.send(...)` → 303 redirect to `?rebuilt=1` with the existing "Re-extraction queued" banner. Admin can now queue multiple shul extractions in succession and walk away.

Force-extract semantics: the build path has no hash-match short-circuit (that lives in `scrapeOneShul`, the rescrape path), so admin clicks always re-run the cascade. Combined with PR #2's supersede-on-insert, the new data_source atomically replaces the prior one.

---

## 🔍 Multi-calendar shul (one URL per schedule-context)

**Logged 2026-05-19.**

Some shuls publish their schedule across two separate calendar pages on the same domain — one for weekday minyanim, one for Shabbat. Concrete example:

- https://calendar.adasisrael.org/events/category/daily-minyan/
- https://calendar.adasisrael.org/events/category/shabbat/

### What works today

- **Auto-merge on registrable domain** attaches both URLs as separate `data_source` rows under the same shul (`app/api/submit/route.ts:105-135`, FEATURES.md "Deduplication" entry).
- **Extraction independence** — each data_source runs its own cascade; weekday rules + Shabbat rules merge cleanly on the public feed via the rule-level dedup CTE.
- **Admin "Split into separate shul"** affordance if the merge was wrong (`app/admin/shul/[slug]/page.tsx:520-533`).

### 4 UX sub-gaps

1. **Misleading user-facing error on 2nd-page submit** (`app/submit/page.tsx:61-62`). Says "We already have this shul. Email us if you want to update it." — sounds like a rejection. Actually a 2nd data_source was silently attached. Fix shape: distinct success message when the auto-merge path fires.
2. **Discovery resolver returns ONE URL** (`lib/discovery/find-schedule-page.ts:243-305`). If the user submits the bare homepage, the resolver picks the first "schedule"-like link. Multi-calendar pages are missed. Fix shape: extend resolver to return array, OR surface "Add another schedule URL" affordance in admin.
3. **No visual multi-calendar indicator in admin** (`app/admin/shul/[slug]/page.tsx`). Two data_source rows show with no label distinguishing "weekday calendar" from "Shabbat calendar." Fix shape: derive label from URL path keywords (`daily-minyan`, `shabbat`, `calendar`) OR free-text admin tag per data_source.
4. **30-min cooldown suppresses 2nd-URL extraction** (`app/api/submit/route.ts:170-187`). If both URLs submitted within 30 min, the 2nd's extraction is suppressed. Fix shape: cooldown per `(shul_id, identifier)` not per shul.

### Priority

Defer. None block the phase-1 launch. Pick up if a real user hits the case.

---

## 🔍 Discovery — HIGH: INSERT failures silently lose candidates

**Logged 2026-05-19.**

`app/api/admin/discovery/run/route.ts:103-160`. When Places returns duplicate `place_id`s within or across queries, the second insert hits `ON CONFLICT DO NOTHING` and the discovery_run row gets `error=<raw SQL statement>`. Admin sees "error_runs: 6" in the result banner with no retry path or list of skipped candidates.

In prod today: 6 of 9 discovery_run rows are marked error. Exact candidates lost; re-running discovery finds the same duplicates and fails again.

**Fix shape:** distinguish "true duplicate" (skip silently) from "INSERT failure" (log a structured error with the failing place_id + retry on next run). Add batch retry with exp backoff for transient DB hiccups; return a JSON list of failed place_ids for admin inspection.

---

## 🔍 Discovery — HIGH: Dead "deferred" status in candidates UI

**Logged 2026-05-19.**

`app/admin/candidates/page.tsx:28,35` — the UI renders a `deferred` filter pill and a `STATUSES` array entry, but no code path ever writes `review_status='deferred'`. Clicking the pill shows a perma-empty list.

**Fix shape:** either (a) remove the pill + enum value (delete-only refactor); (b) wire up a real "snooze for N days" affordance with a `deferred_until` timestamp column so candidates auto-return to pending after the snooze window.

---

## 🔍 Discovery — MEDIUM: LLM scout failures silent in resolver

**Logged 2026-05-19.**

`lib/discovery/find-schedule-page.ts:185-241`. If `ANTHROPIC_API_KEY` is missing, the function returns `null` silently (line 189). If the Anthropic API call throws, the exception is caught (line 238) and also returns `null`. Either way the resolver cascades to the root-URL fallback at confidence 0.4 — admin never sees that the LLM scout was attempted and failed.

**Fix shape:** log a structured warn with the failure reason (`no-api-key` / `rate-limit` / `network-error` / `bad-response`); attach an `llmAttempt: {status, model, costUsd}` field to `ResolvedScheduleUrl` so ops can see attempt rate + failure breakdown.

---

## 🔍 Discovery — MEDIUM: No metrics on schedule-resolver tier distribution

**Logged 2026-05-19.**

The resolver has 4 tiers: common-path probe → root-page link scan → LLM scout → root-URL fallback. No per-tier counter exists. If 80% of submissions hit the fallback (low-confidence 0.4 root URL), we're pushing weak URLs into extraction without knowing.

**Fix shape:** increment per-tier counters (Postgres counter table OR Inngest event payload field); surface on `/admin` ops dashboard as "Resolver tier distribution — last 30d."

---

## 🔍 Discovery — MEDIUM: Discovery is English-only

**Logged 2026-05-19.**

Multiple sites:

- `app/api/admin/discovery/run/route.ts:58-67` — Places request body omits `languageCode`. Defaults to API-key locale (English).
- `data/discovery-targets.json` — target queries are all English (`"synagogue"`, `"shul"`, `"shtiebel"`) even for Paris, Antwerp, Israel, Sarcelles.
- `lib/discovery/find-schedule-page.ts:26-51` — `COMMON_PATHS` (`/schedule`, `/times`, `/calendar`, `/minyan`, `/davening`, `/tefilla`) and `SCHEDULE_KEYWORDS_RE` (schedule|times|minyan|davening|prayer|service|tefilla|shacharis|mincha|maariv|shabbos) are English + transliterated Hebrew only.

A French shul page like `acip.fr/horaires-des-offices/` misses Tier 1 (pattern probe) + Tier 2 (link scan) and falls to Tier 3 (LLM scout) or worst case the 0.4-confidence root-URL fallback.

**Fix shape:** (a) add `languageCode` to Places request, keyed off `target.region` (`europe.fr`, `europe.ru`, `israel`, etc.); (b) extend `COMMON_PATHS` + keyword regex with locale variants (`horaires`, `prières`, `office`, `horarios`, `rezos`, `молитва`, Hebrew script); (c) update the LLM scout prompt to enumerate the non-English signal terms explicitly.

---

## 🔍 Discovery — MEDIUM: Approval → extraction success is ~36%

**Logged 2026-05-19.**

Of 11 approved candidates, 4 reached `shul.status='active'`, 6 landed at `unsupported`, 1 archived. The Crown Heights cohort is Chabad/ShulCloud-heavy and many sites the v2 cascade can't yet handle (the ShulCloud-specific parser was retired in PR #2 as dead code).

Not a code bug per se — but no surface tells admin "discovery is producing approvable shuls vs unsupported ones at this rate." Hard to know whether to keep approving Crown Heights candidates or move to another tier.

**Fix shape:** add an "Approval funnel — last 30d" widget at top of `/admin/candidates` showing % approved that reached `active` vs `unsupported`. Tracks improvement as the cascade gets better.

---

## 🔍 Discovery — LOW: No "merged into existing shul" banner on dedup-approve

**Logged 2026-05-19.**

`app/api/admin/candidate/[id]/approve/route.ts:126-170` — when the approve route's match_domain dedup finds an existing shul, it backfills `address`/`location` and returns `{ ok: true, dedup: true, shulId }`. The redirect (line 241-251) sends admin back to `/admin/candidates` with no visual cue that a merge happened. Admin might not realize a duplicate was reconciled.

**Fix shape:** 303 to `/admin/shul/<slug>?merged-from=<candidate_id>` + banner copy "Candidate merged into existing shul. Review the data_source list to confirm."

---

## 🔍 Discovery — LOW: Reject reason "required" is client-side only

**Logged 2026-05-19.**

`app/admin/candidates/page.tsx:597-600` marks `required` on the reason input. `app/api/admin/candidate/[id]/reject/route.ts:28-29` accepts empty reason and falls back to "no reason given." A direct API caller (or a buggy form) bypasses the requirement.

**Fix shape:** API-side 400 on empty reason — match the client-side rule at the boundary.

---

## 🔍 Discovery — LOW: Approve error returns 303 + `?err=` instead of 400 + JSON

**Logged 2026-05-19.**

`app/api/admin/candidate/[id]/approve/route.ts:87-94` — when no URL is present, the function does a 303 redirect with `?err=URL+required...`. HTTP status code says success (303), so programmatic clients (tests, automation) can't detect failure via status alone.

**Fix shape:** branch on `Accept` header — HTML clients get the redirect; JSON clients get 400 + `{ error: "url-required", message: "..." }`.

---

## 🔍 Discovery — LOW: Candidate list doesn't pre-flag "matches existing shul"

**Logged 2026-05-19.**

Discovery's only dedup is `ON CONFLICT DO NOTHING` on `shul_candidate.placeId` (`run/route.ts:135`). If a shul was submitted via `/submit` BEFORE discovery ever saw it (no existing `shul_candidate` row), a later Places result creates a fresh candidate with no flag.

The approve endpoint's match_domain dedup (`approve/route.ts:126-170`) catches it — but only when admin clicks approve. Admin reviewing the pending queue sees the candidate with no warning that it duplicates an existing shul.

**Fix shape:** in the `/admin/candidates` query (`lib/queries.ts` or inline), left-join `shul.match_domain` against the registrable domain of the candidate's `websiteUri`. Render a "matches shul <slug>" badge so admin can mark-duplicate without clicking through.

---

## 🔍 Discovery — LOW: Pre-PR2 stale state — chevra-ahavas-yisroel has 7 data_sources, 1 healthy

**Logged 2026-05-19.**

One-time data artifact from before PR #2's supersede-on-insert landed. The shul (id 67, slug `chevra-ahavas-yisroel`) has 7 data_source rows; only 1 is `approved+last_run_status IN ('ok','no_change')`. Going forward this can't recur — supersede-on-insert prevents same-(shul, identifier) accumulation. Existing data needs a one-time cleanup.

**Fix shape:** extend `scripts/dedupe-cross-status.ts` (or write a sibling) to mark non-winning sources `review_status='rejected'` with `reviewer_notes='pre-PR2 cleanup'` and soft-delete their rules. Run once against prod.

---

## 🔍 Discovery — LOW: Domain backfill on dedup-merge may not re-trigger extraction

**Logged 2026-05-19.**

`app/api/admin/candidate/[id]/approve/route.ts:126-170` — when an approve-flow merges the candidate into an existing shul by domain match, it backfills `address` + `location` from the Places metadata. But it's unclear whether the existing shul's `data_source` re-extracts to pick up the now-validated name/address; if it doesn't, the shul stays with stale fields until the next weekly cron run.

**Fix shape:** verify behavior by reading the approve route + buildDataSource carefully; if no re-extraction fires, conditionally `inngest.send("data-source.requested", ...)` when `last_run_at` is older than N days.

---
