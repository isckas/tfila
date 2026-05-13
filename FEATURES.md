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

Added: 2026-05-13 · **Status: principle locked, not yet built.**

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
- **Now (~30 min):** Step 1 only — factor `backfillShulLocation` out and call from email path. Unblocks the Safra-style "no address" symptom.
- **Soon (1-2 days):** Steps 2-7, the full unification.

Until full unification ships, admin can hand-fill `shul.address` in `/admin/shul/[slug]` for email-derived shuls that need to show up in the map view.
