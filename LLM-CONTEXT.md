# LLM Context — making Claude smarter in the extraction pipeline

**Living research document. Sister to [EXTRACTION.md](./EXTRACTION.md). Not a decision; not a roadmap. A record of ideas for using Claude more intelligently — with more context, more tools, more self-review — so extraction quality goes up without ballooning code complexity.**

Last updated: 2026-05-17. Add to as we run experiments, as new Anthropic capabilities ship, or as we identify new failure modes from production.

---

## The goal

Today's extraction stack treats Claude as a pure function:

```
HTML in → JSON out
```

That's exactly how LLM-extractors looked in 2023-2024. The 2025-2026 wave shifted to treating the LLM as a small **agent** with access to context, tools, and self-review — and the accuracy gains are real.

This document captures concrete ways to evolve our extraction from "pure function" to "context-aware agent" without changing the overall architecture. Every idea here:
- **Keeps the existing 4-tier cascade** (see EXTRACTION.md for that broader story)
- **Preserves the few-shot domain prompt** (our moat — Jewish bulletin context generic services don't have)
- **Composes with the swap candidates in EXTRACTION.md** rather than competing with them

If EXTRACTION.md is about *which engine* runs the extraction, this doc is about *how smart that engine is allowed to be*.

---

## Status quo — how Claude is used today

Single-pass, isolated extraction per page:

1. **`extract.ts`** — sanitized HTML → Claude (Haiku 4.5) with the 4K+ system prompt + 5 few-shot examples → JSON string → Zod parse → done. Sonnet 4.6 fallback if Haiku confidence < 0.4.
2. **`extract-pdf.ts`** — same shape, with PDF as base64 input.
3. **`extract-vision.ts`** — image URL input, vision model.
4. **`extract-email.ts`** — email body as input.

What the model sees:
- ✅ The 4K+ system prompt with domain context and few-shot examples
- ✅ The page/PDF/email content
- ❌ Nothing about which shul this is, what nusach, what timezone, what we extracted last week
- ❌ Nothing about today's Hebrew date, upcoming Yom Tov, etc.
- ❌ Nothing about similar shuls' typical schedules
- ❌ No tools to ask for help when uncertain
- ❌ No second chance to self-correct

The model is reasoning from page content + general knowledge + 5 hand-picked examples. That's it.

What it produces:
- ✅ A JSON object the Zod schema validates
- ✅ A self-reported confidence score (0.0-1.0)
- ✅ A "reasoning" field (1-3 sentences explaining its choices)
- ❌ No citations of WHERE in the page each rule came from
- ❌ No flags for specific concerns ("I'm unsure about X")
- ❌ No second opinion

Real-world impact from last night's cron run (2026-05-17):
- 57 scrapes total
- 29 ok, 7 no_change, **21 broken**
- Many broken cases have low-confidence symptoms: 0.05-0.45 scores, sharp rule-count drops, cascade-tier failures

**These 21 are the ground-truth test set for any idea below.** Each idea below includes "what it would have done for one of last night's failures."

---

## Strategy 1: Two-pass extract + critique

**The idea.** First call: Haiku extracts as today. Second call: a "critic" gets both the source AND the extraction, asked to find errors, missing rules, misinterpretations, and propose fixes. Only fires when first-pass confidence < 0.7 OR a sharp rule-count drop is detected.

**Mechanics.**
- Critic prompt is short (~500 tokens): "You're auditing an extraction. Here's the source. Here's the extracted JSON. Find any errors. Output a revised JSON OR confirm the original is correct."
- Critic uses the SAME model (Haiku) for cost — second-look value comes from fresh eyes, not bigger model. Optional Sonnet for the hardest cases.
- Output: revised extraction + a confidence-of-correction score.

**Why it changes things.**
- A first-pass extractor focused on "find the schedule" can miss things a second-pass reviewer focused on "find the bugs" would catch.
- Same pattern that works in human peer review, code review, scientific publishing.

**What it would have caught last night:**
- *Valley Outreach Synagogue (5 → 0 rules)*: critic looks at the page, sees "Mincha 7:15 PM, Maariv 8:00 PM" on a Sunday section the first pass clearly missed. Says: "First pass returned 0 rules but the page has a visible weekday section starting at row 47. Here are 5 rules from that section."
- *Agudath Toronto (13 → 5 rules)*: critic notices "Shabbos section produced 5 rules but weekday section was skipped. Adding 8 weekday rules."
- *Low-confidence cases (~14 of 21)*: critic either confirms "yeah this is genuinely unparseable, low confidence is correct" — which is actionable signal for admin — or finds the issue.

**Integration cost.** ~1 day. Add to `extract.ts` after the first call; fire conditionally on low-confidence triggers. Cost adds ~$0.005-0.01 per critique-triggered case (~20-30 cases/week). Almost certainly a net win.

**Trade-offs.**
- More tokens per extraction in the worst case — but only for the 30%-ish cases that would have been broken anyway.
- Adds latency to those cases — irrelevant for cron-driven extractions; mildly annoying for the synchronous `/admin/shul/[id]/extract` flow.
- Potential for the critic to over-correct (introduce errors when first pass was actually right). Mitigated by always preserving the first pass + having the critic explicitly say "no changes" when applicable.

**Inspired by.** Code review (always two pairs of eyes), academic peer review, the "self-consistency" pattern in LLM research, the "consistency-via-critique" pattern from Anthropic's own published work on extraction.

---

## Strategy 2: Tool-augmented extraction (Claude as small agent)

**The idea.** Define Anthropic tools the model can invoke mid-extraction:

| Tool | Purpose | Example use |
|---|---|---|
| `lookupHebrewDate({parsha, year}) → { from, to }` | Resolve "Parshas Behar" to a date range | Page says "Schedule for Parshas Behar" with no year — Claude calls this to get the actual dates |
| `getSunsetRange({lat, lng, daysAhead}) → array` | Verify zmanim-relative times are computed sensibly | Page says "Mincha 18 min before shkia" — Claude can sanity-check the implied clock time matches expectations |
| `getPreviousExtraction(shulId) → rules` | Compare to last successful extraction | Claude can ask "did this shul have these rules last week?" and reason about deltas |
| `validateRule(rule) → warnings[]` | Flag suspicious rule shapes | Claude proposes "Mincha at 02:30" — validator returns "this is 2:30 AM, unusual; confirm?" |
| `searchHebrewMonth(name) → month_index` | Map Hebrew month names to numbers | Page uses "Sivan" — Claude can resolve to month 9 (or 3 depending on counting) without guessing |

**Why this is bigger than it looks.** Today Claude has to know everything from prompt + training. Tools let it ASK for the things it can't infer. The Safra "ad_hoc with past validFrom" bug from 2026-05-14 happened because Claude couldn't know what "May 8-9" referred to without context. A `lookupHebrewDate` tool would have prevented it.

**What it would have helped last night:**
- Cases where Claude saw a parsha name + zmanim references could verify them against real calendar data instead of guessing.
- Cases where rule times look anomalous could be flagged inline rather than emitted with high confidence.

**Integration cost.** ~2-3 days. Define each tool as an Anthropic tool-use schema. Switch the extraction `messages.create` call to use `tools: [...]`. Build the tool implementations (Hebcal calls, DB queries, time computations).

**Composes with.** Anthropic tool use is already the rank-1 swap candidate in [EXTRACTION.md](./EXTRACTION.md) (for structured output). This builds on that — once you're using tool use for output, adding more tools for input/verification is the natural next step.

**Trade-offs.**
- More API round-trips per extraction (each tool call is an extra round-trip). Net cost may go up slightly; net quality goes up more.
- Tool design is its own discipline — too many tools and Claude gets confused which to use; too few and it doesn't help.
- Hebcal API is rate-limited; need caching.

**Inspired by.** The agent-with-tools pattern that became dominant in 2025-2026 for non-trivial extraction. Anthropic's computer-use, OpenAI's function calling — same shape.

---

## Strategy 3: Context-rich prompts — front-load metadata

**The idea.** Today the user-message is just HTML. Better: prepend a metadata block before the page content.

```
You are extracting a schedule for:
  Shul: Bais Menachem
  ID: 57
  Address: 17299 NE 10th Avenue, North Miami Beach, FL 33162
  Timezone: America/New_York (EDT)
  Nusach: Chabad (from prior extraction)
  Last successful extraction (8 days ago):
    - Shacharis daily 6:45
    - Mincha weekday 19:15
    - Maariv weekday 21:00
    - Shabbos Shacharis 9:00
    [etc.]

Today's Hebrew context:
  Date: 4 Sivan 5786
  Upcoming: Shavuos starts 5 Sivan
  Special schedule window: 'Erev Yom Tov' for Shavuos may apply to this week's bulletin

Now here's THIS week's bulletin:
[HTML or PDF content]
```

**Why it helps.**
- *Prior extraction*: Claude can do delta-reasoning. "Mincha was 19:15 last week; this week says 19:30. Probable seasonal shift. Confidence high."
- *Nusach hint*: "This page references Tanya 6:00 AM. Chabad context: that's a shiur, skip."
- *Hebrew calendar context*: "Page is dated Sivan 4 — Shavuos is in 1 day. The 'Yom Tov schedule' section applies to Shavuos."
- *Address context*: Claude can recognize landmarks. "This is in North Miami; the candle-lighting time of 18:30 EDT is plausible for late spring." (Cross-checks against zmanim sanity.)

**What it would have helped last night.**
- Most of the 21 broken cases had ZERO context — Claude saw the bulletin in isolation. Many of the low-confidence cases would have hit "actually I have a recent successful extraction; this looks similar" and resolved upward.

**Integration cost.** ~1-2 days. Query the metadata pre-extraction and prepend to the prompt. Use prompt caching so the metadata-prefix is cached and only the page body counts as new tokens on each call.

**Trade-offs.**
- Prompt becomes longer — but only by ~500-1500 tokens, and prompt caching makes the cost overhead near-zero.
- On the FIRST extraction for a new shul, there's no prior extraction to feed. Graceful degradation: feed less context, fall back to current behavior.
- Risk of Claude over-anchoring to prior extraction ("looks like before so I won't look closely"). Mitigated by also passing the bulletin in full and requiring per-rule re-extraction.

**Inspired by.** RAG patterns, conversational continuity, the "feed-the-doctor-the-chart-first" pattern from medical-AI. Context turns a fresh-eyes problem into a continuity problem.

---

## Strategy 4: Reasoning before extraction (Sonnet extended thinking)

**The idea.** When the cascade falls through to Sonnet (Haiku confidence < 0.4), use Sonnet's **extended thinking mode**. The model takes 10-30 seconds to reason about page structure BEFORE emitting JSON — basically self-deliberation in a hidden scratchpad.

**Mechanics.** Pass `thinking: { type: "enabled", budget_tokens: 4000 }` to Sonnet's `messages.create` call. The model emits invisible "thinking" tokens first (you pay for them but they don't go in the response), then the visible structured output.

