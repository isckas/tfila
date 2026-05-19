# tfila.co — Gap audit + recommended next steps

## Context

You asked: *where are we, what's missing, what's next* — not just "finish the v2 rollout." So this plan steps back from the v2-rollout-only frame and audits the whole project.

**Current state (verified this session):**
- v2 extraction pipeline live in `main`. 3 canary shuls verified across html / vision / js_rendered. PDF + email tiers untested in real traffic.
- 51 active shuls. The SCOPE.md Phase 1 completion bar is **100+ shuls + weekly cron stable for 2 weeks + 3-5 real daveners successfully used it**. You are not at Phase 1 complete.
- Public site is functional: landing → location → feed → shul detail all work. Admin queue + review surface in place.
- Documentation discipline is strong (PROGRESS / SESSION / DECISIONS / FEATURES / STYLE / SCOPE). The build artifacts are unusually well-maintained for a solo build.
- You're mid v2-canary, mid `/save`+`/resume` skill ship. Standing rule: build-phase deferrals on credential rotation, auto tests, auth-model rework.

Three parallel audit agents covered user-facing UX, operations/observability, and testing/security/privacy. Their findings collapse into the gap list below, **deduped against what you already know** (per PROGRESS.md, FEATURES.md, and the feedback memories).

## What's actually solid (so the list below isn't all alarms)

- SSRF protection on `/submit` (`lib/ssrf.ts`) — strong; DNS resolution + IPv4-mapped-IPv6 covered.
- Magic-link admin auth — HMAC-SHA256, single-use via DB, 15-min token + 30-day session, timing-safe compare.
- Drizzle parameterized queries everywhere; no raw-SQL concat injection vector found.
- TypeScript strict mode on. Postmark webhook auth is sound (timing-safe, fail-closed in prod).
- v2 extraction pipeline architecturally solid — sourceQuote required at tool-call level, agent loop capped, fallback strategy clean.
- The new-shul onboarding flow is end-to-end: `/submit` → Inngest event → cascade → review queue → approve → public.

## Gap list — prioritized by "when does this hurt"

### A. Will bite the moment real users land (HIGH — close before broadcasting the URL)

These directly degrade the user-visible experience or cause silent wrong-data:

1. **Yom Tov / fast-day / special-schedule rules are silently filtered or undistinguished on public surfaces.**
   - `app/page.tsx:143` filters `specialScheduleKind !== "regular"` from the feed without surfacing why.
   - `app/shul/[slug]/page.tsx:319-375` weekly table shows special rules without clearly labeling them; users may see wrong times on Tisha B'Av / Pesach / fast days.
   - **Impact:** the freshness wedge that justifies the product literally produces wrong answers on the dates that matter most.

2. **No Open Graph / Twitter Card metadata on shul pages.**
   - `app/shul/[slug]/page.tsx:32-41` returns title+description only. No `openGraph`, no `twitter`, no preview image.
   - **Impact:** every shul URL shared in WhatsApp / iMessage / Reddit shows a naked blue link. Single biggest lever on shareability.

3. **No sitemap.xml + no robots.txt.**
   - Missing files: `app/sitemap.ts`, `public/robots.txt`.
   - **Impact:** Google can't index `/shul/[slug]` pages → organic discovery dead-on-arrival. Also: your own `/bot` page tells shuls "we respect robots.txt" but there's no robots.txt for them to inspect.

4. **No structured data (schema.org Place / LocalBusiness) on shul detail pages.**
   - **Impact:** no rich snippets in Google search → hours/address won't appear inline.

5. **Mobile touch targets fail WCAG.**
   - Emoji buttons in `components/FeedHeader.tsx:32-52` and `app/page.tsx:67-71` are 7×7 px — well under the 44×44 px floor.
   - **Impact:** users misfire on phones (the primary form factor for "next minyan near me").

6. **Developer comment leaks into prod empty state.**
   - `components/MinyanList.tsx:48-51` shows "Most sprint-1 shuls don't have addresses yet, so this is expected for now. The address-backfill pass lands next." to public users.
   - **Impact:** breaks trust the first time a user hits the empty state.

### B. Will bite the first time something breaks (HIGH — operational blind spots)

7. **Sentry is installed but `SENTRY_DSN` is unset → error tracking dark in prod.**
   - `instrumentation.ts` + `instrumentation-client.ts` are conditional on env. Today every exception falls into Vercel logs that rotate out in 7 days.
   - **Fix is small:** create a Sentry project, set the DSN env var, redeploy. ~30 min.

