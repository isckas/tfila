# tfila.co — Scope

**Product**: tfila.co — a mobile-first directory of Jewish minyan times.
**Domain**: tfila.co (to be registered)
**Working repo**: daven-site (rename pending)
**Scope locked**: 2026-05-11
**Status**: Sprint 1 (static directory) complete. Scoped pivot to "next minyan near me" ready for Phase 1 build.

---

## 1. Vision

> tfila.co is a mobile-first directory of Jewish shul minyan times built around two moments: **"I need to daven soon and I don't know where"** (urgent) and **"I'll be in X city — where can I daven?"** (planning). Open the app: see the next minyanim near you, sorted by start time, including any that have already started for late arrivals. Times stay fresh because shuls submit their website (or weekly email) once and tfila.co re-scrapes — no admin login required, no rot.

**Form factor**: installable PWA (no native iOS/Android in MVP).

---

## 2. Users

- **Davener** (primary). May be anonymous in MVP — no required login. Browser geolocation OR optionally saved home location (browser localStorage, no server-side accounts).
- **Admin** (Isaac). Reviews LLM-generated scrape configs, manually edits when needed, monitors queue.
- **Shul / gabbai** (NOT a user). Submits a URL + contact email via anonymous public form. No login. We email them when their scrape breaks. Shul claim/edit UI is explicitly Phase 2+.

---

## 3. Killer use cases (ranked)

1. **Urgent "next minyan near me"** — the wedge. Tap once, see times sorted by start, walkable distance.
2. **Late-arrival check** — show in-progress minyanim with countdown ("started 12 min ago, still going").
3. **Travel planning** — pick city + date range, see what's available across the span.
4. **Recurring "where on Shabbos" near home** — neighborhood discovery, filter by nusach/style (Phase 2 filter).

### Cross-cutting requirement (mandatory across all use cases)
**Special schedules**: Yamim Tovim, fast days, the three weeks, Aseres Yemei Teshuvah, ad-hoc shul-specific overrides. The data model AND scraper MUST handle recurring annual special schedules + one-off date-bounded overrides + "applies to this date range only" semantics. This is where existing aggregators rot fastest.

### Critical-but-not-killer flows (have to work, not have to feel magical)
- Shul submission form (URL + contact email, anonymous)
- Admin review queue (sorted by confidence ascending)

---

## 4. Non-goals

**tfila.co is NOT:**
- A social network (no profiles, no check-ins, no following)
- A shul management tool (no booking, no aliyah signup, no donations)
- A Halacha / kaddish-list app (no Halacha lookups, no kaddish lists, no full lifecycle features). **Scope-revised 2026-05-11**: we DO surface today's parsha + daf yomi + active study cycles with Sefaria links as a Phase 2 contextual sidebar — this is supportive context for daveners, not the product itself.
- A chat/messaging tool (no comments, no "ask the gabbai")
- Selling ads / sponsorships / premium tier in v1
- A pure zmanim calculator product — but **Phase 1 includes a full location-aware zmanim panel** (alos, netz, sof zman shema, sof zman tefillah, chatzos, mincha gedolah, plag mincha, shkia, tzeis, candle-lighting / havdalah) with a condensed strip on the home feed and a dedicated `/zmanim` page. **Scope-revised 2026-05-11** (was "thin strip only").

**tfila.co won't (yet):**
- Ship native iOS/Android apps — PWA only
- Offer shul login / shul-side editing UI
- Send push notifications by default — strictly opt-in if ever added
- Keep historical archive of past minyan times

**Denominational scope**: Support **any minyan that publishes structured times on a website or weekly email** — Orthodox, Conservative, Chabad, Sephardi, Carlebach, etc. No features tailored to non-Orthodox patterns specifically.

---

## 5. MVP cut line

### Phase 1 — MVP (~4-6 weeks + ~1 week production hardening)
- PWA shell, installable, mobile-first, geolocation
- "Next minyanim near me" feed sorted by start time, including in-progress (late-arrival display)
- Date picker for planning mode
- Shul detail page (name, address, all times for chosen day, distance, map link)
- Anonymous shul submission form (URL + contact email)
- Scrape pipeline:
  - ShulCloud fast path (existing extractor)
  - LLM schema-build for non-ShulCloud sites (Haiku 4.5 + Sonnet fallback, prompt caching, Zod validation)
  - Inngest-driven weekly deterministic re-scrape with per-host concurrency caps
