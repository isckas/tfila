# tfila.co — Ideas

Parking lot for ideas that are out of MVP scope but worth not losing. Anything in here is **not** committed work — promote to `SCOPE.md` or build directly if and when we decide to do it.

**Conventions:**
- New entries go to **Triage**. When we decide on it, move to Phase 2 / Phase 3 / Investigate / Killed.
- Each entry: one-line idea + (optional) **Why** / **Cost**.
- Don't add things already in `SCOPE.md` here — that's the committed plan.

---

## Triage (new, undecided)

### Admin flow simplification (2026-05-14)

Admin pipeline now spans `/admin/candidates`, `/admin/queue`, `/admin/shuls`, `/admin/shul/[slug]`, and `/admin/data-source/[id]`. Each page works in isolation but together they don't read as one coherent workflow — the candidate → shul → extraction → review → activate lifecycle isn't visible from any single page. Options: (a) unified pipeline view (one page, one row per shul, current stage + next action), (b) merge candidates into queue with stage-aware filtering, (c) keep separate but add cross-links and a top-of-page "shul in stage X — do Y next" banner. Worth ~half day of UX work; user explicitly flagged.

### Auto-approve heuristic for high-confidence candidates (2026-05-14)

Discovery returns 20-30 candidates per Crown-Heights-density target. Admin clicks through one by one. Many are obvious-approve: name contains "Synagogue" or known shul keyword, types include `synagogue`, has a website. Heuristic: if (types contains `synagogue`) AND (name passes a regex like `/synagogue|shul|chabad|congregation|bais|beth/i`) AND (`website_uri` present and on a non-shared domain) → auto-approve, skip admin queue. Risk: false positives on non-Orthodox shuls we don't want. Mitigate by requiring an explicit admin opt-in per target (toggle on the discovery picker).

### Sub-region tiling for dense Orthodox enclaves (2026-05-14)

Places Text Search v1 caps at 20 results per call. Lakewood / Boro Park / Flatbush each have hundreds of shuls. A single 2.5km query returns 20 — we're missing 80%+. Solution: sub-tile dense targets into 4 or 9 smaller bounding boxes, run each separately. Cost: 4-9× Places calls per dense target = ~$0.30-0.70 vs $0.10 currently. Worth it for the bulk of NA daveners.

### Directory crawl scrapers (approach B from the discovery discussion)

Once the Places-seeded pipeline (approach A) is humming, add per-source crawlers for Chabad.org/centers, OU shulfinder, Star-K kosher establishment list (kosher proxy → likely shul nearby), local Vaad sites. Each scraper drops into the same `shul_candidate` table with `source` ≠ `'google_places'`. Useful for Chassidish / non-mainstream enclaves Places misses.

### Vision-extractor confidence calibration on real shul images (2026-05-13)

Vision tier (`lib/llm/extract-vision.ts`) defaults to Sonnet 4.6. **Now has one real data point**: theshul.org's `Times-Bamidbar5786.png` was extracted successfully (rules + reasonable confidence). Still pending: anash.ca/daven test + ~3-5 more vision extractions before we can assess prompt quality. Worth checking: does Sonnet over-extract from stylized typography? Does it correctly skip non-schedule images (donation flyers, banners)? Revisit prompt once we have ~5 vision extractions.

### Cloudflare proxy may need to evolve (2026-05-14)

Today the proxy fires only on 403/406. Some anti-bot systems serve a 200 with a Cloudflare interstitial / JS challenge HTML body (not a 403). Our pattern matches schedule keywords + time-like content, so interstitial pages get caught by the cascade's "0 rules / low confidence" → extract_failed path — but they don't trigger the proxy retry. Future fix: heuristic to detect interstitial HTML (length < 5KB, contains "checking your browser" / "DDoS protection" / `cf-mitigated` header) and trigger proxy retry on those too.

---

## Phase 2 candidates (from SCOPE.md)

- Email-newsletter source: Postmark Inbound → Inngest `email.received` → LLM extract → rule diff. Subscription = gabbai adds unique address manually.
- **Torah-study sidebar with Sefaria links** (promoted 2026-05-11): parsha, daf yomi, mishna yomi, halacha yomi, nach yomi. Built on `@hebcal/core` + Sefaria URL conventions.
- Nusach/style tags on shuls and per-minyan
- Multi-day Shabbos planning view
- Inline walking directions (vs. linking out to Google Maps)
- Auto-detect "this week's special schedule" sections during scrape
- Shul claim/edit flow (only if shuls actually ask for it)
- Confidence-gated auto-publish for very-high-confidence LLM configs

## Phase 3 candidates (from SCOPE.md)

- **R2/S3 raw I/O archive** (deferred from PR 3, 2026-05-11): SCOPE.md called for archiving raw HTML + raw LLM input/output to R2 so we can re-process when prompts improve. Skipped in PR 3 to keep scope tight and avoid the AWS SDK dependency. Cost of deferral is small — page content hash is already on data_source, so we can re-fetch when needed; what we lose is the exact LLM I/O used at extraction time. Worth adding once we have ~100+ extractions and want to A/B prompt versions offline.
- Push notifications ("minyan at your usual shul in 15 min")
- User accounts + saved favorite shuls
- Crowdsourced flag-wrong-time
- Auto-subscribe to mailing lists via headless form-fill
- Davener-forwarded emails ("forward your shul's weekly email to submit@tfila.co")
- Public API for other Jewish apps
- Monetization (sponsorship / premium)
- Upstash Redis edge cache for geo-bucket queries (when QPS warrants)
- Neon read replicas / branching for read/write split
- Edge runtime for `/` (global latency)
- Postgres trigram + GIN index for shul-name search

## Investigate (need evidence / experiment)

- Zmanim edge-case validation for northern latitudes (Toronto, UK). `kosher-zmanim` claims correctness; verify on a real shul before trusting broadly.
- Inngest free-tier limits at our projected weekly-scrape volume (currently fine at 30 shuls; revisit at 500+).
- Whether daveners actually want nusach filters at MVP, or it's a Phase 2 nice-to-have. Resolve by watching beta-user behavior.

## Killed (decided not to do)

- Native iOS/Android apps — PWA is the call.
- Conservative/Reform-specific feature work — we accept their data via the generic pipeline but won't build for their patterns.
- Halacha lookups + kaddish lists — out of scope (note: parsha/daf-yomi sidebar was *promoted into scope* 2026-05-11, but full Halacha browsing remains out).
- Trademark / USPTO search — skipped per scoping.
- `no_url` shul status — briefly added 2026-05-14 to track candidates approved without a URL, removed same session (migration 0007). Product call: tfila.co only publishes shuls with live times, so a tracking row without times shouldn't exist; approve flow requires a URL.

## Built (promoted out of triage)

- **Email-inbound vendor pick** (decided 2026-05-13: Cloudflare Email Routing + Workers). Worker deployed 2026-05-14 at `https://tfila-inbound-email.tfila.workers.dev`. Free at any volume. Inbound flow verified end-to-end on real shul forwards.
- **Discovery system** (approach A from "design a scraper to find shuls" discussion). Built 2026-05-14 — see FEATURES.md "Discovery: Places-seeded candidate queue" + "Discovery: schedule-page resolver".
- **Anti-bot fetch fallback** (Cloudflare Worker proxy). Built 2026-05-14 — see FEATURES.md "Fetch fallback via Cloudflare Worker proxy". Validated against Chabad.org-hosted sites that 403 Vercel outbound.