8. **No uptime monitoring + no `/api/health` endpoint.**
   - **Impact:** if the Sunday cron silently breaks or the site goes down at 3am Shabbos, you find out Monday. Lowest-effort fix is a UptimeRobot/BetterStack free tier hitting `/`.

9. **Preview deploys hit prod DB + prod Inngest + prod Resend + prod Anthropic.**
   - Only `/api/inbound/email/route.ts:39-44` has a `NODE_ENV` guard. Writes, emails, and LLM calls from preview deploys all land in prod.
   - **Impact:** every PR you preview burns Anthropic budget and can mutate prod data. Highest-blast-radius operational gap.

10. **No rate limits on `/api/submit`, `/api/inbound/email`, `/api/admin/request-link`.**
    - PROGRESS.md flags `/submit` per-IP rate limit as "best done at Vercel WAF level" — fine, but currently *no* limit exists, and the admin request-link endpoint can be used to spam emails to ADMIN_EMAIL or burn the Resend quota.
    - **Impact:** one malicious actor or one mis-configured email loop = $50-500 in unexpected LLM spend + flooded inbox.

11. **No global Inngest concurrency cap.**
    - Per-shul concurrency is capped (limit:1) but the weekly fan-out hits all 51 shuls in parallel against Anthropic/Jina/Browserless/Docling. Hitting external rate limits silently retries forever.
    - **Impact:** weekly cron silently stretches from 30 min to 6 hours; admin doesn't know.

12. **No Inngest dead-letter / failed-event surfacing.**
    - When events exhaust retries, there's no row in your DB and no email. PROGRESS.md notes that the cron-summary script surfaced **21 broken extractions silently failing for weeks** — same failure mode.
    - The "21 broken" item is on the deferred list; this is the systemic version.

13. **No cost ceiling on LLM calls.**
    - `agent-loop.ts` caps iterations (8) and per-call max_tokens, but no per-request cost budget, no daily/weekly spend cap, no anomaly alert.
    - **Impact:** a runaway retry loop can spend $100-500 unnoticed.

### C. Known-deferred items that need a re-check before launch (MEDIUM)

You explicitly deferred these. The audit confirms they're still deferred — but a few have grown teeth:

14. **Credentials in `.env.local` committed to git** (per audit). Per `feedback-security-cleanup-deferred` you don't want this surfaced as outstanding during build. **But** if `github.com/isckas/tfila` is a **public** repo, any committed key is compromised right now regardless of build phase. **Single-step verify:** is the repo public? If yes, rotate before next session. If private, deferral stands.

15. **Zero automated tests.** Documented gap. The 2-3 highest-leverage tests would be: (a) `consumeMagicLinkToken` single-use behavior, (b) `shouldUseV2(shulId)` dispatch, (c) `assertPublicHttpUrl` SSRF guard for IPv4-mapped-IPv6. Each is ~10 LOC of vitest. Still deferrable — just noting the floor is unusually low.

16. **No ESLint config + no CI.** ESLint takes ~15 min to add. CI is heavier. Both deferrable but cheap.

### D. Privacy/legal — depends on launch geography (CONDITIONAL)

If you stay US-only and don't plan EU traffic in the next 60 days, these are deferrable. If you ever share the URL in a WhatsApp group with EU members, they apply:

17. **No privacy policy page.** No `/privacy`. `/bot` page partially covers data handling but doesn't satisfy GDPR Article 13.

18. **No data-deletion endpoint for shuls.** GDPR Article 17 requires 30-day SLA on erasure requests. Currently: "email hello@tfila.co" with no documented process.

19. **localStorage stored without consent.** `components/FindCard.tsx:8-16` persists location + radius without an opt-in banner. GDPR Article 7.

20. **`shul.contactEmail` stored in plaintext.** PII at rest; no documented retention policy or encryption.

### E. Strategic gap — Phase 1 completion vs v2 rollout

You're currently focused on **v2 rollout polish** (canary → global flip → tier coverage). But the SCOPE.md Phase 1 completion bar is:

- **100+ shuls** seeded (you have 51 — gap = 49)
- **Weekly cron stable for 2+ weeks** (you have ~2 weeks runway, but the cron has been unstable due to v2 mid-stream changes)
- **3-5 real daveners** successfully using the site (not measured — probably zero outside you?)

The v2 rollout is a means to "extraction quality good enough that shul count can scale" — but the bigger lever for Phase 1 might be:

- **Daveners using the site** is unknown territory. No analytics? No "first 5 users" recruited and observed?
- **Shul count to 100** is mostly a discovery + submission problem, not an extraction-quality problem.
- **"Why isn't tfila.co taking off?"** — without OG metadata + sitemap + usable mobile + privacy policy, sharing the URL to test with 5 friends is friction-heavy.

