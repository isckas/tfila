# Session log — 2026-05-14 → 2026-05-15

**Pickup doc.** If you're returning to this project, read this first, then PROGRESS.md "Now" if you need more depth.

This session spans two working days that flowed together:
- **2026-05-14 evening** — code work: pipeline parity, address search, no-stale gate, admin notes, admin UX overhaul, code review with all critical findings fixed
- **2026-05-15** — documentation + brainstorming: Phase 2 candidate pool, gap analyses, exploration entries

---

## Headline

**27 commits live in prod, two migrations applied, one data backfill, one full-stack code review with all critical findings fixed, and a comprehensive Phase 2 candidate pool documented in FEATURES.md.**

The product is in a stable, shippable state. Next pickup is the Phase 2 selection conversation OR routine maintenance — your call when you're back.

---

## Code commits — 2026-05-14 evening

| Commit | Type | Summary |
|---|---|---|
| `6a61431` | refactor | PR1 — `allocateUniqueSlug` shared; admin extract uses `backfillShulLocation` |
| `9fbcbbb` | refactor + fix | PR2 — shared guardrails + `insertRuleFromExtraction`; **email path now respects guardrails** |
| `5889428` | refactor | PR3 — `persistDataSourceWithRules` + `applyShulNameAndAddressFromExtraction` (completes "Unified post-ingestion pipeline") |
| `f5e2239` | feat | Address-search 25-mi radius, nearest-first, per-shul grouping |
| `fe0737e` | feat | No-stale-data gate — public surfaces hide shuls without a successful run in 14d |
| `cd761ed` | feat | Admin notes per shul — migration 0008 |
| `fa17ce3` | chore | Housekeeping (FEATURES.md entries, logo source, diag script, favicon) |
| `fb06f77` | fix | `geocodeAddressIfMissingLocation` — fixes the bug where address-set email-shuls had `location IS NULL` |
| `5443c8c` | feat | Admin UX inbox overhaul — verb-first one-row-per-shul; queue + rejected became filtered views |
| `c078e1f` | fix | MinyanList times in shul TZ instead of server UTC |
| `c3eacbf` + `7914b6c` | copy | Tagline copy edits |
| `49aeb4a` | fix (cost) | `pageContentHash` sanitized-vs-raw bug + Sonnet skip on Haiku zero-rules |
| `acbff05` | fix | Idempotency: HTML + non-HTML rescrape paths atomic + retry-safe |
| `af30511` | fix (security) | Magic-link single-use + drop attacker-controlled Origin + Postmark fail-closed (migration 0009) |
| `21f2b84` | fix (security) | `/submit` SSRF guard + per-domain extraction cooldown |
| `9babf55` | fix | Build/scrape race + `findShulPlace` disambiguation + email guardrail bail to 0.5 |
| `282ae08` | refactor | `lib/format.ts` + `components/badges/*` — kill duplication |
| `9a002c4` | fix | Zmanim TZ from lat/lng (was UTC) + a11y labels + `<h3>` headings + RelativeTime hydration + delete dead `SearchBox` |

## Documentation commits — 2026-05-15

| Commit | Summary |
|---|---|
| `203d9c0` | First SESSION.md + PROGRESS/FEATURES status updates after the code-review night |
| `8028109` | FEATURES: "Schedule update timing" — how email vs cron updates flow + where date columns live |
| `cc210c8` | FEATURES: flag email-schedule date handling as needing live-data verification |
| `6fd8c28` | FEATURES: exploration entry — LLM extraction context / skill / prompt (5 options ranked) |
| `264a733` | FEATURES: gap entries — automated tests, single-admin auth model |
| `38e5e62` | FEATURES: Phase 2 candidates — Telegram bot, layered Jewish-life map |
| `309fb9f` | FEATURES: Phase 2 candidates — multi-language UI, predictive missing-bulletin alert |
| `93dc983` | FEATURES: rename "Long-term ideas" → "Phase 2 features"; add Make-a-Minyan as Isaac-flagged Phase 2 candidate |

---

## Migrations applied to prod Neon

- **0008** — `shul.admin_notes`, `shul.admin_notes_updated_by`, `shul.admin_notes_updated_at`
- **0009** — `consumed_magic_link` table (token_hash PK, consumed_at + index)

Both ran via Neon SQL editor on the `phase-1-migration` branch.

## Data ops run

- `scripts/backfill-shul-locations.mjs` — 18 shuls had `address` set but `location` NULL → all geocoded, written. Bais Menachem (id=57), theshul.org (56), bayt.ca (41), thornhillshul (40), and 14 others.

---

## What to verify post-deploy (still relevant for any new work)

1. **Zmanim render in shul timezone** — `/?lat=25.8900949&lng=-80.1867138&via=address&q=North+Miami` → Alos ~5:19 AM (was 9:19 AM UTC).
2. **Minyan times in shul timezone** — same page → Bais Menachem mincha ~7:49 PM (was 11:49 PM UTC).
3. **Magic-link single-use** — sign out → request → click (works) → click again → `/signin?error=already-used`.
4. **Per-domain cooldown** — submit a URL whose domain matches a shul extracted in the last 30 min. Should accept but skip the Inngest event.
5. **Admin inbox** — `/admin` shows tiles + verb-first row list; click into a shul; back out; verify no shul appears twice across inbox / queue / rejected.
6. **Saturday cron** — first cron after 2026-05-17 22:00 ET should show way fewer LLM extractions (hash bug fix lets unchanged pages hit the `no_change` short-circuit).

