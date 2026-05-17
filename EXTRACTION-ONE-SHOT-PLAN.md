# Extraction one-shot upgrade — implementation plan

**Status: chosen approach as of 2026-05-17.** This is the plan we're going to execute, superseding (but not deleting) [EXTRACTION-PLAN.md](./EXTRACTION-PLAN.md)'s phased version.

**Rationale for one-shot over phased:** time is not a constraint; we want the maximum-quality lift in one focused effort. Cost must not increase (free tools / free tiers preferred). Safe rollout via feature flag, branch isolation, and incremental enablement.

**This document is implementable, not exploratory.** It captures every architectural decision, every file change, the rollout sequence, and the rollback path — enough to walk in and execute without re-deriving.

---

## What we're building

Today the extraction stack is a pure function: `HTML in → JSON out`, single-shot, blind. We're rewriting it as a small **agent** with context, tools, and self-review, while keeping the cascade architecture and the few-shot domain prompt (the moat) intact.

### Target architecture (after rollout)

```
URL or email arrives
        │
        ▼
┌─ 1. PRE-PROCESS LAYER (free, swap-in vendors) ─────────────────┐
│ HTML pages  → Jina Reader (https://r.jina.ai/<URL>)            │
│                returns clean markdown                          │
│                free tier 1M tokens/mo, fits our scale          │
│                                                                │
│ PDF docs    → Docling (IBM open-source, self-hosted)           │
│                returns clean markdown with table preservation  │
│                free forever, no API dependency                 │
│                                                                │
│ Images      → existing Claude vision tier (unchanged)          │
│ Email body  → existing tier (unchanged)                        │
│                                                                │
│ Fallbacks   → keep current sanitize.ts + UA chain as backup    │
│                used only when Jina / Docling are unreachable   │
└────────────────────────────────────────────────────────────────┘
        │
        ▼
┌─ 2. ROUTER (cheap Haiku call) ─────────────────────────────────┐
│ Classify the input in ONE prompt:                              │
│   weekly_schedule  → main extraction prompt                    │
│   yom_tov_special  → special-schedule-optimized prompt         │
│   calendar_widget  → bypass; rerender via JS tier              │
│   about_marketing  → 0 rules, skip extraction entirely         │
│   blog_news        → 0 rules, skip extraction entirely         │
│   error_or_empty   → 0 rules, mark unsupported                 │
│   other            → fall through to main prompt               │
│                                                                │
│ Cost: ~$0.001 per page; saves $0.01-0.05 on the 10-20% of      │
│ pages that get classified as non-schedule.                     │
└────────────────────────────────────────────────────────────────┘
        │
        ▼
┌─ 3. EXTRACTION (Claude as agent, not function) ────────────────┐
│ Inputs to Claude:                                              │
│   • System prompt (existing few-shot domain prompt — the moat) │
│   • Context preamble (NEW):                                    │
│       - Shul metadata: name, address, timezone, nusach         │
│       - Prior successful extraction (last 14d), if exists      │
│       - Hebrew calendar context: today's Hebrew date,          │
│         upcoming Yom Tov, current parsha                       │
│       - Cached via Anthropic prompt caching                    │
│   • The page content (clean markdown from pre-process layer)   │
│                                                                │
│ Output: STRUCTURED via Anthropic tool use (NOT JSON parsing)   │
│   • The Zod schema is registered as an Anthropic tool          │
│   • Schema gains a required source_quote field per rule        │
│                                                                │
│ Tools Claude can call DURING extraction (NEW):                 │
│   • lookupHebrewDate({parsha, year}) → date range              │
│   • getSunsetRange({lat, lng, daysAhead}) → array of sunsets   │
│   • getPreviousExtraction({shulId}) → previous rules           │
│   • validateRule({rule}) → warnings                            │
│   • searchHebrewMonth({name}) → month index                    │
│                                                                │
│ Model selection:                                               │
│   • Haiku 4.5 primary                                          │
│   • Sonnet 4.6 fallback when Haiku confidence < 0.7            │
│     (was 0.4; raising threshold catches more cases)            │
│   • Sonnet uses extended thinking mode                         │
│     (thinking: { type: "enabled", budget_tokens: 4000 })       │
└────────────────────────────────────────────────────────────────┘
        │
        ▼
┌─ 4. CRITIQUE PASS (conditional) ───────────────────────────────┐
│ Triggers:                                                      │
│   • Final extraction confidence < 0.7  OR                      │
│   • Sharp rule-count drop vs prior extraction (>= 50% fewer)   │
│                                                                │
│ A second Haiku call with the SAME tool access:                 │
│   "You are auditing an extraction. Here is the source.         │
│    Here is the extracted JSON with source_quote citations.     │
│    Find any errors, missing rules, misinterpretations.         │
│    Either confirm the extraction or propose a revised one."    │
│                                                                │
│ Output: confirmed extraction OR revised extraction (with       │
│ updated confidence + reasoning).                               │
└────────────────────────────────────────────────────────────────┘
        │
        ▼
┌─ 5. PERSIST + GUARDRAILS (existing pipeline, unchanged) ───────┐
│ Same as today — guardrails, transactions, freshness gate,      │
│ admin notes, etc.                                              │
│ The only change: minyan_rule gets a new source_quote column.   │
└────────────────────────────────────────────────────────────────┘
```