- Admin review queue, sorted by confidence ascending, side-by-side preview, approve/reject/edit
- **Full zmanim panel** (location-aware): alos, netz, sof zman shema (MGA + GRA), sof zman tefillah (MGA + GRA), chatzos, mincha gedolah, plag mincha, shkia, tzeis (multiple opinions), candle-lighting, havdalah. Condensed strip on home feed + dedicated `/zmanim` page. Likely uses `@hebcal/core` (already installed) for zmanim math; fall back to `kosher-zmanim` if needed for opinion coverage.
- Special-schedule data model (date-bounded overrides in DB + scraper)
- **Data-model future-proofing for email-newsletter source** (kind enum includes `email_newsletter` from day 1 even though pipeline is Phase 2)

### Phase 2 — Earn-it (weeks 6-12 post-MVP)
- **Email-newsletter source**: Postmark Inbound webhook → Inngest `email.received` → LLM extract → rule diff → update. Subscription mechanism = manual gabbai adds our unique address.
- **Torah-study sidebar** (scope-added 2026-05-11): today's parsha, daf yomi, mishna yomi, halacha yomi, nach yomi, and any active study cycles. Each item links to the corresponding Sefaria page. Likely sources from `@hebcal/core` + Sefaria URL conventions.
- Nusach/style tags on shuls and per-minyan
- Multi-day Shabbos planning view
- Inline walking directions
- Auto-detect "this week's special schedule" sections during scrape
- Shul claim/edit flow if demanded
- Confidence-gated auto-publish for high-confidence configs

### Phase 3 — Later/maybe
- Push notifications
- User accounts + saved favorites
- Crowdsourced flag-wrong-time
- Auto-subscribe to mailing lists via headless form-fill
- Davener-forwarded emails
- Public API
- Monetization

### Launch geographic scope
**Whatever we can scrape + manual adds.** Bootstrap seed strategy:
- (a) Manually add 50-100 well-known shuls before public launch (NYC, Lakewood, LA, Miami, Chicago, Toronto)
- (b) Scrape GoDaven / ChabadOne directories to bootstrap names + addresses, then run each through our own submission pipeline
- Current state: 30 ShulCloud shuls, 503 minyanim from sprint 1

---

## 6. Data model

### Core tables

**`shul`**
- `id`, `slug`, `name`, `address`, `lat`, `lng` (PostGIS `GEOGRAPHY(Point)`), `timezone`
- `nusach` (optional default for all minyanim at this shul)
- `submitted_url`, `contact_email`
- `status`: `pending_review` | `active` | `broken` | `archived`
- `submitted_at`, `activated_at`
- **GIST index** on `lat,lng` geography column for `ST_DWithin` radius queries

**`data_source`** (1:N from shul — replaces sprint-1 `scrape_config`)
- `id`, `shul_id`
- `kind`: `shulcloud_website` | `website_llm` | `email_newsletter` | `manual`
- `identifier`: URL for website kinds; unique inbound address like `shul-{token}@inbound.tfila.co` for email
- `config_json` (selectors/regex/time semantics for website_llm; extraction hints for email; also stores `cascade_attempts[]` audit trail)
- `confidence_score` (0.0–1.0)
- `extraction_strategy` (added 2026-05-13): `html` | `js_rendered` | `pdf_document` | `vision_image` | `failed`. Which tier of the extraction cascade produced the rules. Weekly rescrapes pin to this tier so they skip earlier tiers.
- `priority`: email > website > manual default (higher wins on rule conflict)
- `built_at`, `built_by` (`llm` | `manual` | `admin_edit`)
- `last_run_at`, `last_received_at`, `last_run_status`, `last_run_diff_summary`
- `review_status`: `pending` | `approved` | `rejected`, `reviewer_notes`

**`shul.status`** values: `pending_review` | `active` | `broken` | `archived` | `unsupported`. `unsupported` (added 2026-05-13) means every tier of the extraction cascade returned 0 rules; weekly cron skips these unless an admin manually re-triggers.

