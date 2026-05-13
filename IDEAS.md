# tfila.co — Ideas

Parking lot for ideas that are out of MVP scope but worth not losing. Anything in here is **not** committed work — promote to `SCOPE.md` or build directly if and when we decide to do it.

**Conventions:**
- New entries go to **Triage**. When we decide on it, move to Phase 2 / Phase 3 / Investigate / Killed.
- Each entry: one-line idea + (optional) **Why** / **Cost**.
- Don't add things already in `SCOPE.md` here — that's the committed plan.

---

## Triage (new, undecided)

### Vision-extractor confidence calibration on real shul images (2026-05-13)

Vision tier (`lib/llm/extract-vision.ts`) defaults to Sonnet 4.6 with a confidence-calibration prompt tuned for "typed schedules" vs "handwritten / stylized fonts". Hasn't been exercised on a real shul image end-to-end yet — anash.ca/daven would be the first test once the cascade reaches the image. Worth checking: does Sonnet over-extract from a stylized typography? Does it correctly skip non-schedule images (donation flyers, banners)? Once we have ~5 real vision extractions, look at confidence vs. rule-correctness to decide if the prompt needs adjustment.

### JS-injected image src — anash.ca/daven pattern (2026-05-13)

anash.ca/daven has `<img id="daven-image" src="" />` in the static HTML — the src is populated by JS after page load. Browserless rendering should populate it, but `findImageCandidates` in `cascade.ts` filters images by `src` keywords AND by alt/id/class containing schedule terms. The image's id IS `daven-image` which matches "daven", so it should rank well — but only IF the rendered HTML has the populated src. **Untested.** Tomorrow: run `debug-cascade.ts https://anash.ca/daven` after the PDF-scan fix lands, see whether vision tier finds the image.

### Email-inbound vendor pick (2026-05-12, shelved mid-PR-11)

**Status**: PR 11 app-code is shipped (webhook, Inngest function, LLM extractor, `/submit` UI). Postmark setup blocked because Postmark won't let us configure inbound on a public/free-email domain (`@gmail.com` etc). We need to pick + wire one of these vendors before the email flow goes live:

- **Option A — Postmark bare hashed inbound address** (`<hash>@inbound.postmarkapp.com`): zero DNS, immediate, ugly address.
- **Option B — Postmark on `inbound.tfila.co`** (preferred, we own tfila.co): one MX record on tfila.co's DNS → Postmark. Result: `submit@inbound.tfila.co`.
- **Option C — Cloudflare Email Routing + Workers**: free, custom domain, slightly different code path (Workers, not Postmark JSON webhook).

**Code already deployed**, just inert until a webhook fires it:
- `app/api/inbound/email/route.ts` — accepts Postmark-shaped JSON, HTTP Basic auth via env, fires Inngest event
- `lib/inngest/functions/process-email.ts` — finds/creates shul, runs LLM extract, persists rules
- `lib/llm/extract-email.ts` — email-tuned extractor
- `lib/inbound/extract-original-sender.ts` — heuristic for forwarded "From:" line
- `app/submit/page.tsx` — UI shows the inbound address (hardcoded `submit@inbound.tfila.co`, swap after pick)

**Tied to env vars** (production):
- `POSTMARK_INBOUND_USERNAME` + `POSTMARK_INBOUND_PASSWORD` — optional HTTP Basic auth; if unset, webhook accepts unauthenticated POSTs (fine for dev; production should set these)
- If switching to Cloudflare: ditch the Postmark-shaped JSON; either build a Workers-side adapter or have the Worker POST the same shape

**To resume**: pick A/B/C, sign up + configure, paste the webhook URL `https://tfila.vercel.app/api/inbound/email`, optionally add Basic Auth creds to Vercel, update the hardcoded `INBOUND_ADDRESS` in `app/submit/page.tsx`, redeploy.

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
