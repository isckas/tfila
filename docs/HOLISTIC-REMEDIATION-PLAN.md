# tfila.co — Unified Remediation Plan · one branch (2026-06-07)

**This is ONE plan for ONE branch.** It merges all three reviews into a single deduplicated, dependency-ordered
sequence:
- **Error / log audit** → bug IDs `C# / H# / M# / L#` (Appendix A)
- **Effectiveness / code review** → `E-*` IDs (Appendix B)
- **UI / UX review** → screen redesigns `UI-1…8` (Appendix C)

Where reviews overlapped, the item appears **once** here, tagged with every source ID (e.g. `[C3·E-E1]`). The three
appendices keep the full evidence + file:line for every tagged item. Nothing is coded yet.

## The one root cause that ties all three reviews together

A **3-axis status model** — `shul.status` × `data_source.review_status` × `data_source.last_run_status` — that *stores*
facts it should *derive*. That single choice produced: the **429-storm regression + no-recovery trapdoor** (site down
**41→9 active shuls**), the **30+ "Fix X" patches**, the email-parity bugs, **and** the admin-UI mislabeling. Layered
on top, the **geo-tz 500**, **wrong-timezone zmanim**, and **frozen "fixed" evening times** mean even the 9 shuls still
up show wrong-or-no times, while the UI buries the one action users want. So the branch is sequenced so **each phase
makes the next cheaper**, and the early phases mostly **delete code**.

## Scope: EVERYTHING ships — no waves, one branch

**All of P0–P5 below gets built. This is the full scope, not a menu and not staged releases.** The `P#` labels are
**build order, not waves** — they're sequenced only by hard dependency (you can't redesign the feed UI until the 500
that hides it is fixed; the pipeline decision gates the state-machine collapse; correct times must land before the UI
that displays them). Everything lands on **one branch** (`fix/holistic-remediation`); P0 is simply committed first so
the site recovers early *within that branch*. `typecheck` + the new smoke test gate every commit.

**The only things intentionally NOT done** (by design, not omission): the 2 **refuted** findings `R1`/`R2`, and the
items the skeptic flagged **"KEEP as-is"** (compute-on-the-fly zmanim, the PostGIS query, the freshness gate,
rate-limit fail-open, the trimmed `/api/health`, magic-link auth, server-component feed + force-dynamic — touching
those would be the *wrong* move).

> **`E-DECISION-1` — CONFIRMED (full revamp): v1 base.** Consolidate to ONE pipeline = keep v1's simpler shape, fold
> in v2's two real wins (forced tool-schema output + required `sourceQuote`), delete the rest (~1.5–2k LOC).
>
> **Execution model (user: "fastest — the site is down"):** apply directly to **prod**, no Neon-branch detour. **P0
> first** to restore the site (P0 needs *no* schema migration — config + query edits + the re-extract data op). Then
> straight through P1→P5. I pause only for a quick confirm on the few **irreversible** ops: the enum/column-dropping
> migrations in P1 and the LLM-spend re-extract. UI (P4) is **built straight from the Appendix-C wireframes** — no
> hi-fi-mockup pre-step.

---

### P0 — Stop the outage *(smallest, highest impact; mostly one-liners/deletes)*
Goal: stop the home-feed 500, stop shedding shuls, make the 429 storm unrepeatable.
1. **Located-feed 500** `[C3·E-E1]` — `next.config.ts`: `serverExternalPackages:['geo-tz']` + `outputFileTracingIncludes`, **and** try/catch around `findTz` (`app/page.tsx:247`). (Stretch per E-E1: drop geo-tz from the hot path, derive tz from the nearest shul.)
2. **Kill the no-recovery trapdoor** `[E-A1·C2·H1]` — delete `s.status='active'` from the 4 public reads (`queries.ts:25/290/319/662`); repoint the cron worklist (`weekly-rescrape.ts:40`) to `review_status='approved' AND shul.status<>'archived'`. ~6 lines; visibility becomes a pure function of freshness; demoted shuls self-heal.
3. **429-proof the pipeline** `[C1·E-D1·M2]` — global concurrency/throttle gate on LLM calls + 429/529 retry-with-backoff in the agent loop; classify transient vs terminal and **only demote on terminal** (stop pinning off fallback tiers on a transient).
4. **Safety net** `[L11]` — add eslint/biome + `lint`/`typecheck` scripts (Next 16 `build` no longer lints) + a `GET /?lat=&lng=` render smoke test. Ship before re-deploying.
5. **Data op (post-deploy):** re-extract the ~30 now-reachable stranded shuls → confirm `active` climbs back toward ~37.

### P1 — Collapse the status model *(kills the "Fix-X" disease; mostly deletes)* — gated by `E-DECISION-1`
1. **Consolidate to one pipeline** `[E-DECISION-1]` — delete `cascade-v2/extract-v2/router/agent-loop/extract-critique/build-context/extract-email-v2` + v2 flags; keep tool-schema output + required `sourceQuote`.
2. **`shul.status` → {live, archived}; derive the rest** `[E-A2]`.
3. **One `applyExtractionResult()` transition** `[E-A3·H4·M3·M6]` — replaces the 3–4 copy-pasted mark-broken/recover blocks; fixes the email one-way-door + parity + the cost-gate `first_broken_at` stamp in one place.
4. **`review_status` → {approved, rejected}** `[E-A4]`; **drop `first_broken_at`, derive from `scrape_run`** `[E-A5]`.
5. **Folds out cheaply:** v2 no-change hash `[H2·E-D3]`, confidence dead-band `[M1]`, unreject 500 guard `[H5]`, candidates `IN('ok','no_change')` reader `[M13]`.

### P2 — Make the times correct *(the product's whole value)*
1. **Real timezones** `[E-C3·M7·UI-3]` — backfill `shul.timezone` from lat/lng, make non-null, **and pass `timezone={tz}` to `ZmanimStrip` (`shul/[slug]:231`)** so screen == print == feed.
2. **Day-of-week tz-anchored** `[H3]` (`page.tsx:142`).
3. **Seasonal evening times** `[E-C1]` — stop flattening shkia-tracked mincha/maariv to fixed clocks; emit `zmanim`-anchored + guardrail-flag fixed evening times after ~17:00.
4. **Hebrew-calendar special days** `[E-C2]`; **freshness = time-validity** `[E-C4]`.

### P3 — Acquisition portfolio *(cheaper + more accurate data)*
**Reframe the "moat"** doc `[E-B3]` → **platform-aware router** using the `fingerprint()` you already discard `[E-B1]` → **deterministic ShulCloud adapter (tier 0)** `[E-B2]` → **scope the cascade to long-tail + email** `[E-B4]` → **"report wrong time" tap** `[E-B5]`.

### P4 — Redesign both UIs *(depends on P0 feed-up + P2 correct-times)*
1. **Design tokens first, app-wide** `[UI-8]` — **delete `globals.css:18` Arial** (whole app renders in Arial, not Geist); blue badges → neutral; tap-target + focus-ring floors; `amber-700→800` on the 2 wordmark dots. *Tailwind-only — no `<Card>` component layer.*
2. **End-user** — landing (Find dominant; delete "9 shuls indexed") `[UI-1]`; feed (date `onChange` not "Update"; fix next-minyan ordering; FreshnessBadge pill; empty-state CTA) `[UI-2]`; shul (Today/Tomorrow tabs; dedupe trust line; cut the map clutter) `[UI-3]`; **global wordmark-as-home shell** `[UI-4]`.
3. **Admin** — cockpit (8 tiles → filter chips that absorb `/queue`+`/rejected`; crisis health header; **bulk re-extract with confirm + the P0 rate-gate**) `[UI-5]`; reorder `deriveAdminShulState` so the queue isn't empty `[E-F1]`; approval (deep-link to the review card; source-quotes-by-default) `[UI-6]`; discovery (5 pills → 2 tabs) `[UI-7]`.
4. Built directly from the lo-fi wireframes in Appendix C — no hi-fi-mockup pre-step (user: "build it out").