---

## Phase 2 candidate pool (FEATURES.md "🚀 Phase 2 features" section)

Five candidates documented as Phase 2 — to be revisited after traction is established. **Final cut TBD.** Each entry has explicit revisit triggers, design considerations, and why-deferred reasoning:

- **Telegram chatbot** — chat-first interface for find-near-me + flyer submission. Trigger: ≥3 users asking for an app/WhatsApp version in a single month.
- **Layered Jewish-life map** (minyanim + eruv + mikvah + kosher) — Google-Maps-style layers. Trigger: explicit user requests OR community volunteer offering to maintain eruv data.
- **Multi-language UI** (Hebrew, Russian, French, Spanish, Yiddish) — analytics-driven trigger (≥10% Hebrew or ≥5% any non-English in `Accept-Language`).
- **Predictive "missing bulletin" admin alert** — per-sender cadence learning + alert. Trigger: ≥30 active email senders with ≥8 weeks of cadence each.
- **"Make a Minyan" (ad-hoc location-based)** — Isaac-flagged favorite. Detailed design questions captured ("Details that need real work"). Depends on Telegram bot + auth rework being live first.

Plus **2 noted gaps** captured in FEATURES.md (not in the Phase 2 section but tracked as deferred):
- **Automated tests** — typecheck is the only safety net today; 4 concrete prior-art bugs cited that would have been caught
- **Auth model** — single-admin works today, will need rework for any co-admin

---

## 7 user-suggested ideas — analyzed (not in FEATURES.md, kept as session record)

User asked to analyze 7 specific ideas. Verdicts:

| # | Idea | Verdict |
|---|---|---|
| 1 | Siddur download | Small enhancement only — link to existing free siddurim (Open Siddur Project, Sefaria); don't host content |
| 2 | Candle-lighting times | Already 80% built — extend the existing zmanim strip with candle-lighting + havdalah |
| 3 | Daily Dvar Torah feed | **Skip** — off-scope, dilutes brand; cross-link existing sources if anything |
| 4 | Generic Jewish AI bot | **Skip — pushed back actively** — halachic liability + brand risk + better existing solutions (Sefaria, ChatGPT) |
| 5 | Kaddish-on-my-behalf | Adjacent product; deserves separate focus, not a tfila.co feature |
| 6 | chabad.org zmanim feed | **Skip** — already done better via Hebcal; would add dependency for less control |
| 7 | "Make a Minyan" (ad-hoc) | **Phase 2 candidate** (Isaac flagged as favorite) — added to FEATURES.md with full design |

---

## Outstanding (deferred, not done in this session)

**Code-review items deferred by design**
- API error-response convention via `lib/http.ts` (touches every route — focused PR)
- Per-IP rate limit on `/submit` (better at Vercel WAF level than in code)

**Pre-existing items (rolling)**
- Same-origin URL fallback only runs in HTML tier (less urgent post-resolver)
- Vision-extractor calibration — needs 5 more real vision extractions
- Anthropic Auto-Reload + monthly cap (operational; the hash-bug fix should reduce burn rate substantially)

**Live-data verification (blocked on time, not effort)**
- Email schedule pipeline date handling — walk a real shul (e.g. Safra `id=59`) end-to-end against its source bulletin once 2-3 weeks of email cycles have run. See FEATURES.md "Schedule update timing — Needs verification on live data."

**Build-stage cleanup** (deferred per user instruction — don't surface during build phase)
- Credential rotation (Neon API key, Neon DB password, Inngest signing key, Cloudflare token, Google API key)
- Automated tests (FEATURES.md gap entry; recommended starting point: 6-line hash-stability test in vitest)
- Auth model rework (FEATURES.md gap entry; trigger = first real second-admin user story)

---

## Memory updates from this session

- New: `feedback-minimize-user-work` — default to scripts/APIs over web-UI walkthroughs; ask for credentials, user keeps them in `.env.local`.
- New: `feedback-security-cleanup-deferred` — don't list credential rotation as outstanding while the project is in build stage.
- Updated: `project-pickup-2026-05-14` — current state pointer.

---

## How to resume

1. **Read this file** (you're doing it). Top half = what shipped. Bottom half = what's deferred + Phase 2 pool.
2. **PROGRESS.md "Now"** — deferred items (cross-references SESSION.md and FEATURES.md).
3. **FEATURES.md** is the historical decision record. Every entry now has a Status line (`BUILT 2026-05-XX (commit X)` or `Phase 2 candidate` or `Principle locked. TBD.`).
4. **The 🚀 Phase 2 section in FEATURES.md** is the candidate pool. The next "what should we build?" conversation probably starts here — pick one based on which trigger has fired.
5. **If you need credentials / DB access** to run a script, ask Isaac directly. He keeps prod credentials in `.env.local` (gitignored). Per `[[feedback-minimize-user-work]]`, default to writing a script he can run locally rather than routing him through web dashboards.
6. **Don't mention credential rotation** in "what's outstanding" lists per `[[feedback-security-cleanup-deferred]]` — that's deferred until build phase ends.

## What "build phase ends" means (for the deferred decisions)

The deferred-during-build items (tests, auth model, credential rotation, multi-language) all have implicit triggers. Rough working definition of "build phase ends":
- Daily active users > 50 (signal: real product fit, not just self-use)
- ≥3 months without a critical bug shipped
- Marketing motion in flight (vs pure organic discovery)

When 2 of those 3 are true, time to revisit the deferred items.