### What's different from today

| Layer | Today | New |
|---|---|---|
| HTML preprocess | Custom 40-line regex `sanitize.ts` | Jina Reader (free) → clean markdown |
| PDF preprocess | Send full PDF to Claude as base64 | Docling preprocess → Claude reads clean markdown |
| Browser rendering | Browserless (kept) | Browserless (kept; free tier sufficient) |
| Output structure | Bare JSON parsing + Zod validation | Anthropic tool use (Zod schema as tool) |
| Prompt context | Static system prompt + page content | + shul metadata, prior extraction, Hebrew calendar |
| Mid-extraction tools | None | 5 tools Claude can call |
| Page classification | None — every page goes through full extraction | Router decides extraction or skip |
| Self-review | None — single-shot extraction | Critique pass on suspicious extractions |
| Hard-case handling | Sonnet fallback (one-shot) | Sonnet with extended thinking |
| Rule audit trail | None — `reasoning` field is the whole audit | `source_quote` per rule |

### Net cost impact

**Flat to slightly down in steady state.** Reasoning:

| Direction | Source |
|---|---|
| **+** Tool calls (small, ~$0.001-0.005 each, max 5-15 per extraction) | New |
| **+** Critique pass on triggered cases (~30/week × $0.005-0.01) | New |
| **+** Sonnet extended thinking on hardest cases (~30/week × $0.05-0.10) | New |
| **−** Router skips non-schedule pages (10-20% of inputs × full extraction cost) | New saving |
| **−** Docling replaces PDF-to-Claude-as-base64 (~$0.05/PDF saved) | New saving |
| **−** Cleaner Claude input (Jina markdown < raw HTML token count) | New saving |
| **=** Hash-shortcut on weekly cron (already shipped Friday) | Existing |

**Estimated steady-state cost: same or 10-20% lower than today.** The hash shortcut from last Friday is doing most of the heavy lifting on cost. Everything we add is small-volume; everything we remove is bigger-volume.

---

## The pieces — one section per component

Each subsection is self-contained: what it is, why it earns its slot, how it fits into the existing code, trade-offs.

### 1. Jina Reader — HTML preprocessor

**What.** Pre-process every HTML page via `https://r.jina.ai/<URL>`. Jina returns clean markdown with ads, nav, footer, scripts, and styling stripped. Uses ReaderLM-v2 (a 1.5B model purpose-built for HTML-to-markdown).

**Why.**
- Cleaner input to Claude → fewer tokens, faster extraction, less noise to confuse the model.
- Removes ~150 lines of custom sanitization + UA-fallback code (less to maintain).
- Handles JS rendering for many pages automatically (covers a chunk of what Browserless does today).
- **Free tier: 1M tokens/month** — at ~150 shuls × ~3K tokens each weekly = ~450K/month, well within free.

**Integration.**
- New file `lib/scrapers/jina-reader.ts` — wraps the Jina endpoint, handles errors + timeouts.
- `lib/llm/extract.ts` swaps its input source from `fetchHtml(url) → sanitizeHtmlForLLM(html)` to `fetchViaJinaReader(url) → markdown`.
- `lib/scrapers/sanitize.ts` is retained but only called as fallback when Jina fails (network error, rate limit, malformed response).
- `lib/scrapers/fetch.ts` UA-fallback chain is retained as a deeper fallback for Jina failures.

**Trade-offs.**
- External dependency. If Jina has an outage, we fall through to existing code path. Acceptable; existing code still works.
- Network round-trip latency (~200-400ms added per HTML extraction). Negligible for cron, mildly annoying for sync admin re-extracts.
- Rate limit: Jina free tier has a per-minute limit. At our Saturday cron's ~150 shuls in ~10 min, we may need to space them out. Currently Inngest's per-shul concurrency cap of 1 already does this.

