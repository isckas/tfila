# tfila.co — Decision Log

ADR-style record of the load-bearing decisions made during build. Each
entry captures **context** (what problem forced the decision), **options
considered**, **the decision**, **reasoning**, and **implications** (what
got built / what changes in the codebase as a result).

This file is the long-form complement to PROGRESS.md (rolling work log)
and FEATURES.md (catalog of what exists). When a decision sits behind a
piece of code or a future direction, write it here so the **why** survives
context window evictions and personnel turnover.

---

## 2026-06-07 (evening) — P3 reframe + deploy reality

### Decision — Descope the ShulCloud deterministic adapter (P3 E-B2); ship report-wrong-time instead

**Context.** P3's centerpiece was a deterministic ShulCloud parser, justified by (a) ShulCloud being a JS-render failure case the cascade struggled with, (b) making ShulCloud shuls immune to the 429 storm, (c) being ~free vs an LLM call. Researching real ShulCloud sites before building (the lesson from v2's Docling misfire) overturned all three premises.

**Findings.** All 4 active ShulCloud shuls extract on the plain **static-HTML tier at 0.75–0.92** (no JS render needed). P0 had **already** made transient 429s retry-with-backoff instead of demote, so ShulCloud shuls are already storm-immune. Cost is cheap Haiku (~cents/year). And the deterministic parser hits a real wall: a generic "Evening Minyan" at 5:30pm is mincha-or-maariv depending on shkia — exactly the disambiguation the LLM does and a DOM parser can't. The LLM's own "gold" extraction for shaareyzedek was actually noisy (3 overlapping rules for one event), so the accuracy bar wasn't even high.

**Options.** (1) Build the adapter anyway (consistency/defense-in-depth). (2) Descope it; ship the two cheap P3 wins. (3) Skip P3, jump to P4.

**Chose (2)** — user-confirmed. Shipped **E-B5** (anonymous report-wrong-time tap → `time_report` → admin triage; never auto-spends LLM) + **E-B3** (reframe the "moat" doc: the moat is the rule model + zmanim/special-day resolver + curated directory, NOT the commoditizable few-shot prompt — that mislabel was being used to reflexively veto deterministic strategies).

**Implications.** No platform-aware router / tier-0 parser. The cascade stays the one engine; P0's storm-proofing is what made the adapter redundant. `EXTRACTION.md` carries the moat reframe. If ShulCloud-specific accuracy ever matters, revisit — but the DOM is clean (`ce_event_*` classes under `.calendar_day_view`), so it's a known quantity.

### Decision — Production deploys are manual; merge-to-main is the durable path

**Context.** Mid-P4, discovered prod wasn't picking up pushed commits. Pushing the branch creates a **Preview** deployment that **fails** (Preview env lacks `DATABASE_URL`; `db/client.ts` throws at module load during `next build`). The last git-tracked Production deploy was May-20 `main`, yet prod ran newer code (Jerusalem geo-tz returned 200) — so P0 went live via a manual `vercel deploy --prod` that leaves no git record.

