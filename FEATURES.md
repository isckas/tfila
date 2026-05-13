# tfila.co — Features

Feature design + decision doc. Each section describes a single feature or concern: what exists today, what's broken or unhandled, possible approaches, and the chosen direction (when decided).

Different from the sibling docs:
- **[SCOPE.md](./SCOPE.md)** — what tfila.co is and isn't, locked
- **[PROGRESS.md](./PROGRESS.md)** — rolling log of what's been built
- **[IDEAS.md](./IDEAS.md)** — parking lot for non-MVP ideas
- **[CHANGELOG.md](./CHANGELOG.md)** — day-versioned release log for the admin section
- **[STYLE.md](./STYLE.md)** — UX north star

This file is for **bounded feature designs**: each entry has a question, current state, options, and (eventually) a chosen answer that gets promoted into code.

---

## Deduplication: same shul, different submissions

Added: 2026-05-13 · Status: **open — needs decision**

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

### Open decision

Pick A, B, C, or D — and confirm the desired UX for the false-positive case (a real false-positive merge needs a way out: admin "split" action, or a confirmation step before merging).

Once decided, the work:
1. Schema: add `shul.match_domain` (varchar 253, indexed)
2. Backfill: compute match_domain for existing rows
3. URL submission path: extract eTLD+1 from submitted URL, dedupe by it
4. Email submission path: extract eTLD+1 from sender domain, dedupe by it
5. Cross-link: when a new submission's match_domain hits an existing shul, attach the new submission as an additional `data_source` instead of creating a new shul
6. Admin "split" tool: if two shuls were incorrectly merged, admin can split them apart
