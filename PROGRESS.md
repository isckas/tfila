# tfila.co — Progress

Rolling build log. **Latest at top.** Update after every meaningful work session.

**Convention:** each entry is dated. Mark in-progress with ⏳, done with ✅, blocked with 🚫.

Three sections:
- **Now** — what's actively being worked on
- **Done** — finished slices, in reverse chronological order
- **Blocked / Needs decision** — things waiting on something

---

## Now — next session

**Last working session: 2026-05-14 (long night — full-stack code review + 17 fix commits).**

See **[SESSION.md](./SESSION.md)** for the canonical pickup doc — it's the most up-to-date snapshot of state, what to verify post-deploy, and where the seams are.

### Decided + designed, ready to build (or: think about)

- **Same-origin URL fallback only runs in HTML tier** — deferred refactor. JS-rendered, PDF, and Vision tiers don't try `/worship/shabbat`, `/services`, etc. Less urgent since the schedule-page resolver routes URLs to the right page before the cascade.
- **Vision-extractor calibration** — need ~5 more real vision extractions to assess prompt quality on stylized typography.
- **API error-response convention via `lib/http.ts`** — touches every route; deferred from the code-review night. Convention: form POST → 303 redirect with `?err=`; JSON POST → JSON response. Today the three styles are mixed.
- **Per-IP rate limit on `/submit`** — best done at the Vercel WAF level, not in code. Current per-domain cooldown handles the most common spam shape.

### Deferred build-stage cleanup (do once project is stable)

Per [[feedback-security-cleanup-deferred]]: don't surface credential rotation here while we're in build mode.

### Still pending user-side setup (not new)

- **Anthropic Auto-Reload + monthly cap** — recommended after the cascade work bumped per-extraction cost ~10×. The 2026-05-14 hash bug fix should reduce weekly cron LLM spend dramatically (was paying for full extraction every Saturday on every shul).

---

## Done

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
