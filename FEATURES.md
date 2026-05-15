# tfila.co — Features

Feature design + decision doc. Each section describes a single feature or concern: what exists today, what's broken or unhandled, possible approaches, and the chosen direction (when decided).

### How this differs from the sibling docs

| File | Purpose | Granularity | Lifecycle |
|---|---|---|---|
| [SCOPE.md](./SCOPE.md) | What tfila.co is and isn't, locked | Whole product | Edited rarely |
| [IDEAS.md](./IDEAS.md) | Parking lot — "maybe someday" | One-line entries | Most never leave |
| **FEATURES.md** | Designs with open choices we *will* build | Per-feature with options + tradeoffs + decision | Decided → built → archived |
| [PROGRESS.md](./PROGRESS.md) | Rolling build log | Per-PR / per-day | Append-only |
| [CHANGELOG.md](./CHANGELOG.md) | Day-versioned release log for admin | Per-version | Auto-bumped at midnight ET |
| [STYLE.md](./STYLE.md) | UX north star | Project-wide rules | Edited rarely |

**Lifecycle of an idea → feature → ship:**

1. **IDEAS.md** — new idea captured as one line. Most stay here forever.
2. **FEATURES.md** ← this file — we decide to do it, write a full design entry with options + tradeoffs.
3. **Pick an option** — annotate the entry with the decision.
4. **PROGRESS.md** — implementation logged as commits land.
5. **CHANGELOG.md** — when the day rolls over, the cron grabs the commits into a new version entry that the admin sees.

So: IDEAS is "free-form notes I don't want to lose"; FEATURES is "I'm about to build this and need to think clearly first." After building, the FEATURES entry stays as the historical decision record.

---

## Deduplication: same shul, different submissions

Added: 2026-05-13 · **Decision: Option A (registrable-domain dedup), 2026-05-13. Built 2026-05-13.**

**Built with the auto-merge + admin Split escape hatch.** New submissions whose registrable domain (eTLD+1) matches an existing shul auto-attach as a new `data_source` under that shul. If the merge was wrong (e.g. shared hosting), admin clicks "Split into separate shul" on the data_source row to undo.

**Question:** When two people submit the same shul through different channels, how do we recognize them as the same shul and avoid creating duplicate rows?

### Current behavior

**URL submissions** ([`app/api/submit/route.ts:41-48`](./app/api/submit/route.ts)):
```ts
const existing = await db
  .select({ id: shul.id })
  .from(shul)
  .where(eq(shul.submittedUrl, url))
  .limit(1);
if (existing[0]) return fail(req, "duplicate");
```
Dedupes by **literal string match** on `shul.submittedUrl`. Returns "duplicate" error to the user when the exact submitted string already exists.

**Email forwards** ([`lib/inngest/functions/process-email.ts:100-118`](./lib/inngest/functions/process-email.ts)):
```ts
const existing = await tx
  .select(...)
  .from(dataSource)
  .where(and(
    eq(dataSource.kind, "email_newsletter"),
    eq(dataSource.identifier, originalSenderEmail),
  ));
if (existing[0]) { /* reuse */ } else { /* create new shul + data_source */ }
```
Dedupes by **literal email match** on `data_source.identifier`. Existing sender → reuse the shul + refresh rules. New sender → creates a new shul.

### What slips through today

**URL → URL collisions** (creates duplicate shuls):
- `https://theshul.org` vs `https://www.theshul.org/` vs `http://theshul.org`
- `https://theshul.org/calendar` vs `https://theshul.org/services` (same shul, different schedule pages)
- `https://theshul.org` vs `https://theshul.org/` (trailing slash)

