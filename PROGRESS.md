# tfila.co — Progress

Rolling build log. **Latest at top.** Update after every meaningful work session.

**Convention:** each entry is dated. Mark in-progress with ⏳, done with ✅, blocked with 🚫.

Three sections:
- **Now** — what's actively being worked on
- **Done** — finished slices, in reverse chronological order
- **Blocked / Needs decision** — things waiting on something

---

## Now

_(nothing in flight — ready for PR 9 production Inngest + Resend setup)_

---

## Done

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
