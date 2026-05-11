# tfila.co — Progress

Rolling build log. **Latest at top.** Update after every meaningful work session.

**Convention:** each entry is dated. Mark in-progress with ⏳, done with ✅, blocked with 🚫.

Three sections:
- **Now** — what's actively being worked on
- **Done** — finished slices, in reverse chronological order
- **Blocked / Needs decision** — things waiting on something

---

## Now

_(nothing in flight — ready to start PR 4)_

---

## Done

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
