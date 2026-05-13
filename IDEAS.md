# tfila.co — Ideas

Parking lot for ideas that are out of MVP scope but worth not losing. Anything in here is **not** committed work — promote to `SCOPE.md` or build directly if and when we decide to do it.

**Conventions:**
- New entries go to **Triage**. When we decide on it, move to Phase 2 / Phase 3 / Investigate / Killed.
- Each entry: one-line idea + (optional) **Why** / **Cost**.
- Don't add things already in `SCOPE.md` here — that's the committed plan.

---

## Triage (new, undecided)

### Vision-extractor confidence calibration on real shul images (2026-05-13)

Vision tier (`lib/llm/extract-vision.ts`) defaults to Sonnet 4.6. **Now has one real data point**: theshul.org's `Times-Bamidbar5786.png` was extracted successfully (rules + reasonable confidence). Still pending: anash.ca/daven test + ~3-5 more vision extractions before we can assess prompt quality. Worth checking: does Sonnet over-extract from stylized typography? Does it correctly skip non-schedule images (donation flyers, banners)? Revisit prompt once we have ~5 vision extractions.

### Email-inbound vendor pick (2026-05-12, **decided 2026-05-13: Option C — Cloudflare Email Routing + Workers**)

**Decision**: Option C (free at any volume — cost-conscious bootstrap call). Code shipped in `cloudflare-worker/` directory; see [`cloudflare-worker/README.md`](./cloudflare-worker/README.md) for the end-to-end setup walkthrough.

Worker has a Postmark-compatible adapter — POSTs Postmark-shaped JSON to the main app's existing `/api/inbound/email` endpoint with HTTP Basic Auth. No tfila.co code changes needed; the webhook receiver doesn't know it's talking to Cloudflare instead of Postmark.

**Pending user-side setup** (~15 min one-time, see Worker README):
1. Cloudflare Email Routing on `tfila.co` (or `inbound.tfila.co`)
2. `npx wrangler login` + `npx wrangler secret put` for `WEBHOOK_URL` / `WEBHOOK_USER` / `WEBHOOK_PASS`
3. Mirror `WEBHOOK_USER` / `WEBHOOK_PASS` to Vercel as `POSTMARK_INBOUND_USERNAME` / `POSTMARK_INBOUND_PASSWORD`
4. `npx wrangler deploy`
5. Wire the Email Routing rule `submit@tfila.co → tfila-inbound-email` in the Cloudflare dashboard

**Why C over B (Postmark on tfila.co subdomain):**
- Free at any volume (Cloudflare) vs ~$15/mo (Postmark)
- Same end-user address (`submit@tfila.co`)
- Cost-conscious bootstrap stage; vendor change is reversible (just turn off the Worker and configure Postmark)

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