**`minyan_rule`**
- `id`, `shul_id`, `data_source_id` (provenance)
- `tefillah`: `shacharis` | `mincha` | `maariv` | `selichos` | `neilah` | `other` (free-text label). **Minyan times only — NOT class/shiur times** (no Daf Yomi, no Tehillim groups)
- `days_of_week` (bitmask or array)
- `time` (tagged union):
  - `{ kind: 'fixed', clock: '07:00' }`
  - `{ kind: 'zmanim', anchor: 'shkia' | 'tzeis_72' | 'alos' | 'netz' | 'misheyakir' | 'sof_zman_tefillah', offset_min: -18 }`
- `valid_from`, `valid_to` (nullable — null = always)
- `special_schedule_kind`: `regular` | `yom_tov` | `three_weeks` | `aseres_yemei_teshuvah` | `fast_day` | `rosh_chodesh` | `ad_hoc`
- `priority` (higher wins on date conflict — e.g. Yom Kippur rule wins over weekday Shabbos)
- `nusach` (optional override of `shul.nusach`)
- `last_seen_in_scrape_at`, `deleted_at` (soft delete)

**`scrape_run`** (audit log)
- `id`, `shul_id`, `data_source_id`, `started_at`, `finished_at`, `status`, `rules_added`, `rules_removed`, `rules_changed`, `error`

### Rule resolution

For date D, location L: fetch all rules from all active sources for each shul in radius. Apply source priority → rule priority → return winners. Resolve zmanim-relative times at query time via `kosher-zmanim` using shul lat/lng + date D. Never store as fixed clock time.

### Conflict policy (locked)

When email-derived and website-derived rules disagree on a time, **email wins**. Email is the most recent gabbai-authored source.

---

## 7. Architecture

```
┌─────────────────────────────────────────────────────────┐
│  PWA (Next.js 16 App Router on Vercel)                  │
│  ├─ public: / feed, /shul/[slug], /submit               │
│  ├─ admin: /admin/queue (magic-link via Auth.js)        │
│  └─ /api/health for uptime ping                         │
└─────────────────────────────────────────────────────────┘
       │ reads/writes                  │ emits events
       ▼                               ▼
 ┌────────────────────┐         ┌────────────────────┐
 │ Neon Postgres      │         │ Inngest            │
 │  + PostGIS         │◀──data──│  - schema.build    │
 │  + GIST index      │         │    (on submission) │
 │  + connection pool │         │  - scrape.weekly   │
 └────────────────────┘         │    (cron, fanout)  │
                                │  - scrape.run      │
                                │    (per shul,      │
                                │     concurrency    │
                                │     keyed by host) │
                                │  - email.received  │
                                │    (Phase 2)       │
                                └─────────┬──────────┘
                                          │
                ┌─────────────────────────┼──────────────────────┐
                ▼                         ▼                      ▼
   ┌──────────────────────┐  ┌─────────────────┐  ┌──────────────────────┐
   │ Extraction cascade   │  │ R2 / S3         │  │ Postmark Inbound     │
   │  (added 2026-05-13)  │  │  raw HTML       │  │  (Phase 2)           │
   │  HTML → JS-rendered  │  │  archive        │  │  webhook → Inngest   │
   │  → PDF → Vision →    │  │  LLM I/O audit  │  └──────────────────────┘
   │  failed              │  │  raw .eml       │
   │                      │  │  (Phase 2)      │
   │  ├─ Anthropic API    │  └─────────────────┘
   │  │   Haiku 4.5 →     │
   │  │   Sonnet 4.6      │
   │  │   + prompt cache  │
   │  │   + Zod validate  │
   │  │   + tolerant JSON │
   │  ├─ Browserless      │
   │  │   (JS render)     │
   │  ├─ Claude PDF       │
   │  │   document blocks │
   │  └─ Claude vision    │
   │      image blocks    │
   └──────────────────────┘

Cross-cutting: Sentry · Axiom logs · Better Stack uptime · kosher-zmanim (in-process)
External: Google Geocoding (one-time per shul + reverse-geocode for feed place name)
External (cascade tier 2): Browserless (~$0.001/render, free tier 1k/mo)
```

### Locked stack choices

**From sprint 1 (kept):**
- Next.js 16 App Router + Tailwind + TypeScript
- Neon Postgres + Drizzle ORM
- Vercel hosting