**Decision.** Ship via **merge PR to `main`** (Production env has `DATABASE_URL` → builds clean; durable, matches how PRs #2–4 shipped) and/or `vercel deploy --prod`. Never deploy stale pre-merge `main`. Captured in memory `reference_deploy_mechanism`. Optional future fix: lazy-init the Pool in `db/client.ts` so Preview builds stop failing.

---

## 2026-06-07 — Holistic remediation (3 reviews → unified plan → P0/P1/P2 to prod)

### Decision 1 — One unified plan, one branch, "no waves"
- **Context:** A "review all logs + code" ask grew into 3 review passes (error/log audit, effectiveness, UI), each with its own roadmap.
- **Chose:** ONE plan (`~/.claude/plans/reveiw-all-logs-and-reactive-locket.md`, copied to `docs/HOLISTIC-REMEDIATION-PLAN.md`) on ONE branch `fix/holistic-remediation`, with P0–P5 as **build-order dependency phases, NOT optional waves**. Each item tagged with all its source IDs (e.g. `[C3·E-E1]`). Everything ships except the 2 refuted findings + the skeptic's "keep as-is" list.
- **Lesson:** When multiple review passes accrete, dedupe into one tagged plan so there's a single source of truth; kill leftover per-review roadmaps.

### Decision 2 — E-DECISION-1: consolidate to v1 base + v2's 2 wins
- **Context:** Dual v1/v2 pipelines; v2 was the global default but underperformed (0.527 avg confidence, 5/28 approved) and its extra per-shul LLM calls amplified the 429 storm.
- **Chose:** Retire v2 entirely (−2643 LOC), keep v1's simpler 4-tier cascade; fold in v2's two genuine wins — forced tool-schema output + required `sourceQuote` (`tools/extraction-output.ts` kept; fold-in still pending).
- **Implications:** `EXTRACTION_PIPELINE_V2` flag now a no-op; H2 (markdown-vs-sanitized hash mismatch) resolved automatically.

### Decision 3 — Status-model: fix the BEHAVIOR in code, defer the cosmetic enum migration
- **Context:** A 3-axis status model (`shul.status`×`review_status`×`last_run_status`) + the demote/restore dance behind 30+ "Fix X" patches caused the no-recovery trapdoor.
- **Chose:** Achieve the target behavior in code only — derived public visibility (E-A1), sticky `review_status` (never flip approved→pending on a run outcome), no `shul.status` demotion, transient-vs-terminal classification (only demote on terminal). Shuls now self-heal via the weekly cron. DEFER the cosmetic enum-value removal ({live,archived}/{approved,rejected}) + dropping `first_broken_at` to a gated migration — not needed for correctness.
- **Lesson:** Separate behavioral fixes (code, no migration, shippable now) from cosmetic schema cleanup (destructive, gated). Ship the value, defer the churn.

### Decision 4 — Execution: prod-fastest, gate only the destructive/costly steps
- **Context:** Site down (41→9 active shuls); user wanted speed.
- **Chose:** Deploy straight to prod (`vercel deploy --prod`; the Vercel **Preview** env lacks `DATABASE_URL`, so preview builds fail). Verify each deploy with the HTTP smoke test + a real test extraction. PAUSE for explicit go only on (a) LLM-spend ops and (b) destructive DB migrations. Prod aliases to the BRANCH deployment → don't push main until merge.
- **Lesson:** "Fastest" ≠ "no gates" — gate the irreversible (migrations) + the metered (LLM spend); move fast on the rest.

### Decision 5 — Root cause of the 41→9 regression (corrected by adversarial verification)
- **Context:** Docs implied a clean v2 canary; the site had quietly dropped to 9 active shuls.
- **Found:** The first global-v2 weekly cron (2026-05-24) hit an **Anthropic 429 storm** from an unthrottled ~41-way fan-out — TRANSIENT, proven from `config_json.cascade_attempts` ("429 rate_limit_error"). `preferredStrategy:'html'` pinning off fallback tiers turned the transient 429 into permanent "cascade exhausted all tiers" demotions; cron-only-fans-active+approved made it a one-way trapdoor. An initial "v2 dropped v1's URL fallback" hypothesis was REFUTED by the verifier and by re-extracting shul 1 successfully.
- **Lesson:** Adversarially verify root-cause hypotheses against stored evidence (config_json/Sentry) before committing a fix.

### Decision 6 — E-C1 evening times: convert to zmanim only when the source says so (option 2)
- **Context:** 455 of 491 live rules were fixed clocks; shuls publish mincha/maariv clock times that actually track sunset (BAYT's "8:45pm"), so a frozen clock goes seasonally wrong while the freshness pill reads green.
- **Options:** (1) auto-convert evening fixed times to a shkia-offset via server-side sunset math; (2) convert only when the page describes the time relative to a zman; (3) flag for admin, never auto-convert.
- **Chose (user):** **Option 2** — the extraction prompt emits `zmanim` only when the source text says "before/after shkia/sunset/tzeis/plag/candle-lighting"; bare clock times stay fixed (lower confidence). Deleted the "emit fixed + reviewer note" escape hatch. The ShulCloud pre-computed-clock case (BAYT) is explicitly deferred to **P3's ShulCloud adapter**, which reads ShulCloud's underlying `shkia − N` rule directly — deterministic, no LLM guessing (the v1 pipeline has no sunset tool after retiring v2).
- **Implications:** re-extract all active shuls with fixed evening rules (user chose); add a quiet "may shift seasonally" note (E-C4) on fixed evening times; keep "Verified N ago" as-is.
- **Lesson:** Don't make the LLM guess sunset math it can't read off the page; route deterministic platforms (ShulCloud) to an adapter that reads the real rule, reserve the LLM for the long tail.

**Convention:** latest at top. Sections grouped by date + topic. Cross-link
to PROGRESS.md commits + FEATURES.md entries when relevant.

---

## 2026-06-03 — home-feed 500 + batch-then-code workflow

Home feed returned HTTP 500 at one specific user-supplied coordinate (`?lat=43.8030364&lng=-79.4429928&radius=2`) after PR #4 shipped. Other coordinate sets — including ones 1.5 km away in the same neighborhood — returned 200. Three decisions came out of the investigation + the resulting fix design.

### Decision 1 — Pull the stack trace from Sentry API instead of over-investigating statically

**Context:** Initial investigation showed the SQL query worked when run directly, and every component + utility in the feed-render path (`resolveRuleTime`, `computeZmanimStrip`, `MinyanList`, `RelativeTime`, all formatters, `FeedHeader`, `isoDateInTz`) was individually defensive by static reading. Yet the 500 was deterministic. Spent ~20 turns reading code without finding a throwing line.

**Options:** (a) keep reading code (slow, may never converge), (b) reproduce locally with `npm run build && start` (~5 min cycle, requires prod DB access which is already present), (c) pull the error from Sentry (~30 seconds once token is set up).

**Chose (c).** The Sentry DSN was already wired up for the project. User created a read-only auth token (scopes: `event:read`, `project:read`), added it to `.env.local` as `SENTRY_AUTH_TOKEN`. First token attempt was invalid (64-char bare hex, possibly wrong type); second token authenticated but lacked `org:read` (the `/organizations/` endpoint denied access). The `/projects/` and `/events/` endpoints worked, which was enough — fetched the most recent error event on `GET /` and got the full stack trace in one curl.

**Implication:** **For runtime errors that aren't visible by static reading, the FIRST move is Sentry, not deeper investigation.** Saved roughly 5-10 turns of speculation. Memorialized in `[[reference-sentry-access]]` so the access details survive — org slug `ik-c7`, project `javascript-nextjs-tfila`, US region (`us.sentry.io`), token works for `/projects/{org}/{project}/events/`.

**Lesson:** Defensive static reading hits diminishing returns fast once the obvious throwers are eliminated. Runtime telemetry is the right answer.

### Decision 2 — Fix geo-tz with `serverExternalPackages` + `outputFileTracingIncludes` + try/catch around `findTz`

**Context:** The Sentry stack trace showed `Error: ENOENT: no such file or directory, open` inside `c.find` (geo-tz's `find()` function) calling `fs.openSync`, transaction `GET /`. geo-tz 8.1.7 reads its `.geo.dat` timezone-boundary data files from `node_modules/geo-tz/data/` at runtime, resolving paths relative to its own module dir. Two factors compound: (a) Next.js 16's Turbopack bundles geo-tz INTO an SSR chunk (`_0yjgu07._.js`), breaking `__dirname`-relative path resolution; (b) the `.geo.dat` binary files weren't traced into the deployment. The bug is location-specific because geo-tz only `openSync`s the `.geo.dat` for coordinate tiles requiring point-in-polygon precision — index-only-resolvable tiles (NYC, the old Thornhill coords) don't hit it.

**Options:** (a) `outputFileTracingIncludes` for geo-tz data only; (b) `serverExternalPackages: ["geo-tz"]` only — keeps the module un-bundled so its path resolution is correct, and nft tracing handles the files; (c) both belt-and-suspenders + a try/catch around the `findTz` call as a third defense; (d) wrap only — leaves the data still missing.

**Chose (c).** `serverExternalPackages` fixes the path-resolution side; `outputFileTracingIncludes` guarantees the data ships even if Next's `@vercel/nft` doesn't pick up the dynamic `fs.openSync` paths; the try/catch around `findTz` makes the core home page resilient to any future regression — falls back to `America/New_York` instead of 500-ing. Verified against the Next 16.2.4 docs (`outputFileTracingIncludes` and `serverExternalPackages` are both stable top-level config keys in Next 15+).

**Implication:** `next.config.ts` gains two keys; `app/page.tsx:247` wraps `findTz` in try/catch. Held in the plan file `~/.claude/plans/i-want-you-to-fluttering-canyon.md` — not yet coded; will ship as part of the next batch.

**Lesson:** Native-module data files on Next.js/Vercel need BOTH explicit external-package opt-out AND explicit file tracing. Sharp, geo-tz, aws-crt, canvas — same pattern.

### Decision 3 — Batch-then-code workflow: accumulate designed fixes in the plan file, implement together

**Context:** With the geo-tz fix designed, the natural impulse was to code + ship. User pushed back: "hold this in plan and we will continue to explore other things that come up. and code all at once."

**Options:** (a) ship each fix as soon as designed (small PRs, frequent reviews), (b) accumulate in the plan file until the user signals "ready," then implement everything as one batch PR.

**Chose (b).** User has now used this pattern twice in the same scope of work — the OPEN-ISSUES.md bundle for PR #4 was the same shape (explore → 12 entries accumulated → implement as one PR). Batching reduces PR overhead, lets related fixes share context in review, and matches the user's mental model of how the project moves forward.

**Implication:** `~/.claude/plans/i-want-you-to-fluttering-canyon.md` becomes the **live working draft for the next batch**. As issues are surfaced and diagnosed, new sections get appended. When the user signals readiness, all fixes go into one branch, one PR, one code-review. Until then: do NOT jump to coding when something is diagnosed. Capture the fix shape in the plan and ask what's next.

**Lesson:** Batch-then-code is a stable user preference for this project — codified in `[[feedback-batch-then-code]]`.

---

## 2026-05-19 — UNIQUE INDEX + cross-status dedup

Closing pass on the dedup + state-machine workstream. PR #2 left two follow-ups: clean up 3 cross-status duplicate pairs the original script missed, and add the DB-level UNIQUE INDEX. Both done this turn via PR #3 (`0aba418`).

### Decision 1 — Approved-status as PRIMARY sort key when picking dedup winners, not a tiebreaker

**Context:** Original `scripts/dedupe-data-sources.ts` only handled `approved+ok-vs-approved+ok` duplicates. Cross-status pairs (approved+ok vs pending, approved+ok vs approved+no_change) survived. First version of `scripts/dedupe-cross-status.ts` used the same sort as the original: `priority DESC, last_run_at DESC, id DESC`, with approved-status only as a tiebreaker for identical last_run_at. Dry-run revealed this picked pending+newer-last_run_at sources over approved+older — the wrong winner, because the pending row was a missed-supersede artifact, not a deliberate human approval.

**Options:** (a) leave sort as-is and rely on luck, (b) move approved-status to PRIMARY sort key before priority/last_run_at, (c) only de-dup within same review_status (would leave cross-status dups).

**Chose (b).** The semantic invariant is "human-approved sources should win over auto-pending re-extractions of the same URL." last_run_at recency is meaningless across review-status boundaries — a pending source can be more recent simply because the supersede gap let it accumulate.

**Implication:** `scripts/dedupe-cross-status.ts` sorts by `approvedScore DESC, priority DESC, last_run_at DESC NULLS LAST, id DESC`. Verified correct winners on dry-run before running for real (ds#83 Chevra, ds#80 Anshei Lubavitch, ds#101 The Shul — all approved sources retained).

### Decision 2 — Declare partial UNIQUE INDEX in schema.ts with matching `.where()` predicate

**Context:** Migration 0012 creates `CREATE UNIQUE INDEX ... WHERE review_status <> 'rejected'` via raw SQL. Without a matching schema.ts declaration, drizzle-kit's next diff run would see the live index as drift and offer to "fix" it (likely by recreating without the predicate). Tried initial declaration without `.where()` — that's worse than no declaration at all because it actively misleads drizzle-kit.

**Options:** (a) skip schema declaration entirely (drift never gets resolved in either direction), (b) declare without `.where()` (drift gets actively miscorrected), (c) declare with `.where()` to match prod (no drift).

**Chose (c).** Drizzle's IndexBuilder exposes `.where(condition: SQL)` (verified via `node_modules/drizzle-orm/pg-core/indexes.d.ts:67`). Declaration: `uniqueIndex("data_source_shul_identifier_idx").on(t.shulId, t.identifier).where(sql\`${t.reviewStatus} <> 'rejected'\`)`.

**Implication:** drizzle-kit diff will see schema = live state. Future migration writers can trust the schema as source of truth without needing to special-case this index.

### Decision 3 — Skip code review on migration-already-live PRs

**Context:** PR #3 represented changes already applied to prod (migration ran via surgical applier before PR was even opened). User asked "why do you need to run a code review?" on the auto-suggested `/code-review:code-review` step.

**Options:** (a) run review for completeness, (b) skip when the artifact under review is post-hoc reconciliation of already-live state.

**Chose (b).** Code review's value is catching problems before they ship. For a PR whose contents are (i) a migration already verified live, (ii) a runner script that already executed, (iii) a 7-line schema declaration mechanically derived from the live index — there's no in-flight risk to catch. Reviewing would be archaeology, not engineering.

**Lesson:** The review skill is the default workflow but it's a cost. Skip it when the PR is reconciling state that's already shipped. Apply review when the PR contains forward-looking code surface.

---

## 2026-05-18 → 2026-05-19 — phase-1 launch prep + ops gates

After running a full-project gap audit (three parallel Explore agents — public UX, ops/observability, security/testing/privacy), pivoted from "finish v2 rollout" to "make the site shareable to a 3-5 person test cohort in 1-2 weeks." Sequenced 17 tasks across productivity setup, implementation, and planning docs. Single commit `48aac17` (31 files) shipped + pushed + verified live.

### Decision 1 — Flip v2 global flag now, don't wait for cron-cycle validation

**Context:** Prior plan was to wait until Sat 2026-05-23 weekly cron + Sun morning summary email before flipping `EXTRACTION_PIPELINE_V2=true`. User wanted to test extraction by adding new shuls and observing in real-time, not by passive cron-watching.

**Options:** (a) wait for cron, (b) flip flag now + add new shuls organically, (c) hybrid (flag on for new shuls, cron paused), (d) keep per-shul whitelist + re-extract manually after each add.

**Chose (b).** Per-shul whitelist doesn't work for new submissions — `/submit` fires async ~30s after creation, can't add ID to env in time. Hybrid adds complexity for marginal safety; the canary already verified all 3 tiers. Single-env rollback (`vercel env rm EXTRACTION_PIPELINE_V2 production`) keeps risk bounded.

**Implication:** All 51 active shuls flip to v2 on next weekly cron. New submissions auto-run v2. PDF + email tiers get tested when organic shuls arrive.

### Decision 2 — Single commit for the launch-prep bundle, not split per-feature

**Context:** 31 files spanned 6 thematic groups (UX bundle, analytics, errors, rate limits, PWA, features, planning docs). Cleaner history says split; lower-ceremony solo workflow says bundle.

**Options:** (a) one comprehensive commit, (b) ~5 themed commits (UX, ops, features, infra, docs), (c) one PR per step.

**Chose (a).** User said "commit everything" — singular phrasing matched intent. Many files overlapped multiple themes (`app/page.tsx` touched launch-prep + travel-mode + freshness badge; `MinyanList.tsx` got every UI change). Splitting cleanly would have required hunk-level staging. The trade-off (less granular revert) is acceptable for a solo build.

**Implication:** Bisect would require unpicking sub-features manually. Acceptable cost.

### Decision 3 — Rate limit + cost-gate fail OPEN, not closed

**Context:** Both gates depend on external state — Upstash Redis env vars for rate limit, DB query for cost-gate cumulative-spend check. What if the external call fails mid-extraction?

**Options:** (a) fail open (allow the request when gate fails), (b) fail closed (block when gate fails), (c) circuit-breaker with auto-recovery.

**Chose (a).** Fail-closed means a DB hiccup or missing env var breaks the site / blocks all submissions / kills the weekly cron. Fail-open means a one-off check failure lets a request through that the gate would have caught — which is fine for both rate limit (next request still gets gated) and cost-gate (single LLM call past the cap is recoverable). Sentry catches the gate-internal failure for diagnosis.

**Lesson:** For protective gates, the cost of a missed request is lower than the cost of false rejection. Cost-gate explicitly logs `[cost-gate] failed to compute today's cost; failing open` for traceability.

### Decision 4 — Special-schedule badge uses amber, not rose

**Context:** Existing shul-detail page used `bg-rose-100 text-rose-800` for Yom Tov / fast-day badges. STYLE.md allows rose for "error" state. New feed-side badge needed the same treatment.

**Options:** (a) keep rose (consistent with existing), (b) unify to amber (caution, fits STYLE.md neutral-palette + one-accent), (c) use neutral-100 (no signal).

**Chose (b).** A Yom Tov schedule is "different from regular," not "wrong." Amber communicates "pay attention" without alarm. Also unified rose → amber in the existing detail page badge for consistency.

**Implication:** STYLE.md "neutral-palette + amber accent" pattern is upheld site-wide. Rose is now reserved for true error states (which we don't currently use).

### Decision 5 — Single minimal service worker for installability, not a precaching SW

**Context:** PWA installability needs a registered SW with a fetch handler. Offline caching is a separate concern.

**Options:** (a) full offline-capable SW with route precache, (b) runtime-cache strategy via Workbox, (c) minimal no-op pass-through SW.

**Chose (c).** The test-cohort goal is "site is installable," not "site works offline." Offline support adds cache-invalidation complexity (when does the shul page refresh?) that's out of scope for the first share-with-friends pass. A no-op SW exists, registers cleanly, makes the install prompt fire, and lets offline behavior be layered later without changing the registration shape.

**Implication:** PWA install works; no offline support yet. `public/sw.js` is ~20 LOC and obvious to extend when offline becomes a real need.

### Decision 6 — Vercel Analytics over Plausible / Umami / others

**Context:** Need lightweight pageview tracking to measure "3-5 real daveners used it" Phase-1 success criterion.

**Options:** (a) Vercel Analytics (built-in toggle), (b) Plausible (privacy-friendly third-party), (c) Umami (self-hosted), (d) custom.

**Chose (a).** Project is already on Vercel; analytics is a one-toggle + one-import addition (`<Analytics />` in `app/layout.tsx`). Free tier covers 2.5k visitors/month — plenty for first-cohort phase. Privacy concerns deferred until traffic warrants (Vercel Analytics is itself reasonably privacy-respectful — no cookies, no user IDs).

**Lesson:** Don't optimize for tools the platform already provides. Switching costs are zero now; would be expensive later if real instrumentation grows on top.

### Decision 7 — Inferred Upstash REST URL from user-pasted `redis-cli` command instead of asking

**Context:** User said the credentials were in `.env.local`. Grep found `UPSTASH_REDIS_REST_URL="redis-cli --tls -u redis://default:...@more-sheep-129736.upstash.io:6379"` — the native-protocol command, not the HTTPS REST URL that `@upstash/redis` SDK needs.

**Options:** (a) ask user to grab the correct REST URL from the Upstash dashboard, (b) infer the REST URL from the hostname in the command, (c) refuse to proceed.

**Chose (b).** Upstash REST URL pattern is `https://<hostname>` where hostname is the same as the native-protocol host. Inferred `https://more-sheep-129736.upstash.io`, verified via `curl -H "Authorization: Bearer <token>" /ping` which returned `{"result":"PONG"}`. Then fixed `.env.local` too so local dev matches prod.

**Lesson:** When the user pastes credential-adjacent context with a clear shape, infer and verify — it's faster than a clarifying round-trip. Verification (ping) closes the safety gap.

### Decision 8 — Build-phase deferral re-confirmed (no tests, no auth rework, no cred rotation)

**Context:** Gap audit surfaced zero test coverage, single-admin auth, and credentials in `.env.local` as latent issues. User's standing rule: defer security cleanup during build phase.

**Options:** (a) honor the deferral, (b) renegotiate per item, (c) start a minimal test scaffold despite the rule.

**Chose (a).** Repo is private (confirmed via AskUserQuestion) — credentials in committed files are not externally exposed. Tests can be added once daily active users > 50 per the existing "build phase ends" definition. Auth rework needs a real second-admin trigger, which doesn't exist. Pushing back on the deferral would be solving a problem the user has explicitly decided to defer.

**Implication:** Notes for revisit are captured in `feedback-security-cleanup-deferred` memory. Will resurface when build phase ends.

---

## 2026-05-18 (afternoon) — `/save` + `/resume` skill design

After the v2 canary expansion completed (all 3 tiers verified — see next section), built two user-level Claude Code skills to codify the session-continuity ritual that was being done manually. The skills + PreCompact hook are installed at user scope (`~/.claude/skills/`) so they work in every project.

### Decision 1 — Build skills, not slash commands

**Options:** (a) slash commands at `.claude/commands/`, (b) skills at `.claude/skills/`, (c) hooks-only auto-capture.

**Chose (b).** Slash commands are deprecated in favor of skills. Skills support `$ARGUMENTS`, rich frontmatter, supporting files, and are the modern equivalent. Pure prompt-injection is the right pattern for "ritual codification" — Claude executes the skill body using normal tools.

### Decision 2 — User scope, not project scope

**Options:** user-wide (`~/.claude/skills/`), project-only (`.claude/skills/`), or both.

**Chose user-wide.** Drift prevention is universal — every project benefits from `/save` + `/resume`. If a specific project later needs custom save behavior, drop a project-level `.claude/skills/save/SKILL.md` and Claude Code's resolver picks project over user (project wins on name conflict).

### Decision 3 — Pair `/save` with `/resume` (vs. /save only or auto-load)

**Options:** (a) `/save` only, (b) `/save` + `/resume` pair, (c) `/save` + auto-load on session start via CLAUDE.md instruction.

**Chose (b).** Auto-load (c) creates 5-10s overhead on every session start, including trivial questions where you just want to ask one thing. Manual `/resume` is opt-in: type 7 characters when you actually need state reconstruction. Pairs reinforce each other: `/save` at end, `/resume` at start.

### Decision 4 — Update existing docs, don't introduce a new SESSION-STATE.md type

**Options:** (a) update SESSION.md/PROGRESS.md/DECISIONS.md/auto-memory (existing pattern), (b) write a new SESSION-STATE.md per project, (c) both.

**Chose (a).** Reuses what's already maintained. SESSION.md gets the pickup snapshot (briefing format); DECISIONS.md gets new decisions; auto-memory gets durable user/feedback/project memories. No new file types to learn or maintain.

### Decision 5 — Quick mode + deep mode split (`/save quick` vs `/save`)

**Context:** sometimes you want a 2-line "stepping away from keyboard" save vs a full session checkpoint. v1 of the design was binary.

**Chose:** two modes. `/save quick` = ~10s, single block prepended to SESSION.md with branch/tasks/intent/next-action. `/save` (deep) = ~30s, full categorization + 4 files touched.

**Why it matters:** the PreCompact hook (Decision 7) uses `quick` mode so the auto-save doesn't take longer than the compaction itself. Forces a clean separation between defensive snapshots and intentional checkpoints.

### Decision 6 — Briefing-format SESSION.md sections (not just a free-form log)

Per Active Context Compression research (arxiv 2601.07190) and LangChain's deep-agents context-management guide, the highest-value format for cross-session handoff is a "briefing for the next LLM" with explicit fields:

- Where we are (2-3 sentences)
- Next concrete action (one sentence)
- Constraints to preserve
- Critical data (links, IDs, commits)

**Chose:** make this the FIRST sub-section of every new SESSION.md entry. Past sections were implicitly briefing-like; v2 makes the structure explicit so `/resume` can parse predictable headings.

### Decision 7 — PreCompact hook auto-fires `/save quick`

**Context:** user's original ask was "when the rag window is compressed... nothing is lost." Manual `/save` doesn't help if the user steps away or forgets — auto-compaction fires silently and replaces context with a lossy summary.

**Chose:** register a `PreCompact` hook in `~/.claude/settings.json` that runs `claude /save quick` before compaction. Catches the failure mode in the original ask. Per Claude Code's hook system, `PreCompact` fires reliably before compression happens.

**Implication:** even if user has zero `/save` discipline, the durable doc captures critical state before any compaction. Quick mode keeps the auto-save lightweight enough not to disrupt flow.

### Decision 8 — Goal-drift check in `/resume`

Per research (Active Context Compression paper): "2% misalignment → 40% failure rate" when drift compounds across sessions. v1 of the design had no drift detection — `/resume` just reported state.

**Chose:** add an explicit goal-drift step. `/resume` compares SESSION.md's "next concrete action" to the user's current intent in this new conversation. If they diverge, ask one explicit confirmation question ("Last session pointed at X. Your current message looks like Y. Continue X or pivot to Y?") rather than silently routing into the wrong work.

**Implication:** prevents the subtle failure where a user types "continue" but means something different from the prior session's stated next action.

### Out of scope (deliberate)

- **Multi-scope memory tagging** (mem0/agentmemory pattern with user_id/agent_id/session_id) — our auto-memory file types are working; defer.
- **Vector retrieval over historical sessions** — needs vector DB / MCP; over-engineered for v1.
- **Git tag at save point** — clever but adds friction.
- **CLAUDE.md pattern codification** ("decision recurred 3+ times → suggest codifying") — needs retroactive scan; defer.
- **Full agentmemory-style silent tool-use capture** — much bigger architectural change. PreCompact hook is the minimum-viable version.

### Sources

- [LangChain — Context Management for Deep Agents](https://blog.langchain.com/context-management-for-deepagents/)
- [Zylos — AI Agent Context Compression](https://zylos.ai/research/2026-02-28-ai-agent-context-compression-strategies)
- [Active Context Compression: Autonomous Memory Management in LLM Agents](https://arxiv.org/pdf/2601.07190)
- [Persistent Memory for AI Coding Agents — Sourabh Sharma (Medium)](https://medium.com/@sourabh.node/persistent-memory-for-ai-coding-agents-an-engineering-blueprint-for-cross-session-continuity-999136960877)
- [State of AI Agent Memory 2026 — mem0](https://mem0.ai/blog/state-of-ai-agent-memory-2026)
- [Continuous-Claude-v3 — context management via hooks + ledgers (GitHub)](https://github.com/parcadei/Continuous-Claude-v3)
- [Mastering Claude Code Sessions: --continue & --resume — AiOps School](https://aiopsschool.com/blog/mastering-claude-code-sessions-continue-resume/)
- [agentmemory — persistent memory for AI coding agents (GitHub)](https://github.com/rohitg00/agentmemory)

---

## 2026-05-18 (morning) — Extraction Pipeline v2 deployment + canary

Deploy day for the v2 rewrite built on 2026-05-17. Five concrete decisions captured below — the host-pivot, the canary shape, the two bugs found mid-canary, and the expanded-canary rollout plan. The build-side decisions are in the next section ("2026-05-17 — Extraction Pipeline v2 (one-shot rewrite)").

### Decision 1 — Docling host: Hugging Face Spaces over Fly.io

**Context:** the original plan in DECISIONS.md "2026-05-17" specified Fly.io as the deployment target for Docling because it's the Docker hosting sweet spot — fast deploys, sane defaults, auto-stop billing. We tried it first.

**The blocker:** Fly required a valid credit card for signup verification. The user's only payment instrument is a Wise prepaid card, which Fly rejected. Quote from the user: *"Docling on Fly.io wants a cc i only have a prepaid wise account and it does not work - what are my options?"*

**Options considered (no-CC required):**
- (a) Hugging Face Spaces — free CPU Basic tier (2 vCPU, 16 GB RAM), Docker SDK
- (b) Self-host on user's PC + Cloudflare Tunnel — only works when PC is on
- (c) Koyeb free tier — 512 MB RAM, tight for Docling

**Chose (a) Hugging Face Spaces.** Free forever, no CC EVER, 16 GB RAM (>>>Docling's 1 GB minimum), official-ish (HF has a partnership with IBM Research on Docling). 30s cold-start after 48h idle is acceptable for our weekly cron workload — one cold start across the whole batch. For ad-hoc admin "Extract now" actions, the 30s extra wait is rare.

**Implications:**
- Created HF account `IsKa123`, generated write token, saved to `.env.local` as `HF_TOKEN`
- Created Space `IsKa123/tfila-docling-serve` via HF API (no UI clicks needed)
- Pushed minimal Dockerfile wrapping `quay.io/docling-project/docling-serve-cpu:latest` (had to override entrypoint with explicit `--host 0.0.0.0 --port 7860` because HF requires port 7860 and the base image's `DOCLING_SERVE_PORT` env var override was silently ignored)
- Two build hiccups fixed mid-flight: `CORS_ORIGINS=["*"]` env var broke pydantic-settings JSON parser (removed; CORS doesn't matter for server-to-server); port env var ignored (overrode via CLI flag)
- Endpoint live at `https://iska123-tfila-docling-serve.hf.space`. Saved to `.env.local` + Vercel prod env as `DOCLING_URL`
- Smoke-tested against arxiv 9-page PDF: HTTP 200, 1.6 MB markdown, status=success, 89s processing

**New standing rule:** see [[feedback-no-credit-card-services]] memory file. Default to no-CC services first (HF, Koyeb, Cloudflare, Vercel hobby, Neon free, Resend free, Render free); only mention CC-required options when no-CC equivalent can't meet the need.

### Decision 2 — Single-shul canary first, NOT global flip

**Context:** rollout plan supported two patterns: (a) flip `EXTRACTION_PIPELINE_V2=true` globally and watch what happens, or (b) start with `EXTRACTION_V2_SHUL_IDS=<one shul>` and verify before widening.

**Chose (b) per-shul canary first, even though the feature is fully flag-gated.** Reasoning:

- Per-shul canary lets us pick a HIGH-CONFIDENCE v1 baseline (BAYT, 48 rules at 0.92) and detect regression vs that specific baseline. With global flip we'd be averaging across 51 shuls of varying quality and a regression on one shul could be masked.
- Per-shul canary also makes "rollback" trivial: just remove the ID from the env var. Global rollback needs `EXTRACTION_PIPELINE_V2` to be unset, which is the same action but applies to everyone — bigger blast radius for a typo.
- **Crucially:** the per-shul approach is the ONLY way to detect a silent "flag has no effect" bug. Which is exactly what happened — see Decision 4 below.

**Picked BAYT (id=41, html tier) as the first canary** out of 4 candidates:
- id=41 BAYT — 48 rules HTML 0.92 ← chosen, biggest sample = most regression surface
- id=7 Shaarei Tefillah — 29 rules HTML 0.92 — alternative
- id=56 The Shul — 8 rules vision 0.95 — saved for round 2
- id=10 Bris Avrohom Fair Lawn — 16 rules HTML 0.92 — fastest iteration if things go wrong

### Decision 3 — Merge `extraction-v2` to main + flag-gate vs preview-only

**Options:**
- (a) Merge extraction-v2 → main, flag gates rollout
- (b) Keep branch separate, deploy via Vercel preview URL first

**Chose (a).** Reasoning: v2 is feature-flag-gated at the dispatcher layer. With `EXTRACTION_V2_SHUL_IDS` unset and `EXTRACTION_PIPELINE_V2` unset, the dispatcher's `shouldUseV2()` returns false for every shul — main behaves IDENTICALLY to before merge. There's no risk in merging.

(b) would have added a layer (preview URL with different env scope) that doesn't catch anything (a) doesn't, while complicating the rollback story.

PR #1 opened with full diff summary + rollback playbook + test plan checklist. Merged via `gh pr merge 1 --merge --delete-branch=false` to preserve the branch for safety.

### Decision 4 — Mid-canary bug: `shulId` never threaded to dispatcher

**Symptom:** BAYT's first Extract Now after env var set + branch merged produced a data_source whose `config_json.usage` had no `v2Meta` and whose rules had no `sourceQuote`. The cascade clearly ran but it ran v1, not v2.

**Root cause:** the `runCascade()` dispatcher in `cascade.ts` reads `opts.shulId` to decide v1 vs v2. But the three call sites — `app/api/admin/shul/[id]/extract/route.ts`, `lib/inngest/functions/build-data-source.ts`, `lib/inngest/functions/scrape-one-shul.ts` — were all calling `runCascade(url, { timeoutMs: 25_000 })` without `shulId`. Without it, `shouldUseV2(undefined)` always returned false.

**This was a build-time bug I introduced when adding the dispatcher** in commit `4f9e9e9`. I added `shulId` to `CascadeOpts` but forgot to update the call sites. Typecheck didn't catch it because `shulId` is optional in `CascadeOpts`.

**Fix:** commit `7aa4c73` — threaded `shulId` from all three callers (each already had it in scope: `s.id` in the admin route, `shulId` param in build-data-source, `args.shulId` in scrape-one-shul).

**Lesson worth remembering:** if a feature flag depends on a value being passed through multiple layers, **make the type non-optional everywhere it can be non-null at the call site**, or add a runtime warning when the flag is set but the input is missing. We DO have a `console.warn` in `shouldUseV2` for "v2 enabled but no shulId provided; falling back to v1" — but it only fires when `EXTRACTION_PIPELINE_V2=true` AND shulId is null. The per-shul case (`EXTRACTION_V2_SHUL_IDS=41` AND shulId is null) silently fell to v1 with no warning. Should add a similar warn for that branch in a follow-up.

### Decision 5 — Mid-canary bug: router skipped HTML tier on legitimate calendar pages

**Symptom:** after fix #1, BAYT's second Extract Now still failed — but differently. The cascade attempts showed:
1. `html` tier `skipped` with errorMessage `"router: calendar_widget — jumping to JS render"`
2. `js_rendered` extracted 0 rules at 0.05 confidence (only 992 chars of markdown back from Browserless + sanitize)
3. `vision_image` extracted 0 rules from an unrelated FORWEBSITE.png banner
4. `pdf_document` skipped — no .pdf links on page

Result: cascade exhausted, shul marked `unsupported`. I had to manually restore `status='active'` in the DB.

**Root cause:** my router classified `bayt.ca/calendar` as `calendar_widget` (probably because the page DOES embed a JS widget) and the cascade had a branch (in `cascade-v2.ts`) that skipped the HTML tier on that hint, jumping straight to JS-render. But v1 had successfully extracted **48 rules from the SAME URL via raw HTML** — proving the schedule IS in static HTML, just alongside a calendar widget. The router was being too clever.

**Options considered:**
- (a) Keep the `shouldRerenderJs` branch but tune the router's classification to be more conservative — only `calendar_widget` when the page CLEARLY has no static schedule content
- (b) Remove the `shouldRerenderJs` branch entirely; always attempt HTML tier; let the cascade fall through to JS-render if HTML returns 0 rules
- (c) Run HTML AND JS-render in parallel, take the better result

**Chose (b).** Cleanest. The router's job is to ADVISE the cascade, not REPLACE the cascade's fall-through logic. The cascade was designed to fall through tiers; the router shouldn't short-circuit that. Cost is minimal — one extra Haiku call when HTML returns 0 (vs the entire failure we just saw).

**Fix:** commit `c22a29c` — removed the `shouldRerenderJs` branch in `cascade-v2.ts`. Router is now advisory only; HTML tier always attempts unless `shouldSkipExtraction` flags the page as non-schedule (about/blog/error). `shouldRerenderJs` is still exported from `router.ts` but unused — left for potential future use or removal.

**Result:** after deploy, BAYT's third Extract Now succeeded — 54 rules at 0.92 confidence, html tier, 100% sourceQuote coverage, single Haiku call. Matched v1's quality baseline.

**Lesson worth remembering:** ML-classifier-driven routing is risky when the classifier's wrong answer is "do nothing." Prefer "advise + still try" over "advise + skip" unless skipping is provably safe.

### Decision 6 — Expanded canary plan + global flip criteria

**Context:** BAYT canary success validated HTML tier + the agent loop. Still untested in prod: js_rendered, vision_image, pdf_document tiers, AND the email path.

**Plan (drafted in scratch file, saved to project as `docs/EXTRACTION-V2-ROLLOUT-PLAN.md`):**

- **Phase A — expand canary set:** add id=67 (Chevra Ahavas Yisroel, js_rendered) + id=56 (The Shul, vision_image) to `EXTRACTION_V2_SHUL_IDS`. Set becomes `41,56,67`.
- **Phase B — manually trigger** both new canaries; verify v2Meta + sourceQuotes vs v1 baselines.
- **Phase C — wait for weekly cron** (Sat 2026-05-23 03:00 UTC → Sun 2026-05-24 morning cron-summary email). Three canary shuls run through scrape-one-shul → cascade dispatcher → v2 path. Other 48 keep running v1.
- **Phase D — global flip (conditional):** if all 3 canaries `ok` Sunday morning, set `EXTRACTION_PIPELINE_V2=true`, remove `EXTRACTION_V2_SHUL_IDS`, all 51 active shuls run v2.

**PDF tier remains untested.** No PDF-bearing shuls in the active pool. Docling standalone smoke test passed; the integration is exercised end-to-end (HF Space + lib/scrapers/docling.ts + cascade-v2's tier 4) but no live shul has triggered it. **Decision: accept the gap, document it, defer real-world PDF canary until a PDF shul arrives organically.**

**Pass criteria per canary:**
- `last_run_status = ok`
- `confidence_score >= v1 baseline - 0.1`
- `rules_count >= v1 baseline * 0.8`
- `with_quote = total` (every v2 rule has sourceQuote)
- Cost within 3× v1 baseline

**Fail criteria (any of):**
- `last_run_status != ok`
- Rules dropped by >50% vs v1
- Cost exceeds 5× v1
- Confidence < 0.5 (was previously > 0.8)

A single canary failure pauses Phase D and triggers code-side investigation; doesn't roll back the others.

**Paused state at end of session:** Phase A NOT executed — user clicked Extract Now on 56 + 67 before env var update, so both routed to v1 (data_sources #100, #101 with no v2Meta). Resume by updating env var to `41,56,67` first, then re-trigger.

---

## 2026-05-17 — Extraction Pipeline v2 (one-shot rewrite)

The deepest decision thread of the entire build so far. Spans **two
sessions** (research night 2026-05-16, build day 2026-05-17), three
research docs (EXTRACTION.md / LLM-CONTEXT.md / EXTRACTION-PLAN.md),
one implementation plan (EXTRACTION-ONE-SHOT-PLAN.md), and 16 commits
on the `extraction-v2` branch.

### Context

The 2026-05-14 code-review night fixed the most acute v1 bugs (hash
mismatch wasting Sonnet calls on every weekly rescrape; non-atomic
rescrape; cost regressions). But the underlying extraction architecture
— direct JSON-out from Claude Haiku/Sonnet/vision/PDF with no agent
tools, no source attribution, no preprocessing, no critique — was
showing its age:

- Reviewers couldn't see *why* a rule was extracted. They had to open
  the source URL/PDF and visually find the line. Slow + error-prone.
- The LLM had no access to the Hebrew calendar, zmanim, prior
  extraction state, or rule validation while extracting. It had to
  guess.
- PDFs went straight to Claude-as-base64. Multi-page bulletins with
  tables lost structure.
- Email path duplicated agent orchestration in a different file.
- No router — every page (about pages, blog posts, error stubs)
  consumed full extraction budget.
- Hallucinated parshas / wrong-year dates kept slipping through.

Cron-summary script (built 2026-05-16, commit `165748d`) surfaced
21 broken extractions sitting in `scrape_run`. Empirical proof that
v1 has a tail problem.

### Research phase (2026-05-16 → 2026-05-17 morning)

Three living research docs were produced before any code:

1. **EXTRACTION.md** (commit `e0d737d`) — surveyed tech-stack swaps:
   Firecrawl, Jina Reader, Crawl4AI, LlamaParse, Reducto, Docling,
   Browserbase. Ranked 5 swap candidates by ROI; top three were
   (1) Anthropic tool use, (2) Jina Reader preprocess, (3) PDF
   preprocessor (LlamaParse or Docling).
2. **LLM-CONTEXT.md** (commit `fe72c9b`) — surveyed LLM-side
   strategies: tool use, prompt caching, structured output schemas,
   citations/grounding, agent loops, extended thinking, multi-pass
   audit.
3. **EXTRACTION-PLAN.md** (commit `c747d3c`) — first synthesis,
   phased rollout (3 phases over weeks). User pushed back: "is this
   really the best way to implement this — I want the best bang for
   my buck."

### User-driven scope decision

> "if time was not an issue — you are doing the coding so that's not a
> consideration — I want to implement the best possible improvement in
> one shot and then test it … choosing new tech stack that is free is
> fine"

This collapsed the phased plan into a single big rewrite. **Decision:
one-shot v2, free tech only, feature-flag gated for safe rollout.**
Captured in **EXTRACTION-ONE-SHOT-PLAN.md** (commit `4d1fa2b`).

### Decision 1 — Branch isolation: `extraction-v2`

**Options:**
- (a) Build v2 inline in `main` with feature flags
- (b) Long-lived branch `extraction-v2`, merge when proven
- (c) Fork the repo

**Chose (b).** Main stays clean and shippable for hotfixes during the
~16-step rewrite. Feature flag still controls rollout AFTER merge —
the branch is just a safety net during the build phase.

**Implication:** the dispatcher in `cascade.ts` (commit `4f9e9e9`)
lazy-imports the v2 module so v1-only deploys don't pay the v2 import
cost.

### Decision 2 — Feature-flag rollout shape

**Options:**
- (a) Global boolean: v1 OR v2 for everything
- (b) Per-shul subset: v2 only for explicit shul IDs (canary)
- (c) Percentage rollout (10% of shuls)

**Chose (a) AND (b) together.** `EXTRACTION_PIPELINE_V2=true` is the
global kill switch. `EXTRACTION_V2_SHUL_IDS=12,34` is the canary
override that lets us test v2 against a single trusted shul without
risking production traffic.

**Reasoning:** percentage rollout doesn't fit our workload — extractions
are per-shul, not per-request. Per-shul canary lets the same shul be
tested deterministically across multiple cron runs. Cheap to implement
(15-line `shouldUseV2()` helper).

**Implication:** v2 is dormant on merge. Production keeps running v1
until a specific shul ID is added to the env. `.env.example` documents
both knobs.

### Decision 3 — Free-tier tech stack only

**Considered (rejected):**
- LlamaParse for PDF — $0.003/page. Cheap per page but adds another
  vendor + key + billing surface.
- Reducto for PDF — more accurate than LlamaParse but expensive.
- Firecrawl as full preprocessor — would replace our cascade entirely;
  loses the multi-tier moat.
- Browserbase as Browserless swap — moderate cost, no compelling
  quality win over our existing Cloudflare Worker + Browserless
  free-tier combo.

**Chose:**
- **Jina Reader** (`r.jina.ai/<URL>`) — free, no API key, returns
  clean LLM-ready markdown stripped of nav/footer noise. Used as
  the HTML tier preprocessor.
- **Docling** (IBM open-source) — self-hosted PDF parser; preserves
  table structure across multi-page bulletins. Falls back to v1's
  direct-PDF-to-Claude when `DOCLING_URL` is unset.
- **Hebcal** (`@hebcal/core`) — already in package.json. Powers Hebrew
  calendar resolution + sunset/zmanim ranges as agent tools.

**Reasoning:** the highest-leverage swaps (preprocessing) don't need
paid services. Quality-per-dollar is best at the free tier; paid
options become attractive only once we have evidence the free tier
caps out.

### Decision 4 — Anthropic tool use for structured output (no JSON parsing)

**Options:**
- (a) Current v1 pattern: prompt asks for JSON, parse with
  `json-with-comments`, retry on parse failure
- (b) Anthropic tool use: define a tool whose `input_schema` IS the
  extraction shape; model emits a `tool_use` block with validated args

**Chose (b).** Removes all parse-failure code paths. The Anthropic SDK
validates against the JSON Schema before returning; if the model emits
malformed args the API rejects it server-side and we never see it.

**Implication:** `lib/llm/tools/extraction-output.ts` (commit `00b4e54`)
defines `extractionOutputTool` wrapping the full extraction schema.
Every v2 extractor uses it as the final tool in the agent loop.

### Decision 5 — Agent loop pattern (not single-shot prompts)

**Options:**
- (a) Single-shot: prompt → response (current v1)
- (b) Agent loop: prompt → `tool_use` blocks → execute → `tool_result`
  → repeat until model emits the final `emit_extraction` tool call

**Chose (b).** Lets the model do mid-extraction research instead of
guessing. Example: "this header says 'Parshas Behar' — let me call
`lookupHebrewDate({parsha:'Behar'})` to get the actual Gregorian
date range" instead of hallucinating a date.

**Implication:** `lib/llm/agent-loop.ts` (commit `dd88f4e`) is shared
across all v2 extractors. Tracks usage across iterations, audits tool
calls, caps iterations at 8 to bound runaway loops, supports extended
thinking when called for Sonnet.

### Decision 6 — Five mid-extraction tools (not more, not fewer)

The exact tool set was a deliberate cut. Rejected: a `web_search` tool
(scope creep, adds variance), a `fetch_url` tool (security risk), a
`screenshot` tool (cost). Kept:

1. **`lookupHebrewDate({parsha, year?})`** — resolves "Behar" to
   a date range. Uses `@hebcal/core`'s `HebrewCalendar.calendar()`.
2. **`getSunsetRange({lat, lng, daysAhead?})`** — returns
   shkia/netz/tzeis 72 per day. Used for zmanim-anchor sanity checks.
3. **`getPreviousExtraction({shulId})`** — queries DB for prior
   extraction. Lets the model reason about deltas vs hallucinating
   from scratch.
4. **`validateRule({rule})`** — local heuristics: time format,
   suspicious hours (3am Mincha = blocking), day-of-week range,
   validFrom/To consistency. Returns warnings + blocking flags.
5. **`searchHebrewMonth({name, hebrewYear?})`** — alias-aware
   resolver for "Nissan" / "Nisan" / "Sivan" with month index +
   Gregorian range.

**Implication:** `lib/llm/tools/*.ts` (commit `b889963`) — one file
per tool, each exports `<name>Tool` (Anthropic.Messages.Tool) and a
handler function. Shared across HTML/PDF/vision/email v2 paths.

### Decision 7 — Source-quote requirement (forced grounding)

Every v2 rule MUST include a `sourceQuote` field with a verbatim snippet
from the source. If the model can't quote where it found a rule, it's
required to NOT emit it. The Anthropic JSON Schema marks it required.

**Reasoning:** the single biggest reviewer pain point was "is this
real?" — having to open the source to verify each rule. Forced quoting
acts as both an accuracy gate (the model literally has to point to the
text) and a UX gift (reviewer sees the source inline).

**Implication:**
- Migration 0010 added `minyan_rule.source_quote` nullable column
  (commit `ffb873b`). Nullable so v1 rows aren't affected.
- `lib/llm/schema.ts` added optional `sourceQuote` to `RuleSchema`.
- `lib/pipeline/persist-submission.ts` writes `r.sourceQuote ?? null`
  into the column (commit `53fc4d0`). Same code path serves v1 (null)
  and v2 (always set).
- Admin data-source page renders each rule's `sourceQuote` as a
  collapsible `<details>` disclosure under the rule line (also
  `53fc4d0`).

### Decision 8 — Model strategy: Haiku first, Sonnet fallback

**Options:**
- (a) Sonnet only for everything (high quality, ~5× cost)
- (b) Haiku only (cheap, accuracy gaps on edge cases)
- (c) Haiku first, Sonnet fallback when Haiku confidence < 0.4

**Chose (c).** Same shape as v1 but with stricter floors and the
fallback gets extended thinking enabled.

**Reasoning:** Haiku 4.5 handles the long tail of clean weekly
schedules at ~1/5th the cost. Sonnet 4.6 with extended thinking
catches the messy PDF tables and ambiguous date sections. Two
models, two prompts, one agent loop infrastructure.

**Implication:** `lib/llm/extract-v2.ts` (commit `cc72c0e`)
implements the Haiku→Sonnet fallback with a `HAIKU_CONFIDENCE_FLOOR
= 0.4` constant. Sonnet fallback uses `enableThinking: true,
thinkingBudgetTokens: 3_000`.

### Decision 9 — Critique pass (two-pass audit, but only when needed)

**Options:**
- (a) Always run a critique pass after every extraction
- (b) Never (just rely on Haiku→Sonnet fallback)
- (c) Critique only when triggered: confidence < 0.7 OR rules
  dropped >50% vs prior extraction

**Chose (c).** Most extractions don't need it; the ones that do
benefit a lot. Cost is bounded because the trigger conditions select
exactly the high-risk extractions.

**Implication:** `lib/llm/extract-critique.ts` (commit `dd88f4e`)
defines `shouldCritique()` (the trigger predicate) and
`critiqueExtraction()` (the audit pass). Constants:
`CRITIQUE_TRIGGER_CONFIDENCE = 0.7`, `CRITIQUE_RULE_DROP_FRACTION
= 0.5`. The critic uses the same 5 tools so it can spot-check
the first pass's reasoning.

### Decision 10 — Critique NOT applied to vision tier (cost guard)

The critique pattern would require re-sending the image, doubling vision
cost. Vision is already on Sonnet-only by default (Haiku vision too weak
for stylized schedule typography), so cost-per-extraction is highest in
the cascade.

**Chose:** skip critique on vision for v2.0. Revisit if vision tier
accuracy doesn't improve enough from extended thinking alone. Marked
`void shouldCritique; void critiqueExtraction;` in `extract-vision-v2.ts`
to keep the import alive for the future enabling.

### Decision 11 — Router pre-classification (skip non-schedule pages)

**Options:**
- (a) Run extraction on every page; let confidence sort it out
- (b) Classify page type first; skip extraction on non-schedule pages

**Chose (b).** Hard-cap on wasted Sonnet calls.

**Implication:** `lib/llm/router.ts` (commit `f90381a`) classifies into
7 page types via Haiku + tool use:
- `weekly_schedule`, `yom_tov_special`, `calendar_widget` → extract
- `about_marketing`, `blog_news`, `error_or_empty` → skip
- `other` → extract with warning

`shouldSkipExtraction(t)` and `shouldRerenderJs(t)` helpers expose the
predicates. The cascade-v2 calls the router as a Tier-1 pre-step; on
"skip" it records the decision and continues to tiers 2/3/4 (the page
might still LINK to a real schedule PDF/image).

### Decision 12 — PDF strategy: Docling preprocess → reuse HTML pipeline

**Options:**
- (a) Separate v2 PDF agent (mirrors HTML agent but for PDFs)
- (b) Preprocess PDF → markdown via Docling, then feed markdown into
  the same `extractFromHtmlV2` pipeline

**Chose (b).** Massive code reuse. The agent loop, the 5 tools, the
critique trigger, the context preamble — all the same. Docling just
swaps the input source.

**Implication:** `lib/llm/extract-pdf-v2.ts` (commit `b0b1c7d`) is
**83 lines** because it delegates to `extractFromHtmlV2`. Returns
`v2Meta.preprocessor: "docling" | "direct-claude-fallback"` so the
admin can see which path served the extraction. Falls back to v1's
PDF-as-base64 path when Docling isn't deployed yet.

### Decision 13 — Email path: optional shulId (context preamble may be empty)

**Constraint:** the email path is sometimes called BEFORE a shul row
exists (the email itself creates the shul). The HTML/PDF/vision paths
always have a shul (it was created at URL submission time).

**Decision:** `extractFromEmailV2`'s `shulId` is **optional**. When
missing, skip the context preamble. When present, build the preamble +
allow `getPreviousExtraction` to actually query.

**Implication:** `lib/llm/extract-email-v2.ts` (commit `91a61a6`) has
a defensive branch around `buildContextPreamble`. The 5 tools are
still bound; `getPreviousExtraction` just returns "no shulId" when
called without context.

### Decision 14 — Cascade-v2 mirrors v1's 4-tier order

The router could in theory short-circuit straight to vision/PDF for
some page types. We deliberately did NOT do that — keep the tier
order identical to v1 (HTML → JS-rendered → Vision → PDF) so behavior
deltas during canary testing isolate to the agent pipeline, not the
fan-out logic.

**Implication:** `lib/llm/cascade-v2.ts` (commit `4f9e9e9`) is
structurally a copy of v1's `cascade.ts` with the extractor calls
swapped. Router only affects tier 1 (HTML); tiers 2/3/4 always run
on a non-useful tier-1 result.

### Decision 15 — Verbose admin source disclosure (not inline)

The `sourceQuote` could have been displayed inline next to the rule,
but most rules don't need to be inspected — only the suspicious ones.

**Decision:** collapsible `<details>` element with a "source" summary.
Clicked open shows a monospace quote in a bordered blockquote. Closed
by default — adds zero visual noise to the rule list.

**Implication:** the admin rule list stays compact for the common case
and expands on demand for the suspicious case.

### Build sequence (16 steps, 14 commits)

Order matters — each step adds an independently typecheck-clean piece:

1. Migration 0010 — `source_quote` column (`ffb873b`)
2. Anthropic tool def for output schema (`00b4e54`)
3. Five mid-extraction tools (`b889963`)
4. `build-context.ts` — shul metadata + Hebcal preamble (`9c3756e`)
5. `router.ts` — page-type classifier (`f90381a`)
6. `jina-reader.ts` — HTML preprocessor (`7000743`)
7. `docling.ts` — PDF preprocessor wrapper (`61707b0`)
8. `agent-loop.ts` + `extract-critique.ts` (`dd88f4e`)
9. `extract-v2.ts` — full HTML pipeline (`cc72c0e`)
10. `extract-pdf-v2.ts` — Docling reuse (`b0b1c7d`)
11–12. `extract-vision-v2.ts` + `extract-email-v2.ts` (`91a61a6`)
13. `cascade-v2.ts` + dispatcher in `cascade.ts` (`4f9e9e9`)
14. `.env.example` v2 flag documentation (`f8aeb89`)
15–16. `persist-submission` + admin disclosure (`53fc4d0`)

All commits on the `extraction-v2` branch. Main untouched.

### What's NOT in v2 (deliberate omissions)

- **No prompt caching yet.** Would compound the cost win but adds
  complexity; defer to a second pass once v2 stability is proven.
- **No multi-source corroboration.** When two sources disagree (PDF
  vs HTML vs email), v2 still picks the most recent. Cross-source
  reconciliation is a future Phase.
- **No automated tests for v2 paths.** Per
  `[[feedback-security-cleanup-deferred]]` — test coverage gap stays
  open during build phase.
- **No prod deployment.** Branch lives locally + on GitHub when pushed.
  No env flags set in Vercel prod. v1 keeps serving 100% of traffic.

### Rollout plan (next session)

1. Push `extraction-v2` to GitHub.
2. Deploy Docling to Fly.io (or skip — v2 PDF auto-falls-back to v1).
3. Set `EXTRACTION_V2_SHUL_IDS=<one trusted shul>` in Vercel prod env.
4. Trigger "Extract now" from that shul's admin page.
5. Review the resulting data source: do `sourceQuote` disclosures
   show? Confidence higher? Rules correct? Cascade attempts logged?
6. If good: expand `EXTRACTION_V2_SHUL_IDS` to 5–10 more shuls.
7. If still good after a weekly cron cycle: flip
   `EXTRACTION_PIPELINE_V2=true` for global rollout.
8. Monitor cron-summary email (built 2026-05-16) for any v2 regressions.

---

## 2026-05-16 — Observability: cron-summary script + weekly digest

### Context

The 2026-05-14 code review flagged "no observability" as a top gap.
Saturday-night weekly cron runs were producing data but nobody was
looking. Discovered 21 broken extractions sitting in `scrape_run`
that had been silently failing for weeks.

### Decision

Two-pronged: on-demand manual digest + automated weekly email.

1. **`scripts/cron-summary.mjs`** — manual on-demand digest. Runs
   locally against prod via `DATABASE_URL` from `.env.local`. Default
   6h lookback, widen with `--hours N`. Groups `scrape_run` by status,
   lists broken/error rows with shul + slug + error, reports stale-gate
   hidden count. Use Sunday mornings.

2. **`lib/inngest/functions/weekly-rescrape-summary.ts`** — fires
   Sundays 04:00 UTC (1h after the weekly-rescrape fan-out at Sun
   03:00 UTC). 90-min lookback captures the whole night's scrapes.
   Emails `ADMIN_EMAIL` via `notifyAdmin` with counts + per-shul
   broken/error detail + stale-gate alert.

### Reasoning

Two channels because they serve different time horizons:
- **Manual script** — for when you suspect something specific NOW.
  Fast iteration, no Inngest deploy required to change the query.
- **Automated digest** — keeps an unattended baseline visible. If
  you stop reading email entirely you'd still see "3 issues" in the
  subject line.

90-min window: ~150 shuls at 30s average = ~75 min worst case
including vision tier. 90 min covers that with margin.

Skips email entirely when `total=0` — avoids noise about nothing
(deploy paused, `SCRAPE_ENABLED=false`, etc.)

### Implication

Commit `165748d`. Followup `23251e9` added full URLs to the digest
email so links are clickable in Resend (the relative `/admin/shul/<slug>`
links don't resolve in mail clients).

---

## 2026-05-16 — Phase 2 candidate: "Tfila for Shuls" gabbai portal

### Context

Research-mode brainstorm asking "what could fundamentally change the
extraction problem?" The highest-leverage answer was a reframe: stop
scraping AT shuls, get shuls to PUBLISH to us.

### Decision

Documented as a Phase 2 candidate (NOT a commitment) in FEATURES.md.
Marked as "the most strategically interesting candidate in the Phase 2
pool — but also the most ambitious; not the right starting point unless
traction + ICP justify the sales motion."

### Reasoning

- **Stripe playbook.** Solve the gabbai's actual operational problem
  (manually writing weekly bulletins), structured data falls out as a
  side effect.
- **Sister to "compute schedule from rules"** thread: a year's schedule
  is derivable from 8–15 rules; the bulletin becomes a derived artifact,
  not a source of truth.
- **Cascade becomes fallback** for non-portal shuls. Nothing about
  Phase 1 work is wasted.
- **Network effects + defensible moat** vs current "we scrape your site"
  posture.

### Revisit triggers

- ≥1000 shuls in the directory AND recurring gabbai complaint, OR
- A strategic pivot (e.g., the directory commoditizes), OR
- A community org asking to manage 30 member shuls in one tool.

### Implication

Commit `5949ae8`. Pure documentation; depends on auth-rework Phase 2
entry. The first concrete action when this triggers: interview 5 gabbais
BEFORE building anything; sketch minimum portal in 3 screens; pair-launch
with a Vaad to skip the cold-start.

---

## 2026-05-17 — Resend `from` address: must use `onboarding@resend.dev` until domain verified

### Context

Trying to send the test cron-digest email locally with the Resend API
key. Email failed with a "domain not verified" error.

### Decision

For now, send all transactional + admin emails from
**`onboarding@resend.dev`** (Resend's free shared sandbox address).
Switch to a verified `@tfila.co` sender once a domain is verified
in Resend (production blocker, but not urgent during build phase).

### Reasoning

- Resend rejects sends from unverified domains.
- We don't want to verify `tfila.co` until the email model is
  finalized — that involves SPF/DKIM records + a deliverability
  reputation we can't yet justify investing in.
- `onboarding@resend.dev` is fine for the single-admin email model
  during build.

### Implication

`AUTH_EMAIL_FROM` is `hello@tfila.co` in `.env.example` but is
overridden in `.env.local` to `onboarding@resend.dev` during build
phase. Per `[[feedback-security-cleanup-deferred]]`, domain verification
goes on the "build phase ends" checklist alongside credential rotation.

---

## Cross-cutting principles (re-affirmed this week)

These aren't new decisions but were re-asserted by the user during the
extraction-v2 build. Captured here so they're discoverable from the
decision log directly.

### "Minimize what I have to do" (2026-05-16)

> "anything that you can do via api or yourself that minimizes what I
> have to do should be first top choice. even if you don't have the key
> or access ask for it. if I must do the technical work it is a last
> resort"

**Implication:** when v2 deploys, Claude executes Vercel env changes,
Inngest sync, Docling deploy, etc. via API/CLI rather than producing
step-by-step instructions for the user to follow manually. User keeps
credentials in `.env.local`; Claude asks for the env var names it needs.

### "Don't revoke credentials yet" (2026-05-16)

> "we are not revoking credentials till we have a stable functional
> build. right now the site is in the building stage."

**Implication:** the FEATURES.md "Credential rotation" gap stays open
through Phase 1. Don't list it in pickup TODOs. Revisit when the
working definition of "build phase ends" triggers (DAU > 50, ≥3 months
no critical bug, marketing motion in flight — 2 of 3 true).

### "I keep credentials in .env.local — computer is locked + secured"

**Implication:** Claude never logs credentials, never shows them in
chat, never commits them. Reads via `process.env.*` only. If a user
shares a credential in chat, treat it as a transient one-time use and
remind them it lives in `.env.local`.

---

## Doc index

Living research/planning docs that informed these decisions:

- [EXTRACTION.md](./EXTRACTION.md) — tech-stack survey (Firecrawl,
  Jina, Crawl4AI, LlamaParse, Reducto, Docling, etc.) ranked by ROI
- [LLM-CONTEXT.md](./LLM-CONTEXT.md) — LLM-side strategies (tool use,
  caching, schemas, citations, agent loops, extended thinking, audit)
- [EXTRACTION-PLAN.md](./EXTRACTION-PLAN.md) — first synthesis,
  phased rollout (superseded by ONE-SHOT below)
- [EXTRACTION-ONE-SHOT-PLAN.md](./EXTRACTION-ONE-SHOT-PLAN.md) — the
  16-step implementation plan that became this branch's commits
- [FEATURES.md](./FEATURES.md) — catalog of what exists + Phase 2
  candidate pool
- [PROGRESS.md](./PROGRESS.md) — rolling build log (latest at top)
- [SESSION.md](./SESSION.md) — canonical pickup doc for next session
