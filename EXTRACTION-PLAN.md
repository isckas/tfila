# Extraction upgrade plan — synthesizing EXTRACTION.md + LLM-CONTEXT.md

**Phased plan for evolving the data-extraction pipeline. Synthesizes the tech-stack research in [EXTRACTION.md](./EXTRACTION.md) (which engine runs the extraction) with the LLM-side strategies in [LLM-CONTEXT.md](./LLM-CONTEXT.md) (how smart we make that engine).**

**Last updated: 2026-05-17.** Living document — update after each phase based on what the test rig actually shows.

---

## The big picture

**Goal:** evolve from "single-shot, blind extraction" → "agent with context, tools, and self-review" — without throwing away the cascade architecture or the few-shot domain prompt (our moat).

**Two principles:**
1. **Order matters because changes compose multiplicatively.** Tool use is the prerequisite for tool-augmented extraction. Context-rich prompts make the critique pass smarter. Doing them out of order means redoing work.
2. **Measurement gates every phase.** Each phase ends with re-running the test rig (Phase 0) and comparing metrics. If a phase doesn't improve numbers, revert before continuing. No big-bang rewrites.

**Ground-truth benchmark (today, 2026-05-17):**
- Last night's cron: 57 scrapes total
- **Broken: 21 (~37% failure rate)**
- This is the rate we're trying to bring down — not via individual heroics but via systematic agent capabilities.

**Concrete success target:** broken-rate from 37% → <15% by end of Phase 2. If we hit that, Phases 3-4 become optional.

---

## Phase 0 — Build the test rig (prerequisite for every later phase)

**Why first.** Every idea in EXTRACTION.md and LLM-CONTEXT.md ends with "validate with the test rig." Without it, every improvement claim is anecdotal. Without it, we can't know if Phase 1 actually helped. Skipping this is the most common way extraction-rewrite projects fail.

### Deliverables

1. **15-20 hand-curated fixtures** across all tiers:
   - 5 HTML schedule pages (ShulCloud, WordPress, custom CMS, table-layout, prose-only)
   - 3 JS-rendered (anash.ca-style dynamic image src; Wix calendar widget; ShulCloud opaque aid-URL)
   - 4 PDFs (clean single-page; multi-page bulletin with schedule on page 3; image-heavy bulletin; scanned PDF)
   - 3 vision images (clean weekly schedule snapshot; stylized typography; multi-column poster)
   - 3 email bulletins (text-only; HTML-formatted; complex with quoted-reply chain)
   - **Plus 5 representative shul rows from last night's 21 broken cases** — those become the regression set we want explicitly to fix

2. **Hand-written "correct" extractions** for each fixture — JSON in the same shape our schema emits

3. **A runner script** `scripts/eval-extraction.mjs` that:
   - Loads fixtures + expected outputs from a versioned directory
   - Runs the current cascade against each
   - Diffs output vs expected (rule-level)
   - Emits a scorecard: rules matched / rules missed / rules invented / confidence accuracy / per-extraction cost / per-extraction latency
   - Saves the scorecard with a git commit hash so we can compare across changes

4. **Baseline scorecard** captured BEFORE any extraction code change

### Effort

~6-8 hours total. The fixture-creation is the hardest part (you have to manually verify each correct extraction by reading the source). The runner is ~100 lines.

### Why this can't be skipped

Every "did this swap help?" question in Phase 1+ is answered by re-running this rig. No rig = decisions by vibes. The same 15-20 fixtures evaluate every future swap candidate forever — it's a build-once, use-forever investment.

This also doubles as a regression test: any future change to extraction code re-runs the rig and catches regressions before they ship.

---

## Phase 1 — Foundation (compose well, low risk, no architectural changes)

Three changes that prepare the substrate for Phase 2. They don't require swapping vendors or rewriting tiers.

### 1A. Anthropic tool use for structured output

**Source:** [EXTRACTION.md](./EXTRACTION.md) rank-1 swap candidate.

**What.** Replace bare JSON parsing in `extract.ts`, `extract-pdf.ts`, `extract-vision.ts`, `extract-email.ts` with Anthropic's tool-use API. Define the extraction schema as a tool; Claude is forced to call it with valid arguments.

**Why first within Phase 1.** Every other change is easier on top of tool use. Tool-augmented extraction (Phase 2B) literally requires this foundation.