### P5 — Harden, observe, delete
1. **Security** — SSRF at the fetch boundary, all channels `[H6·M10]`; CF-proxy allowlist `[M9]`; admin DAL authz `[M8]`.
2. **Observability** — dead-man's switch `[H8]`; `/api/health` probes the feed `[H9]`; digest spike-gate + NULL-`first_broken_at` backfill `[M4·M5]`; Inngest `onFailure` `[M11]`; `notifyAdmin` re-throw `[M12]`; `withSentryConfig` source-maps `[M16]`; cost-gate counts cron spend `[E-D2]`.
3. **Delete-list** — Jina tier (0% success), Docling tier, `is_manual_edit`, discovery→one-shot (fixes `[H7]`), park CF-proxy/binary, centralize the freshness `EXISTS` + dedup CTE; optional bigger ones: rules-as-projection `[E-A6]`, prompt caching / drop critique / shared Anthropic client `[E-D4·E-D5·E-D6]`.
4. **Lows** — dead `deferred` pill `[L2]`, dead `shul.status='broken'` UI `[L3]`, approve-303 `[L4]`, reject-reason `[L5]`, slug collision `[L6]`, RUNBOOK drift `[L8]`, script env vars `[L9]`, `.env.local` malformed `[M15]`, candidate enum `[M17]`, downgrade stale OPEN-ISSUES entry `[L10]`, archive doc sprawl.

---

## Unified verification (per phase, end-to-end)
- **P0:** `vercel build` ships geo-tz `.geo.dat`; `/?lat=31.78&lng=35.21` → 200; Sentry ENOENT count = 0; after the re-extract op `mcp__pg-neon__query` shows `active`≈37 with `scrape_run` ok/no_change (no 429-broken); throttle holds under a forced fan-out on a preview deploy.
- **P1:** read-only SQL invariants — no `broken` row with NULL `first_broken_at`; no non-rejected duplicate `(shul_id,identifier)`; no active/unsupported-with-fresh-rules contradiction; the 3 mark-broken sites are now one helper (grep).
- **P2:** a Jerusalem/Chicago test shul renders correct clocks + zmanim on screen == print == feed; a shkia-tracked mincha is a `zmanim` rule correct in both Jan and Jul; a fast-day rule only fires on its real Hebcal date.
- **P3:** a ShulCloud shul extracts via the adapter at ~$0 with correct rules; the cascade only runs for custom/long-tail.
- **P4:** every screen intentional at 360/768/1280px; primary action obvious in ~2s; no new color/font/icon families; admin queue shows the reviewable shuls; bulk re-extract is rate-gated.
- **P5:** force `total=0` + a feed 500 in preview → an alert actually fires; an SSRF redirect-to-private-IP is blocked at the fetch boundary.

---
---

# APPENDIX A — Error / log audit (bug findings: `C/H/M/L`)

## Context

The user asked: *"review all logs and code and look for improvements when you see things that are
failing or do not make sense. **List out the issues before doing any solving.**"*

This file is the **issue inventory only** — no fixes have been made. It is the durable batch register
per the locked batch-then-code workflow ([[feedback-batch-then-code]]): diagnosed issues accumulate here;
code is written only once the user picks scope.