The v2 rollout is correct, but the rest of category A (open graph, sitemap, special-schedule UX, mobile targets) probably gates "is this share-able to a friend" more than v2 confidence does.

## Decisions locked with user

1. **Repo is private** → `.env.local` credential exposure stays a deferred build-phase item per `[[feedback-security-cleanup-deferred]]`. No rotate-now action. Keep `.env.local` off git going forward (`.gitignore` already has it; ensure new keys go to Vercel env + a local-only file).
2. **Test audience ready in 1-2 weeks** → Category A (public-facing leaks) is now **pre-launch blocker**, prioritized ahead of v2 polish.
3. **No analytics installed** → add lightweight tracker as part of launch-prep batch so the Phase-1 "3-5 real daveners" criterion is even measurable.

## Recommended sequence (locked)

Run in this order. Each step has a clean rollback and a concrete pass criterion.

### Step 0 — Claude Code productivity setup (do first, ~30 min total)

These three reduce friction in every subsequent step. Cheap, one-time, never has to be done again.

- **Install Vercel CLI** — `npm i -g vercel`. Unlocks `vercel env pull/add/rm`, `vercel deploy`, `vercel logs` from inside Claude. Several upcoming steps (flag flip, env var add for analytics + Sentry + rate limits) become one-liners instead of dashboard click-throughs.
- **Run the `fewer-permission-prompts` skill** — scans recent transcripts, adds safe read-only commands (`git status`, `git log`, `npm ls`, etc.) to project `.claude/settings.json` auto-allow. ~5 min once, payoff every session.
- **Add a Postgres MCP server** pointed at the Neon DB. Lets me run verification SQL (data_source inspection, rule-count checks, sourceQuote coverage) directly instead of writing queries for you to copy-paste. ~10 min to wire up; we'll pull `DATABASE_URL` from `.env.local` and configure a read-only server.

### Step 1 — Flip v2 global flag (today, 5 min)

Add `EXTRACTION_PIPELINE_V2=true` in Vercel prod env. Leave `EXTRACTION_V2_SHUL_IDS` in place (harmless once global flag wins). Vercel auto-redeploys.

**Pass:** next new-shul `/submit` produces a data_source with non-NULL `source_quote` on every rule.
**Rollback:** `vercel env rm EXTRACTION_PIPELINE_V2 production`.

### Step 2 — Launch-prep batch (the "before friends touch it" PR, ~half-day)

Single PR bundling six small, low-risk public-facing fixes. Each is independently small but the bundle is "this site is shareable now."

| Fix | File | Effort |
|---|---|---|
| Strip the dev-comment in empty state | `components/MinyanList.tsx:48-51` | 2 min |
| Add Open Graph + Twitter metadata on shul pages | `app/shul/[slug]/page.tsx:32-41` (`generateMetadata`) | 30 min |
| Add `app/sitemap.ts` listing all active shul slugs | new file | 20 min |
| Add `public/robots.txt` (allow all + reference Tfila-Bot policy) | new file | 5 min |
| Bump emoji-button tap targets to 44×44 px min | `components/FeedHeader.tsx:32-52`, `app/page.tsx:67-71` | 15 min |
| Label special-schedule rules in weekly table + feed | `app/page.tsx:143-145`, `app/shul/[slug]/page.tsx:319-375` | 1-2 hrs (the longest one) |

Open Graph + sitemap + emoji-tap-target each have obvious Next.js 16 idiomatic patterns; the special-schedule labeling needs a design choice — show inline badge under each rule? Show a date-validity strip? Keep simple: a `Yom Tov` / `Fast day` / `Special` badge inline next to the time, neutral color per STYLE.md (no new color family).

**Pass:** test with one shared link to WhatsApp — preview shows shul name + city + tagline. Visit on a phone — emoji buttons hit on first tap. Visit on Tisha B'Av (or simulate by checking a date with `specialScheduleKind` rules) — special-schedule rules are visually distinct.

### Step 3 — Install lightweight analytics (15 min)

You're on Vercel — **Vercel Analytics** is one toggle in the Vercel dashboard + one `<Analytics />` import in `app/layout.tsx`. Free tier covers 2.5k visitors/month — plenty for "first 5 friends" phase.

**Pass:** open Vercel Analytics tab, see your own pageview registered. Now the Phase-1 success-criterion ("3-5 real daveners") is measurable.

### Step 4 — Wire up Sentry + add `/api/health` (45 min)