**Eliminates these failure classes:**
- "Claude wrapped JSON in markdown fences"
- "Claude added prose preamble before the JSON"
- "JSON truncated mid-array when output tokens ran out"

**Output:** PR ~50-80 lines. Mechanical refactor; schema stays identical.

**Cost:** Same per-token cost as today. No new dependencies.

**Reversibility:** Trivial. One PR can switch back to bare JSON parsing.

### 1B. Context-rich prompts

**Source:** [LLM-CONTEXT.md](./LLM-CONTEXT.md) strategy 3.

**What.** Front-load shul metadata + prior extraction + Hebrew-calendar context BEFORE the page content. Use Anthropic prompt caching so the metadata prefix doesn't blow per-call costs.

**Why second within Phase 1.** Uses data we already have but currently ignore (prior extraction in DB, shul timezone, nusach, Hebcal date context). Immediate quality gain on the cascade's hard pages.

**Eliminates these failure classes:**
- Year-defaulting bugs (Safra-style "ad_hoc with past validFrom") — Claude sees today's Hebrew date
- Nusach-mismatch confusion (Chabad page references "Tanya 6:00 AM" — context tells Claude that's a shiur, not a minyan)
- Drift detection ("Mincha was 19:15 last week, today says 19:30; probable seasonal shift, high confidence")

**Output:** PR ~100-150 lines. New `lib/llm/build-context.ts` helper. Wired into each extract function's prompt assembly.

**Cost:** ~500-1500 extra prompt tokens per call, but prompt caching makes this near-zero on cache hits.

**Reversibility:** Medium. Once context is baked in, going back means re-validating that no extractions started depending on it.

### 1C. Citations / grounding

**Source:** [LLM-CONTEXT.md](./LLM-CONTEXT.md) strategy 6.

**What.** Schema change: every rule has a `source_quote: string`. The extraction prompt requires Claude to quote the exact source text per rule.

**Why third within Phase 1.** Small change, large audit/trust gain. Makes Phase 2's critique pass meaningfully better (critic sees what the first pass thought it was extracting AND where it found it).

**Eliminates these failure classes:**
- Hallucination: Claude can't emit a Sunday Maariv rule if it can't quote where it found it
- "Where did this rule come from?" mystery in admin review

**Output:** PR ~30-50 lines. Schema gets `source_quote: string`. Prompt mentions the new field. Admin UI shows hover-tooltip with the quote on each rule.

**Cost:** Slight increase in output tokens (~30-100 chars per rule). Negligible.

**Reversibility:** Trivial. Field is optional; can be made unused.

### Phase 1 milestone

Re-run test rig. Expected metric changes:
- **Rule accuracy:** flat-to-slightly-up (citations should reduce invented rules)
- **Confidence calibration:** improved (context helps with edge-case judgments)
- **Cost:** roughly flat (prompt caching offsets context-prefix overhead)
- **Latency:** roughly flat
- **Broken-rate:** modest improvement, maybe 37% → 30%

If metrics don't improve at all, investigate before proceeding to Phase 2. The wins are real but small until Phase 2 multiplies them.

---

## Phase 2 — Smart extraction (depends on Phase 1)

These shift the architecture from "pure function" to "small agent." Each depends on Phase 1's tool-use foundation.

### 2A. Two-pass extract + critique

**Source:** [LLM-CONTEXT.md](./LLM-CONTEXT.md) strategy 1.

**What.** Triggered only on confidence < 0.7 OR a sharp rule-count drop. Second Haiku call: "audit this extraction; find errors; propose fixes." Output is either confirmation or a revised extraction.

**Why first within Phase 2.** Highest-ROI single change in either source doc. Catches the exact failure patterns from last night (Valley Outreach 5→0 rule drop, Agudath Toronto 13→5 drop, the ~14 low-confidence cases). Mechanically simple.

**What it would have caught last night:**
- *Valley Outreach (5→0)*: critique would say "first pass returned 0 rules but the page has visible weekday schedule starting at row 47. Here are 5 rules."
- *Agudath Toronto (13→5)*: critique would say "Shabbos section parsed, weekday section skipped — adding 8 rules."
- *Low-confidence (~14 cases)*: critique either confirms (admin-actionable) or finds the issue.

**Output:** PR ~150-200 lines. New `lib/llm/extract-critique.ts`. Wired into rescrape + admin-extract paths after first extraction completes.

**Cost:** +$0.005-0.01 per triggered case (~20-30/week). Tiny.

**Reversibility:** Trivial. Just remove the conditional second-call.

### 2B. Tool-augmented extraction

**Source:** [LLM-CONTEXT.md](./LLM-CONTEXT.md) strategy 2.

**What.** Define 3-5 tools Claude can invoke mid-extraction:
- `lookupHebrewDate({parsha, year})` → Hebcal-backed; resolves "Parshas Behar" to a date range
- `getSunsetRange({lat, lng, daysAhead})` → Hebcal-backed; verifies zmanim-relative times are consistent
- `getPreviousExtraction({shulId})` → DB-backed; Claude can compare to last successful extraction
- `validateRule({rule})` → local sanity checks (Mincha at 02:30 → warning; rule with overlapping days_of_week → warning)
- Optional: `searchHebrewMonth({name})` → map Hebrew month names to numbers

**Why second within Phase 2.** Depends on Phase 1A (tool use) being live. Eliminates whole error classes that no amount of prompt engineering can fix (Claude can't know this year's parsha-date mapping from training alone).

**Output:** PR ~250-350 lines. New `lib/llm/tools/` module with one file per tool. Each extract function declares the relevant tool array.

**Cost:** +1-3 API round-trips per extraction on average. Each tool call is cheap (~$0.001). Net cost up ~10-15%; net quality up much more.

**Reversibility:** Medium. Each tool is independent; can remove individually. The tool-use API surface stays.

### Phase 2 milestone

Re-run test rig. Expected metric changes:
- **Broken-rate:** target 37% → <15%
- **Rule accuracy:** notable improvement on previously-broken regression cases
- **Cost per extraction:** +10-20% (worth it if quality up meaningfully)
- **Latency:** +1-3 seconds on critique-triggered cases (acceptable for cron; not great for sync admin extracts but tolerable)

If the broken-rate doesn't drop meaningfully, investigate. Could be:
- Critique prompt needs work
- Critique should escalate to Sonnet for hardest cases
- Some failure modes need a different strategy (e.g. anti-bot blocks won't be fixed by smarter extraction)

---

## Phase 3 — Tier-specific upgrades (after Phase 1+2 are stable)

These swap individual tier implementations for managed services. Each can be done independently. Each is reversible.

### 3A. LlamaParse for the PDF tier

**Source:** [EXTRACTION.md](./EXTRACTION.md) rank-3 swap.

**What.** Replace the current "send PDF to Claude as base64" approach with LlamaParse for the PDF-to-markdown step, then run the Phase-1+2-enhanced extraction on the clean markdown.

**Why first within Phase 3.** Biggest quality improvement on the cascade's weakest tier. Specialized PDF parsers (agentic OCR + vision-language models + multi-pass layout review) measurably outperform direct LLM-on-base64-PDF.

**Output:** PR ~200-250 lines. New `lib/llm/extract-pdf-llamaparse.ts`. Cascade swaps to use it. Existing `extract-pdf.ts` retained as fallback for the first 2 weeks.

**Cost:** LlamaParse is paid per page (~$0.001-0.005 each). The Claude extraction cost goes DOWN (smaller input → fewer tokens). Net probably flat or slightly negative cost.

**Reversibility:** Easy. PDF tier is well-isolated.

### 3B. Jina Reader as HTML preprocessor

**Source:** [EXTRACTION.md](./EXTRACTION.md) rank-2 swap.

**What.** Before LLM extraction, pipe HTML through `https://r.jina.ai/<URL>` for clean markdown. Pass markdown (not raw HTML) to Claude.

**Why second within Phase 3.** Smaller per-tier quality gain than PDF, but big code-simplification win — removes ~150 lines of custom HTML sanitization + UA-fallback. Wait until PDF tier is stable on LlamaParse before swapping HTML too (one risky vendor change at a time).

**Output:** PR ~100-150 lines (mostly deletions). Custom `sanitize.ts` and `fetch.ts` UA fallback retained as backup for when Jina fails.

**Cost:** Jina free tier covers 1M tokens/month; we'd likely stay within it. After: $0.02/M tokens.

**Reversibility:** Medium. Once on Jina, going back requires re-validating that custom sanitization still works.

### 3C. Reasoning mode for Sonnet fallback

**Source:** [LLM-CONTEXT.md](./LLM-CONTEXT.md) strategy 4.

**What.** When the cascade falls through to Sonnet (Haiku confidence < 0.4), enable `thinking: { type: "enabled", budget_tokens: 4000 }`. Sonnet takes ~20 seconds to reason about page structure in a hidden scratchpad before emitting JSON.

**Why third within Phase 3.** Tiny code change (~10 lines), but only kicks in on the ~30-50 hardest cases per week. Worth doing for completeness; not a structural shift.

**Output:** PR ~10 lines. Wraps existing Sonnet call.

**Cost:** +$0.05-0.10 per triggered case. Triggers on ~30-50 cases/week max.

**Reversibility:** Trivial.

### Phase 3 milestone

Re-run test rig. Expected metric changes:
- **PDF tier quality:** noticeable improvement (specialized parsers vs direct LLM)
- **HTML tier quality:** slight improvement (Jina handles ads/nav/markdown conversion cleanly)
- **Code volume:** ~150 lines deleted
- **Cost per extraction:** roughly flat or slightly down (fewer tokens to Claude offset by Jina/LlamaParse fees)

If quality regresses on any tier, the swap-back path is well-defined (fallbacks are retained).

---

## Phase 4 — Operational optimizations (only after Phase 3 stable)

### 4A. LLM router

**Source:** [LLM-CONTEXT.md](./LLM-CONTEXT.md) strategy 5.

**What.** Cheap-Haiku pre-classification step routes pages to specialized prompt variants: weekly_schedule / yom_tov_special / about_or_marketing / calendar_widget / 404. Skip extraction entirely on non-schedule pages.

**Why deferred.** Doesn't directly improve accuracy on already-broken cases. Pure cost + correctness optimization (right prompt for the right page shape).

**Output:** PR ~150-200 lines. Router + 3-4 prompt variants.

### 4B. Cross-shul corroboration

**Source:** [LLM-CONTEXT.md](./LLM-CONTEXT.md) strategy 7.

**What.** Statistical sanity check against similar shuls. k-NN by location + nusach + size. Confidence-modifier on extractions that look anomalous vs peer set.

**Why deferred.** Value scales with directory size. Premature at ~100 shuls; high-impact at 1000+.

**Output:** PR ~300+ lines. Similar-shul lookup + corroboration prompt + soft-signal weighting.

---

## What we deliberately SKIP

These came up in research but are explicit non-starters:

- **Full Firecrawl / ScrapeGraphAI replacement** ([EXTRACTION.md](./EXTRACTION.md) rank 5). The custom domain prompt IS our differentiation. Replacing the whole stack loses the moat. Hard no.
- **Browserbase swap** ([EXTRACTION.md](./EXTRACTION.md) rank 4). Browserless works. Not a pain point. Skip until it becomes one.
- **All 5 architecture reframes** (portal, compute-from-rules, davener-as-sensor, schema.org, multi-source corroboration). Those are Phase 2 product features in FEATURES.md, not Phase 1 extraction work.

---

## Total effort + sequencing

| Phase | Items | Effort | Risk | Reversibility |
|---|---|---|---|---|
| 0 | Test rig | 1 day | Low | N/A (additive) |
| 1A | Tool use migration | 0.5 day | Low | Trivial |
| 1B | Context-rich prompts | 1-2 days | Low | Medium |
| 1C | Citations | 0.5 day | Low | Trivial |
| 2A | Two-pass critique | 1 day | Low-Medium | Trivial |
| 2B | Tool-augmented extraction | 2-3 days | Medium | Medium |
| 3A | LlamaParse for PDF | 2 days | Medium (new vendor) | Easy |
| 3B | Jina Reader for HTML | 1-2 days | Medium (new vendor) | Medium |
| 3C | Sonnet thinking mode | 0.5 day | Low | Trivial |
| 4A | LLM router | 1-2 days | Low | Medium |
| 4B | Cross-shul corroboration | 3-4 days | Low (when scale right) | Medium |

**Total: ~14-17 days of focused engineering across the entire plan.**

**Realistic calendar:** spread over 6-8 weeks with measurement + iteration between phases. Don't try to crunch — the test-rig re-runs between phases ARE the work, not interruption to it.

**Critical path:** Phase 0 → 1A → everything else. If you skip the test rig OR skip tool use, the rest of the plan cascades poorly.

---

## Risk view

**Low-risk PRs that can ship next week if you want:**
- Phase 0 (test rig)
- Phase 1A (tool use migration)
- Phase 1C (citations)

**Medium-risk that wait for Phase 1 + first measurement:**
- Phase 1B (context-rich prompts) — risk of over-anchoring to bad prior extractions
- Phase 2A (critique) — risk of critic introducing errors
- Phase 3A (LlamaParse) — new vendor dependency, vendor outage = our outage

**Higher-risk that should wait further:**
- Phase 4B (cross-shul corroboration) — needs scale; easy to over-engineer

---

## Recommended start (the narrow plan)

If you adopt this plan, here's the specific 4-week wedge to start with:

### Week 1: Phase 0 only

Build the test rig. Capture baseline. **Don't touch extraction code.** This week's deliverable is the runner script + 15-20 fixtures + a baseline scorecard committed to the repo.

Why this matters: every subsequent measurement requires this. Skipping it means you have no way to know if Week 2-4 work helped.

### Week 2: Phase 1A (tool use) + 1C (citations)

Both small PRs. Each independently reviewable. Re-run rig after each merge.

Why both this week: tool use is the prerequisite for Phase 2B; citations are a low-effort audit-trail win that pairs with Phase 2A's critique pass.

### Week 3-4: Phase 1B (context-rich) + 2A (critique)

The two pieces that compose into the biggest accuracy gain. Measure after each.

Why this is the heart of the plan: by end of Week 4, the broken-rate target (37% → <15%) is reachable. If you hit it, Phases 3-4 become optional. If you don't, you have specific test-rig data to diagnose what's still failing.

### Reassessment point (end of Week 4)

Look at the rig metrics. Three outcomes:

1. **Hit the <15% target.** Phase 3+ optional. Stop here, observe production, revisit when needed.
2. **Big improvement but not all the way.** Decide whether Phase 3A (LlamaParse for PDF specifically) closes the remaining gap. Probably yes if PDFs are over-represented in residual broken cases.
3. **Modest improvement.** Investigate why. Could be: bad prompt design in critique, anti-bot blocks (not solvable by smarter extraction), or fundamentally messy source pages where no amount of LLM magic helps. Pivot strategy based on findings.

---

## Success criteria (concrete, measurable)

By end of Phase 1: broken-rate from 37% → 30% (modest)

By end of Phase 2: broken-rate from 37% → <15% (the real target)

By end of Phase 3: broken-rate from 37% → <10% AND ~150 lines of custom code deleted

By end of Phase 4: cost-per-extraction down 20-40% via routing; cross-shul corroboration catches the last few percent of subtle errors

If Phase 2 alone hits the <15% target, that's a successful project — Phases 3-4 become "nice to have."

---

## Related docs

- **[EXTRACTION.md](./EXTRACTION.md)** — tech-stack research (which engine runs the extraction); source for Phases 3 swap candidates
- **[LLM-CONTEXT.md](./LLM-CONTEXT.md)** — LLM-side strategies (how smart the engine is); source for Phases 1B, 1C, 2A, 2B, 3C, 4A, 4B
- **[FEATURES.md](./FEATURES.md) → "LLM extraction context"** — original high-level FEATURES entry that seeded this thread
- **[FEATURES.md](./FEATURES.md) → Phase 2 features** — broader architecture reframes (portal, compute-from-rules) that complement but don't substitute for this extraction-quality work
- **[PROGRESS.md](./PROGRESS.md)** — running build log; track each phase's PR shipment here

---

## Notes for future updates to this document

- **Capture rig metrics after each phase.** Add a "Phase X completed" subsection with the before/after scorecard so we have a permanent record of what each change actually delivered.
- **Adjust phase plan based on data.** If Phase 1 metrics suggest the critique pass alone wouldn't help much, re-order. The plan above is the BEST GUESS today; reality should override it.
- **Promote successes to FEATURES.md.** Any phase we ship gets a proper FEATURES.md entry with options + tradeoffs + decision (the historical record). This doc stays as the upstream plan.
- **Note unforeseen issues.** If LlamaParse turns out to be unreliable, write WHY here so future-Isaac doesn't try it again hoping for different results.
- **Re-read before each Phase kickoff.** The temptation to skip the test rig or jump straight to "the cool agent stuff" will be constant. The plan exists to resist it.