**Method.** Pulled real production signals first (Sentry events API, live Neon DB via `mcp__pg-neon__query`,
`docs/OPEN-ISSUES.md`), then ran a 7-dimension read-only audit workflow (26 agents) over the codebase with
an **adversarial verify pass** on every high/critical claim. 44 raw findings → de-duplicated below to ~30
distinct issues. 17 high/critical claims confirmed, **2 refuted** (kept at the bottom so they aren't chased).

### Headline (corrected by adversarial verification)

The site is **down from ~41 active shuls to 9**. The cause is NOT what the docs imply (a clean v2 canary success).
The 2026-05-24 cron — the first weekly run after `EXTRACTION_PIPELINE_V2=true` went global — **broke 28 of ~41
active shuls in one night and demoted them to `pending_review`, where nothing ever rescrapes them again.**

Root cause, proven from `data_source.config_json->last_rejected_extraction->cascade_attempts`:
the unthrottled concurrent cron fan-out hammered the **Anthropic API into 429 `rate_limit_error`** (literal
error string on ids 2,4,7,12,20,29,37,110…; 23 of 75 error-bearing attempts are rate-limit/overload).
Because the weekly rescrape pins `preferredStrategy:"html"` — which gates OFF the JS/vision/PDF fallback tiers
in `cascade-v2.ts` — a transient 429 became a permanent `"cascade exhausted all tiers"` → demotion. And the
demotion is a one-way trapdoor: the cron only fans out `active + approved`, so the 28 never came back.
19–23 of them had successful runs *before* 05-24 (working under v1, regressed by v2). Their rules still sit in
the DB (anash-ca: 30, ohab-zedek: 29, agudah: 24…) but are hidden because the shul is no longer `active`.

This went unnoticed for 2 weeks because every safety net had a blind spot (see C/H findings on monitoring).

---

## DB snapshot (live, read-only, 2026-06-07)

| shul.status | count | notes |
|---|---|---|
| active | **9** | the entire public site |
| pending_review | 31 | all 31 still hold live rules; 0 have an approved source — stranded |
| archived | 27 | |
| unsupported | 7 | |

`scrape_run` volume collapsed: 41 runs on 05-24 (5 ok / 8 no_change / **28 broken**) → 13 on 05-31 → 11 on 06-07.

---

## CRITICAL — live production impact (confirmed)

**C1. The 05-24 mass-regression mechanism: 429 storm + tier-pinning + no transient/terminal distinction.**
Concurrent weekly fan-out (`weekly-rescrape.ts`) drives Anthropic into 429s; `extract-v2.ts` agent loop has no
429/529 backoff and throws; `scrape-one-shul.ts:210` calls `runCascade(url,{preferredStrategy:"html"})`, and
`cascade-v2.ts` (~lines 254/315/386) gates the JS/vision/PDF tiers behind `preferredStrategy`, so there is no
surviving fallback → `scrape-one-shul.ts:231-240` maps `strategy==='failed'` straight to a permanent broken
demotion. *Files:* `lib/llm/extract-v2.ts`, `lib/llm/cascade-v2.ts`, `lib/inngest/functions/weekly-rescrape.ts`,
`lib/inngest/functions/scrape-one-shul.ts`. *Direction:* throttle fan-out concurrency; retry 429/529 with backoff
in the agent loop; on weekly rescrape, allow tier fallback (or retry transient before demoting); distinguish
transient (network/timeout/429/529) from terminal (page truly has no schedule) and only demote on terminal.

**C2. No automatic recovery — 30–31 shuls stranded in `pending_review`, hidden despite live rules.**
`weekly-rescrape.ts:40-45` fans out only `status='active' AND review_status='approved'`. The three mark-broken
blocks (`scrape-one-shul.ts:267-313`, `487-518`, `559-585`) flip the source `approved→pending` and demote the
shul `active→pending_review` — out of the fan-out set forever. The only manual reset
(`app/api/admin/shul/[id]/reset-status/route.ts:36`) accepts `unsupported` only, not `pending_review`. Recovery
today = a per-shul, two-step manual admin action (Extract Now → approve), with no bulk tool. *Direction:* add a
recovery fan-out lane (pending_review shuls with live rules / recently-broken sources, bounded retries via
`first_broken_at`); extend `reset-status` to `pending_review`; add a "demoted-but-recoverable" admin list + bulk
re-extract.

**C3. geo-tz crashes the home feed (500) — top Sentry error; fix diagnosed 2026-06-03, never applied.**
`app/page.tsx:247` `findTz(lat,lng)[0] ?? "America/New_York"` runs in the Server Component render with no
try/catch (`??` only handles an empty array, not the thrown `ENOENT`). `next.config.ts` is still the empty stub,
so Next file-tracing never ships geo-tz's lazily-`openSync`'d `.geo.dat` blobs into the Vercel function → ENOENT
→ 500 on every located ("use my location" / address) request. Confirmed live: Sentry event
`e685e66e093a4d7091c2bd22cbbb7799`, culprit `GET /`, `c.find`→`openSync`→ENOENT; 12 of 14 recent events match.
*Direction:* `serverExternalPackages:['geo-tz']` + `outputFileTracingIncludes:{ '/':['node_modules/geo-tz/data/**'] }`
in `next.config.ts`, **and** wrap `findTz` in try/catch → ET fallback.

---

## HIGH — confirmed

**H1. "Daveners see the previous schedule" is a lie — demotion hard-hides the shul.** The
`scrape-one-shul.ts:243-244` comment promises graceful degradation, but the same transaction demotes the shul,
and every public read gates on `status='active'`/`review_status='approved'` (`queries.ts:24/289/317/662`,
`freshness.ts:61`; detail page renders `<StaleShulPage>`). Rules persist but vanish from every surface. Compounds C1/C2.

**H2. v2 no-change hash short-circuit can never fire → every v2 cron pays full LLM re-extraction.** Stored hash =
`sha256(Jina markdown)` (`extract-v2.ts:225`), but `scrape-one-shul.ts:138-149` compares
`hashSanitizedHtml(raw HTML)` — different input, never equal. `hashV2Markdown` (`extract-v2.ts:258`), written
exactly for this, is **dead code** (never imported). Same class of bug as the documented v1 hash regression.
*Direction:* compute the comparison hash via the same markdown pipeline when v2 is active (wire up `hashV2Markdown`).

**H3. Home feed computes day-of-week in server (UTC) timezone → wrong day's minyanim every ET evening.**
`app/page.tsx:142` `referenceDate.getDay()` on a UTC server; the dow filter at `174-180` then drops Friday-night
minyanim and surfaces Saturday a day early after ~7–8pm ET. The shul detail page does it correctly
(`app/shul/[slug]/page.tsx:80`, tz-anchored). All 9 active shuls are Eastern → fires weekly for every located user.
*Direction:* derive dow from a tz-anchored ISO (`new Date(isoDateInTz(now,userTz)+'T12:00:00Z').getUTCDay()`);
note `userTz` is currently computed *after* line 142 and must move up.

**H4. Email recovery is a one-way door.** The email success path (`process-email.ts:410-428`) sets
`lastRunStatus:'ok'` but never restores `review_status:'approved'`, never clears `first_broken_at`, never
re-activates the shul — unlike the URL recovery (`scrape-one-shul.ts:369-403/628-660`). So a single bad-week
email flips an email source to `pending` and no later good email can un-hide it. Silent shul-bleed with no
demotion event to surface it. *Direction:* mirror the URL recovery (restore approved + clear first_broken_at +
re-activate shul). Parity with [[feature-address-backfill-parity]].

**H5. Unreject route → unhandled 500 on 27 prod rows.** `data-source/[id]/unreject/route.ts:27-34` does a blind
`UPDATE … SET review_status='pending'` with no sibling check and no try/catch. The partial UNIQUE INDEX
(`migration 0012`, `WHERE review_status<>'rejected'`) then collides with the live same-`(shul_id,identifier)`
winner. 27 currently-rejected rows (the superseded dedupe losers, e.g. ds#51 vs live ds#101) each 500 on the
"Move back to pending" button. *Direction:* check for a live sibling first → 409 + friendly banner, or
try/catch the unique violation.

**H6. SSRF: the guard runs once at `/submit`; the actual fetch path is unprotected.** `assertPublicHttpUrl`
(`lib/ssrf.ts`) is called only in `app/api/submit/route.ts`. `fetchHtml`/`fetchBinary` use `redirect:'follow'`
with no per-hop IP check, and the async cascade (`buildDataSource → runCascade → fetchHtml`) re-validates
nothing — so redirect-to-private-IP and DNS-rebind reach `169.254.169.254`/`10.0.0.0/8`/`127.0.0.1` from an
**unauthenticated** form. *Direction:* enforce SSRF validation at the fetch boundary for every channel; use
`redirect:'manual'` + re-validate each hop, or a connect-time private-IP reject.

**H7. `discovery /run target=all` → guaranteed timeout + ~$6 uncapped + orphaned audit rows.**
`app/api/admin/discovery/run/route.ts:187-205` iterates **186 sequential Places calls** (101 targets); at ~1s
each it blows past `maxDuration=120` and is killed mid-loop, leaving `discovery_run` rows with `finished_at NULL`
and no cost ceiling. Admin-gated and the UI never emits `all`, so it's a latent footgun, not yet fired.
*Direction:* remove the `all` branch or chunk it (Inngest fan-out + per-run query/cost cap).

**H8. No dead-man's switch — a dead cron is silent.** `weekly-rescrape-summary.ts:55-57` suppresses the email
when `total===0` — which is exactly the dead-cron / paused-deploy / `SCRAPE_ENABLED=false` case. The only
heartbeat (`hello.ts`) is event-triggered, not a cron. *Direction:* send the digest unconditionally with a loud
"CRON DID NOT RUN" subject, or add an external absence-alarm (UptimeRobot/cronitor expected-ping).

**H9. `/api/health` is blind to the home-feed 500.** `app/api/health/route.ts` only runs `select 1`; it never
exercises the feed, so UptimeRobot + RUNBOOK report green while C3 is 500ing for every located user. This is why
the geo-tz outage went unescalated for weeks. *Direction:* synthetic check that renders `GET /?lat=&lng=` and
asserts 200; point UptimeRobot at the feed too.

---

## MEDIUM — confirmed

- **M1. Confidence dead-band.** Cascade `MIN_USEFUL_CONFIDENCE=0.4` (`cascade-v2.ts:31/40`) accepts a tier, but
  guardrail `MIN_AUTO_APPLY_CONFIDENCE=0.6` (`guardrails.ts:14`) then flags 0.4–0.59 as broken; a 0.3–0.39 correct
  HTML extraction is discarded and the cascade exhausts. *Dir:* align the floors / fall back to best non-empty extraction.
- **M2. Transient errors become permanent broken.** `cascade-v2.ts:235-243` collapses Jina/fetch/LLM throws into a
  single `failed` attempt → permanent demotion (no retry class). Overlaps C1. *Dir:* record httpStatus/error class; retry transient.
- **M3. Email broken path parity gap.** `process-email.ts:345-369` flips `broken`+`pending` but omits the
  `first_broken_at` stamp and the `active→pending_review` demote that all URL sites do. Latent (only 1 email source
  exists; never fired). *Dir:* extract a shared mark-broken helper so all 4 sites stay in lockstep.
- **M4. Digest has no spike gate.** `weekly-rescrape-summary.ts:219` renders "28 NEW broken" with the same subject
  grammar and flat bullet list as "1 broken" — a fleet collapse reads as routine. *Dir:* threshold/baseline-gated `[ALERT] MASS BREAKAGE` prefix + active-shul delta.
- **M5. 12 oldest-broken sources invisible to the digest.** Its broken list filters `first_broken_at IS NOT NULL`
  (`summary.ts:131`); migration 0011 added the column with no backfill, and demoted sources never transition again
  to get it stamped. *Dir:* `COALESCE(first_broken_at,last_run_at)` / one-time backfill.
- **M6. cost-gate error omits `first_broken_at`.** `scrape-one-shul.ts:195-198` writes `last_run_status='error'`
  without the COALESCE stamp every other transition uses (invariant gap; latent). *Dir:* add the stamp, or don't treat a transient cost-gate as a broken streak.
- **M7. 8 of 9 active shuls have `timezone IS NULL`.** Accidentally correct today (all ET via `?? 'America/New_York'`
  in `resolve.ts`/`strip.ts`/shul + print pages); `buildDataSource` never backfills `shul.timezone` from lat/lng.
  First non-ET shul renders every clock/zman 1–8h off, silently. *Dir:* backfill tz from geo-tz at build time + one-time for the 8 rows.
- **M8. Admin authz lives only in `layout.tsx`.** Next 16 docs warn a layout gate isn't an authorization boundary
  (partial rendering); the 10 admin page components + data layer don't re-check. Mutation API routes ARE gated (good). *Dir:* a cached `verifySession()` DAL called per page + in data fns.
- **M9. Cloudflare fetch-proxy is an open fetcher.** `cloudflare-worker/src/index.ts:40` `HOST_ALLOWLIST=[]`
  (proxy any host) + `redirect:'follow'`, gated only by a bearer token → SSRF amplifier. *Dir:* populate allowlist; reject private IPs; manual redirects.
- **M10. Admin extract/rebuild + email cascade fetch with no SSRF check** on stored/admin-edited URLs
  (`extract/route.ts`, `rebuild/route.ts`, `build-data-source.ts:55`; edit route only checks protocol). *Dir:* validate at `runCascade`/`fetchHtml` entry (same fix as H6).
- **M11. No Inngest `onFailure` anywhere** — a retry-exhausted function dies silently in the dashboard, no
  email/Sentry. *Dir:* add a shared `onFailure` → `notifyAdmin` + `Sentry.captureException` on the crons + process-email.
- **M12. `notifyAdmin` swallows all send errors** (`email.ts:72-80`, console.error only); unset `RESEND_API_KEY`/`ADMIN_EMAIL`
  silently drops the only alert. *Dir:* re-throw in the digest step so Inngest retries; Sentry on send-failure; warn loudly if key/ADMIN_EMAIL unset in prod.
- **M13. PR #4 missed one reader.** `app/admin/candidates/page.tsx:140-160` still uses strict
  `last_run_status='ok'` (not `IN ('ok','no_change')`) → healthy `no_change` shuls false-flagged as "extraction landed broken." Dormant (no recent approvals). *Dir:* broaden to `IN ('ok','no_change')`.
- **M14. Stranded shul mislabeled "Review N new extractions"** (`admin-state.ts`) when the only pending source is the
  *failed* extraction — sends admin to "approve" when the real action is "re-extract." *Dir:* distinguish pending-because-fresh from pending-because-broken via `last_run_status`.
- **M15. `.env.local` malformed:** `INNGEST_API_KEY` declared twice (lines 11 & 35) + a stray bare-string line 48
  (the Sentry secret with no `KEY=`). Vercel-CLI dump artifacts. *Dir:* dedupe / re-pull cleanly.
- **M16. Sentry has no `withSentryConfig`** in `next.config.ts` → no build-time source-map upload / release tagging →
  minified stack traces (the thing telemetry-first debugging needs). *Dir:* wrap the config (composes with the C3 fix in the same file).
- **M17. `shul_candidate.review_status` is unconstrained `text`** (vs the `data_source` pgEnum) — no DB guard against drift. *Dir:* promote to pgEnum / CHECK.

---

## LOW — cleanup (confirmed)

- **L1.** Router classifier: after `shouldRerenderJs` was neutered, its only effect is the harmful hard-skip
  (`cascade-v2.ts:179-188`) + a per-run Haiku cost; the specialized `yom_tov` prompt it enabled is never branched.
  *Dir:* make `shouldSkipExtraction` advisory (always attempt HTML), or drop the classifier.
- **L2.** Dead `deferred` candidate-status pill — perma-empty (`candidates/page.tsx:28/35`).
- **L3.** Dead `shul_status='broken'` filter + badge — no code writes it (`shuls/page.tsx:32`, `shul/[slug]/page.tsx:693`). Keep the enum value for legacy rows; drop the UI.
- **L4.** `candidate/[id]/approve` returns 303 (success) on not-found / url-required / already-reviewed — status-code lie.
- **L5.** Reject reason "required" is client-only; API substitutes "no reason given" (`reject/route.ts:27-29`).
- **L6.** `slug.ts:42-52` returns `base-99` without a final collision check; `split/route.ts` has a TOCTOU window → possible UNIQUE 500.
- **L7.** 27 live `minyan_rule` rows attached to `rejected` sources (reject route doesn't soft-delete rules) — contradictory pair, not yet a public leak.
- **L8.** `RUNBOOK.md` drift: documents `/api/health` returning `{ok,db:{latencyMs}}` (route returns `{ok}`); references nonexistent `MAINTENANCE_MODE`.
- **L9.** One-off scripts reference undocumented env vars (`PROD_DATABASE_URL`, `GOOGLE_PLACES_API_KEY`).
- **L10.** `docs/OPEN-ISSUES.md` "Discovery HIGH: INSERT failures silently lose candidates" is **STALE** — the
  serialization root cause was already fixed by the Drizzle-builder switch; candidates were recovered (runs 10–12).
  Only 6 inert error audit rows remain. *Dir:* downgrade the doc entry to cleanup; close/backfill rows 4-9.
- **L11 (process gap).** No tests/lint safety net: `package.json` has no `lint`/`test`, no eslint/biome/vitest, and
  Next 16's `next build` no longer lints — the only check is a partial `tsc`. This is the class of gap that let both
  C3 and the C1 regression ship unnoticed. *Dir:* add eslint/biome + a smoke test that renders `GET /` with a sample lat/lng.

---

## REFUTED — do NOT chase (adversarial verify overturned these)

- **R1.** "v2 dropped v1's same-origin URL fallback, and THAT caused the 05-24 regression." — **Refuted as the cause.**
  The cohort failed on Anthropic **429s**, before any rule-quality eval (the fallback only fires on a *successful-but-weak*
  result). v1 extracted these ShulCloud `/calendar` pages directly from the same URL — there was no "static page v1
  hopped to." The capability gap (`cascade-v2.ts` never calls `extractFromUrlWithFallback`) is a *real but latent*
  issue for a different class (true JS-widget landing pages whose schedule lives at `/services` etc.) — **low priority**, not the regression.
- **R2.** "Router misclassification caused the mass regression." — **Refuted.** Only ~8% of broken attempts were
  genuine router skips; the cited evidence (ds 22/6) was actually confidence-gate failures dated *before* v2 went global.
  The mechanism (hard-skip on the html-pinned cron path) is real → tracked as L1 / M-band, not a critical cause.

---

## Verification approach (per fix, end-to-end)

- **geo-tz (C3):** `vercel build` locally; confirm `.geo.dat` traced; hit `/?lat=31.78&lng=35.21` (Jerusalem,
  polygon-precision case) → 200, ET-or-correct tz; watch Sentry for new ENOENT events = 0.
- **429/recovery (C1/C2):** in a preview deploy, trigger a recovery fan-out over the 30 stranded shuls; confirm via
  `mcp__pg-neon__query` that `active` climbs back toward ~37 and `scrape_run` shows ok/no_change, not 429-broken.
- **State/data fixes:** assert invariants with read-only SQL (no `last_run_status='broken'` with `first_broken_at IS NULL`;
  no non-rejected duplicate `(shul_id,identifier)`; no `pending_review` shul with a fresh approved source).
- **Monitoring (H8/H9):** force `total=0` and a feed 500 in preview; confirm an alert actually fires.
- Add the smoke test (L11) so the home-feed render path is covered before any of this re-ships.

---
---

# APPENDIX B — EFFECTIVENESS REVIEW (architecture + line-level, all 4 lenses) · evidence for THE PLAN

**Method.** Per the user's call: full effectiveness review (Architecture / Simplicity / Accuracy / Cost), every
design decision on the table, exhaustive line-level + strategic. Ran an 11-reviewer workflow (40 agents) with a
**constraint-grounded skeptic pass** that judged each high-impact rec against the reality of a *solo dev, build
phase, free-tier-only, ~9 active / 74 total shuls*. **66 recommendations (29 high / 27 med / 10 low). Of 29
high-impact recs skeptic-checked: 20 kept, 9 softened, 0 dropped** — not one was refuted as over-engineering.
All headline claims below were re-verified by me against the live DB. Still no code — this is the batch.

### Area verdicts (the diagnosis)

| Area | Verdict |
|---|---|
| Extraction pipeline | **wrong-approach** — dual v1+v2 cascade over-built for the scale and aimed at the wrong layer; accuracy is lost at FETCH (ShulCloud/JS widgets), not extraction |
| Inngest orchestration | **needs-rework** — no single owner of the "reconcile a run outcome" transition → the 30+ "Fix X" patches |
| Data model + queries | **needs-rework** — `shul.status` duplicates a freshness truth already derived from `data_source`; special-day kind stored but never checked against the Hebrew calendar |
| Public surface | **needs-rework** — UX is sound; plumbing (70MB geo-tz in hot path, inline geocode, no streaming/error boundaries, tz-correct-by-luck) is not |
| Admin surface | **needs-rework** — well-built, but a state-ordering bug mislabels all 31 reviewable shuls and the review queue shows zero of them; no bulk recovery |
| Ingestion / fetch / discovery | **needs-rework** — URL submit is the workhorse; discovery + email + CF-proxy/binary tiers are low/zero-yield and feed the duplicate-persist sprawl |
| Cross-cutting infra | **needs-rework** — mostly right-sized; the cost lever is wrong (daily-$ cap vs the per-minute 429 that actually hurt) |
| **Macro approach** | **needs-rework** — LLM cascade is the right *long-tail* engine, mis-deployed as a mono-strategy on a platform-concentrated pool |
| **Data-model redesign** | **needs-rework** — 3 overlapping status fields + stored visibility + rules-live-forever create the contradictions; verified live |
| **Accuracy e2e** | **needs-rework** — model is the right *shape* but expressiveness + tz gaps make active shuls show WRONG times TODAY; "fresh" ≠ "still correct" |
| **Simplicity debt** | **needs-rework** — core is right-sized; the extraction + state-machine layer is materially over-built for the scale |

---

## ★ The one strategic decision that unblocks everything: collapse to ONE pipeline

Two reviewers reached opposite framings — "retire v2, keep v1's shape" (**kept/high**) vs "delete the now-dormant
v1" (**softened/med**) — but they **agree on the conclusion: one pipeline, ~1.5–2k LOC deleted.** They differ only
on which base to keep, and the evidence favors v1's simpler shape:
- v2 is the global default, yet of 28 v2-shaped extractions **17 went broken, only 5 approved**; the HTML tier
  (56 of 62 sources) **averages 0.527 confidence — below its own 0.6 auto-apply floor**.
- v1's canary baseline was already good (BAYT 48 rules @0.92). v2's extra machinery (router, agent-loop, 5 tools,
  critique, Jina, Docling) added cost + the 429-amplification + the parity-bug surface with **no measured accuracy gain**.
- **v2's only two genuine wins:** Anthropic tool-schema output (kills the JSON-parse/brace-scan path) and the
  required `sourceQuote` per rule (admin verifies without opening the URL). Fold those two into v1; delete the rest.

**E-DECISION-1 — Consolidate the extraction pipeline onto one shape (v1 + v2's 2 wins).** *[high / M]* Decide the
direction, then delete `cascade-v2.ts`/`extract-v2.ts`/`router.ts`/`agent-loop.ts`/`extract-critique.ts`/
`build-context.ts`/`extract-email-v2.ts` + the `EXTRACTION_PIPELINE_V2`/`_V2_SHUL_IDS` flags + `shouldUseV2`. This is
a prerequisite that makes most recs below cheap. *(This is a genuine fork — flagged for the user, not auto-decided.)*

---

## Theme A — The state machine is the root disease (data-model collapse). Highest leverage; mostly deletes code.

The 30+ "Fix X" patches are a symptom: **three overlapping status fields** (`shul.status` × `data_source.review_status`
× `last_run_status`) encode facts that are already derivable, kept in sync by 3 copy-pasted demotion transactions.

- **E-A1. Make public visibility a pure function of "has a fresh good extraction"; repoint the cron off `shul.status`.**
  *[high / S — kept]* Delete the `s.status='active'` clause from all 4 public reads (`queries.ts:25/290/319/662`) —
  the `EXISTS(fresh approved ok source)` predicate is already the real gate. Change the cron worklist
  (`weekly-rescrape.ts:40`) to `review_status='approved' AND shul.status <> 'archived'`. **~6 lines deleted, no
  migration, and it eliminates the no-recovery trapdoor that caused the 41→9 regression** (a 429 storm becomes a
  1-week stale window, not permanent removal). Auto-fixes the live contradiction (id=59 `unsupported` with 20 fresh rules).
- **E-A2. Collapse `shul.status` to admin intent only `{live, archived}`; derive the rest.** *[high / M — kept]*
  `active`/`pending_review`/`unsupported` are all recomputable (and `deriveAdminShulState()` already re-derives them).
  Delete every `SET status=...` write in the scrape worker / build-data-source / approve route. **Deletes ~60 lines +
  3 near-duplicate transactions; makes the contradictory-state bug class structurally impossible.**
- **E-A3. Extract one `applyExtractionResult()` / `writeRunOutcome()` transition.** *[high / S–L — kept]* The
  mark-broken / recover-restore / demote logic is hand-written 3–4× (`scrape-one-shul.ts:267/487/559`, `process-email.ts`)
  and the copies have already drifted (the email parity bugs H4/M3). One helper = all channels in lockstep.
- **E-A4. Reduce `review_status` to `{approved, rejected}` (sticky human verdict); derive "needs review."** *[med / M]*
  Stop flipping `approved→pending` on a transient bad run — that throws away the admin's standing approval and forces
  the restore dance.
- **E-A5. Drop `first_broken_at`; derive "broken since" from `scrape_run`.** *[low / M — verified]* It's a
  hand-maintained aggregate that's **wrong 94% of the time** (44/47 broken rows NULL), so the badge it powers is blank.
- **E-A6. (Bigger) Make `minyan_rule` a recompute-at-write projection; hard-delete losers.** *[med / L]* **61% of rows
  are dead tombstones** (1263/1754) that no query reads; the two hot feeds each carry an identical ~40-line ROW_NUMBER
  dedup CTE run on every request. Do this *after* A1/A2 prove out.

## Theme B — Acquisition portfolio: stop using the LLM as a mono-strategy

- **E-B1. Add a platform-aware acquisition router (the fingerprint signal already exists, thrown away).** *[high→med /
  M — softened]* `fingerprint()` already classifies shulcloud/chabad/wix deterministically but is only called by a
  one-off script; the live pipeline ignores it (and ignores the `kind='shulcloud_website'` it already stores). Branch
  at the top of acquisition on platform.
- **E-B2. Build a deterministic ShulCloud (then Chabad) adapter as tier 0; reserve the LLM for the long tail.** *[high→med
  / M — softened]* ShulCloud is the single largest host (~35–45% once vanity domains are counted) and exposes a
  structured minyan-times widget / feed (the *same* rule model as `minyan_rule`). A ~100-line deterministic parser is
  more accurate AND ~free vs a Sonnet call, and immune to the JS-render/429/banner-image failures. Caveat: target the
  structured widget, fall back to the cascade for free-form pages.
- **E-B3. Reframe the documented "moat."** *[med / S — doc only]* The moat is **the rule model + zmanim/special-day
  resolver + curated directory**, NOT the few-shot prompt (the most commoditizable, most failure-prone part). The
  "moat" label is currently used in 5 docs to reflexively veto deterministic strategies — that's the conceptual root of
  the mono-cascade design.
- **E-B4. Scope the cascade explicitly to custom/long-tail + email.** *[med / S — deletes code]* Once adapters take the
  templated majority, the cascade's input narrows and several platform-specific Fix patches (the `calendar_widget`
  special-casing, the JS-render 429 exposure) simply stop occurring.
- **E-B5. Bring "report wrong time" forward as a near-term tier; keep the gabbai portal deferred.** *[med / S]* The
  cheapest accuracy signal + cheapest targeted re-extract trigger. One row + the admin queue you already have. (Not the
  gabbai portal — no auth, no sales motion.)

## Theme C — Accuracy leaks that show WRONG TIMES today (the product's whole value)

- **E-C1. Stop flattening seasonal mincha/maariv into fixed clocks — extract them as `zmanim` anchored.** *[high / M —
  kept]* **Verified: 455 of 491 live rules are `fixed`; only 36 are `zmanim`.** `prompts.ts` Example 5 explicitly
  flattens "winter Maariv = Mincha+10" into a fixed clock. BAYT stores Sun/Tue/Thu Mincha as both `19:10` AND `20:45`
  (source "8:45pm" — a *summer* shkia time). By winter that minyan is ~4:30pm. **The time is wrong for most of the
  year while the freshness pill stays green** — the homepage literally promises "times that don't go stale." Invert the
  prompt default for evening tefillos (infer offset-from-shkia via `getSunsetRange`); add a guardrail flag for any
  fixed mincha/maariv after ~17:00.
- **E-C2. Gate `special_schedule_kind` rules against the actual Hebrew calendar (Hebcal) at render time.** *[high / M —
  kept]* Special-day kind is stored semantically but resolved as dumb date-brackets (`valid_from/to`) — nothing checks
  "is today actually Rosh Chodesh / a fast / yom tov." So special schedules fire on the wrong dates or never.
- **E-C3. Backfill `shul.timezone` from lat/lng; make it non-null.** *[high / S — kept]* **8 of 9 active shuls have
  `timezone IS NULL`** (45 of all rows); clocks/zmanim are correct *only by Eastern-coast luck* via the
  `?? 'America/New_York'` defaults. First non-ET shul renders every time 1–8h wrong, silently.
- **E-C4. Redefine "fresh" around time-validity, not source-recheck recency.** *[med / M]* Today "fresh" = "we
  re-checked the source," which (per C1) is not "the time is still correct."
- *(Plus the bug-audit's C3 geo-tz 500 and H3 server-UTC day-of-week — same accuracy-of-times theme.)*

## Theme D — Cost / concurrency (the regression was requests/minute, not dollars/day)

- **E-D1. Add a global concurrency/throttle gate on LLM calls.** *[high / S — kept]* The weekly cron's per-`shulId`
  Inngest key throttles nothing across shuls; the daily-$ cost-gate is the wrong lever for a per-minute 429 storm. A
  global token-bucket / concurrency cap is the actual fix for the regression's root cause (overlaps bug-audit C1).
- **E-D2. The daily-budget cost-gate is structurally blind to weekly-cron spend.** *[high / M — verified]* It sums only
  `data_source` rows *created today*; re-scrapes UPDATE existing rows, so the single largest spend event isn't counted.
- **E-D3. Decouple the no-change hash from the input source** (bug-audit H2 — every v2 cron pays full re-extraction). *[high / S]*
- **E-D4. Restore real prompt caching (v2 throws it away).** *[med / S]*  **E-D5. Drop the critique pass + 5 agent-loop
  tools — high cost, no measured accuracy gain.** *[med / M]*  **E-D6. One shared Anthropic client with tuned
  retry/timeout** (9 bare `new Anthropic()` today). *[med / S]*

## Theme E — Public-surface plumbing

- **E-E1. Delete geo-tz from the feed hot path** (70MB in the render path; also the 500) — derive user tz from the
  nearest shul or a ~1KB offset table. *[high / S — kept]*  **E-E2. Move `reverseGeocode` off the blocking render path**
  (stream it / drop to a coords label). *[med / S]*  **E-E3. Add `loading.tsx` + `error.tsx` for the feed/shul routes**
  (the dynamic geo feed has no shell, no error boundary). *[med / S]*  **E-E4. Extract one `resolveDaySchedule()` helper**
  (3 drifting copies of the rule→time loop). *[med / M]*  **Keep:** server-component feed compute + force-dynamic; do
  NOT add Cache Components to a per-geo feed. *[verified right]*

## Theme F — Admin effectiveness (solo admin whose whole job is approve-fresh-data)

- **E-F1. Reorder `deriveAdminShulState` so `pending_review` beats `broken`.** *[high / S — kept]* Verified: the current
  ordering mislabels all 31 reviewable shuls as "broken/investigate" and the review queue shows **zero** of them.
- **E-F2. Add a bulk-approve action + a one-screen "storm/recovery" triage list.** *[high / M — kept]* Recovering the 30
  stranded shuls is currently dozens of two-step manual actions.
- **E-F3. Wire the existing `reset-status` recovery into the shul-page UI.** *[med / S]*

## Theme G — Delete-list (simplicity wins, mostly $0 risk)

- Delete the **Jina Reader tier — 0% success rate in production**. *[high / S — kept]*  · Delete the **Docling/PDF tier**
  (0 PDF sources ever). *[low / S]*  · Delete the **`is_manual_edit` machinery** (0 rows use it). *[med / S]*  ·
  **Demote Places discovery to a one-shot seeding script** (ran once, 67% query errors, 6% candidate→active). *[high / S
  — kept]*  · **Collapse the 3 channel-specific persist paths into one shared post-ingestion pipeline** (parity). *[high→med
  / M]*  · **Centralize the freshness EXISTS clause (5 verbatim copies) + dedup CTE (2 copies)** into SQL fragment
  helpers. *[med / S]*  · Park CF-proxy/binary-fetch behind a flag (unused). *[med / S]*  · Archive the planning `.md`
  sprawl into `docs/archive/`. *[low / S]*

## Right-sized — KEEP as-is (don't spend effort here)

Compute-on-the-fly zmanim · the PostGIS nearby query · query-time freshness gate · rate-limit fail-open · the trimmed
`/api/health` · email console-fallback · drizzle/pg config · HMAC single-use magic-link auth · server-component feed +
force-dynamic. The reviewers explicitly flagged these as already the most effective shape for the goal + scale.

---

---
---

# APPENDIX C — UI / UX REVIEW (both surfaces, all 4 lenses, lo-fi redesigns) · evidence for THE PLAN

**Method.** 8-screen-group review (4 end-user + 3 admin + 1 design-system), each judged on UX-flows / visual /
usability / mobile-a11y **against STYLE.md** (minimal-clicks, neutral + one amber-800 accent, emoji-as-glyph,
mobile-first, Tailwind-only), each producing a **360px ASCII redesign**, then a **skeptic pass** that checked every
redesign stays STYLE.md-true and actually removes clicks. **53 problems (17 high / 25 med / 11 low).** The skeptic was
valuable — it **softened 6 of 7** redesigns (caught real over-reaches) and flagged the design-system one as
*not* STYLE.md-true. Below: per screen, the **wireframe**, the **strongest change to ship**, and **what over-reaches
(skip)**. These are lo-fi; **hi-fi rendered mockups (HTML/screenshots via the design skills) are the next step and
need stepping out of plan mode to write files.**

> Honest framing the skeptic insisted on: most of these improve **hierarchy/clarity**, not raw click-count. The
> genuine *click-removers* are tagged ✓CLICK. Don't oversell the rest as click wins.

---

## END-USER

### 1. Landing (`app/page.tsx:64-132`, FindCard/LookupCard/AddCard)
**Problem (high):** Find / Look-up / Add are three **co-equal** cards (`grid md:grid-cols-3`), so the ~95% action
(Find) competes with the rarest (Add); and **"9 shuls indexed" advertises an empty directory** on first impression.

```
+----------------------------------------+
| [pin]  Tfila times that don't go stale |
|        Fresh from each shul's own site,|
|        every Motzei Shabbat.           |
+----------------------------------------+
| (amber) Saved location? Resume ->  Clr |   <- ResumeBanner (only if saved)
+----------------------------------------+
|  📍 Find a minyan near you              |
|  Times happening around you right now.  |
|  +----------------------------------+   |
|  |        Use my location           |   |   <- full-width primary CTA
|  +----------------------------------+   |
|  no GPS? enter an address ___________   |   <- quiet single fallback line
|                              [ Go ]     |
+----------------------------------------+
|  🔍 Know the shul's name?               |   <- lighter card, KEEP heading
|  [ e.g. Agudah, Young Israel... ]       |   <- live type-to-match, on-page
+----------------------------------------+
|  ↻ Refreshed every Motzei Shabbat       |   <- quiet meta line (NOT a chip)
+----------------------------------------+
|  Run a shul? Add it ->                  |   <- quiet link; expands form in place
+----------------------------------------+
|                         About  ·  Help  |
+----------------------------------------+
```
**Ship:** demote FindCard's address input to a quiet fallback line **under** the dominant "Use my location" (delete
the co-equal "or enter an address" divider, `FindCard.tsx:87-91`); **delete "9 shuls indexed"** (`LookupCard.tsx:116`),
replace with a quiet "Refreshed every Motzei Shabbat" **text line**; shorten the 45-word hero. **Skip:** dressing
freshness as a new *chip component* (over-design); stripping Look-up to a naked row (it's a real co-equal task — keep
the lighter card). Note: geolocate is *already* 1 tap — this is a **hierarchy** fix, not a click win.

### 2. Located feed (`app/page.tsx:134-end`, MinyanList, FeedHeader, ZmanimStrip)
**Problems (high):** an always-on date `<form>` + **"Update" submit button** = a roundtrip in the 90%-today case;
ordering sorts purely by start time so a **started-20-min-ago minyan outranks a starts-in-5-min one**; freshness is
faint *text*, not the existing `FreshnessBadge` pill; the zmanim grid uses `title=` tooltips that **don't fire on
touch**; the walking empty-state is a dead-end while address-search gets an "Add a shul" CTA.

```
+------------------------------------------+
| tfila.co            [🔍]        [+]       |  <- sticky, 1 line
| Near Lawrence, NY  (change)  within 2mi v |
+------------------------------------------+
| ☀ Netz 5:24 · Shkia 8:31 · Tzeis 9:03 ⌄ |  <- zmanim collapsed (tap=full grid)
+------------------------------------------+
|  +------------------------------------+  |  <- row #1 emphasized (NO separate hero)
|  | Mincha   7:15 PM · in 6m   🟢 live |  |
|  | Cong. Bais Medrash · Ashkenaz      |  |
|  | 📍 0.3 mi          ✓ Verified 2d   |  |  <- FreshnessBadge pill
|  +------------------------------------+  |
|  Later today        [All][Shach][Minch]  |
|  | Maariv  8:05 PM · in 56m           |  |
|  | Young Israel  📍 0.5 mi  ✓ 1d      |  |
|  | Maariv  8:45 PM · in 1h 36m        |  |
|  | Anshe Sfard   📍 0.7 mi  ✓ 4d      |  |
|                                          |
|  Showing 3 of 11 within 2 mi             |
|  Not now? Today ▾ · widen to 5 mi        |  <- date picker = onChange link
+------------------------------------------+
```
**Ship ✓CLICK:** demote the date picker to a **"Today ▾" that navigates on `onChange`** (kill the Update button —
the one true click-saver, pure STYLE.md "live feedback beats roundtrips"). Cheap co-wins (no new UI): **fix ordering**
so upcoming always outranks already-started; swap freshness text → the existing `FreshnessBadge` pill; give the
walking empty-state the same Add-a-shul CTA. **Skip:** a *separate* "NEXT MINYAN" hero card (redundant once ordering is
fixed — just emphasize row #1); the "~N min walk" ETA (new field, removes no clicks). Zmanim collapse-to-3-chips is
good (fixes the no-touch-tooltip bug) but it's progressive disclosure, not a click win.

### 3. Shul detail + stale (`app/shul/[slug]/page.tsx`, print)
**Problems (high):** **zmanim render in the wrong timezone on screen** — `ZmanimStrip` accepts a `timezone` prop but
`page.tsx:231` passes none, so it formats in host-UTC while print/feed are correct (same shul, different zmanim);
**blue nusach pills** (`:192/:385`) are a 4th color family; freshness is shown twice; the date picker is a submit+reload.

```
+------------------------------------------+
| <- back                                  |
| Beth Avraham Yoseph of Toronto           |
| 613 Clark Ave W, Thornhill, ON           |
| ✓ Verified 11h ago  · 0.4 mi away        |   <- ONE trust line (dedupe)
| [ Directions ]        [ Print sheet ]    |   <- promoted to buttons
|------------------------------------------|
|  Today  | Tomorrow |  Pick a date >      |   <- tabs (cut 2 actions)
|------------------------------------------|
| Sunday, June 7 (today)                   |
|  Shacharis              6:45 AM          |
|  Shacharis              8:00 AM          |
|  Mincha                 7:10 PM          |
|  Maariv                 9:45 PM          |
| v  Zmanim today  (tap a term = meaning)  |   <- inline, tz-correct
| v  Other days · full weekly schedule     |
|------------------------------------------|
| Times from bayt.ca/calendar, re-checked  |
| weekly. Last verified Jun 6, 11:02pm EDT |
|             home feed · find another shul |
+------------------------------------------+
```
**Ship:** **pass `timezone={tz}` to `ZmanimStrip` (`page.tsx:231`)** — a real correctness/trust bug, one token, free;
recolor blue nusach pills → neutral; single trust line; Today/Tomorrow tabs (✓CLICK, cuts 2 actions); promote
Print/Directions to buttons; cut the 280px map iframe + 3 redundant map links + "Status: active". **Skip:** moving
zmanim *into* a disclosure (adds a tap to currently-visible reference data); reuse the existing "Other days" `<details>`
rather than a 2nd collapsible. (Pairs with effectiveness **E-C3** timezone backfill + bug-audit **H3**.)

### 4. Global shell + onboarding (`app/layout.tsx`, /submit, /bot, /signin) — the only **KEEP** verdict
**Problems (high):** four "← back" links with **three different labels/targets**; `/signin` and `/bot` have **zero path
home**; `/signin` + the address empty-state use an off-palette `bg-neutral-900` CTA; `/submit` duplicates `AddCard`.

```
Global shell (top of EVERY page)
+------------------------------------+
| [pin] tfila.co        Add · Find   |  <- wordmark = home; links text-xs
+------------------------------------+
--- /submit AFTER a URL is posted ---
|  +------------------------------+  |
|  | Got it — Aish Thornhill is   |  | emerald banner, verb-led
|  | in the queue.                |  |
|  | We'll have times in ~30s.    |  |
|  | [ View your shul -> ]        |  |
|  +------------------------------+  |
|  About · Add a shul · Find a shul  |  shared footer
+------------------------------------+
```
**Ship:** a **persistent clickable wordmark = home** in `layout.tsx` (rescues /signin + /bot 0→1, lets all four ad-hoc
"← back" links be deleted) + normalize the two `neutral-900` CTAs → `amber-800` + one-line verb-led submit success copy.
**Skip / watch:** keep the shell to a wordmark + 2-3 `text-xs` links — **no nav tabs/breadcrumbs/sticky bar** (drifts
enterprise-y); redirect `/submit`→home-with-banner rather than hard-delete (don't 404 inbound/SEO links).

---

## ADMIN

### 5. Cockpit (`app/admin/page.tsx`, AdminInbox, /admin/shuls, layout)
**Problems (high):** **8 count-tiles** = a 4-row wall above the inbox at 360px; the 6-link header overflows 360px;
`/queue` + `/rejected` are near-identical thin views; **no recovery affordance for the 30 storm-stranded shuls**.

```
+------------------------------------------+
| tfila.co        Admin        [Sign out]  |
|  Admin triage                            |
|  +------------------------------------+  |
|  |  9 active   ·   31 need you        |  |  <- crisis-aware health header
|  |  20 broken since the 6/3 storm     |  |
|  |  [ Re-extract all 20 broken ]      |  |  <- amber-800 (NEEDS confirm + rate-gate)
|  +------------------------------------+  |
|  [All 31][Broken 20][Review 7][Stale 4]  |  <- chips filter in place
|  Inbox                                   |
|  |▌Investigate broken extraction      |  |  (rose band)
|  | Beth Israel · 12 Main St           |  |
|  | 9d stale · broken 4d   [ Extract ] |  |  <- inline only for broken/stale
|  |▌Review 2 new extractions           |  |  (amber band)
|  | Anshe Sfard · 8 Oak Ave  [ Open ]  |  |  <- Open (NOT blind Approve)
|  More ▾  Candidates · Changelog · Feed   |
+------------------------------------------+
```
**Ship ✓CLICK:** collapse the 8 tiles into **in-place filter chips that also absorb `/queue` + `/rejected`** (removes 2
routes + the nav round-trip + the 360px wall; pure subtraction); collapse the header to wordmark + Admin + Sign-out
(rest under "More ▾"). **Skip (dangerous):** row-level **[Approve]** — approve targets a *data_source*, not a shul, and
blind-approve breaks the accuracy promise; keep **[Open]** for review rows, inline **[Extract]** only for broken/stale.
The bulk **"Re-extract all N"** is the riskiest add — it can **re-trigger the exact 429 storm**; only ship it with a
confirm + the existing rate gate (ties to effectiveness **E-D1**), else defer.

### 6. Approval workflow (`/admin/shul/[slug]`, `/admin/data-source/[id]`, rule edit)
**Problems (high):** the queue row deep-links to the **full settings page**, so reaching the review card is a 2nd hop;
**source quotes are collapsed by default** (the whole point of v2 is verifying the rule against its quote); blue nusach
badge on both pages.

```
+--------------------------------------+
| <- queue          ds 482 · html  0.91|
| Beth Tefilah · 14 Main St, Lakewood  |
| 6 rules — check each quote, then act  |
+======================================+
| RULE                | SOURCE QUOTE   |  <- shown side-by-side, NOT hidden
|---------------------+----------------|
| Shacharis 7:00 AM   | "Shacharis     |
| Mon-Fri        [x]  |  7:00am M-F"   |  <- [x] delete only (no hand-edit)
| Mincha 15m b/4 shkia| "...15 min     |
| Every day      [x]  |  before sunset"|
| Maariv 8:45 Sun-Thu | (no quote) !   |  <- flagged: no evidence
+======================================+
|  [ Approve 6 rules ]      Reject     |  <- existing top card, relabeled
+======================================+
```
**Ship ✓CLICK:** **deep-link the queue row straight to the newest-pending data-source review card** (removes a full
nav); **show each source quote next to its rule by default** (un-collapse `data-source/[id]:332`); recolor the blue
nusach badge → neutral on **both** pages. **Skip:** an inline rule **[edit]** drawer — it contradicts a *deliberate*
product stance (`data-source/[id]:180-184`: admin deletes + re-extracts, never hand-edits, to preserve machine
provenance); a new sticky bottom bar (the approve card is already top-of-card — just relabel "Approve N rules").

### 7. Discovery + queues (`/admin/candidates`, /queue, /rejected, /data-sources/rejected, /changelog) — *medium*
**Problems:** 5 status pills incl. a **dead "deferred"** one; 4 overlapping queue/rejected "doors"; run-discovery picker
always expanded.
**Ship:** collapse 5 pills → **2 tabs (Pending / Reviewed)**; merge the 4 queue/rejected views into the inbox chips
(Theme #5); collapse "Run discovery" + the two always-open result boxes into `<details>`; drop the dead pills; nav 6→4.

---

## 8. Design system / tokens — flagged **NOT fully STYLE.md-true** (the redesign over-reached)
**Real token bugs to fix (ship):**
- **`globals.css:18` `font-family: Arial` overrides Geist app-wide** — the single highest-value fix; the whole app is
  silently rendering in Arial despite Geist being wired up. Delete it; reconcile `--background` to `stone-50`.
- **Swap the 5 `bg-blue-100/text-blue-800` nusach/status badges → neutral** (`shul/[slug]:192/385`, `candidates:35`,
  `data-source/[id]:307`, `admin/shul/[slug]:71`) — blue is a forbidden 4th color family.
- **`RadiusSelector:29`** is ~22px (below the 36px tap floor) with `focus:outline-none` and no ring — bump to `py-2` +
  add a `focus-visible` ring. Same min-tap/focus-ring floor on filter chips + the date select.
- `amber-700 → amber-800` on the **2 wordmark dots only** (`FeedHeader:27`, `admin/layout:20`) — **not** `RelativeTime:43`
  (that amber-700 is an intentional *caution* state).
**Skip (this is why it was flagged):** introducing `<Card>/<Badge>/<Button>` wrapper components **violates STYLE.md's
"Tailwind utility classes only"** and is over-engineered for a 9-shul solo build; and **merging the 3-4 status-badge
maps couples different domains** (candidate status vs shul lifecycle vs admin tier) that only happen to share colors.
Keep it token-level, not a component framework.

---

## Highest-leverage UI changes → folded into THE PLAN P4 at the top; kept for reference (skeptic-filtered)

1. **`globals.css` Arial line** — the entire app renders in the wrong font; one-line, app-wide. *(do first)*
2. **`ZmanimStrip timezone={tz}`** (`shul/[slug]:231`) — users see wrong zmanim on screen; one token.
3. **Feed date picker → onChange-navigate** (kill "Update") + **fix next-minyan ordering** — ✓CLICK + the core glance.
4. **Persistent wordmark-as-home in `layout.tsx`** + normalize off-palette CTAs — fixes trapped pages across 5 screens.
5. **Admin: 8 tiles → filter chips that absorb /queue + /rejected** — removes 2 routes + the nav round-trip.
6. **Admin: deep-link queue → review card + show source quotes by default** — the approval hot path.
7. **Landing: demote address input under "Use my location" + delete "9 shuls indexed".**
8. Recolor blue badges → neutral; tap-target/focus-ring floors. *(rolls up with #1)*

**Cross-links:** the feed 500 (bug-audit **C3**) must be fixed before anyone *sees* screen #2; wrong-times accuracy
(**E-C1/C2/C3**, **H3**) is what makes any of this UI trustworthy. **Next step for the "go-further" mockups:** turn the
wireframes above into **hi-fi rendered HTML mockups** (via the frontend-design / wireframe skills) — that writes files,
so it needs stepping out of plan mode.