- Create a Sentry project, grab `SENTRY_DSN`. Set in Vercel prod env. The `instrumentation.ts` + `instrumentation-client.ts` files are already there waiting.
- Add `app/api/health/route.ts` returning `{ ok: true, db: <bool from a 1ms select 1>, ts: ... }`.
- Sign up for UptimeRobot free tier (50 monitors, 5-min interval), point one at `https://tfila.co/api/health`. Email alerts on failure.

**Pass:** trigger a deliberate `throw new Error("sentry test")` in a route, confirm it lands in Sentry. UptimeRobot dashboard shows green.

### Step 5 — Add minimum rate limits (~half-day)

Use Upstash Redis free tier (10k requests/day — covers us) + `@upstash/ratelimit`. Three middleware-level limits:
- `/api/submit`: 5 req/hr/IP
- `/api/admin/request-link`: 3 req/hr/email + 10 req/hr/IP
- `/api/inbound/email`: 100 req/day total (one Postmark webhook id)

**Pass:** loop-test each endpoint with curl, confirm 429s after threshold. Existing `feedback-no-credit-card-services` memory applies — Upstash free tier needs no card.

### Step 6 — Then go test with friends

Share the URL with the 3-5 person test cohort. Watch Vercel Analytics + Sentry. Collect feedback. Iterate.

The v2 rollout (Step 1) is happening in parallel: as friends submit shuls or visit, the new submissions exercise v2 and we learn whether the long-tail tiers (PDF, email) hold up under organic traffic.

## What I deliberately did NOT include

- **Automated tests** — build-phase deferral holds. Revisit at "daily active users > 50."
- **Privacy policy + cookie banner** — defer until first EU click or first explicit ask.
- **Multi-admin auth rework** — solo-user model holds until first real second admin appears.
- **Inngest dead-letter visibility** — the cron-summary script catches the same failures after-the-fact. Sufficient until traffic scales.
- **Phase-2 features** (Make-a-Minyan, gabbai portal, multi-language) — not until Phase 1 completion bar hits.
- **Backfilling the 21 broken extractions** — let v2 global flip + next weekly cron cycle resolve naturally; triage only what remains after.

## Step 7 — Phase-1-completion fills (verified missing this session)

Two items SCOPE.md locked as Phase 1 but never built. Verifying surfaced both:

- **PWA shell** — no `manifest.json`, no `app/manifest.ts`, no service worker, no icons. SCOPE.md says "hand-rolled service worker (~80 LOC). `next-pwa` is not Next.js 16 ready." Never written. ~Half-day to land: `app/manifest.ts` + `public/icons/*` + a basic service worker + iOS-Safari install testing.
- **Travel mode UI on the feed** — `app/page.tsx:41` accepts `date?: string` as a searchParam but no UI control to set it. Users can pass `?date=2026-05-25` via URL but there's no input. ~2-3 hrs: add a small `<input type="date">` next to the location strip, wire to existing rule resolution which already accepts a date.

Both should ship before the test cohort arrives — they're Phase-1 completeness, not new features.

## Step 8 — Wedge sharpeners (the "this is actually useful" features)

Picked: Tefillah filter chips + In-progress countdown. Both ship after launch-prep + Phase-1 fills.

- **Tefillah filter chips on the feed.** Shacharis / Mincha / Maariv pill row at the top of MinyanList, client-side filter (the dataset is small). STYLE.md aligns: "live feedback beats roundtrips." ~Half-day.
- **'In progress' visual distinction with countdown.** SCOPE killer use case #2 is delivered today only by the relative-time string. Add a small `live` pill + minute-countdown ("started 7 min ago, still going") that visually pops from "starts in 23 min." Files: `components/MinyanList.tsx`, `components/RelativeTime.tsx`. ~Half-day.

## Step 9 — Moat deepener (trust signal)

Picked: Freshness badge.

- **`Verified N days ago` chip per shul card.** Pull from `data_source.last_run_at` (or `scrape_run.started_at`). Inverse of the existing stale-gate: visible positive trust signal instead of hidden negative gate. ~1-2 hours. Files: `components/MinyanList.tsx` for the feed, `app/shul/[slug]/page.tsx` for the detail page.

## Parallel planning docs (write while implementation steps land)

These don't block any code step. Slot them in between implementation steps when context-switching needs a breather. All three live under `docs/`.

### Step 10 — Operational runbook (~1-2 hrs, `docs/RUNBOOK.md`)

Short reference for "things break" scenarios. Each scenario gets 5-10 lines:

