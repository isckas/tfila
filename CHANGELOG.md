# tfila.co — Changelog

Day-versioned log of features, functions, and stack/code notes. Rendered in the admin section at `/admin/changelog`.

**Convention:** one version per active build day. End of day, a midnight ET cron bumps the version and appends a new section with that day's commits. Latest version at top.

---

## v4 — 2026-06-07

**The holistic remediation.** The site had silently dropped from ~41 to **9 active shuls** after the 2026-05-24 Anthropic 429 storm turned transient rate-limit failures into permanent demotions through a one-way trapdoor — and every safety net had a blind spot, so it went unnoticed for two weeks. A 3-review audit (error/log · effectiveness · UI) drove a single unified fix executed as phases **P0–P5** plus a full cleanup backlog, shipped straight to prod and adversarially reviewed each step. Recovered to **24 active**; the directory is correct, hardened, and monitored. (Also folds in the late-May state-machine / dedup hardening that shipped as PRs #2–#4.)

### Features

- **Report a wrong time** — an anonymous "Report a wrong time" tap on each shul page records a lightweight report (`time_report`, migration 0013) that the admin triages at **`/admin/reports`**. Never auto-spends LLM — it surfaces for review, the admin decides whether to re-extract.
- **Bulk re-extract** — a confirm-gated button on the admin cockpit re-extracts every broken shul at once, throttled by the global concurrency cap + the daily cost-gate (so it can't repeat the storm).
- **Both UIs redesigned** — landing (Find made dominant, dropped "N shuls indexed"); located feed (date picker navigates on change instead of a submit button, an upcoming minyan now outranks one that already started, walking empty-state gets an Add-a-shul CTA); shul page (Today/Tomorrow tabs, map clutter cut, zmanim rendered in the shul's own timezone); `/signin` + `/bot` rescued from being dead-ends; admin cockpit (8 count-tiles → in-place filter chips that absorb `/queue` + `/rejected`); candidate Pending/Reviewed tabs; admin source-quotes shown next to each rule by default.

### Fixes

- **Stopped the outage.** Fixed the geo-tz crash that 500'd the located home feed (Next file-tracing + a try/catch). Killed the no-recovery trapdoor — public visibility is now *derived* from "has a fresh, approved, successful source," not a stored `status='active'`, so a demoted shul self-heals on its next good scrape. Made the 429 storm unrepeatable (a global concurrency cap + transient-vs-terminal classification: a rate limit is now a one-week stale window, not a permanent demotion). **Recovered 9 → 24 active.**
- **Correct times.** Day-of-week is computed in the *shul's* timezone (the server-UTC version dropped Friday-night minyanim after ~7 pm ET); zmanim render in the shul tz so screen == print == feed; evening minyanim the source describes relative to a zman now emit `zmanim`-anchored times (instead of freezing to a summer clock that's wrong all winter), with a "may shift seasonally" note on fixed evening clocks; `shul.timezone` backfilled.
- **Admin review queue** no longer shows zero reviewable shuls — a reviewable extraction now outranks "broken" in the derived state.
- **Email-channel parity** — a good email now restores a previously-demoted source (was a one-way door).
- **Design system** — the entire app was silently rendering in Arial despite Geist being loaded; fixed. Blue badges → neutral (one accent color only); tap-target + focus-ring floors on controls.

### Security & observability

- **SSRF closed at the fetch boundary** — every fetch (the extraction cascade *and* the weekly rescrape over stored URLs) now validates the URL + each redirect hop against private / loopback / metadata IPs, not just the `/submit` form. The Cloudflare fetch-proxy got the same guard.
- **Dead-man's switch** — a silently-dead weekly cron now fires a loud "CRON DID NOT RUN" alert (this is exactly how the original outage hid for two weeks).
- **`/api/health` probes the feed** — it now exercises the geo-tz dependency that 500'd the feed, so monitoring goes red instead of reporting green-while-broken.
- **Inngest `onFailure`** on all 5 key functions → admin email + Sentry; critical alerts retry and fall back to Sentry when email is unconfigured.
- **Per-page admin auth** — every admin page re-verifies the session (defense-in-depth beyond the layout gate).
- Weekly digest gained a mass-breakage spike-gate (`🚨 [ALERT]` prefix) + the live active-shul count, and now surfaces sources that broke before the `first_broken_at` column existed.

### Stack & infra

- **Consolidated to one extraction cascade** — retired the v2 agent-loop pipeline (router, agent-loop, 5 tools, critique pass, Jina, Docling — ~2.6k LOC) after it underperformed v1 and amplified the 429 storm; kept v2's two real wins (forced Anthropic tool-schema output + a required per-rule `sourceQuote`).
- **Cost-gate now counts weekly-cron spend** — it was structurally blind to rescrapes (which UPDATE rows; the gate only summed same-day inserts); now gates on `built_at`.
- Migrations applied to prod: **0013** (`time_report`), **0014** (`shul_candidate.review_status` CHECK constraint).
- Added Biome lint + Vitest + a render smoke test; deleted orphaned Jina/Docling scrapers; removed a discovery "run all targets" footgun.

### Process

- Executed on one branch, deployed straight to prod in dependency-ordered phases, each one **adversarially reviewed by multi-agent workflows** (~50 agents total) — which caught real bugs before merge (a Cloudflare-worker host-block false-positive on `fda.gov`-style domains, an Inngest runId mix-up, a cost-gate over-count). Every deploy was smoke-checked.

---

## v3 — 2026-05-14

### Features

- **Shul discovery system** — proactively find shuls via Google Places, triage in admin, queue extraction.
  - **`shul_candidate` + `discovery_run` tables** (migration 0005). Place_id UNIQUE for natural dedup across re-runs; raw response preserved as JSONB; no DELETEs (rejected rows act as a denylist).
  - **`docs/discovery-targets.md` + `data/discovery-targets.json`** — 88 davener-weighted geographies covering ~85% of NA daveners, ~80% of Europe, plus 35 travel destinations.
  - **`/admin/candidates`** — listing with status filter pills, target dropdown, URL-presence filter (has URL / no URL / any), Run-discovery picker (~$0.10 per target, ~3 Places API calls), Recently-approved-last-24h section.
  - **Approve flow** requires a URL — Places-returned or admin-pasted via `urlOverride` form field. tfila.co only publishes shuls with live times, so a no-URL row isn't created at all. Approve redirects to `/admin/shul/[slug]` to watch extraction.
  - **Dedup-merge address backfill** — when a candidate's domain matches an existing shul, the existing shul's address + location get filled in from the Places data if they were null.
- **Schedule-page resolver** (`lib/discovery/find-schedule-page.ts`) — hybrid pattern-then-LLM-scout. Given a root URL, returns the URL of the actual schedule page (e.g. resolves `jewishwindsorterrace.org` to `/templates/articlecco_cdo/aid/2710598/jewish/Times-and-Schedule.htm`). Wired into both `/api/admin/candidate/[id]/approve` and `/api/submit` so the resolved URL replaces the root in `shul.submittedUrl`.
- **Cloudflare Worker fetch proxy** — bot-block fallback. When a site returns 403/406 to both UA attempts from Vercel, `lib/scrapers/fetch.ts` retries via the Cloudflare Worker (the same one that handles inbound email). Cloudflare edge IPs aren't typically caught by the same anti-bot rules that flag Vercel/AWS outbound. Concretely fixed Chabad.org-hosted shuls.
- **Pipeline parity step 1**: shared `backfillShulLocation()` helper called from both URL and email submission paths. Email-derived shuls now get Google Places address backfill so they're not second-class on the geo feed.

### Stack & infra

- **Cloudflare Worker** now handles two responsibilities: `email()` for inbound mail at `submit@tfila.co` + `fetch()` proxy at `/fetch` (bearer-auth via `FETCH_PROXY_TOKEN`). Deployed at `https://tfila-inbound-email.tfila.workers.dev`.
- **Inngest** now properly registered to production env. Vercel-Inngest marketplace integration installed for preview-deploy auto-sync. Production sync via the Inngest dashboard's "Sync new app" once per function-list change.
- **Migration 0006** added `shul_status='no_url'`. **Migration 0007** dropped it in the same session (product call: shuls without times shouldn't exist as rows; approve requires a URL).
- **Logo + brand assets shipped** — `tfila-b.png` as source, `scripts/build-logo-assets.mjs` runs sharp to produce favicon / apple-icon / og-image / legacy `favicon.ico` variants. Auto-wired via Next 16's `app/icon.png` / `app/apple-icon.png` / `app/opengraph-image.png` conventions.
- **New env vars**: `FETCH_PROXY_URL`, `FETCH_PROXY_TOKEN`.

### Fixes

- **Email-extract prompt tightening** — default to *regular weekly* rules; only date-bound when times themselves are special (Tisha B'Av, fast days). Don't infer years in the past for partial dates ("May 8-9" → upcoming, not previous year).
- **Migration 0004 applied to production Neon** — was written but never applied; `/admin/shul/*` pages were 500'ing on `SELECT *` referencing the missing `match_domain` column. Applied via direct `pg` connection to the actually-default Neon branch (`phase-1-migration`; the branch literally named "production" is empty).
- **`normalizeWebsiteUrl()`** boundary normalization in `lib/inbound/extract-website.ts` — guards against LLM-hallucinated shared-MTA strings and malformed URLs that would have crashed `new URL()` inside the email persist transaction.

### Known limitations

- **Admin flow** spans multiple pages (`/admin/candidates`, `/admin/queue`, `/admin/shuls`, `/admin/shul/[slug]`, `/admin/data-source/[id]`) that were built independently. Each works in isolation; together they don't read as one coherent workflow. UX simplification deferred to next session.
- **Pipeline parity steps 2-7** — only step 1 (address backfill) shipped. Slug allocation, broken-config guardrails, persist body, configJson normalization still duplicated across `build-data-source.ts` and `process-email.ts`.

---

## v2 — 2026-05-13

### Fixes

- **Dedup: stop merging different shuls that share a mailing-list provider.** Forwarded email submissions now derive `match_domain` from the shul's own website (LLM-extracted from the email body, with a regex fallback over body URLs), NOT from the sender's email domain. Before this fix, every shul on a shared platform like MyShul or Mailchimp ended up with `match_domain = "myshul.com"` / `match_domain = "list-manage.com"`, so the next forwarded email would silently auto-merge into the first shul on that platform regardless of which shul it was actually about.
  - New `lib/inbound/extract-website.ts` exports `extractCanonicalWebsiteFromEmail()` + `isSharedMtaDomain()` + the `SHARED_MTA_DOMAINS` denylist (shul/marketing platforms, generic mail providers, social, shortlinks).
  - LLM extraction (`ExtractionSchema.shulWebsite`) is the primary source; regex over body URLs is the fallback. If neither finds anything, `match_domain` stays NULL (no dedup) — safer than wrong-merging.
  - For shared-MTA senders, `data_source.identifier` becomes compound (`info@myshul.com::edmondjsafrasynagogue.com`) so two different shuls on the same MTA get separate data_sources.
  - `/api/admin/backfill-match-domain` updated to apply the same denylist check.
- **One-shot cleanup endpoint** `POST /api/admin/null-mta-match-domain` nulls `match_domain` on existing rows that were poisoned with a shared-MTA value, so they stop wrong-merging future submissions.

---

## v1 — 2026-05-13

Baseline release. Everything below covers the full build from sprint 1 through end of 2026-05-13. Future versions list incremental day-over-day changes.

### Features

- **Mobile-first home page** with three equal-weight tiles for the site's three jobs:
  - 📍 **Find a minyan** — `Use my location` button + address fallback input. Auto-restores saved location.
  - 🔍 **Look up a shul** — live fuzzy search across all active shuls (subsequence matching, no API roundtrip per keystroke).
  - ➕ **Add a shul** — embedded URL submit form + inline email-forward instructions for `submit@tfila.co`.
- **Geolocated minyan feed** sorted by start time with configurable radius (½ mi to 25 mi). Includes minyanim that started up to 30 min ago for late arrivals; 24-hour forward window.
- **Reverse-geocoded place chip** — feed header shows "Crown Heights, NY" instead of raw lat/lng.
- **Sticky feed header** keeps Find / Look-up / Add reachable on every scroll.
- **Public shul detail pages** (`/shul/[slug]`) with date picker, distance from user, zmanim grid, recurring weekly schedule, OpenStreetMap embed, source-attribution paragraph, and "last updated" freshness signal.
- **"Other days · weekly breakdown" disclosure** — site's main job is current minyan times; date picker + full week table collapsed by default, auto-opens for non-today URLs.
- **Submission flow**: anonymous URL submission OR forward-an-email path. Both feed the same admin review queue.
- **Admin section** (magic-link auth):
  - Review queue sorted by confidence ascending
  - All shuls listing with search + status filter
  - Per-shul detail page with edit URL + manual extract trigger
  - Per-data-source review with cascade-attempt breakdown
  - Rejected section with "move back to pending" / "approve directly" actions
- **Zmanim panel** with hover tooltips explaining each abbreviation (Sof Tef, Plag, Mincha G, etc.).
- **STYLE.md** at repo root codifies the UX north star: minimal clicking, simple clean aesthetics, neutral + amber-800 palette, mobile-first.

### Functions / pipeline

- **Extraction cascade** (`lib/llm/cascade.ts`) — four-tier escalation pipeline:
  1. HTML — direct fetch + LLM extract on sanitized HTML
  2. JS-rendered — Browserless `/content` endpoint → HTML extract
  3. Vision — schedule-image candidates → Claude Sonnet vision with base64 input
  4. PDF — bulletin-PDF candidates → Claude Haiku/Sonnet with base64 PDF document blocks
  - Vision runs before PDF because shul-published schedule images are small + clean weekly snapshots; bulletin PDFs are multi-MB kitchen-sink documents.
  - Winning strategy persists on `data_source.extraction_strategy` so weekly rescrapes skip earlier tiers.
  - When all tiers fail, `shul.status = 'unsupported'` blocks the weekly cron from retrying.
  - For vision/PDF: `data_source.identifier` stays on the page URL (not the per-week resource URL like `Times-Bamidbar5786.png` that rotates with the parsha), so rescrapes re-discover the current resource.
- **Same-origin URL fallback** for HTML tier — submitted `/calendar` (events widget) automatically tries `/worship/shabbat`, `/services`, `/service-times`, `/schedule`, `/minyan`.
- **Dual-HTML candidate scan** — PDF/image finder scans both Browserless-rendered AND static HTML and dedupes, because Browserless sometimes strips static links.
- **Base64 binary fetcher** (`lib/scrapers/fetch-binary.ts`) — fetches PDFs/images locally with Tfila-Bot UA + browser-UA fallback (25 MB cap), then passes to Claude as `Base64PDFSource` / `Base64ImageSource`. Bypasses Anthropic's URL-fetcher robots.txt enforcement that blocks all ShulCloud-CDN-hosted assets.
- **LLM prompt caching** on system prompts (Haiku 4.5 first-pass → Sonnet 4.6 escalation below 0.4 confidence) for HTML, email, address, and PDF extraction.
- **Tolerant JSON parser** (`extractJsonObject`) tolerates prose preambles + trailing chatter; eliminates the assistant-message-prefill dependency some models recently started rejecting.
- **Email-newsletter ingestion** (app-code complete; awaiting Postmark vendor setup):
  - `lib/inbound/extract-original-sender.ts` regex-parses forward markers from Gmail/Outlook/Apple Mail/Yahoo
  - Forwarded-email data_sources keyed by original sender; gabbai action not required
  - Regular rules REPLACE on each weekly forward; special-schedule rules ADD (date-bounded, priority 10)
- **Address-from-search fallback** (`lib/geocoding.ts` `findShulPlace`) — when LLM extraction doesn't surface an address, searches Google Places Text Search by shul name. Scored by name-token overlap + place type (synagogue +0.4 / place_of_worship +0.25 / religious_organization +0.15). Applies automatically when confidence ≥ 0.7.
- **Reverse geocoding** for the home-feed place chip — Google Geocoding API's `latlng` parameter resolves to neighborhood + admin code.
- **Inngest async pipeline**:
  - `data-source.requested` — handles new submissions, runs the cascade
  - `shul.scrape.requested` — per-shul rescrape (called from weekly cron)
  - `email.received` — handles forwarded-email submissions
  - `shul-weekly-rescrape` cron — Saturday 22:00 ET (motzaei Shabbos); fans out one event per active+approved data_source
  - Per-host concurrency caps so we don't DDoS one provider
- **Weekly rescrape with hash-comparison shortcut** — HTML tier skips LLM call when page-content hash matches previous run. Broken-config guardrails: confidence < 0.6 OR rule-count drop > 50% flags the data_source as `pending` instead of replacing rules.
- **Stateless HMAC magic-link admin auth** (~120 LOC, no Auth.js dependency, no session DB tables).
- **Verbose cascade-attempt audit** — every tier's outcome (extracted / fetch_failed / extract_failed / skipped) recorded in `configJson.cascade_attempts`. Admin UI renders the per-tier breakdown with a "winner" badge on the tier that succeeded.

### Stack & code notes

- **Frontend**: Next.js 16 App Router + Tailwind v4 + TypeScript + React 19
- **Database**: Neon Postgres + Drizzle ORM + PostGIS (`GEOGRAPHY(Point, 4326)` + GIST index for radius queries via `ST_DWithin`)
- **Background jobs**: Inngest v4 (durable retries, fan-out, per-host concurrency, step replay)
- **LLM**: Anthropic API (Haiku 4.5 first-pass → Sonnet 4.6 fallback). Prompt caching with `cache_control: { type: "ephemeral" }`. Zod-validated outputs.
- **JS rendering**: Browserless `/content` endpoint (free tier 1k/mo)
- **Geocoding + Places**: Google Maps APIs (forward + reverse geocoding + Places Text Search v1). Single key powers all three.
- **Email**: Resend (transactional / magic links); Postmark planned for inbound (vendor pick pending — see IDEAS.md)
- **Hosting**: Vercel
- **Observability**: Sentry + structured logs (wired in code, key not yet provisioned)
- **Auth**: hand-rolled HMAC-signed magic links + session cookies, AUTH_SECRET ≥ 32 chars
- **Required env vars**:
  - `DATABASE_URL` — Neon connection string
  - `ANTHROPIC_API_KEY` — required for all cascade tiers
  - `GOOGLE_GEOCODING_API_KEY` — both Geocoding API and Places API (New) enabled, both in key's API-restrictions allowlist
  - `BROWSERLESS_API_KEY` — required for tier 2 (silently no-ops if unset, warns once in prod)
  - `RESEND_API_KEY` — magic-link email delivery
  - `AUTH_SECRET`, `ADMIN_EMAIL`, `AUTH_URL`, `AUTH_EMAIL_FROM` — admin auth
  - `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` — async pipeline
  - See `.env.example` for the full list.
- **Schema** — `data_source.extraction_strategy` enum (`html | js_rendered | pdf_document | vision_image | failed`); `shul.status` includes `unsupported` (cron skips these). `minyan_rule.time` is a tagged-union JSONB stored via `serializeMinyanTime()` helper.
- **Tagged-union time format**: `{ kind: 'fixed', clock: 'HH:MM' }` or `{ kind: 'zmanim', anchor, offsetMin }`. Resolved at query time using `@hebcal/core` based on shul lat/lng + timezone.
- **Data source priority** (higher wins on rule conflict): email_newsletter (60) > website_llm (40) > shulcloud_website (30)
- **Sanitization**: HTML stripped of `<script>`, `<style>`, `<noscript>`, `<svg>`, `<template>`, and HTML comments before sending to LLM. Typical 80-90% size reduction on WordPress / Divi sites.
- **Browser-UA fallback** in `lib/scrapers/fetch.ts` — submits Tfila-Bot/1.0 UA first; falls back to Chrome UA on 403/406 for WAF-protected sites.
- **Drizzle quirks**: JSONB tagged unions cast through `serializeMinyanTime()` (one place to update if we ever migrate to strict JSONB typing). `cascade_attempts` validated at read-time via `parseCascadeAttempts()` (Zod) in admin UI.
- **Inngest hardening**: `extractionStrategy === null` explicitly guarded (treated as `'html'`). `process-email` has 5-min finish timeout to prevent hung concurrency locks. Browserless missing-key logs a `console.warn` once per cold start in production.
- **AGENTS.md rule** (active): Claude asks 3 clarifying questions before any new feature. Skips for concrete bug fixes, typo/copy edits, trivial renames, or continuing already-approved work.

### Known limitations / pending setup

- **Postmark inbound vendor pick** — app code shipped, vendor not yet selected (IDEAS.md "Email-inbound vendor pick").
- **Same-origin URL fallback** runs in HTML tier only — JS-rendered, PDF, Vision tiers don't try `/worship/shabbat` etc. Deferred refactor.
- **Anthropic Auto-Reload** — recommended after the cascade work bumped per-extraction cost ~10×.
- **anash.ca/daven** — not yet end-to-end tested with the cascade (image src is JS-injected).
