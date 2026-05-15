# Session log — 2026-05-14 evening

**Pickup doc.** If you're returning to this project, read this first, then PROGRESS.md "Now" if you need more depth.

---

## What this session did

Started with the user asking "what's left on FEATURES.md?" → ended with **17 commits live in prod**, two migrations applied to Neon, a 18-row data backfill, and a full-stack code review with all critical findings fixed in the same night.

## Commits, in order shipped

| Commit | Type | Summary |
|---|---|---|
| `6a61431` | refactor | PR1 — `allocateUniqueSlug` shared; admin extract uses `backfillShulLocation` |
| `9fbcbbb` | refactor + fix | PR2 — shared guardrails + `insertRuleFromExtraction`; **email path now respects guardrails** (bad-week emails no longer wipe rules) |
| `5889428` | refactor | PR3 — `persistDataSourceWithRules` + `applyShulNameAndAddressFromExtraction` — completes FEATURES.md "Unified post-ingestion pipeline" |
| `f5e2239` | feat | Address-search 25-mi radius, nearest-first, per-shul grouping (FEATURES.md "Home-page address search") |
| `fe0737e` | feat | No-stale-data gate (FEATURES.md "No stale data") — public surfaces hide shuls without a successful run in 14d |
| `cd761ed` | feat | Admin notes per shul — migration 0008 |
| `fa17ce3` | chore | Housekeeping (FEATURES.md entries, logo source, diag script, favicon) |
| `fb06f77` | fix | `geocodeAddressIfMissingLocation` — fixes the bug where address-set email-shuls had `location IS NULL` and were invisible to ST_DWithin |
| `5443c8c` | feat | Admin UX inbox overhaul — verb-first one-row-per-shul; `/admin/queue` + `/admin/rejected` became filtered views |
| `c078e1f` | fix | MinyanList times in shul TZ instead of server UTC |
| `c3eacbf` | copy | Capitalize "Tfila" in tagline (3 places) |
| `7914b6c` | copy | Drop stray double-space in tagline |
| `49aeb4a` | fix (cost) | `pageContentHash` sanitized-vs-raw bug + Sonnet skip on Haiku zero-rules — biggest active LLM-cost leak fix |
| `acbff05` | fix | Idempotency: HTML + non-HTML rescrape paths atomic + retry-safe |
| `af30511` | fix (security) | Magic-link single-use + drop attacker-controlled Origin + Postmark fail-closed (migration 0009) |
| `21f2b84` | fix (security) | `/submit` SSRF guard + per-domain extraction cooldown |
| `9babf55` | fix | Build/scrape race + `findShulPlace` disambiguation + email guardrail bail to 0.5 |
| `282ae08` | refactor | `lib/format.ts` + `components/badges/*` — kill duplication |
| `9a002c4` | fix | Zmanim TZ from lat/lng (was UTC) + a11y labels + `<h3>` headings + RelativeTime hydration + delete dead `SearchBox` |

## Migrations applied to prod Neon

- **0008** — `shul.admin_notes`, `shul.admin_notes_updated_by`, `shul.admin_notes_updated_at`
- **0009** — `consumed_magic_link` table (token_hash PK, consumed_at)

Both ran via Neon SQL editor on the `phase-1-migration` branch.

## Data ops run

- `scripts/backfill-shul-locations.mjs` — 18 shuls had `address` set but `location` NULL → all geocoded, written. Bais Menachem (id=57), theshul.org (56), bayt.ca (41), thornhillshul (40), and 14 others.

---

## What to verify post-deploy

1. **Zmanim render in shul timezone** — open `/?lat=25.8900949&lng=-80.1867138&via=address&q=North+Miami`. Alos should read ~5:19 AM (was 9:19 AM UTC).
2. **Minyan times in shul timezone** — same page. Bais Menachem mincha should read ~7:49 PM (was 11:49 PM UTC).
3. **Magic-link single-use** — sign out → request → click (works) → click again from email → should redirect to `/signin?error=already-used`.
4. **Per-domain cooldown** — submit a URL whose domain matches a shul extracted in the last 30 min. Should accept but skip the Inngest event.
5. **Admin inbox** — `/admin` shows tiles + verb-first row list; click into a shul; back out; verify no shul appears twice across the inbox / queue / rejected views.
6. **Saturday cron** — first cron after 2026-05-17 22:00 ET should show way fewer LLM extractions because the hash bug fix lets unchanged pages hit the `no_change` short-circuit.

---

## Outstanding (deferred, not done tonight)

**Code-review items deferred by design**
- API error-response convention via `lib/http.ts` (touches every route — focused PR)
- Per-IP rate limit on `/submit` (better at Vercel WAF level than in code)

**Pre-existing items (rolling)**
- Same-origin URL fallback only runs in HTML tier (less urgent post-resolver)
- Vision-extractor calibration — needs 5 more real vision extractions
- Anthropic Auto-Reload + monthly cap (operational; the hash-bug fix should reduce burn rate substantially)

**Build-stage cleanup** (deferred per user instruction — don't surface during build phase)
- Credential rotation (Neon API key, Neon DB password, Inngest signing key, Cloudflare token, Google API key)

---

## Memory updates from this session

- New: `feedback-minimize-user-work` — default to scripts/APIs over web-UI walkthroughs; ask for credentials, user keeps them in `.env.local`.
- New: `feedback-security-cleanup-deferred` — don't list credential rotation as outstanding while the project is in build stage.

---

## How to resume

1. Read this file (you're doing it).
2. PROGRESS.md "Now" lists deferred-but-not-blocked work.
3. FEATURES.md is the historical decision record — every entry now includes a Status line (`BUILT 2026-05-14 (commit X)` or `Principle locked. TBD.`).
4. If you need cred / DB access to run a script, ask the user — they keep prod credentials in `.env.local` (gitignored).
5. The user prefers scripts over dashboard clicks. Don't route them through web UIs unless there's no programmatic path.