- **Site is down** — which dashboard to check first (Vercel deployments → Vercel logs → Sentry → UptimeRobot), how to roll back a deploy (`vercel rollback`), how to verify rollback worked.
- **Cron silently failed** — how to detect (`scripts/cron-summary.mjs --hours 24`), how to manually rerun (`Inngest dashboard → replay event`), how to investigate root cause.
- **Cost spike on Anthropic** — how to spot it (Anthropic console daily usage), how to kill traffic immediately (`vercel env add EXTRACTION_DISABLED true` + a 5-line code check), how to revert.
- **Credential leak** — rotation order (Anthropic → Inngest → Resend → Google → Jina → HF), how to do each without downtime, how to invalidate sessions (`AUTH_SECRET` rotation kills all sessions).
- **Database emergency** — how to pin a Neon snapshot, how to fork a branch for safe restore-testing.

Each entry: "the trigger / the dashboard / the command / the verification."

### Step 11 — Cost-tripwire / LLM budget plan (~half-day, code + doc)

Two-part: a written budget policy + an in-app circuit breaker.

- **Budget policy doc** (`docs/COST-BUDGETS.md`): daily ceiling, weekly ceiling, monthly ceiling. Anthropic console alerts wired to those numbers.
- **In-app circuit breaker**: a pre-extraction check that reads cumulative `usage` tokens from `data_source.config_json` for the current day, halts new extractions if > daily ceiling. Returns a `cost_capped` status so admin can investigate. ~half-day; file: new `lib/llm/cost-gate.ts`, called from `cascade.ts` before any LLM dispatch.

This is the missing layer below the agent-loop iteration cap.

### Step 12 — First-5-friends test plan (~1 hr, `docs/FIRST-USERS-TEST-PLAN.md`)

Right now "share with friends in 1-2 weeks" is intent, not plan. Document:

- **Cohort**: who specifically (initials are fine), their geography, their typical davening pattern (weekday Shacharis only? Shabbos? travel?). Pick a mix.
- **The share message**: one short WhatsApp/iMessage text. Includes the URL, one-sentence ask, and an explicit "tell me if it broke." No marketing pitch.
- **3 questions to ask each** after they've tried it once: (a) what did you try to do? (b) did it work? (c) would you use it again? Avoid leading questions.
- **Signals to collect**: Vercel Analytics pageviews from non-Isaac IPs, manual notes from each conversation. No formal survey.
- **Cadence**: 1 week before iterating. Resist tweaking based on the first piece of feedback — let signal accumulate.
- **Decision criteria after 2 weeks**: what counts as "iterate on what's there" vs "build feature X" vs "scrap and rethink." Pre-write so the answer doesn't come from emotion.

## Tasks to create on plan approval (sequenced order)

1. **Step 0a**: Install Vercel CLI (`npm i -g vercel`)
2. **Step 0b**: Run `fewer-permission-prompts` skill
3. **Step 0c**: Add Postgres MCP server pointed at Neon
4. Flip `EXTRACTION_PIPELINE_V2=true` in Vercel prod
5. Launch-prep batch: strip dev-comment, OG metadata, sitemap, robots.txt, tap-target bumps, special-schedule labels
6. Install Vercel Analytics
7. Wire Sentry DSN + add `/api/health` + sign up UptimeRobot free tier
8. Add rate limits to `/submit`, `/admin/request-link`, `/inbound/email` via Upstash
9. PWA shell (manifest + service worker + icons + iOS Safari install test)
10. Travel mode UI on feed (date input wired to existing rule resolver)
11. Tefillah filter chips on feed (client-side)
12. In-progress countdown + visual distinction
13. Freshness badge per shul card
14. Write `docs/RUNBOOK.md` (operational scenarios)
15. Build cost-tripwire circuit breaker + `docs/COST-BUDGETS.md`
16. Write `docs/FIRST-USERS-TEST-PLAN.md`
17. (carry-forward) `/save` + `/resume` functional verification — task #1 stays as-is

## Tasks to create on plan approval (sequenced order)

1. Flip `EXTRACTION_PIPELINE_V2=true` in Vercel prod
2. Launch-prep batch: strip dev-comment, OG metadata, sitemap, robots.txt, tap-target bumps, special-schedule labels
3. Install Vercel Analytics
4. Wire Sentry DSN + add `/api/health` + sign up UptimeRobot free tier
5. Add rate limits to `/submit`, `/admin/request-link`, `/inbound/email` via Upstash
6. PWA shell (manifest + service worker + icons + iOS Safari install test)
7. Travel mode UI on feed (date input wired to existing rule resolver)
8. Tefillah filter chips on feed (client-side)
9. In-progress countdown + visual distinction
10. Freshness badge per shul card
11. (carry-forward) `/save` + `/resume` functional verification — task #1 stays as-is