**What it would have helped last night.**
- *The Hampton Synagogue (confidence 0.05)*. Big-budget Hamptons site likely has complex layout. Without extended thinking, Sonnet had to do all the reasoning in the output stream — which compressed to "low confidence." With extended thinking, Sonnet can spend 20 seconds reasoning: "This is a two-column table. The header is 'Weekday | Shabbos'. Within each column, each row is a tefillah. Some rows have 'Daf Yomi' labels — those are shiurim. Mincha at 1:30 PM appears in both columns — emit as daysOfWeek [0,1,2,3,4,5,6]."

**Integration cost.** ~half a day. Wrap the Sonnet fallback call in the thinking-enabled mode. Cost slightly higher (~$0.05-0.10 per hard page) but only fires on cases Haiku already gave up on (~30-50/week max).

**Trade-offs.**
- Latency goes up on those specific extractions (sync admin re-extracts feel slower). Irrelevant for cron-driven runs.
- Cost per hard case roughly doubles — but baseline was already small, and quality wins should reduce rejected-rules churn.
- Not a magic bullet — extended thinking helps with reasoning-heavy pages, not with pages where the issue is anti-bot blocks or rendering failures.

**Inspired by.** OpenAI o1, Claude's extended thinking, the "let the model think before answering" wave that started 2024 and matured 2026.