**Email → Email collisions** (creates duplicate shuls):
- `bulletin@theshul.org` vs `weekly@theshul.org` (different gabbais sending the same shul's emails)
- `gabbai+filter@theshul.org` vs `gabbai@theshul.org` (Gmail subaddressing)
- `Bulletin@theshul.org` vs `bulletin@theshul.org` (case sensitivity — *currently both match because Postgres `eq()` on text is case-sensitive*; we'd need explicit `lower()` to fix)

**Cross-channel collisions** (URL ↔ Email — neither dedup path sees the other):
- Davener submits `https://theshul.org` → shul row #1
- Different davener forwards email from `gabbai@theshul.org` → shul row #2
- Both rows exist, neither linked

**Places-found duplicates** (future, when Places address backfill matches):
- Two submissions hit the same Google Places `place_id` after backfill, but neither shul stored the placeId so we don't notice they're the same physical location.

### Options ranked

#### A. Dedupe by registrable domain across both channels (Recommended)

Use the `tldts` library (already in dependencies — `lib/tld.ts`-style) to extract the eTLD+1 from URLs AND from email domain parts. Single column on `shul`: `match_domain` (e.g. `theshul.org`). Both submission paths check + populate it.

- URL `https://www.theshul.org/calendar` → match_domain `theshul.org`
- Email `bulletin@theshul.org` → match_domain `theshul.org`
- Both collide → reuse the existing shul, add the new submission as an additional `data_source`

**Pros:** catches most real-world collisions (URL↔URL, Email↔Email, URL↔Email). Cheap to implement. One column + one helper function.
**Cons:** false-positive risk — two shuls share a registrable domain in rare cases (shared hosting). E.g. `chabad.org` and many community sites under it would all collapse to `chabad.org`. Need an opt-out / admin "split" affordance.

#### B. Multi-signal fuzzy match with admin review

For each new submission, compute a similarity score against existing shuls based on: domain match, name token overlap (after LLM extracts the name), address proximity (after geocoding), Place ID match. Above a threshold → auto-merge. Below threshold but non-zero → flag for admin review with side-by-side comparison.

**Pros:** highest precision; handles edge cases like shared hosting cleanly.
**Cons:** complex to build and reason about. Requires the LLM extraction to have already run before we can score. Adds admin queue churn.

#### C. Hostname-only match for URL, normalized email for email, no cross-channel

Minimal change: normalize URL host (lowercase, strip www., strip protocol, strip path) when dedup-checking. Normalize email (lowercase, strip Gmail subaddressing) when checking. Don't cross-link URL submissions and email submissions.

**Pros:** simplest; minimal risk of false-positive merges.
**Cons:** still misses cross-channel cases (URL submission + email submission for same shul). User still ends up with both showing in the feed.

#### D. Status quo + admin merge tool

Keep the current literal-string dedup. Add an admin action: "Merge shul B into shul A". Manual cleanup as duplicates surface.

**Pros:** zero engineering until duplicates actually become a problem.
**Cons:** reactive; admin has to actively monitor for duplicates; user-facing feed shows duplicates until merged.

### Edge cases to handle in any approach

- **Same shul, multiple physical locations** (rare but real: branches in different cities). Should NOT collapse just because they share a domain. Solution: keep them as separate shul rows, link via a `parent_shul_id` if needed.
- **Catering one address from multiple weekly bulletins** (one shul, two newsletters: a weekly schedule + a special Yamim Tovim bulletin from a different sender). Same shul, two email senders, both legitimate sources. Solution: each email sender becomes a separate `data_source` under the same shul.
- **Submission of a re-extract URL after a shul moved domains**. E.g. `oldname.org` (in DB) → resubmit as `newname.org` (current). Should produce a duplicate warning + admin tool to migrate the existing data_source to the new domain.

### Decision

**Option A — registrable-domain dedup across both channels.** Decided 2026-05-13. Not yet built.

Open sub-question (to resolve before building): the false-positive escape hatch. Either (1) auto-merge on domain match + admin "split" action to undo, or (2) flag-as-likely-duplicate on the new submission and require admin click-through to merge. The doc currently leans toward (1) auto-merge + admin split, but (2) is safer for the shared-hosting edge case (e.g. many community sites under `chabad.org`).

### Amendment 2026-05-13: shared-MTA correction (email path)

**Bug found in production.** The original Option A built the email path keying `match_domain` off the **sender's** email domain. But many shuls forward through a shared mailing-list service (MyShul, Mailchimp, Constant Contact, etc.) — every shul on that platform ends up with the same `match_domain` (e.g. `myshul.com`), so the *next* forward silently wrong-merges into the *first* shul on that platform. Discovered when a forwarded MyShul email for Edmond J. Safra Synagogue landed with `match_domain = "myshul.com"`.

**Fix (built 2026-05-13).** Email path now keys dedup off the *shul's own website*, not the sender:
1. LLM extraction prompt asks for `shulWebsite` (new optional field in `ExtractionSchema`).
2. Regex fallback in `lib/inbound/extract-website.ts` scans the body for non-tracking, non-MTA, non-image URLs when the LLM didn't return one.
3. If neither finds a usable URL, `match_domain` stays NULL (no dedup) — safer than wrong-merging.
4. `data_source.identifier` becomes compound (`info@myshul.com::edmondjsafrasynagogue.com`) when the sender is on the shared-MTA denylist, so two different shuls on the same MTA still get separate `data_source` rows.
5. The shared-MTA denylist (`SHARED_MTA_DOMAINS` in `lib/inbound/extract-website.ts`) covers shul-specific platforms (myshul.com), generic ESPs (mailchimp, sendgrid, constantcontact, mailerlite), generic mail providers (gmail, yahoo, outlook), and social/shortlinks.
6. `/api/admin/backfill-match-domain` updated with the same denylist check, so re-running backfill never re-introduces a shared-MTA value.
7. `/api/admin/null-mta-match-domain` (new POST) nulls existing rows that were poisoned with a shared-MTA value.

URL submission path is unchanged — `match_domain` from URL is correct by construction.

### Implementation plan (when ready to build)

1. **Schema**: add `shul.match_domain` (varchar 253, indexed)
2. **Backfill**: compute match_domain for existing rows
3. **URL submission path** (`app/api/submit/route.ts`): extract eTLD+1 from submitted URL via `tldts`, dedupe by it
4. **Email submission path** (`lib/inngest/functions/process-email.ts`): extract eTLD+1 from sender domain, dedupe by it
5. **Cross-link**: when a new submission's match_domain hits an existing shul, attach as an additional `data_source` under the same shul instead of creating a new shul
6. **Admin "split" tool**: if two shuls were incorrectly merged, admin can split them apart

Each step is small and independent. Could ship across 3 PRs (schema + backfill / submission paths / admin tool) or one if we have a quiet day.

---

## Unified post-ingestion pipeline: URL and email paths must do the same work

Added: 2026-05-13 · **Status: BUILT 2026-05-14 across PR1-PR3 (commits `6a61431`, `9fbcbbb`, `5889428`). Email path now respects guardrails — bug found in design retroactively fixed.**

**Principle:** Submission channels are an ingestion concern, not a processing concern. Whether a shul reaches us via URL submit, forwarded email, or any future channel (claimed shul, public API, mailing-list subscribe), every step *after* the raw data is in hand must be identical. The channel only owns "how the bytes arrive"; everything else — extraction, dedup, address backfill, persistence, guardrails, admin treatment — runs through one shared pipeline.

### Why

Today the two channels run divergent code paths in `lib/inngest/functions/build-data-source.ts` (URL) and `lib/inngest/functions/process-email.ts` (email). Each one re-implements similar logic — slug allocation, name/address preference rules, data_source insertion, configJson shape — and they've already drifted on at least three things (address backfill, identifier collision handling for shared MTAs, dedup-merge semantics for new vs existing shuls). The Safra forward (shul id=59) made this concrete: 12 rules extracted, 0.88 confidence, but no `shul.address` and no `shul.location` because the email path skips Places backfill. Email-derived shuls are second-class on the home-page geo feed, the OpenStreetMap embed, and any distance-sort query.

Every new feature we add to one path is at risk of forgetting the other. The fix is structural, not "remember to add it both places."

### Current divergences (audit, 2026-05-13)

Run side-by-side in `build-data-source.ts` vs `persistFromEmail()`:

| Concern | URL path | Email path |
|---|---|---|
| LLM extraction call site | After cascade picks a winning tier | Direct on body text |
| Same-origin URL fallback (`/calendar` → `/services` etc.) | Yes (HTML tier only) | N/A — no URL to fall back from |
| `findShulPlace()` Places backfill at confidence ≥ 0.7 | Yes | **No** ← blocks geo queries |
| Hash-comparison shortcut on rescrape | Yes | N/A — emails are push, no rescrape |
| Broken-config guardrails (confidence < 0.6 OR 50%+ rule-count drop flags as pending) | Yes | **No** ← bad week's email could wipe rules silently |
| Slug-collision allocation loop | Yes (inlined in /api/submit) | Yes (inlined in process-email.ts) ← duplicated |
| `cfg.cascade_attempts` audit trail | Yes | **No** — emails get `cfg.last_model` / `cfg.last_usage` instead |
| `match_domain` source | Submitted URL eTLD+1 | LLM-extracted shulWebsite (or regex fallback) |
| `data_source.identifier` shape | Submitted URL | Sender email (or compound `email::domain` for shared MTAs) |
| Priority | 40 (website_llm) | 60 (email_newsletter) |
| Rule-replacement semantics | Replace all "live" rules per data_source on rescrape | Regular rules REPLACE, special rules ADD |

Some of these are legitimate channel differences (LLM input shape, identifier shape, priority). Others are *accidental* divergences (Places backfill, guardrails, audit trail) that should converge.

### Target architecture

```
INGESTION (per channel — small, channel-specific)
  ├── URL: fetch cascade → produce { extractedText, sourceUrl, ... }
  └── Email: parse forward → produce { extractedText, sourceEmail, shulWebsite?, ... }

NORMALIZATION
  Each channel emits a uniform "submission payload":
  { rawText, rawHash, sourceKind, identifier, matchDomainHint?, ...channelMetadata }

SHARED PIPELINE (one implementation, called by both)
  1. LLM extract → name, address, website, rules, confidence, reasoning
  2. Dedup: lookup by match_domain → merge into existing shul OR create new
  3. Slug allocation (existing helper, called once)
  4. Persist shul row (preferring LLM-extracted name > channelMetadata > derived defaults)
  5. Persist data_source row (with channel-appropriate identifier + priority + configJson)
  6. Persist rules (with channel-appropriate replace-vs-add semantics)
  7. Address backfill via findShulPlace() if shul.address is null AND confidence ≥ 0.7
  8. Broken-config guardrails (flag as pending_review on confidence/rule-count anomalies)
  9. Admin notification (already shared via notifyAdmin())

ADMIN SURFACE
  Already unified — /admin/queue, /admin/shul/[slug], /admin/data-source/[id]
  treat both channels identically. No change needed.
```

The shared pipeline lives in a single function, probably `lib/pipeline/persist-submission.ts` or expanded into a new `lib/extraction/` module. Both Inngest functions call it after their channel-specific ingestion completes.

### Implementation sketch (when ready to build)

This is bigger than a single PR. Stage it:

1. **Extract `findShulPlace()` backfill into a reusable helper** — `lib/geocoding.ts` → `backfillShulLocation(tx, shulId, name, urlHint)`. Currently inlined in `build-data-source.ts`. Cheapest win — call from email path immediately, even before deeper refactor.
2. **Extract slug-collision-avoidance** into `lib/slug.ts` → `allocateUniqueSlug(tx, baseSlug)`. Currently duplicated across `/api/submit/route.ts` and `process-email.ts`.
3. **Extract broken-config guardrails** into `lib/pipeline/guardrails.ts` → `applyExtractionGuardrails(prevConfidence, prevRuleCount, newExtraction)` returning `{ shouldFlagPending, reason }`.
4. **Extract the shared persist body** into `lib/pipeline/persist-submission.ts` → `persistSubmission(tx, normalizedPayload, extraction)`. Returns `{ shulId, dataSourceId, isNewShul, rulesAdded, rulesRemoved }`.
5. **Rewrite `build-data-source.ts`** to call the shared persist after the cascade. Channel-specific work shrinks to: fetch + cascade + (optional same-origin fallback) + build normalizedPayload.
6. **Rewrite `persistFromEmail()`** to call the shared persist. Channel-specific work shrinks to: extract original-sender + compute compound identifier for shared MTAs + build normalizedPayload.
7. **Add address backfill + guardrails to email path automatically** as a side effect of step 6 (since they're now in the shared helper).

After this, adding a new submission channel = implement ingestion + emit a normalizedPayload. Everything downstream is free.

### Edge cases the shared pipeline must handle correctly

- **Email creates first, URL second.** First email creates a shul with no address (no backfill ran because confidence was, say, below 0.7). Later, a URL submission domain-merges into the email-created shul. The URL path's persist call should: detect `shul.address IS NULL`, run backfill with the URL as hint, populate the address. Means backfill check is "if shul.address is null", not "if isNewShul".
- **URL creates first, email second, with conflicting names.** URL extraction returned "The Shul of NYC". Email extraction returns "Edmond J. Safra Synagogue" for the same `match_domain`. The shared persist must NOT overwrite an admin-approved name. Use the existing `build-data-source.ts:288` guard pattern: only update name when current value looks like a placeholder (matches hostname OR contains a `.`).
- **Rule replacement semantics differ.** URL: all live rules under that data_source get replaced on rescrape. Email regular rules: replace within the same data_source. Email special-schedule rules: ADD (date-bounded). Shared persist should accept a `ruleReplacementStrategy: "replace-all" | "replace-regular-add-special"` flag from the caller.
- **configJson shape.** URL stores `cascade_attempts`. Email stores `last_subject`, `last_model`, `last_usage`. The shared persist accepts an opaque `configJsonExtras` from the caller and merges it. The shared pipeline owns common fields (`version`, `prompt_version`, `first_received_at`, `last_received_at`).

### Cost / scope note

Places Text Search v1 is paid (~$0.032/call after free tier). The 0.7-confidence floor keeps the email-path cost contained. Adding backfill to email-path roughly doubles Places calls in steady state if half of submissions arrive via email. Probably worth it for full geo coverage, but worth monitoring once shipped.

Estimated effort: 1-2 days of focused work for the full refactor (steps 1-7). Step 1 alone (extract `backfillShulLocation`, call from email path) is ~30 minutes and unblocks the most visible symptom — the Safra address gap. Reasonable to ship step 1 immediately as an unblocker and tackle the larger unification when there's a quiet day.

### Decision

**Principle locked 2026-05-13:** every new feature added to either path must either (a) live in the shared pipeline, or (b) be explicitly justified as a channel-specific concern. No more silent drift.

**Build order:**
- ~~**Now (~30 min):** Step 1 only — factor `backfillShulLocation` out and call from email path.~~ **Shipped 2026-05-14 (commit `6afdcbb`).** Email-derived shuls now get Places address backfill alongside URL-derived ones.
- **Soon (1-2 days):** Steps 2-7, the full unification — still pending.

Two follow-ups in scope of the unification:
- `app/api/admin/shul/[id]/extract/route.ts:215-241` still has a third inline copy of the Places-backfill logic. Same 5-line swap to call the new helper.
- Slug allocation is duplicated in `app/api/submit/route.ts`, `process-email.ts`, and `app/api/admin/candidate/[id]/approve/route.ts`. Step 2 of the staged refactor.

---

## Discovery: Places-seeded candidate queue

Added: 2026-05-14 · **Built 2026-05-14.**

**Question:** Most shul submissions today come from a davener pasting a URL. Coverage of any given neighborhood is partial — we have whoever happened to submit. How do we proactively find shuls in dense davener-population areas?

### Built solution

Approach **A** of the discussion (Places-seeded discovery + admin triage) — implemented end-to-end this session.

**Data sources:**
- `docs/discovery-targets.md` — human-readable ranked list (88 geographies) with davener counts, center coordinates, radius, query variants.
- `data/discovery-targets.json` — machine-readable mirror; runtime source of truth for the discovery script. Tier 1 / Tier 2 / Europe / Travel destinations.

**Schema:** (migration 0005)
- `shul_candidate` — messy bucket. `place_id` UNIQUE for natural dedup across re-runs. `raw_response_jsonb` preserves Google's full response. `review_status` enum: `pending` | `approved` | `rejected` | `duplicate` | `deferred`. No DELETEs — rejected rows function as a denylist on subsequent discovery runs.
- `discovery_run` — audit log per Places API call (target, query, result count, candidates new/dup, error).

**Discovery trigger:**
- `POST /api/admin/discovery/run` — admin-clicked from a picker on `/admin/candidates`. Reads `GOOGLE_GEOCODING_API_KEY` server-side (key never leaves Vercel env). Runs ~2-3 Places Text Search queries per target (~$0.10/run).
- `scripts/run-discovery.mjs` — CLI alternative for batch runs against a region or tier.

**Admin triage flow** (`/admin/candidates`):
- Status filter pills + target dropdown + URL-presence filter.
- "Recently approved · last 24h" section shows each shul's current extraction state without page-hopping.
- **Approve** requires a URL — Places-returned OR admin-pasted via the popover form's `urlOverride` field. No "approve without URL" path; tfila.co only lists shuls with live times. Approve creates the shul row + queues extraction. Redirects to `/admin/shul/[slug]` to watch extraction land.
- **Reject** with required reason — row preserved.
- **Dedup-merge** when candidate's domain matches an existing shul: candidate marked `duplicate`, existing shul's null `address` + `location` get backfilled from the Places candidate.

### Validation

First production run (Crown Heights, Brooklyn): ~30 candidates returned, ~15 approved into the extraction pipeline, ~10 rejected (chabad-house ≠ shul, Reform temple, etc.). Cost: ~$0.20.

### Next iterations

- Auto-approve heuristic for high-confidence candidates (`types` contains `synagogue` + Places name fuzzy-matches an Orthodox keyword) to reduce per-candidate clicking.
- Sub-region tiling — for very dense areas (Boro Park, Lakewood), single 2.5km radius hits the Places 20-result cap. Split into 2x2 or 3x3 sub-bounding-boxes.
- Directory crawl scrapers (approach B from the original discussion) as a complement — Chabad.org's centers directory, OU shulfinder, local Vaad lists. Drop into same `shul_candidate` table with `source` ≠ `'google_places'`.

---

## Discovery: schedule-page resolver

Added: 2026-05-14 · **Built 2026-05-14.**

**Question:** Google Places returns a shul's root URL (e.g. `jewishwindsorterrace.org`), but the actual minyan schedule lives on a sub-page — often opaque (`/templates/articlecco_cdo/aid/2710598/jewish/Times-and-Schedule.htm` on ShulCloud-hosted sites). Submitting the root URL to the extraction cascade misses the schedule entirely.

### Built solution

`lib/discovery/find-schedule-page.ts` → `resolveScheduleUrl(rootUrl)`. **Hybrid strategy** with three fallback tiers; returns a resolved URL + confidence + via-tier audit. Called from both `/api/admin/candidate/[id]/approve` and `/api/submit` so all URL-entry-points resolve once before persisting.

1. **Pattern try** — fetch ~15 common schedule paths (`/schedule`, `/times`, `/minyan`, `/davening`, `/worship/shabbat`, `/tefilla`, `/shabbos`, etc.) with HEAD-then-GET; require the page to contain schedule keywords **AND** time-like strings, so a generic `/services` about-page doesn't false-positive. Free.
2. **Page link scan** — cheerio-parse the root page; scan same-origin links where text OR href matches the schedule keyword regex. Free.
3. **LLM scout** — sample up to 80 same-origin links from the root page, hand them to Claude Haiku 4.5 with a focused prompt ("which link is most likely the minyan schedule?"). Model returns the chosen href; validated against the offered list (no hallucinated URLs accepted). ~$0.005/call. Only fires when tiers 1+2 miss.
4. **Fallback** — return the input URL with confidence 0.4 so the cascade still runs against the root.

Short-circuit: if the input URL already has a meaningful path (admin pasted a specific URL), pass through unchanged with `via='root', confidence=1`.

### Outcomes

- **Resolved URL replaces root** in `shul.submittedUrl` + `match_domain` + `data_source.identifier` + the Inngest extraction event. Weekly rescrape re-targets the schedule URL directly.
- ShulCloud `aid` paths, Chabad.org templates, custom CMS URLs all handleable.

### Cost note

~$0.005/shul one-time during discovery/submission for the LLM-scout fallback. Most shuls hit on pattern/link-scan and never burn the LLM.

---

## Fetch fallback via Cloudflare Worker proxy

Added: 2026-05-14 · **Built 2026-05-14.**

**Question:** Some shul sites block scrapers by IP range, not User-Agent. Chabad.org-hosted shuls return 403 to Vercel's us-east-1 outbound even with a real Chrome UA. Same URLs work fine from residential IPs or Cloudflare's edge. How do we get past this without per-site hacks?

### Built solution

The Cloudflare Worker we already run for inbound email gained a sibling `fetch()` handler at `/fetch?url=<encoded>`. Bearer-token authenticated (`FETCH_PROXY_TOKEN`). Forwards GETs through Cloudflare's edge IPs with a real browser UA + Accept headers. Returns the body verbatim with upstream status in `X-Original-Status` response header.

`lib/scrapers/fetch.ts` extends the existing UA fallback chain by one tier:

```
1. branded UA  (Tfila-Bot)              ← polite default
2. browser UA  (Chrome)                  ← runs only on 403/406
3. /fetch proxy via Cloudflare Worker    ← runs only when (2) is also 403/406
                                            AND FETCH_PROXY_URL is set
```

`FetchResult.fellBackToCfProxy` flag in the audit trail surfaces when this happened.

### Validation

Concrete win: `jewishwindsorterrace.org/templates/articlecco_cdo/aid/2710598/jewish/Times-and-Schedule.htm` returned 403 / 5KB stub from Vercel, returns 200 / 63KB schedule via the proxy. After deploying, the cascade extracts the visible minyanim cleanly.

### Cost

~free — Cloudflare Workers free tier covers any volume we'll hit. The proxy only fires on 403/406, so most fetches don't add a hop.

### Trade-offs

- **Open-relay risk**: mitigated by bearer-token auth + optional `HOST_ALLOWLIST` in the Worker. Don't share the token.
- **Latency**: adds one Cloudflare round-trip when proxy fires (~200ms). Acceptable because it only fires on otherwise-failed fetches.
- **Anti-bot evolution**: if Cloudflare's IPs get blocked next, this stops working. Mitigation paths: Browserless residential proxy (paid), per-CMS scraper (e.g. Chabad API).

---

## Admin notes per shul

Added: 2026-05-14 · **Status: BUILT 2026-05-14 (commit `cd761ed`, migration 0008).**

**The rule.** Every shul row in the admin gets a free-text notes field, editable from `/admin/shul/[slug]`. Stores institutional knowledge that doesn't fit any structured column: "moved domains in March," "gabbai responds via email only," "PDF tier needed because their HTML schedule is a screenshot," "approved against Yossi's recommendation, watch for stale times."

### Why

Triaging shuls today loses context. Why did admin approve a candidate without a perfect type-tag? Why was a data_source manually re-extracted last month? Why does this shul's name in the DB differ from what its website says? Without a notes field, that reasoning lives in commit messages, Inngest event payloads, or nowhere — and surfaces too late for the next admin pass.

A notes field is the cheapest possible "scratchpad for institutional memory" — one column, one textarea, no schema gymnastics.

### Shape (decided)

- **Per shul**, attached to the `shul` row directly. Not per data_source, not per candidate. (Rationale: most context generalizes across the shul's data sources; per-data_source notes would scatter the same observation across multiple rows on rescrape/re-extract.)
- **Single editable field**, replaced on save. Not an append-only log. Last-edited-by (admin email) + last-edited-at timestamp persist alongside the value.
- **Admin-only**. Never rendered on the public `/shul/[slug]` page. Plain text — no Markdown rendering required initially (admins can write Markdown if they want; the field just stores characters).

### Implementation sketch

1. **Schema** (one migration):
   ```sql
   ALTER TABLE shul ADD COLUMN admin_notes text;
   ALTER TABLE shul ADD COLUMN admin_notes_updated_by text;
   ALTER TABLE shul ADD COLUMN admin_notes_updated_at timestamptz;
   ```
   Nullable. No index — notes are admin-page-only, never queried in the davener path.

2. **Drizzle schema** — add the three columns to `shul` in `db/schema.ts`.

3. **API route** — `POST /api/admin/shul/[id]/notes` (admin auth required). Body: `{ notes: string }`. On save: writes the value, sets `admin_notes_updated_by = session.email`, `admin_notes_updated_at = NOW()`.

4. **UI** — on `/admin/shul/[slug]`, add a "Notes" card. Textarea (rows ~6, autosize-ish), Save button, and a small "Last edited by isaac.kass@gmail.com · 2 days ago" line below. Empty state: placeholder "Anything an admin should know about this shul…"

5. **Listing surface (optional, v1.1)** — a tiny note icon (📝 or similar) next to shuls with non-empty notes in `/admin/shuls`, so admins can spot which rows already have context without clicking in.

### Edge cases

- **Concurrent edits.** Two admin tabs open on the same shul, both save. Last-write-wins (no optimistic locking). For a one-admin-mostly project this is fine; revisit if the team grows.
- **Length cap.** No DB cap. UI soft-warns if > ~5 KB (notes are not blog posts).
- **Deletion.** Clearing the textarea + save = `admin_notes = NULL`, fields wiped. No history retained.
- **Markdown rendering.** v1 plain-text only. If admins start writing checklists, revisit (probably just `react-markdown` with the strict subset).

### Cost

~30 minutes: 1 migration, 3 schema lines, 1 API route, 1 textarea + Save button, 1 conditional badge in the listing.

### Decision

**Designed 2026-05-14.** Per-shul, single editable field, admin-only. Implementation deferred to a follow-up session — not blocking any other in-flight work.

Related: [[admin-ux-simplification]] (when written) — notes is one of the small surfaces that the unified pipeline view should expose inline.

---

## Home-page address search: 25-mile radius, nearest first

Added: 2026-05-14 · **Status: BUILT 2026-05-14 (commit `f5e2239`). Per-shul grouping + empty-state CTA shipped per recommended option set.**

**The rule.** When a user enters an address on the home page (the `FindCard` widget), the feed shows every minyan within a **25-mile radius** of that address, **ranked nearest first** (shul → user distance ascending). The radius and ranking are independent of the time-window logic.

### Why 25 miles, why nearest-first

- **25 miles.** The current default (`DEFAULT_RADIUS_MILES = 2` in [`app/page.tsx:20`](./app/page.tsx)) is tuned for dense urban submitters who walk to shul. An address search is a different intent — usually a traveler, a someone-new-in-town, or a davener checking what's reachable by car. 25 mi covers a normal driving range and pulls in suburbs / nearby towns that 2 mi misses.
- **Nearest-first.** Today the feed sorts by `startIso` (next-time-first — see [`app/page.tsx:159`](./app/page.tsx)). That's right for the "I'm here now, what's next" walking case. For an address search across a 25-mile spread, a minyan 24 miles away starting in 5 minutes is irrelevant to someone searching from their home address; a minyan 1.5 miles away starting in 40 minutes is what they want to see. Distance becomes the dominant signal once the radius opens up.

### Current behavior (2026-05-14)

- `FindCard` geocodes the typed address → redirects to `/?lat=…&lng=…` (no `radius` param).
- [`app/page.tsx:41`](./app/page.tsx) falls back to `DEFAULT_RADIUS_MILES = 2`.
- [`app/page.tsx:159`](./app/page.tsx) sorts by `a.startIso.localeCompare(b.startIso)`, then slices to `MAX_ITEMS = 25`.
- `getNearbyShulsWithRules` already returns `distanceMeters` per rule, so the data needed for nearest-first ranking is there — we just don't use it for ordering.

### What "address search" means (open)

The home page has three entry points to a located feed. We need to decide which of them trigger this 25-mi nearest-first behavior:

- **A.** `FindCard` "Use my location" (geolocation API) → keep current 2 mi + time-first. Walking-default unchanged.
- **B.** `FindCard` "Search by address" (typed address → geocode) → **new** 25 mi + nearest-first.
- **C.** Any URL with `?lat=&lng=` not explicitly carrying a radius → ambiguous. Should default to which?

Probably: A keeps the 2-mile walking default; B uses 25-mile nearest-first; C is the legacy/shared-link case and should preserve whatever was on the originating URL (so already-shared links don't silently change behavior).

### Implementation sketch (when ready to build)

1. **Distinguish the two entry points.** `FindCard` currently emits the same `/?lat=…&lng=…` URL for both geolocation and typed address. Add a marker — either `?via=address` or `?radius=25&sort=distance` — so the page handler knows which mode to render.
2. **Server-side defaults.** In [`app/page.tsx`](./app/page.tsx), branch on the marker: `via=address` → `radiusMiles = 25`, `sortMode = 'distance'`. Geolocation path keeps `DEFAULT_RADIUS_MILES = 2` and `startIso` sort.
3. **Bump the radius clamp.** `Math.min(50_000, ...)` (≈31 mi) already accommodates 25 mi. No DB change needed.
4. **Sort by distance, not time.** Replace `resolved.sort((a, b) => a.startIso.localeCompare(b.startIso))` with `resolved.sort((a, b) => a.distanceMeters - b.distanceMeters)` when `sortMode === 'distance'`. Time-window filter (`earliest` / `latest`) still applies — we're only changing the order within the eligible set.
5. **Header copy.** `FeedHeader` should reflect the mode — "Minyanim near \<address\>, sorted by distance" vs. the current "near you" framing. The `within 25 mi` line in [`app/page.tsx:185`](./app/page.tsx) just falls through with the new `radiusMiles` value.
6. **MAX_ITEMS revisited.** A 25-mile feed could easily return hundreds of rules across dozens of shuls. `MAX_ITEMS = 25` may now feel cramped. Either bump it to ~50, paginate, or group by shul and show the closest 1-2 minyanim per shul as a first-class card.

### Open sub-questions

- **Per-shul vs per-minyan rows.** At 25 mi, one shul with 8 daily minyanim shouldn't fill the entire screen. Group by shul, show the next 1-2 upcoming minyanim per shul card? Or keep the flat list and let MAX_ITEMS trim?
- **Time window.** Current `PAST_WINDOW_MIN = 30`, `FUTURE_WINDOW_MIN = 24*60` covers "the rest of today." Is that still right for an address search? Someone planning a Shabbos trip three weeks out wants a different window. Probably out of scope for v1 — keep today's window, separate "trip planner" feature later.
- **Driving-time vs straight-line distance.** Haversine distance is what we have. 25 mi as the crow flies could be 45 minutes on Long Island. v1 ships haversine; later we could add a Google Distance Matrix call for the top N results.
- **Empty / sparse results.** If a 25-mile search returns 0 minyanim (rural address), what do we show? "No minyanim within 25 mi of \<address\>" + a CTA to submit a local shul? Or quietly extend the radius to 50?

### Decision

**Principle locked 2026-05-14.** Address-search entry point → 25-mile radius, nearest-first ranking. Implementation deferred to a separate session; pick up by deciding (a) which entry-point marker to use, (b) per-shul grouping vs flat list, then ship the page-handler branch.

Related: [[home-page-find-card-ux]] (when written), the [[no-stale-data]] freshness rule still gates which shuls qualify to appear.

---

## No stale data: only list shuls with fresh verified tfila times

Added: 2026-05-14 · **Status: BUILT 2026-05-14 (commit `fe0737e`). 14-day query-time gate + slug-page stale variant + admin freshness pill shipped per recommended option set.**

**The rule.** A shul is only visible to public daveners (home-page feed, fuzzy search, `/shul/[slug]` page, `/find` results) when we have **active, verified tfila times** for it. No active times → not listed. Period.

This is the product's central promise. The whole reason tfila.co exists is that every existing Jewish-shul directory rots: times posted years ago, never updated, davener shows up late. We are the one that doesn't. Listing a shul without fresh times — even a shul we know is real, even a shul we have an address for — quietly betrays that promise. A user who hits one stale entry on tfila.co loses trust in everything else they see here.

### What "active, verified" should mean (open)

The principle is locked. The exact backend predicate isn't yet. Candidate definitions:

- **Minimal:** shul has `status='active'` AND at least one `data_source` with `review_status='approved'` AND at least one `minyan_rule` where `deleted_at IS NULL`.
- **Stricter:** the above, AND the data source's `last_run_status='ok'`, AND `last_received_at` (or `last_run_at` for URL-derived) is within the last ~14 days. Anything older flips the shul out of the public list.
- **Strictest:** the above, AND no admin flag indicating the rules are under review.

The right answer depends on how aggressive we want the "freshness" gate to be. A shul whose website briefly broke last week shouldn't disappear from search — we should still serve our last-known-good rules for a grace period. But a shul whose website has been broken for two months shouldn't keep listing 2-month-old times as if they were authoritative.

### What "not listed" means (open)

Three possible scopes, increasingly strict:

- **A.** Hidden from the home-page feed and fuzzy search only. Direct `/shul/[slug]` URLs still resolve (with a "data not currently available" banner).
- **B.** All public surfaces (feed, search, slug page) return as if the shul doesn't exist publicly. Slug-page URL 404s or redirects.
- **C.** Same as B, with an explicit "this shul exists but tfila.co doesn't have current times — if you have its weekly bulletin, please forward it to submit@tfila.co" page at the slug, so the URL is still indexable and serves a useful action.

C is probably the right call — preserves SEO value of the slug, gives daveners a way to help us restore the listing, doesn't pretend the shul doesn't exist.

### Already-partial behavior

Some pieces of this are already in place; the principle just makes the rule explicit and forces us to extend it everywhere.

- **`/api/submit`** never publishes a freshly-submitted shul publicly. New shuls land as `status='pending_review'`, hidden from the feed until extraction succeeds AND an admin approves the rules.
- **`status='broken' / 'archived' / 'unsupported'`** shuls are already excluded from the public feed via the `status='active'` filter that every public query applies.
- **`status='no_url'` was added and removed** in the same session (migrations 0006 → 0007). Product call codified there: a shul without an extractable URL doesn't get a row at all. That's a stricter version of this same principle, applied at row-creation time.
- **Weekly rescrape guardrails** already prevent silently wiping a shul's rules when a re-scrape returns suspiciously bad data (rule-count drops > 50%, or new confidence < 0.6) — those cases hold the previous-known-good rules and flag the data_source for admin review instead.

What's missing is the **time-since-last-verified gate**. Today an `active` shul stays `active` even if our last successful scrape was 6 months ago. The cron is supposed to keep this fresh, but a paused cron, a long-running broken site, or an Inngest outage could let staleness creep in undetected.

### Open implementation questions

1. **Where does the gate live?** Two reasonable architectures:
   - **At query time** — every public query joins / filters on a "last verified within N days" predicate. Most flexible (we can tune N without a migration), but adds a CPU/index cost on every page load.
   - **In a stored status** — a background job re-evaluates each shul's freshness on a schedule and flips `status` to `stale` (new enum value) when it crosses the threshold. Cheap reads, slightly more complex write/migration story.

2. **What's the threshold?** 7 days? 14? Variable per source type (emails refresh weekly, websites can hold over a missed cycle)?

3. **How do shuls recover from stale?** Admin click → manual extract → if successful, flips back to active automatically. This already works via the existing "Extract now" action; the new status just needs to participate cleanly.

4. **What about shuls we know about but never had times for?** This is the `shul_candidate` queue's domain — those rows aren't yet shuls. Once approved into a shul with status=`pending_review`, the same rules apply: not published until verified.

5. **Discovery-found shuls without contactable websites.** Already handled by removing the `no_url` approve path — those candidates can only be approved with a URL, so they enter the pipeline already on a verifiable path. No new case to handle.

6. **Public-facing copy when a shul slug exists but has no current times.** Per option C above, a short page explaining the situation + a CTA to forward/subscribe their bulletin to `submit@tfila.co`. Copy TBD.

### Why this is on the books explicitly

Because the rule is the product. Discovery, extraction, cascade, anti-bot proxy — every other system we've built exists to make this rule keepable. Without writing it down it stays implicit in scattered status filters and could slowly drift as new code paths get added.

### Decision

**Principle locked 2026-05-14.** Backend implementation deferred to a separate work session. When picked up: pick a threshold (start with 14 days), pick an architecture (start with query-time filtering — easier to undo), implement the public-facing "we don't have current times" page (option C), and add a freshness pill to the admin shul list so we can see at a glance which shuls are at risk of going stale.

---

## Admin UX: inbox-style dashboard, one row per shul

Added: 2026-05-14 · **Status: BUILT 2026-05-14 (commit `5443c8c`).**

The admin pipeline (candidate → shul → data_source → review → activate) used to span 5 separate landing pages, and `/admin/queue` + `/admin/rejected` listed `data_source` rows — so a shul with 2 pending sources showed up twice. The unified design treats **the shul as the unit of work** and renders an inbox-style row per shul with a verb-first label.

### Decisions (locked 2026-05-14)

- **Inbox = only shuls needing attention.** Healthy + active shuls don't appear in the inbox; they live in the catalog at `/admin/shuls`. Inbox empty when nothing's wrong.
- **Verb-first labels** ("Review 2 new extractions" / "Investigate broken extraction" / "No good source — triage" / etc.) rather than state names. Inbox reads like a to-do list.
- **One row per shul guaranteed**. `data_source` becomes an internal artifact you only see on the shul detail page.
- **No taxonomy collapse.** `archived` / `unsupported` / `broken` / `rejected` stay separate — different actions to take, even if the inbox row labels smooth them over for day-to-day use.

### What got built

- `lib/admin-state.ts` — `deriveAdminShulState()` returns one of 8 derived states from the shul row + its aggregated data_source flags. Order-priority: `archived > unsupported > broken > pending_review > no_good_source > awaiting_extraction > stale > active`. `adminShulStateLabel()` maps to the verb. `adminShulStateSortKey()` for inbox urgency-ordering.
- `lib/queries.ts:listAdminShuls` extended with a fifth LATERAL aggregating `has_pending_source`, `has_approved_source`, `has_rejected_source`, `has_broken_run`, `pending_source_count`. Single SQL round-trip; one row per shul guaranteed.
- `components/AdminInbox.tsx` — reusable shul-row renderer.
- `/admin` is now the inbox dashboard (was orphaned). `/admin/queue` + `/admin/rejected` are filtered views of the same data. `/admin/shuls` gained `?state=<derived>` for the dashboard tile clicks.
- `app/admin/layout.tsx` — wordmark links to `/` (public home); new "Admin" nav entry → `/admin`.

### Open follow-ups (not blockers)

- Status taxonomy could collapse later (`unsupported` and `broken` overlap functionally — both mean "system gave up"; `rejected` is the human verdict). Defer until the existing distinction proves redundant in day-to-day use.
- `/admin/data-source/[id]` still exists as a deep-link target. Could be inlined into the shul page eventually.

---

## Schedule update timing — when emails arrive vs when the cron runs

Added: 2026-05-15 · **Note (no decisions to make).** Codifies how the system reacts to a weekly bulletin email that lands BEFORE the Saturday-night URL rescrape, and where the date for each rule is stored.

### Two ingestion clocks, not one

The repo has two scheduled-update mechanisms; they're independent:

1. **Postmark inbound emails — PUSH.** A shul's weekly bulletin lands in `submit@tfila.co` whenever the gabbai sends it (often Wednesday or Thursday for the upcoming Shabbat week). Postmark POSTs the parsed email to `/api/inbound/email`, which fires `email.received` Inngest. There is **no cron** behind this; the email itself is the trigger. So an email arriving Wednesday updates the database Wednesday — the times are live before Shabbat.
2. **URL rescrape — CRON.** `weekly-rescrape.ts` fans out `shul.scrape.requested` events at Sat 22:00 ET (motzaei Shabbat). This refreshes any shul whose data_source is `kind='website_llm'` / `'shulcloud_website'`. Email-derived data_sources are NOT touched by this cron; they only update when a new email arrives.

So a "weekly email sent before the Saturday update" is the *normal* case — emails update on receipt, not on the cron.

### Where the rule's date lives

Every `minyan_rule` row carries:

| Column | For | Used by |
|---|---|---|
| `days_of_week` (smallint[]) | Regular weekly rules. e.g. `[1,2,3,4,5]` for Monday-Friday | Home feed + shul page filter "is today's day-of-week in this set?" |
| `valid_from` (date) | Date-bounded rules. ISO date string. e.g. `"2026-05-22"` | Shul page filter `selectedIso >= validFrom` |
| `valid_to` (date) | Date-bounded rules. Same shape | Shul page filter `selectedIso <= validTo` |
| `special_schedule_kind` (enum) | Tags the rule's nature: `regular`, `yom_tov`, `three_weeks`, `aseres_yemei_teshuvah`, `fast_day`, `rosh_chodesh`, `ad_hoc` | Resolution + priority |
| `priority` (int) | 0 for regular, 10 for date-bounded special. Higher wins on date overlap | Rule resolution at query time |

There is **no separate "schedule_for_week_of" date** — each rule individually carries either a recurring `days_of_week` (regular) or a `valid_from`/`valid_to` (special). Together they let one shul mix "Mincha Mon-Fri at 19:30" (regular, no date) with "Tisha B'Av Maariv 21:15 on 2026-08-13" (special, date-bounded).

### Replace-vs-add semantics on a fresh email

In `lib/inngest/functions/process-email.ts:301-406`, after the LLM returns its rules:

- **Regular rules** (`special_schedule_kind === 'regular'` or omitted) — every existing live regular rule under that data_source is soft-deleted; new regular rules are inserted. This means a Wednesday email completely replaces the prior week's regular schedule. If the gabbai changed Mincha's time, the old time is gone.
- **Special rules** (any non-regular kind) — ADD. Existing special rules are NOT touched. So if last week's email included a "Tisha B'Av schedule" with `validFrom=2026-08-13`, AND this week's email also includes the Tisha B'Av schedule, you now have two date-bounded rules for the same date. (Today this is benign — query-time resolution picks one by priority + position. We'd improve dedup if it became noisy.)

### Resolution at query time

Both the home feed and the shul page resolve which rule applies for a given date by walking all rules for the shul:

1. Special rule? Skip if `selectedIso < validFrom` or `selectedIso > validTo`.
2. Regular rule? Skip if `days_of_week` is set and doesn't include the day-of-week.
3. Among rules that pass, the one with higher `priority` wins on overlap (special's `10` beats regular's `0`).

The `selectedIso` for the shul page comes from the URL `?date=YYYY-MM-DD` (or today if absent), in the **shul's** timezone, not the user's. The home feed uses `now` resolved in the user's location's timezone (per the `geo-tz` fix from 2026-05-14).

### Edge case: email with year-omitted dates

The LLM extraction prompt was tightened on 2026-05-14 (commit `4b1fc95`) to never default partial dates ("May 8-9") to a year in the past — it uses the upcoming occurrence or the email's own date as the floor. This shows up as the special rule's `validFrom` correctly resolving to the next May 8, not the May 8 that already passed.

### Why no per-email "received_at"-as-validity-window field

Considered and rejected: storing the *email's* received_at and treating each rule as "valid until next email arrives." Two reasons against:

1. The schedule the gabbai SENT applies to a specific date range, not "from this Wednesday until I send another email." If the next email is delayed two weeks, the prior schedule is still correct for those two weeks.
2. The replace-on-receipt semantics already handle the "schedule changed" case for regular rules. Date-bounded rules carry their own `validFrom`/`validTo` from the bulletin's text.

### tl;dr

- Emails are **push, not cron** — no Saturday-night dependency.
- Regular weekly rules: no date column; live until next email replaces them; gated at query time by `days_of_week`.
- Date-bounded special rules: `valid_from` / `valid_to` columns; ADD on top of regular; gated at query time by date.
- The Saturday cron only refreshes URL-derived data_sources, never email-derived ones.

### ⚠ Needs verification on live data

Everything above is what the **code** does. We haven't yet confirmed it matches what daveners experience for real schedule cycles. Worth a deliberate examination once we have a few weeks of email-driven shuls in prod:

- **Pick a real email-derived shul** (Safra `id=59` is the canonical one with 12+ regular rules, but any `data_source.kind='email_newsletter'` works) and walk a full cycle:
  1. Inspect the live `minyan_rule` rows: which carry `days_of_week`? Which carry `valid_from`/`valid_to`? Spot any that look mis-categorized — e.g. a "regular" rule that should have been `yom_tov`?
  2. Compare today's home-feed render at the shul's location vs what a human reads off the source bulletin. Mismatches?
  3. After the shul sends NEXT week's bulletin, verify the prior week's regular rules got soft-deleted (not still showing up) and special rules from prior bulletins are still around if their `valid_to` hasn't passed.
- **Check the LLM's date-handling specifically** — re-process a few real bulletins and read the extracted `valid_from`/`valid_to` against the bulletin text. The 2026-05-14 prompt fix (commit `4b1fc95`) should keep partial dates ("May 8-9") from defaulting to the past, but a sample of 5-10 forwards would tell us if it's sticking.
- **Cross-week handling** — what happens when one bulletin covers a date range that overlaps with the next bulletin's? Probably both special rules survive and the priority+date filter picks one, but worth confirming with a real overlap.
- **Stale-special-rules drift** — there's no GC for special rules whose `valid_to` is in the past. They linger in the table forever. Inert for query purposes (filtered out) but accumulates rows. If it becomes noisy, add a periodic job to soft-delete `valid_to < NOW() - INTERVAL '90 days'`.

Pick this up after a few normal email cycles have run in prod (~2-3 weeks of activity), so we have enough data to spot patterns rather than one-shot anecdotes.

---

## LLM extraction context — explore a Jewish-bulletin-aware skill / prompt

Added: 2026-05-15 · **Status: exploration. No decisions yet.**

The current extraction prompts (`lib/llm/prompts.ts`, plus channel-specific variants in `extract.ts` / `extract-pdf.ts` / `extract-email.ts` / `extract-image.ts`) are mostly generic. They tell Claude what fields to fill but don't ground it in the cultural/halachic context of a Jewish-shul bulletin. Worth exploring whether richer context would meaningfully reduce extraction errors — especially on edge cases like:

- Abbreviations that are obvious to a davener but ambiguous to a generic LLM (Mn, Mch, S, Y, Selichos, Vasikin, Hashkamah, Mussaf, Krias HaTorah).
- Calendar context the bulletin omits because "everyone knows" (a Selichos schedule in Elul vs Aseres Yemei Teshuvah differs in start time and structure; "Tisha B'Av" implies a specific date this year).
- Denomination-specific schedules (Chabad bulletins reference Tanya/Rambam classes alongside minyanim — not minyanim; Sefardi bulletins use slightly different tefillah names; Vasikin shacharis means "at sunrise" but the page may say "Vasikin 6:42" mixing kind+clock).
- Date ambiguity in headers ("for Parshas Behar" — without a year/date, what week is that?).

### Why this might matter

We've already had two prompt-driven bugs in prod:

1. The Edmond J. Safra forward (2026-05-14) initially landed with all 12 rules tagged `ad_hoc` and dated to a past validFrom — fixed by the prompt update at commit `4b1fc95` ("default to regular weekly; for partial dates, use upcoming occurrence").
2. The `findShulPlace` low-confidence false-positive case (2026-05-14, fixed in `9babf55`) — Places-side, not LLM-side, but same shape: the model didn't know enough about the shul to disambiguate.

Both were patched by adding context to the prompt or the matching logic. A more deliberate approach would be a single source of "what Claude needs to know about Jewish-shul bulletins" rather than a series of incremental prompt patches.

### Options to explore

**A. Beefier system prompt with embedded glossary (smallest)**
Extend `SYSTEM_PROMPT` with: a tefillah-name normalization table (Vasikin → shacharis with anchor=netz), a list of common one-off schedule kinds and how to tag them, an explicit "calendar context" preamble (current Hebrew date + upcoming Yom Tov windows). Runs on every extraction; no infra change.

- **Pros:** simplest; ~50-100 lines added; immediate effect.
- **Cons:** prompt token cost on every call (inflates input by ~1K tokens × every extraction); harder to iterate on (each tweak is a code change + redeploy); doesn't leverage Claude's tooling for structured knowledge.

**B. Anthropic Claude Skill (or "agent skill") bundle**
Anthropic recently shipped Claude Skills — a packaged combination of prompt, reference docs, and scripts that the model loads on demand. Build a "Jewish-shul-bulletin-extractor" skill that includes:
- A comprehensive glossary
- 5-10 anonymized example bulletins with reference extractions (few-shot)
- A small calendar helper that returns "today's Hebrew date" + "next 4 Yom Tovim" when the model invokes it
- Channel-specific variants (HTML, PDF, email body, vision)

- **Pros:** clean separation of model knowledge vs caller code; iterable without redeploys; Anthropic-blessed pattern; example-based grounding usually beats prose grounding.
- **Cons:** new infra dependency (skill upload + versioning); skill-loading might add latency; learning curve.

**C. RAG over a curated glossary + a few exemplar bulletins**
Build a tiny vector store of (a) glossary entries (b) ~20 representative bulletins with annotated extractions. Each extraction call retrieves the top 3-5 matching entries and includes them in the prompt.

- **Pros:** scales naturally as we add more domain knowledge; relevant context only (smaller per-call prompt than option A).
- **Cons:** more moving parts (vector DB, embedding pipeline); retrieval quality matters; harder to debug a wrong extraction ("which RAG hit caused this?").

**D. Two-pass: extract, then critique with a second model call**
First call: Haiku extracts as today. Second call: Claude (Haiku again? Sonnet?) reads the extracted rules + the source bulletin and answers "is anything obviously wrong?" — flag low-confidence rules for review.

- **Pros:** orthogonal to A/B/C — could compose. Catches inconsistencies the first pass missed.
- **Cons:** doubles cost; second pass needs its own prompt designed to find errors (different skill from extraction).

**E. Hybrid: SKILL (B) + calendar tool (A's context preamble) + critique pass (D) for low-confidence cases**
Probably where this lands if we go deep.

### Open sub-questions

- **Cost vs accuracy curve:** what's an acceptable per-extraction $$ envelope? Today the cascade averages ~$0.01-0.05 per shul. A skill or RAG bumps that. Is even 2× acceptable if it reduces admin-review time substantially?
- **Where to source few-shot examples:** real bulletins from current shuls (privacy — bulletins often have phone numbers + names) vs synthetic examples we author. Probably author 5-10 synthetic ones first, then expand from real bulletins after admin review of the redacted-version-vs-original.
- **Calendar tool scope:** just current Hebrew date + Yom Tov list, or also zmanim ranges (Mincha typically 18 min before shkia, etc.)?
- **Per-denomination prompt variants:** Chabad / Sefardi / Yeshivish / Modern Orthodox bulletins have noticeably different conventions. Do we detect denomination upfront and switch prompts, or train one prompt to handle all four?
- **Verify against ground truth:** how do we measure improvement? Need a small test set of ~20 bulletins with hand-curated correct extractions, run before-and-after on each option.

### What to do first (when picked up)

1. **Build the test set.** Even 15-20 hand-curated bulletins (5 HTML schedule pages, 5 email forwards, 5 PDF bulletins) with correct extractions written out. This is the hardest part, but without it every improvement claim is anecdotal.
2. **Run the test set against the current prompt** to establish baseline accuracy (e.g. % of rules correctly extracted, % of dates correct, % of special-schedule kinds correctly tagged).
3. **Try option A first** — extend the system prompt. Cheap to test; easy to revert. Re-run the test set.
4. **If A is hitting a ceiling**, evaluate B (skill) or C (RAG). The cost/iteration trade probably favors B.
5. **D (critique pass)** is orthogonal; revisit independently once the primary extraction is dialed in.

### Related

- `lib/llm/prompts.ts` — current system prompt (single source for HTML extraction)
- `lib/llm/extract-email.ts:11-50` — email-specific prompt with the 2026-05-14 partial-date fix
- The "Schedule update timing" FEATURES entry above — the verification walk it describes will surface the kinds of accuracy issues this entry is meant to address
- [[feedback-minimize-user-work]] — if we go RAG (C), the build-out should come with a script to seed the vector store, not a manual web-UI uploader

---

## Automated tests — typecheck is the only safety net today

Added: 2026-05-15 · **Status: gap noted. No decisions yet.**

`package.json` has no test runner. The only programmatic check between "I edited this" and "this hits prod" is `tsc --noEmit`. That's caught a handful of real bugs but is structurally incapable of catching the most expensive class of regression in this codebase: silent behavior drift in the extraction / persistence pipeline.

### Why this is on the books

Concrete prior-art that would have been caught by a small test suite:

- **`pageContentHash` mismatch (fixed 2026-05-15, commit `49aeb4a`).** `scrape-one-shul.ts` hashed raw HTML at 80K chars; `extract.ts` stored a hash of sanitized HTML at 120K. They never matched. The weekly cron's "no_change" optimization never fired, so every Saturday paid for a full LLM extraction on every shul. Lived for months. A 6-line vitest test (`hashSanitizedHtml(html) === extractFromHtml(html).pageContentHash`) would have caught it on first commit.
- **Rescrape `apply-changes` not transactional (fixed 2026-05-15, commit `acbff05`).** A partial failure mid-loop could have inserted duplicate rule rows on Inngest retry. Tonight's transaction wrap fixed it, but a fixture-based test that simulates a mid-loop failure would have surfaced the issue much earlier.
- **`backfillShulLocation` short-circuited when address was set (fixed 2026-05-14, commit `fb06f77`).** Bais Menachem invisible to address search for weeks. A boolean assertion test ("after extraction, every shul with `address NOT NULL` should also have `location NOT NULL`") would have flagged the entire population.
- **MinyanList times rendered in UTC (fixed 2026-05-14, commit `c078e1f`).** A snapshot test on the rendered HTML would have caught it the moment the bug was introduced.

Each of these survived months of weekly crons because nobody had a way to assert the invariant.

### Options ranked

#### A. Vitest + small unit tests on `lib/llm/*`, `lib/pipeline/*`, `lib/freshness.ts` (Recommended starting point)

Install vitest. Write 15-25 unit tests covering:
- Hash stability across `extract.ts` ↔ `scrape-one-shul.ts`
- `evaluateExtractionGuardrails` for known input/output pairs
- `deriveAdminShulState` for each of the 8 derived states
- `freshDataSourceExistsForShul` SQL predicate (mocked DB)
- `findShulPlace` confidence math (no real Places call — pre-shape the API response)
- `assertPublicHttpUrl` for the SSRF allowlist (every CIDR class)
- `formatClockFromIso` for known TZ + ISO inputs

**Pros:** smallest possible test surface; runs in <2s; no infrastructure needed.
**Cons:** doesn't cover end-to-end flows; mocking the DB / Anthropic / fetch is awkward.

#### B. Add Playwright E2E for the public-facing flows

Browser tests against tfila.co (or a preview deploy):
- Home page loads
- "Use my location" → home feed renders with at least one minyan card
- Type "Brooklyn" → 25-mi address search renders with grouped shuls + correct local-time strings
- Open a shul page → schedule renders; map renders; "Last updated" present
- Open a stale shul → "we don't have current times" page renders

**Pros:** catches the kind of bug we shipped tonight (TZ render, missing shul). One CI run = one prod-equivalent smoke.
**Cons:** slow (1-2 min per run); brittle to copy edits; needs a stable test shul fixtured in the DB.

#### C. Inngest replay tests for the extraction cascade

Anthropic supports replaying past API calls. Combined with Inngest's local dev server, you could:
- Capture 3-5 representative cascades (HTML success, JS-rendered, PDF, vision, failed)
- Snapshot the `data_source` + `minyan_rule` rows produced
- Re-run the cascade in test against the captured input, assert the output matches

**Pros:** catches behavior drift in the most complex code path (where most bugs hide).
**Cons:** real infra dependency (test Postgres, mocked Anthropic); requires fixture maintenance as prompts evolve.

#### D. Property tests on the rule-resolution algorithm

`fast-check` / `vitest` property tests for: given a synthetic shul with N rules of mixed kinds, querying any date returns at most one rule per tefillah, and that rule satisfies the date filters. Catches edge cases in `app/shul/[slug]/page.tsx` rule resolution + future home-feed grouping logic.

**Pros:** finds bugs you didn't think to write tests for.
**Cons:** moderate learning curve; setup is involved.

### Open sub-questions

- **CI vs local-only:** Vercel doesn't run a test command on deploy by default. Either add a GitHub Action that runs `vitest` on push (10 min setup), or rely on local pre-push.
- **Fixtures for DB tests:** docker-compose with a throwaway Postgres + drizzle migrations? Neon branch per-test? In-memory better-sqlite3 with manual schema? Each has trade-offs; Neon-branch-per-test is the closest to prod but slowest.
- **Coverage target:** none today. Even 30% on `lib/` would catch most of the prior bugs. Don't aim for 80% — diminishing returns past the critical-path modules.

### What to do first

1. **Install vitest** + write the 6-line hash-stability test. Validates the toolchain.
2. **Snapshot test on `deriveAdminShulState`** for all 8 derived states. Quick win + protects the inbox state machine going forward.
3. **Test on `assertPublicHttpUrl`** — security-relevant, easy to write, easy to regress.
4. After 5-10 tests are committed, add a GitHub Action to run them on push.
5. Defer Playwright (option B) until Vitest covers the most-commonly-edited modules.

### Decision

**Deferred per [[feedback-security-cleanup-deferred]] equivalent — don't add big infra during build phase.** Pick this up when the project is stable enough that fixing a bug feels expensive (i.e. when there are real users and a bug = trust loss). Cost of waiting: more bugs ship to prod first; cost of doing now: ~2 days of test-writing instead of feature work. Worth scheduling explicitly when the build phase ends.

---

## Auth model — single-admin today, will need rework for co-admin

Added: 2026-05-15 · **Status: gap noted. No decisions yet.**

`lib/auth.ts:63-67` `isAllowedAdmin()` checks one env var (`ADMIN_EMAIL`). The magic-link, the session cookie, the allow-list check on every admin route, the request-link sender — every layer of the auth chain assumes a single admin. The day Isaac wants help is the day this needs a full rework, not a small extension.

### Why this is on the books

Today the model is the simplest possible thing that works for one person — and that's correct for now. But "one admin" is a lot of structural assumption to unwind:

- `isAllowedAdmin(email)` does exact equality on a single env var
- Magic-link is sent to whatever email matches that env var
- Session cookie's payload is `{ email, exp, kind }` — no role, no user id, no audit
- No `admin_user` table; no `admin_action_log` table
- Every admin POST route checks `getAdminSession()` which only confirms "is this the single admin"
- Notifications (`notifyAdmin`) go to the single email
- New admin = redeploy with a different env var. Two admins = ??? (today, you'd have to pick one and the other can't sign in)

This isn't a problem until the moment you want a second person on the admin side. Then it's an all-at-once migration: schema, auth chain, notification routing, audit, possibly a UI for managing admins.

### Options when the time comes

#### A. `admin_user` + `admin_session` tables — minimal real auth

New `admin_user (id, email, created_at, status)` + `admin_session (id, admin_user_id, token_hash, expires_at)`. Drop the env-var allow-list; replace with `SELECT FROM admin_user WHERE email = ? AND status = 'active'`. Magic-link writes to admin_session. Cookie carries session_id. Adding an admin = INSERT row. Removing = UPDATE status = 'archived'.

**Pros:** smallest delta from current state; one migration; preserves the magic-link flow.
**Cons:** no roles (every admin can do everything); no audit log; no UI for managing.

#### B. A + audit log

Same as A, plus `admin_action (id, admin_user_id, action, target_type, target_id, payload_jsonb, created_at)`. Every admin POST route writes a row before the action.

**Pros:** answers "who archived shul X" three months later. Important once there's >1 admin and any disagreement.
**Cons:** writes-amplification on every admin action (small); UI to view the log is its own piece.

#### C. A + B + roles (`reviewer` vs `superadmin`)

Most ambitious. `reviewer` can approve/reject data_sources but not archive shuls or run discovery. `superadmin` can do everything.

**Pros:** safer for admins-with-less-context onboarding (won't accidentally archive everything).
**Cons:** RBAC is its own complexity hole; probably overkill for tfila.co's foreseeable team size (2-3 max).

#### D. Outsource to Clerk / WorkOS / Auth0

Drop the bespoke magic-link entirely. Sign-in via the third party; map their session to our admin_user.

**Pros:** SOC2-grade auth out of the box; SSO; future-proof.
**Cons:** vendor lock-in; monthly cost; overkill for a 1-3 admin team; magic-link is already working.

### Open sub-questions

- **What's the actual second-admin scenario?** A volunteer Isaac knows wanting to triage candidates? A paid VA? A different shul's gabbai uploading content for their own shul (different — that's a per-shul-claim model, not co-admin)? Each implies a different RBAC shape.
- **Magic-link or password?** Magic-link works at single-admin scale because Isaac always has email access. At 2+ admins with potentially shared inboxes, a password-with-2FA model might be safer. Worth deciding before building.
- **Where does notification routing go?** Today `notifyAdmin` sends to one email. With multiple admins, do all notifications fan out to all? Or per-admin preferences? Or is there a single shared admin@tfila.co alias?
- **How invasive is the migration?** Rough scope: one migration (3-4 tables), `lib/auth.ts` rewrite, every admin route swap (`getAdminSession` → `requireAdmin` returning a typed user), one new admin UI page (`/admin/users`). Estimate: 1-2 days focused work. Doesn't need test coverage in advance — auth is small enough to validate by clicking through.

### What to do first (when picked up)

1. **Decide the actual scenario** that will trigger this. Without a real second-admin user story, you'll over-engineer (option C/D) or under-engineer (option A). The user story informs the option.
2. **Sketch the migration** even if you don't ship it. The exercise of writing the schema + routes will tell you whether option A is enough or you need B from day one.
3. **Don't build until needed.** Option A is small enough to land in a single PR when the second admin shows up. Don't pre-build now.

### Decision

**Deferred. Note exists so future-Isaac (or a code review) doesn't read the env-var allow-list and wonder if it's intentional. It IS intentional, AND it has a known migration path when the time comes.**

Related: [[feedback-security-cleanup-deferred]] — keep credential rotation and auth-model rework on the same "after build phase" timeline.