**New production-grade:**
- **Background jobs**: Inngest (NOT Vercel Cron). Durable retries, fan-out, event-driven, per-host concurrency caps, step replay.
- **Spatial**: PostGIS `GEOGRAPHY(Point)` + GIST index from day 1.
- **PWA**: hand-rolled service worker (~80 LOC). `next-pwa` is not Next.js 16 ready.
- **LLM**: Anthropic Haiku 4.5 first-pass → Sonnet 4.6 fallback. Prompt caching. Zod-validated outputs with retry-on-correction. Raw I/O archived to R2 for re-processing.
- **Extraction cascade** (added 2026-05-13): four-tier escalation for shul sites that don't ship rules in clean HTML — `html → js_rendered (Browserless) → pdf_document (Claude PDF input) → vision_image (Claude vision)`. Strategy stored per data_source so weekly rescrapes skip earlier tiers. Failures land `shul.status = 'unsupported'` so cron stops wasting LLM calls.
- **Geocoding**: Google Geocoding API.
- **Zmanim**: `kosher-zmanim` in-process server-side.
- **Admin auth**: Auth.js magic-link.
- **Davener auth**: none. Browser localStorage + browser geolocation API.
- **Scraper hardening**: User-Agent `Tfila-Bot/1.0 (+https://tfila.co/bot; contact:hello@tfila.co)`, robots.txt respect, ETag/If-Modified-Since HTTP caching, broken-config auto-detection (rule-count drop → admin queue), raw HTML archive in R2.
- **Observability from day 1**: Sentry (errors) + Axiom or Better Stack (structured logs) + Better Stack (uptime ping on `/` and `/api/health`).

### Phase 2 email pipeline (designed-for in Phase 1)

- **Vendor**: Postmark Inbound (~$15/mo unlimited). SendGrid Parse as cheaper backup.
- **Subscription mechanism**: manual — gabbai adds unique address like `shul-{token}@inbound.tfila.co` to their list.
- **Privacy**: strip PII at parse time (keep only schedule + extraction audit), publish retention policy on `/bot` page.

### Deferred (anticipated, not Phase 1)

- Upstash Redis edge cache for geo-bucket queries when QPS warrants
- Neon read replicas / branching
- Edge runtime for `/` (global latency)
- Postgres trigram + GIN for shul-name search
- Push notifications
- Auto-subscribe to mailing lists (Phase 3)
- Davener-forwarded emails (Phase 3)

---

## 8. Open decisions (status)

| # | Decision | Status |
|---|---|---|
| 1 | Initial seed list strategy | ✅ Manual adds (50-100 well-known) + scrape GoDaven/ChabadOne for bootstrap |
| 2 | Submission anti-abuse | ✅ Rate-limit by IP + Turnstile + LLM "is this a shul site?" sanity check + admin queue |
| 3 | Trademark / legal | ✅ Skip (publish `/bot` page with contact + retention policy as trust signal instead) |
| 4 | Domain name | ✅ `tfila.co` |
| 5 | Zmanim edge cases (northern latitudes) | ⏸️ Open — validate on a real Toronto/UK shul during build, don't rule out |
| 6 | Inbound-email privacy | ✅ Strip PII at parse time + transparency on `/bot` page |
| 7 | Phase 1 success criteria | ✅ See below |

### Phase 1 success criteria (locked)

- ✅ Live: PWA installable, home feed working, submission form open
- ✅ Seeded: 100+ shuls (mix of manual adds + GoDaven bootstrap)
- ✅ Working: weekly Inngest scrape has run for 2+ consecutive weeks without manual intervention
- ✅ Validated: 3-5 real daveners have successfully used it to find a minyan

---

## 9. What changes vs. sprint 1

Sprint 1 built a static directory at `/`, `/shul/[slug]`, `/shul/[slug]/print` with 30 ShulCloud shuls and 503 minyanim. Most of this becomes:

- **Keep**: ShulCloud extractor (`lib/scrapers/`), database connection layer, Drizzle setup, Tailwind theme, deployment config.
- **Migrate**: `db/schema.ts` — sprint-1 `shul`/`minyan` shape → new `shul`/`data_source`/`minyan_rule`/`scrape_run` shape with PostGIS. Write a forward migration that preserves the 503 existing minyanim.
- **Rebuild**: home page (`app/page.tsx`) — from static list to geolocated feed. Shul detail page — adapt to new rule resolution. Print page — defer to Phase 2 (low priority for the new product).
- **New**: submission form, admin queue UI, LLM schema-builder, Inngest functions, PostGIS migration, PWA shell, zmanim integration, observability wiring.

---

*This document is the durable scope record. Update inline rather than start fresh if scope shifts.*