### 2. Docling — PDF preprocessor

**What.** Self-host Docling (IBM open-source) as a separate service or as a serverless function. Send PDF URLs to it; receive clean markdown back, with table structure preserved.

**Why.**
- Specialized PDF parsing (layout detection, table structure, OCR fallback) outperforms "send PDF to Claude as base64" by a wide margin.
- Open-source and self-hosted — no vendor billing, no rate limits, no API dependency.
- IBM-backed, mature, active development.
- Drastically reduces Claude input tokens for PDFs (markdown is ~5-10× more compact than base64 PDF representations).

**Integration.**
- New file `lib/scrapers/docling.ts` — wraps the Docling service endpoint.
- Hosting decision (TBD during build): a small Vercel serverless function running Docling, OR a separate Cloudflare Worker, OR a Render.com hobby instance. Docling is Python; Vercel-compatible via their Python runtime.
- `lib/llm/extract-pdf.ts` becomes a thin wrapper: `fetch PDF → Docling → markdown → Claude extraction`.
- Existing direct-Claude-on-PDF code retained as fallback for first 2-3 weeks.

**Trade-offs.**
- One more service to operate. Mitigate by using Vercel's Python serverless if possible (no extra infrastructure).
- Slightly slower per PDF (Docling pass + Claude pass vs single Claude call). Acceptable.
- Some PDFs (scanned, image-heavy) may parse worse with Docling than direct Claude vision. Mitigate by detecting `pages == 0 || empty markdown` and falling through to current PDF tier.

### 3. Anthropic tool use — structured output

**What.** Replace `Claude → JSON string → parse → Zod validate` with `Claude → tool call with structured arguments → validated already`. The extraction schema becomes a registered tool.

**Why.**
- Eliminates entire class of failure modes: Claude wrapping output in markdown fences, adding prose preamble, truncating JSON mid-array.
- Anthropic's officially recommended pattern for structured extraction since 2024.
- Cleaner error messages when the model can't comply with the schema.

**Integration.**
- `lib/llm/extract.ts` (and `extract-pdf.ts`, `extract-vision.ts`, `extract-email.ts`) — change the `messages.create` call shape.
- Define one shared tool definition in `lib/llm/tools/extraction-output.ts` derived from the existing Zod schema (`lib/llm/schema.ts`).
- Tool definition uses Anthropic's `input_schema` JSON Schema format — generated from Zod via `zod-to-json-schema` or hand-written.

**Trade-offs.**
- Same cost per token; same model behavior; pure reliability gain.
- Migration is mechanical but touches 4 files. Low risk.

### 4. Context-rich prompts

**What.** Before the page content, front-load a metadata block:

```
You are extracting a schedule for:
  Shul: Bais Menachem
  ID: 57
  Address: 17299 NE 10th Avenue, North Miami Beach, FL 33162
  Timezone: America/New_York (EDT)
  Nusach (from prior extraction): Chabad
  Last successful extraction (8 days ago):
    - Shacharis daily 6:45
    - Mincha weekday 19:15
    [etc.]

Today's Hebrew context:
  Date: 4 Sivan 5786
  Upcoming: Shavuos starts 5 Sivan
  Special schedule window: 'Erev Yom Tov' may apply

Page content follows:
[markdown]
```

**Why.**
- Claude can do delta-reasoning ("Mincha was 19:15 last week, today says 19:30; consistent with seasonal shift; high confidence").
- Disambiguates references like "Tanya 6:00 AM" (Chabad-context → shiur, not minyan).
- Eliminates year-defaulting bugs when partial dates appear ("for Parshas Behar" → Claude knows the year because Hebrew context says so).
- All data is already in our DB; we're just feeding it back to the model.

**Integration.**
- New file `lib/llm/build-context.ts` — `buildContextPreamble(shulId): Promise<string>`.
- Reads shul metadata, fetches prior extraction via `getPreviousExtraction()`, calls Hebcal for date context.
- Wired into each extract function's user message assembly.
- Use Anthropic prompt caching (`cache_control: { type: "ephemeral" }`) so repeat extractions of the same shul don't re-pay for the metadata prefix.

**Trade-offs.**
- ~500-1500 extra prompt tokens per call — but caching makes the cost near-zero on cache hits.
- Risk of Claude over-anchoring to a bad prior extraction. Mitigate by also passing the full page content (not just delta-style "what's different") and requiring per-rule re-extraction.
- First extraction for a new shul has no prior context. Graceful degradation: prompt builder returns a smaller preamble for new shuls.

### 5. Mid-extraction tools (5 of them)