---

## Strategy 5: LLM as router — classify before extracting

**The idea.** Add a tiny pre-step: cheap-Haiku classifies the page in one prompt:

```
What kind of page is this?
  A) weekly_schedule       — pick if page is the standard weekly tfila schedule
  B) yom_tov_special       — pick if page is a Yom Tov / fast day / Selichos schedule
  C) calendar_widget       — pick if page contains an embedded calendar (needs JS render)
  D) about_or_marketing    — pick if page is About / Contact / Donate / News
  E) blog_or_announcement  — pick if page is a single article (sermon, event announcement)
  F) error_or_empty        — pick if page is a 404 / empty stub
  G) other                 — unclear

Answer with the single letter. Add one-line reasoning.
```

Then route to the appropriate extraction prompt variant:
- A → main schedule prompt (current behavior)
- B → special-schedule-optimized prompt (more focus on validFrom/validTo)
- C → skip directly to tier-2 (JS render)
- D/E/F → return 0 rules immediately, don't burn Sonnet on a 404

**Why it matters.** Today every page gets the same heavy 4K+ prompt. A 200-byte 404 page gets the same treatment as a clean schedule table. Routing cuts cost AND improves accuracy by using the right prompt for the right page shape.

**What it would have helped last night.** Probably a few of the very-low-confidence cases (0.05 confidence often means "this isn't a schedule page at all" — Claude shouldn't have been asked to extract from it).

**Integration cost.** ~1-2 days for the router + 3-4 prompt variants. Saves dollars on non-schedule pages; improves quality on specialized pages.

**Trade-offs.**
- Adds one cheap call per extraction (~$0.001). Negligible.
- Maintenance burden — every new page type is a new variant prompt.
- Risk of router misclassification cascading into bad downstream choice. Mitigate by defaulting to the main prompt on uncertainty.

**Inspired by.** Mixture-of-experts architectures, the routing layer in modern LLM gateways (Portkey, OpenRouter, etc.). Specialists beat generalists when input distribution is heterogeneous — shul pages absolutely are.

---

## Strategy 6: Citations / grounding — force Claude to cite the source line per rule

**The idea.** Schema change: every rule has to include a `source_quote: "Mincha 7:15 PM weekdays"` field. Claude must quote the EXACT text it extracted that rule from. No quote → no rule.

**Why this changes accuracy.** Hallucination becomes structurally impossible. Today, an over-eager extractor might invent a Sunday Maariv that's not on the page. With required citations, it would have to point to where it found that, and it couldn't.

**Admin benefit.** When triaging a broken extraction, every rule has a "← extracted from this line" annotation. The admin can verify each rule individually, fast. Today there's no traceability per rule.

**Integration cost.** ~half a day. Add `source_quote: string` to the Zod schema. Update the prompt to require it. Render in admin UI as a hover-tooltip on each rule.

**Trade-offs.**
- Slight increase in output token count (each rule has a ~30-100 char quote).
- Edge case: rules derived from MULTIPLE lines (e.g. "Mon-Fri 7:00, Sun 8:00" → two rules, same source row range). Schema may need `source_quotes: string[]` instead of singular.
- Doesn't directly improve accuracy on rules the model OMITS (only on rules it INVENTS). For omissions, two-pass critique (Strategy 1) is the better tool.

**Inspired by.** Scientific publishing (every claim cites a source), legal contracts (every clause references specific source), faithful-summarization work in academic NLP.

---

## Strategy 7: Cross-shul corroboration (statistical sanity check)

**The idea.** Before committing an extraction, ask Claude to compare against similar shuls:

```
This shul is: Bais Menachem (Chabad, Florida)
Similar shuls in our DB (Chabad, Sunbelt):
  - Chabad Boca: 8 daily rules, Mincha = shkia − 18
  - Chabad Aventura: 10 daily rules, Mincha = shkia − 18
  - Chabad Hollywood: 9 daily rules, Mincha = shkia − 18

Proposed extraction for Bais Menachem:
  - Shacharis daily 6:45
  - Mincha weekday fixed 18:00  ← unusual; siblings use shkia-18
  - Maariv weekday 21:00
  [2 total rules]

Cross-shul sanity check:
- Rule count low — siblings have 8-10, this has 2. Possibly incomplete?
- Mincha is fixed 18:00 — siblings use shkia-anchored. Confirm intentional?
```

**Why it changes things.** Single-source extraction has no notion of "is this output reasonable for a shul of this type?" Cross-shul context introduces statistical priors. A shul that has 50% fewer rules than its peers is probably an incomplete extraction, not a sparse shul.

**Integration cost.** ~3-4 days. Build the "similar shuls" lookup (k-nearest-neighbor by geography + nusach + size). Then a small corroboration prompt. Heavier than other ideas but produces unique sanity-check value.

**Trade-offs.**
- Cold start: with few shuls in any given category, the "similar shuls" lookup is noisy.
- Risk of over-anchoring to peer averages (a unique shul gets pushed toward the mean). Mitigate by treating corroboration as a SOFT signal — confidence-modifier, not rule-rewriter.
- Most useful at scale (>500 shuls); marginal value below.

**Inspired by.** Anomaly detection patterns from credit-card fraud (compare to peer behavior), peer benchmarking in financial analysis, statistical priors in Bayesian reasoning.

---

## Ranking by ROI (if you tried just one or two)

| # | Strategy | Effort | Impact | Risk | Order to try |
|---|---|---|---|---|---|
| 1 | Two-pass critique | 1 day | High (directly catches yesterday's failures) | Low | **First** |
| 2 | Tool-augmented extraction | 2-3 days | High (eliminates whole error classes) | Medium (new tool design) | **Second** — pair with EXTRACTION.md's tool-use migration |
| 3 | Context-rich prompts | 1-2 days | High (uses data we have but ignore) | Low | **Third** |
| 4 | Reasoning mode (Sonnet thinking) | 0.5 day | Medium (small surface, ~30 cases/week) | Low | Quick win once others land |
| 5 | LLM router | 1-2 days | Medium (cost more than quality) | Low | Cost-optimization phase |
| 6 | Citations / grounding | 0.5 day | Medium (audit + admin trust) | Low | Quality-of-life later |
| 7 | Cross-shul corroboration | 3-4 days | High at scale; weak now | Medium (cold-start) | After ≥500 shuls in directory |

**If forced to pick exactly one to prototype first:** #1 (two-pass critique). Smallest code change, highest signal-to-noise on the immediate problem (21 broken last night), and the prerequisite test rig from EXTRACTION.md is the same test rig used to validate this.

**If picking two:** #1 + #3 (critique + context-rich prompts). They compose perfectly — context-rich prompts make the FIRST pass smarter; critique catches what the first pass still missed.

---

## The meta-theme

Every strategy above is some version of: **"give the model more context, more tools, or more feedback so it isn't extracting blind."**

That's the through-line. The current architecture treats Claude as a pure function — input HTML, output JSON, no memory between calls, no access to anything outside its training. The 2026 pattern is to treat Claude as a small agent with:

- **Memory** (previous extractions, shul metadata) — Strategy 3
- **Tools** (Hebcal, zmanim, validators) — Strategy 2
- **Self-review** (critique pass, citations) — Strategies 1 and 6
- **Specialization** (router-selected prompts, extended thinking on hard cases) — Strategies 4 and 5
- **Statistical priors** (peer comparison) — Strategy 7

Even adopting JUST the first two strategies would shift the architecture from "pure function" to "agent" — and unlock a different ceiling of accuracy.

---

## Open research questions

Things we don't know and would need to investigate before committing to any of these.

### Quality / impact

- **How many of yesterday's 21 broken cases would actually be caught by two-pass critique?** Need to run the critique on each as an offline experiment.
- **For tool-augmented extraction, which tools have the highest signal?** Run a small study: instrument the existing extractor to log when it WOULD have benefited from each tool. Build the tools with the highest hit rate first.
- **Does context-rich prompting cause over-anchoring on bad prior extractions?** Need to test: feed a known-stale "prior extraction" and see if the model correctly identifies + updates it, or anchors to it.

### Cost

- **Per-extraction cost overhead of each strategy.** Today: $0.003-0.05/extraction depending on tier. Strategy 1 adds $0.005-0.01 on triggered cases. Strategy 2 adds 1-3 round-trips. Need a clear ROI model before adoption at scale.
- **Does Strategy 5 (router) actually save money?** Depends on what fraction of pages are non-schedule. Worth measuring.

### Architecture

- **Should these strategies be additive (each independent) or integrated (one unified "smart extraction" function)?** Probably additive at first (easier to A/B test), unified later if patterns repeat.
- **Where does the test rig from EXTRACTION.md come in?** Same one. The 15-20 curated fixtures + correct extractions evaluate EVERY proposed change. Build the rig before anything else.

### Domain

- **What's the right granularity for "similar shul" in Strategy 7?** Same metro? Same nusach? Same size? Probably a learned k-NN on multiple features. Cold-start until we have N shuls.
- **Are there extraction failure patterns we haven't even named yet?** Yesterday's 21 cases are a good sample but not exhaustive. After 100 weekly cron runs, we'd have ~2000 broken examples — that's enough to find structural failure modes none of the above strategies address.

---

## Related docs

- **[EXTRACTION.md](./EXTRACTION.md)** — broader tech-stack research (which engine runs the extraction; this doc is about how smart that engine is allowed to be)
- **[FEATURES.md](./FEATURES.md) → "LLM extraction context"** — the original FEATURES.md exploration entry that seeded this thread; was higher-level (5 options ranked); this doc breaks them into more concrete strategies
- **[FEATURES.md](./FEATURES.md) → "Schedule update timing"** — captures how the date/timing context flows through the system; relevant to Strategy 3
- **[PROGRESS.md](./PROGRESS.md)** — historical record of which extraction bugs were caught manually, useful for grounding future ideas in real failure patterns

---

## Notes for future updates

- **Add new strategies as they occur.** This doc is a brainstorm-and-keep, not a closed list.
- **Record experiments and their results.** If we prototype Strategy 1 against the 21 broken cases and it catches 18, add that data here. If it catches 3, add THAT data too — failed experiments are equally useful.
- **Promote winners to FEATURES.md.** Anything we decide to actually build gets a formal FEATURES.md entry with options + tradeoffs + decision. This doc stays as the upstream ideas pool.
- **Don't merge into EXTRACTION.md.** Two distinct topics. EXTRACTION.md = "which engine"; LLM-CONTEXT.md = "how smart we make it." Worth keeping separate; cross-link via the Related section.
- **Re-read before any LLM-side prompt change.** Most "let's tweak the prompt" arguments are pre-settled by these strategies.