**What.** Define 5 tools Claude can invoke during extraction:

| Tool | Signature | Purpose |
|---|---|---|
| `lookupHebrewDate` | `({parsha: string, year?: number}) → {from, to}` | Resolve "Parshas Behar" to actual dates |
| `getSunsetRange` | `({lat: number, lng: number, daysAhead: number}) → array` | Sanity-check zmanim-anchored times |
| `getPreviousExtraction` | `({shulId: number}) → {rules, extractedAt}` | Compare current vs prior extraction |
| `validateRule` | `({rule: ExtractedRule}) → {warnings: string[]}` | Local sanity check (weird hours, overlapping days) |
| `searchHebrewMonth` | `({name: string}) → {monthIndex, hebrewName}` | Resolve Hebrew month names |

**Why.**
- Claude has knowledge limits (training cutoff, no real-time data). Tools let it ASK for the things it can't infer.
- Eliminates whole error classes: year-defaulting on partial dates, zmanim validation, prior-extraction-based corroboration.
- Composes with the critique pass — the critic has the same tools and uses them for second-look verification.

**Integration.**
- New directory `lib/llm/tools/`:
  - `hebrew-date.ts` — Hebcal API call + memoization
  - `sunset-range.ts` — Hebcal zmanim + memoization
  - `previous-extraction.ts` — DB query
  - `validate-rule.ts` — pure local logic
  - `hebrew-month.ts` — pure local logic
- Each tool exports an Anthropic-compatible `{ name, description, input_schema, execute }` object.
- Tool list assembled in `extract.ts` and passed to `messages.create({ tools, tool_choice })`.

**Trade-offs.**
- More API round-trips (each tool call is a round-trip back to Anthropic). Adds latency per tool call (~500ms-1s).
- Hebcal is rate-limited; mitigate via memoization within an extraction call and caching at the function level.
- Tool design risks: too many tools and Claude gets confused about which to use. We're starting with 5; would tune up/down based on observed usage.

### 6. Router — cheap pre-classification

**What.** Before extraction, a single cheap Haiku call classifies the input page:

```
What kind of page is this?
  A) weekly_schedule
  B) yom_tov_special
  C) calendar_widget (needs JS render)
  D) about_marketing
  E) blog_news
  F) error_or_empty
  G) other

Answer with letter + 1-line reason.
```

Based on classification, route to:
- A → main extraction prompt
- B → yom-tov-optimized variant (focus on validFrom/validTo)
- C → re-render via Browserless tier and re-classify
- D/E/F → return empty rules immediately, mark `unsupported` or `pending_review` accordingly
- G → fall through to main prompt with low-confidence flag

**Why.**
- Today every page burns the same full extraction prompt — even 404 pages, about pages, blog posts.
- Specialized prompts beat generic prompts on heterogeneous inputs.
- The 4-cent saving on a 404 page far outweighs the 0.1-cent router cost.

**Integration.**
- New file `lib/llm/router.ts` — single-prompt classifier.
- Wired into `runCascade` in `lib/llm/cascade.ts` BEFORE tier 1 (HTML) runs.
- 3-4 prompt variants in `lib/llm/prompts.ts` (current main prompt + yom-tov variant + maybe a Chabad/Sefardi variant later).

**Trade-offs.**
- Adds ~$0.001 per page (router cost) but saves $0.01-0.05 on pages classified as non-schedule.
- Risk of misclassification cascading downstream. Mitigate by defaulting to main prompt on uncertainty.
- Maintenance: every new page type variant is a new prompt. Start with 3-4; resist the temptation to add more.

### 7. Critique pass — conditional second-pass audit

**What.** When the first extraction has confidence < 0.7 OR a sharp rule-count drop vs prior, fire a second Haiku call:

```
You are auditing an extraction.
Source page: [markdown]
Extraction: [JSON with source_quote per rule]

Audit the extraction. For each rule:
- Verify the source_quote actually appears in the source
- Check if the rule's time / days / kind are correctly inferred from the quote
Also: identify rules that SHOULD have been extracted but weren't (point to specific source lines).

Output: confirmed extraction (no changes) OR a revised extraction.
```

**Why.**
- Same pattern as peer review, code review, scientific publishing.
- A first-pass focused on "find the schedule" can miss things a second-pass reviewer focused on "find the bugs" catches.
- Directly targets the failure patterns observed on 2026-05-17 (Valley Outreach 5→0 drop, Agudath Toronto 13→5 drop, ~14 low-confidence cases).

**Integration.**
- New file `lib/llm/extract-critique.ts` — `critiqueExtraction(source, extraction, shulId): Promise<ExtractionResult>`.
- Wired into each extract function's tail: if confidence < 0.7 OR rule-count-drop heuristic trips, call critique.
- Critique uses same tools (5 tools above) — particularly `getPreviousExtraction` for delta reasoning.

**Trade-offs.**
- Cost adds ~$0.005-0.01 per triggered case. At ~30 triggers/week = ~$0.30/week. Negligible.
- Latency: doubles extraction time on triggered cases. Acceptable for cron; mildly annoying for sync admin re-extracts.
- Risk of critic over-correcting (introducing errors where first pass was right). Mitigate by requiring critic to explicitly say "no changes" when applicable, and preserving the first-pass extraction as a comparison.

### 8. Sonnet extended thinking — hard-case reasoning

**What.** When the cascade falls through to Sonnet (Haiku confidence < 0.7 even after critique), use Anthropic's extended-thinking mode. Sonnet takes 10-30 seconds to reason about page structure in a hidden scratchpad before emitting the structured output.

**Why.**
- Hard pages (complex layouts, mixed sections, ambiguous structure) benefit dramatically from explicit reasoning steps.
- Without thinking mode, Sonnet has to do all reasoning in the output stream, often producing low-confidence outputs.
- Only fires on the truly hardest cases (~30-50/week max), so cost impact is bounded.

**Integration.**
- One-line config change to the Sonnet fallback call in `extract.ts`:
  ```ts
  thinking: { type: "enabled", budget_tokens: 4000 }
  ```

**Trade-offs.**
- Cost per hard case: +$0.05-0.10. At 30-50/week = +$1.50-5/week. Acceptable.
- Latency per hard case: +20-30 seconds. Irrelevant for cron; noticeable for sync admin re-extracts.

### 9. Source citations — required per-rule grounding

**What.** Schema change: every rule must include a `source_quote: string` field. Claude must quote the exact source text the rule was extracted from. The Zod schema and the Anthropic tool definition both require this.

**Why.**
- Hallucination becomes structurally impossible — Claude can't emit a Sunday Maariv rule if it can't quote where it found one.
- Makes the critique pass dramatically more useful — critic can verify each citation against the source.
- Admin debugging: every rule has a "← came from this line" tooltip in the UI.

**Integration.**
- `lib/llm/schema.ts` — Zod schema gains `source_quote: z.string()` required field.
- `lib/llm/prompts.ts` — system prompt mentions the new field and gives example.
- `db/schema.ts` — `minyan_rule.source_quote` added as nullable column (additive migration — old rules don't have it; new rules do).
- `app/admin/shul/[slug]/page.tsx` — render hover-tooltip with `source_quote` on each rule.

**Trade-offs.**
- Slight increase in output token count (~30-100 chars per rule). Negligible.
- Edge case: rules derived from multiple lines. Schema may need `source_quote` to accept a string OR string array. Start with single string; revisit if needed.

---

## File-level change map

The PR will touch (approximately) these files. Listed in rough dependency order so the build proceeds bottom-up:

### New files

```
lib/llm/tools/
  hebrew-date.ts             tool: parsha → date range
  sunset-range.ts            tool: lat/lng → sunset array
  previous-extraction.ts     tool: shulId → prior rules
  validate-rule.ts           tool: rule → warnings
  hebrew-month.ts            tool: hebrew name → month index
  extraction-output.ts       Anthropic tool definition for structured output
lib/llm/
  build-context.ts           assembles shul metadata + Hebcal context preamble
  extract-critique.ts        second-pass audit function
  router.ts                  page-type classifier
lib/scrapers/
  jina-reader.ts             Jina HTML preprocessor wrapper
  docling.ts                 Docling PDF preprocessor wrapper
db/migrations/
  0010_minyan_rule_source_quote.sql   adds nullable source_quote column
```

### Files rewritten substantially

```
lib/llm/extract.ts           tool use + context preamble + Jina input + router pre-step
lib/llm/extract-pdf.ts       Docling preprocess + tool use + same prompt enhancements
lib/llm/extract-vision.ts    tool use + citations
lib/llm/extract-email.ts     tool use + citations + context preamble
lib/llm/cascade.ts           router integration; preferred-strategy logic updated
lib/llm/prompts.ts           add citations requirement; add 3-4 prompt variants
lib/llm/schema.ts            source_quote required field
```

### Files lightly updated

```
db/schema.ts                 minyanRule gets sourceQuote
lib/pipeline/persist-submission.ts   pass source_quote through
app/admin/shul/[slug]/page.tsx       hover-tooltip on each rule showing source_quote
app/admin/data-source/[id]/page.tsx  same — render source_quote
lib/inngest/functions/scrape-one-shul.ts   pass critique results into guardrail check
```

### Files essentially unchanged (kept as fallbacks)

```
lib/scrapers/fetch.ts        kept; deeper fallback for Jina failures
lib/scrapers/sanitize.ts     kept; fallback when Jina fails
lib/scrapers/render.ts       kept unchanged (Browserless tier)
```

**Estimated total: ~1500-2500 lines of new/changed code across ~25 files.** Substantial but scoped — every change has a defined purpose from this doc.

---

## Feature flag design

**Single flag: `EXTRACTION_PIPELINE_V2`** as an env var.

- Default: `false` (use existing pipeline)
- `true`: use the new pipeline end-to-end

**Implementation pattern in `cascade.ts`:**

```ts
const USE_V2 = process.env.EXTRACTION_PIPELINE_V2 === "true";

export async function runCascade(url: string, opts: CascadeOpts = {}): Promise<CascadeResult> {
  if (USE_V2) {
    return runCascadeV2(url, opts);  // new pipeline
  }
  return runCascadeV1(url, opts);    // existing pipeline (rename current code)
}
```

**Per-shul override (for testing on subsets):**

A second env var `EXTRACTION_V2_SHUL_IDS=57,38,22` (comma-separated). When set, only those shul IDs use v2; everything else uses v1.

```ts
const v2ShulIds = (process.env.EXTRACTION_V2_SHUL_IDS ?? "").split(",").map(s => s.trim()).filter(Boolean).map(Number);

function shouldUseV2(shulId: number): boolean {
  if (USE_V2) return true;
  if (v2ShulIds.includes(shulId)) return true;
  return false;
}
```

This lets us test on 1-2 known-broken shuls before flipping the global flag.

**Rollback:** flip `EXTRACTION_PIPELINE_V2=false` in Vercel env vars. Takes 5 seconds. Vercel auto-redeploys. All extractions immediately return to v1.

---

## The rollout plan (your 5-step request, expanded)

### Step 1: Build in a long-lived feature branch — NOT main

- Branch: `extraction-v2`
- All work happens here. Main stays clean and shippable.
- Use draft PR on GitHub for visibility; don't merge until step 4.
- Smaller intermediate commits within the branch for review-ability later.

### Step 2: Ship behind feature flag (default OFF in production)

- Once the branch is feature-complete, merge to main (BUT with `EXTRACTION_PIPELINE_V2` unset in Vercel = effectively off).
- The new code is deployed to production but inactive. v1 still runs for every extraction.
- Verify in production logs that v1 is still being called and v2 code paths are dormant.

### Step 3: Test on a small subset

- Identify 2-3 known-broken shuls from the 2026-05-17 cron (e.g. Valley Outreach `id=28`, Agudath Toronto `id=43`, The Hampton Synagogue `id=36`).
- Set `EXTRACTION_V2_SHUL_IDS=28,43,36` in Vercel env vars.
- Trigger manual re-extracts via `/admin/shul/<slug>` → "Extract now" for each.
- Verify in admin UI:
  - New rules look correct
  - `source_quote` fields are populated
  - Confidence reasonable
  - No regressions in fields we already had
- Compare against a manual reading of each shul's source page.

If anything looks wrong, fix in branch, redeploy. Iterate until the test subset is clearly improved over v1's output.

### Step 4: Friday afternoon enable for all shuls

- Set `EXTRACTION_PIPELINE_V2=true` in Vercel env vars.
- Vercel auto-redeploys.
- Run a manual smoke test on 5-10 random shuls (mix of healthy and broken from prior weeks).
- The Saturday-night cron (22:00 ET) is now the real stress test — it'll run v2 against all ~150 shuls.

**Why Friday afternoon specifically:**
- Gives ~5 hours of business-day time to monitor before the cron fires.
- If we see anything red-flag, we can flip back to v1 with one env-var change before the cron.
- Avoids the worst-case scenario of pushing a change Saturday morning and finding out at midnight that the whole cron broke.

### Step 5: Rollback plan (be specific)

**Trigger for rollback:**
- Cron's broken-rate goes UP vs last week's baseline (today's 37%)
- OR cron emits substantially fewer scrape_run rows than expected (suggesting v2 is failing silently)
- OR sync admin re-extracts start returning errors
- OR Anthropic / Jina / Docling cost spikes unexpectedly

**Rollback steps:**
1. Set `EXTRACTION_PIPELINE_V2=false` in Vercel env vars → save → Vercel redeploys (~90s)
2. All new extractions immediately return to v1 (no migration; no schema rollback needed — source_quote column is nullable and v1 just leaves it null)
3. Verify in logs that v1 is being called again
4. Total rollback time: ~3 minutes

**After rollback:** investigate the issue in the branch, iterate, re-test on subset, re-enable when fixed. Don't try to fix on main with v2 still active.

---

## Testing methodology AFTER rollout

Three layers, in order:

### Layer 1: Manual smoke test (immediately after step 4)

- 5-10 random shuls from `/admin/shuls`
- Trigger "Extract now" on each via the admin UI
- Verify the new pipeline produces sensible output for healthy shuls (no regressions)
- Verify it produces BETTER output for previously-broken shuls

Total time: ~15-20 minutes.

### Layer 2: Saturday cron + digest email (next Sat after rollout)

The existing weekly cron + digest email IS the production test rig:

- Cron fires Sat 22:00 ET
- Summary email arrives Sun 04:00 UTC (Sat 23:00 ET) with broken/error/no_change counts
- Compare against baseline (last week before v2): broken count was 21 of 57 (37%)
- Target: broken count under 9 of 57 (~15%) — see `EXTRACTION-PLAN.md` for the target rationale

If the cron shows numbers moving in the right direction, v2 is working. If broken count went UP, roll back.

### Layer 3: Retroactive test rig (build AFTER rollout succeeds)

If layers 1 and 2 confirm v2 works, NOW build the test rig described in `EXTRACTION-PLAN.md` Phase 0:

- Curate 15-20 fixtures from the now-working v2 outputs
- Hand-verify each correct extraction
- Build the `scripts/eval-extraction.mjs` runner
- Use it as regression protection for all future extraction changes

The test rig becomes useful once we have working extractions to use as ground-truth. Before that, it would be tested against today's flawed output.

---

## Risks + mitigations

Honest accounting. Three specific risks worth flagging:

### Risk 1: Hard to diagnose if anything breaks

One-shot rewrites combine many changes. If broken-rate goes UP, you don't immediately know which of the 9 components is responsible.

**Mitigation 1:** the per-shul override (`EXTRACTION_V2_SHUL_IDS`) lets us test on subsets first. Most regressions surface during step 3 before global rollout.

**Mitigation 2:** the feature flag enables instant rollback (3 minutes). Worst case, we revert and don't lose any data — the prior pipeline still works and is unchanged.

**Mitigation 3:** detailed logging in each v2 component (router decision, tool calls, critique trigger, etc.). If something goes wrong, the Vercel logs + Inngest dashboard tell us which component triggered the issue.

### Risk 2: Vendor dependency on Jina + Docling

Two new external/self-hosted services. Jina outage = our HTML preprocessing degrades. Docling outage = our PDF tier degrades.

**Mitigation 1:** existing `sanitize.ts` and direct-PDF code paths retained as fallbacks. If Jina returns an error, fall through to sanitize.ts. If Docling returns empty markdown, fall through to direct-Claude-PDF.

**Mitigation 2:** monitor Jina's status page (they have one). Set up an alert if their uptime drops.

**Mitigation 3:** Docling is self-hosted, so we control the uptime. Run on Vercel's Python serverless or similar low-ops platform.

### Risk 3: Longer calendar before validation

Big PR takes longer to write, longer to test, longer to ship safely. If something subtle is wrong, we don't find out until production.

**Mitigation 1:** the subset-testing phase (step 3) is explicitly designed to catch subtle issues on a small number of shuls before going wide.

**Mitigation 2:** the Saturday cron is the real stress test. Even if step 3 looks fine, the cron may surface scale-related issues (rate limits, timeout exhaustion). Step 4's Friday afternoon enable gives us 24 hours to monitor before the cron.

**Mitigation 3:** the prior pipeline still works and is one env-var flip away. Worst case we live with the current 37% broken rate for another week while we iterate.

---

## Effort estimate

Since time is not a constraint, this is for planning, not gating.

| Component | Effort |
|---|---|
| Jina Reader integration | 0.5 day |
| Docling setup + integration | 1-2 days (depending on hosting) |
| Anthropic tool use migration | 0.5 day |
| Context-rich prompts + build-context helper | 1 day |
| 5 tools (each ~30-50 lines) | 1-2 days |
| Router + 3-4 prompt variants | 1 day |
| Critique pass | 1 day |
| Sonnet extended thinking | 0.5 day (one-line change) |
| Citations / source_quote (schema + prompt + UI) | 1 day |
| Feature flag plumbing | 0.5 day |
| Migration 0010 | 0.5 day |
| Documentation updates (this doc + cross-refs) | 0.5 day |
| **Total focused engineering** | **8-12 days** |

Plus iteration / testing on subset / rollout: another 2-3 days.

**Realistic calendar: 2-3 weeks elapsed** assuming the branch stays alive that long without rebasing-pain on main.

---

## What we deliberately skip (re-list for clarity)

- **Full Firecrawl / ScrapeGraphAI replacement.** Loses the few-shot domain prompt moat. Hard no.
- **Browserbase swap.** Browserless works fine. Skip.
- **Cross-shul corroboration.** Needs ≥500 shuls to be useful. Premature at 100. Revisit at scale.
- **Phase 4 LLM router beyond what's in here.** The router defined above is sufficient for v2. More elaborate routing (per-CMS variants, denomination-detection, etc.) is a v3 thing.
- **Architecture reframes (portal, compute-from-rules, davener-as-sensor).** Phase 2 product features. Live in FEATURES.md. Different conversation.
- **Building the test rig BEFORE the rewrite.** Counter-intuitive but right: ground-truth fixtures are hand-curated from KNOWN-GOOD extractions. Today most of our extractions are bad. We build the rig AFTER the rewrite proves out, using the v2 output as the seed.

---

## Sequencing within the branch (build order)

When you sit down to actually build this, here's the order that minimizes rework:

1. **Migration 0010** — add `source_quote` nullable column. Pure additive, deploy immediately or batch with v2.
2. **Schema + tool definition for structured output** — `extraction-output.ts` + Zod schema update. Foundation for everything else.
3. **Tool implementations** (5 tools in `lib/llm/tools/`) — each is independent, can be built in any order. Each can be unit-tested standalone.
4. **build-context.ts** — context preamble builder. Independent.
5. **router.ts** — page classifier. Independent.
6. **jina-reader.ts** — HTML preprocessor wrapper. Independent.
7. **docling.ts** — PDF preprocessor wrapper. Independent.
8. **extract-critique.ts** — depends on schema + tools.
9. **extract.ts** (rewrite) — wires together: Jina input + context + router + tool use + tools + critique + Sonnet thinking.
10. **extract-pdf.ts** (rewrite) — wires together: Docling input + same downstream.
11. **extract-vision.ts** (update) — tool use + citations only; less change.
12. **extract-email.ts** (update) — context + tool use + citations.
13. **cascade.ts** (update) — router integration; preserve cascade pinning logic.
14. **Feature flag** in cascade.ts — `runCascadeV1` vs `runCascadeV2` switch.
15. **Admin UI updates** for source_quote rendering.
16. **Persist-submission update** to pass through source_quote.

Each numbered item is a separate commit on the `extraction-v2` branch. PR is squash-merged or merge-commit-merged at step 4 of the rollout.

---

## Related docs

- **[EXTRACTION.md](./EXTRACTION.md)** — tech-stack research; source for the Jina + Docling decisions
- **[LLM-CONTEXT.md](./LLM-CONTEXT.md)** — LLM-side strategies; source for context-rich prompts, critique, tools, citations, router, thinking
- **[EXTRACTION-PLAN.md](./EXTRACTION-PLAN.md)** — the rigorous phased plan; we chose the one-shot version instead. Phased plan remains as the fallback strategy if one-shot fails badly.
- **[FEATURES.md](./FEATURES.md)** — the broader Phase 2 product roadmap; intentionally separate from extraction-engineering work
- **[PROGRESS.md](./PROGRESS.md)** — log each component as it ships within the branch

---

## Notes for future updates to this document

- **Capture build progress.** As each numbered step in "Sequencing within the branch" completes, mark it with a ✅ + commit SHA so anyone returning to this can see what's done.
- **Capture test results.** After step 3 (subset testing), record the before/after for each test shul. After step 4 (rollout), record the Saturday cron metrics.
- **Capture surprises.** If Jina turns out to be unreliable, if Docling can't handle some PDF format, if tools confuse Claude — write WHY here so future-Isaac doesn't try it again unchanged.
- **If rollback fires, document why.** A failed rollout is more valuable as a learning artifact than a hidden disappointment.
- **Promote to PROGRESS.md when shipped.** This doc is the PLAN; PROGRESS.md is the LOG. Each numbered build step gets a one-line entry in PROGRESS.md when its commit lands.
- **Don't delete this doc after rollout.** It's the historical record of why the architecture looks the way it does. Future-Isaac (and future-Claude) will want to know.
