# Extraction Research — choosing the right tech stack

**Living research document. Not a decision; not a roadmap. A record of options and the reasoning behind each, so future-Isaac (and future-Claude) can make an informed pick when the time comes.**

Last updated: 2026-05-16 (research mode, no code changes pending). Continue editing as new tools land, as we run experiments, or as our requirements shift.

---

## The goal

Consolidate Jewish-shul minyan schedules in one trustworthy place, sourced from each shul's own authoritative output (website OR weekly bulletin email). The product promise is **"times that don't go stale."** Every architectural decision below should be evaluated against:

1. **Accuracy** — extracted rules match what the gabbai actually published
2. **Freshness** — changes propagate to public surfaces within hours, not weeks
3. **Coverage** — works across the long tail of shul website tech (WordPress, Wix, ShulCloud, custom CMSs, hand-coded HTML, PDF bulletins, image flyers, email forwards)
4. **Cost** — per-extraction $$ stays manageable as the directory grows past 1K shuls
5. **Operability** — when something breaks, we can diagnose and fix without heroics

Out of scope for THIS document: home-page UX, admin UX, Phase 2 features. This is purely about the "URL/email → structured minyan rules" pipeline.

---

## Current implementation — snapshot 2026-05-16

### Architecture: 4-tier cascade

```
URL submitted
  ↓
┌─ Tier 1: HTML ───────────────────────────────────────────────────┐
│ • lib/scrapers/fetch.ts — 3-tier UA fallback:                    │
│   1. Branded "Tfila-Bot/1.0" UA                                  │
│   2. Real Chrome UA on 403/406                                   │
│   3. Cloudflare Worker proxy on still-403/406                    │
│ • lib/scrapers/sanitize.ts — strip <script>/<style>/<svg>/       │
│   <noscript>/<template>/HTML comments via regex                  │
│ • lib/llm/extract.ts — Claude Haiku 4.5 with 4K+ system prompt,  │
│   Sonnet 4.6 fallback when Haiku confidence < 0.4                │
│ • Schema-validated output via Zod                                │
│ • hashSanitizedHtml() for no-change shortcut on weekly rescrape  │
└──────────────────────────────────────────────────────────────────┘
  ↓ (only if Tier 1 yielded < useful threshold)
┌─ Tier 2: JS-rendered HTML ───────────────────────────────────────┐
│ • lib/scrapers/render.ts — Browserless /content endpoint         │
│ • waitUntil: networkidle2                                        │
│ • Then same extraction as Tier 1                                 │
└──────────────────────────────────────────────────────────────────┘
  ↓
┌─ Tier 3: Vision (schedule image) ────────────────────────────────┐
│ • Scan static + rendered HTML for <img> with                     │
│   alt/id/class keywords like "schedule|davening|minyan|bulletin" │
│ • Rank candidates by relevance keywords                          │
│ • Top 3 candidates → Claude vision via lib/llm/extract-vision.ts │
│ • Base64-encoded image upload (bypasses some CDN robots.txt)     │
└──────────────────────────────────────────────────────────────────┘
  ↓
┌─ Tier 4: PDF (bulletin) ─────────────────────────────────────────┐
│ • Scan static + rendered HTML for .pdf links                     │
│ • Rank by URL keywords (bulletin/schedule/weekly/magazine +,     │
│   donation/sponsor/membership −)                                 │
│ • Top 1 candidate → Claude with PDF as document attachment       │
│ • lib/llm/extract-pdf.ts; same Haiku→Sonnet fallback             │
└──────────────────────────────────────────────────────────────────┘
  ↓
┌─ Failed ─────────────────────────────────────────────────────────┐
│ • Shul flipped to status='unsupported'                           │
│ • Weekly cron skips it; admin must manually re-trigger           │
└──────────────────────────────────────────────────────────────────┘
```

Each tier's strategy is **persisted on the data_source** so weekly rescrapes (`lib/inngest/functions/scrape-one-shul.ts`) skip directly to the known-good tier without re-running the cascade.

### Separate flow: email forwards

`lib/llm/extract-email.ts` runs the same Haiku→Sonnet pattern against email body text from Postmark webhook. Different prompt (`extract-email`-specific), no fetching, no rendering — body is push-delivered.

### Anti-bot story

- Branded UA first (polite)
- Browser UA on rejection (workaround for naive WAFs)
- Cloudflare Worker proxy as last resort (concrete trigger: Chabad.org sites 403ing Vercel's us-east-1 IPs)
- No residential proxies; no captcha-bypass; no Browserless sessions / persistent cookies

### Cost shape (per extraction, rough)

- **HTML tier (Haiku only, prompt cached):** ~$0.003-0.005
- **HTML tier (Haiku → Sonnet fallback):** ~$0.015-0.03
- **JS-rendered tier:** + Browserless usage (free tier sufficient at current volume)
- **Vision tier:** ~$0.02-0.05 per image
- **PDF tier:** ~$0.05-0.15 per multi-page PDF (Sonnet usually fires here)
- **Failed cascade (all tiers attempted):** ~$0.10-0.20 worst case

The 2026-05-15 `pageContentHash` bug fix (commit `49aeb4a`) now shortcuts unchanged pages on weekly rescrape → most shuls cost ~$0 on most weeks. Cost only re-incurred when content actually changes OR the schedule gets a fresh extraction.

---

## Why the current architecture is sound

These design decisions have aged well and should be preserved across any swap:

### 1. Cascade with per-tier pinning (NOT re-extraction every time)

Most managed extraction services re-run their full pipeline every call. The cascade-pinning model is more efficient and avoids redundant work — the shul that succeeded via Vision tier last week doesn't re-pay for HTML+JS+Vision+PDF this week. Just Vision.

### 2. Source-aware prompts (HTML / PDF / image / email)

Each source type has different conventions. HTML has classnames/IDs that hint at structure; PDFs have layout; images have OCR noise; emails have quoted-reply chains. One generic prompt would be worse than four targeted ones. Worth preserving.

### 3. Few-shot domain prompt

The 4K+ system prompt with 5 worked examples (clean schedule, mixed minyan/shiur, Yom Tov section, non-schedule page, prose-only multi-season) is the **single biggest accuracy lever** in the stack. No generic web-scraping LLM tool has Jewish-domain context built in. This is the moat — keep it regardless of which tier implementations swap.

### 4. Schema-validated output (Zod)

Catches LLM hallucination at the boundary. A Claude response that fails Zod validation is logged + retried, never persisted as garbage. Worth keeping.

### 5. Hash-based no-change shortcut

Unique to this stack — most extraction services don't track "did the source change since last run." For shul bulletins that change ~once per season, this is a huge cost saver. Worth keeping.

### 6. Cloudflare Worker proxy

Clever and cheap. Cloudflare's edge IPs aren't typically caught by the same anti-bot blocks that flag Vercel's us-east-1 outbound. Free at the volumes we're at. Most managed services charge meaningfully for equivalent IP-rotation features.

### 7. Direct Anthropic calls (no middleman)

At Phase 1 volumes, direct API calls are cheaper than going through an extraction-as-a-service vendor. Most managed services markup the underlying LLM cost 2-5×.

### 8. Email extraction as its own first-class path

Many shul-extraction tools (and academic papers) treat email as a special case. We treat it as a first-class data source path with its own prompt, dedup, and persistence pipeline. Right call given email is ~30-50% of our future inventory.

---

## Where 2026 has caught up to (or surpassed) custom code

Three layers where managed services or specialized tools are now meaningfully better than the current custom implementation:

### A. HTML sanitization + clean-text extraction → managed services do this better

Current `lib/scrapers/sanitize.ts` is 40 lines of regex stripping common boilerplate. It works, but:
- It's brittle: each new framework convention is a regex maintenance burden (Vue's `<style scoped>`, Web Components, etc.)
- It doesn't understand page semantics — strips by tag, not by content role (ads, nav, footer aren't stripped unless they happen to be `<script>` or `<style>`)
- It can't differentiate "this is real content" from "this is a marketing CTA"

The 2026 alternative: **Jina Reader** (https://r.jina.ai/<URL>) uses ReaderLM-v2, a 1.5B-parameter model specifically trained for HTML→markdown conversion. Removes ads, nav, footer, scripts; preserves tables and content hierarchy; handles JS rendering for most pages. ~$0.02/M tokens (compared to ~$0.05+/M for full LLM extraction). Free tier 1M tokens.

Alternative: **Firecrawl**'s `/scrape` endpoint returns clean markdown with similar quality.

**Tradeoff:** managed service = network dependency. If Jina is down, our scraping is down (unless we keep the custom path as fallback).

### B. PDF extraction → specialized parsers are way better than "send to Claude as base64"

Current `lib/llm/extract-pdf.ts` downloads the PDF, base64-encodes it, sends to Claude with the same extraction prompt. Claude has to OCR layout AND interpret minyan-times semantics in one pass. This is expensive and accuracy-limited for complex multi-page bulletins.

The 2026 alternative: **LlamaParse** (LlamaIndex) and **Reducto** are purpose-built for PDF parsing:
- LlamaParse: agentic OCR designed for documents; understands tables, hierarchy, figures. SDK-friendly. Free tier exists.
- Reducto: multi-pass — traditional layout detection first, then vision-language model review. Up to 20% higher accuracy on real documents per their benchmarks. Enterprise-pricing.
- **Docling** (IBM open-source): on-prem PDF parsing. Worth considering if external API dependency is a concern.
- **Unstructured.io**: open-source library, broad format support, more generic than specialized PDF parsers.

A specialized PDF parser does the OCR/layout pass first (cheap, deterministic), then a smaller LLM call extracts schedule semantics from clean structured input. Two narrow well-defined steps beats one wide ambiguous one.

**Tradeoff:** extra hop. Today: 1 API call (Claude with PDF). With LlamaParse: 2 API calls (parse + extract). Latency increases; cost depends on the parser's pricing.

### C. Bare JSON output → Anthropic's tool use is more reliable

Current `lib/llm/extract.ts` instructs Claude to emit JSON, parses the response string, validates with Zod. Failure modes seen in production:
- Claude adds a prose preamble ("Here's the extracted schedule:") before the JSON
- Claude wraps in ```json ... ``` fences
- Claude truncates the JSON when output tokens run out mid-array

The 2026 alternative: define the schema as an Anthropic **tool**. Claude is forced to call the tool with valid arguments. The structured output comes back as a parsed object, not a JSON string. Anthropic explicitly recommends this for extraction tasks.

**Tradeoff:** small refactor (changes the `messages.create` call shape); no real downside. Probably the highest-ROI swap of the three.

---

## Tools surveyed — quick reference

### LLM-friendly scraping platforms

| Tool | What it does | Pricing (approximate) | Best for | Notes |
|---|---|---|---|---|
| **Firecrawl** | Fetch + JS render + clean to markdown / JSON, single API call | Free tier; paid from $20/mo, scaler $99/mo, top $333/mo (500K pages) | Production LLM apps; clean markdown out of any URL | Most polished UX of the category. Includes structured extraction with schema. |
| **Jina Reader** | URL → clean markdown via ReaderLM-v2; `r.jina.ai/<URL>` prefix | Free tier 1M tokens; $0.02/M tokens after | Single-URL clean-text extraction; pre-processor before LLM extract | Tiny model purpose-built for HTML→markdown. Highest signal-to-noise for clean conversion. |
| **Crawl4AI** | Open-source Python framework for LLM-ready scraping | Free (self-host) | Teams that want full control and don't mind ops burden | 58K+ GitHub stars in <1 year. Strong community. Operational tax is real if you self-host at scale. |
| **ScrapeGraphAI** | Graph-based extraction with multi-LLM support (OpenAI, Anthropic, local) | Free open-source; paid from $20/mo | Custom extraction graphs; supports natural-language schema | More flexible than Firecrawl; smaller polish budget. |
| **ZenRows** | Managed scraping API with anti-bot bypass | Free tier; paid from $69/mo | Sites with heavy anti-bot protection | Closest to "Bright Data with developer-friendly API." |
| **ScrapingBee** | Headless browser as API | From $49/mo | Replacing self-hosted Puppeteer/Playwright | Simpler than Browserless for many cases. |

### PDF / document parsers

| Tool | What it does | Pricing | Best for | Notes |
|---|---|---|---|---|
| **LlamaParse** | Agentic OCR for PDFs/docs; understands structure (tables, hierarchy, figures) | Free tier; paid per-page | Most PDF use cases; integrates well with LlamaIndex | Probably the right swap for our PDF tier. |
| **Reducto** | Multi-pass: layout detection → vision-language model review | Enterprise | High-stakes / regulated documents | Best accuracy in independent benchmarks. Overkill for our needs. |
| **Docling** | Open-source PDF parser (IBM) | Free (self-host) | On-prem requirements; OR cost-sensitive teams | Solid baseline; less polished than the managed options. |
| **Unstructured.io** | Open-source library, broad format support | Free open-source; paid hosted | When PDF is one of many formats (PowerPoint, Word, etc.) | More generic than specialized PDF parsers. |
| **Reader API (Jina)** | Also handles PDFs via the Reader endpoint | Same Jina pricing | If we already use Jina for HTML, sticking with it for PDFs reduces vendors | Less powerful than LlamaParse for complex layouts. |

### Browser automation

| Tool | What it does | Pricing | Best for | Notes |
|---|---|---|---|---|
| **Browserless** (current) | Managed Chromium endpoint | Free tier; paid from $50/mo | Drop-in for Puppeteer/Playwright | Older; reliable. |
| **Browserbase** | Newer-gen; built for AI agents; session persistence | $39/mo+ | New projects; agent workflows | More sophisticated APIs for agent scenarios. |
| **Scrapfly** | Browser + proxy bundled | $29/mo+ | All-in-one anti-bot + render | Simpler vendor surface area. |
| **Self-hosted Playwright** | DIY | Free | High-volume + ops capacity | Cheaper at scale; operational burden. |

### Residential proxies (anti-bot bypass)

| Tool | What it does | Pricing | Best for |
|---|---|---|---|
| **Bright Data** | Massive residential proxy network | Enterprise (~$15/GB) | Sites with serious anti-bot (would only matter if our targets escalate) |
| **Oxylabs** | Similar; bandwidth-based pricing | Enterprise | Same |
| **Scrapfly** (above) | Includes proxy rotation in the same product | $29/mo+ | Smaller scale |

Our Cloudflare Worker proxy occupies a similar niche, free.

### Structured-output patterns

| Pattern | Notes |
|---|---|
| **Anthropic tool use** | Official recommendation. Schema enforcement at the API level. Almost certainly the right pattern for our use. |
| **OpenAI function calling** | Same idea, different vendor. We're on Anthropic so moot. |
| **Instructor / Outlines** | OSS libraries that bolt schema enforcement onto any LLM. Useful if we ever want LLM portability. |
| **JSON Schema with Anthropic** | Older approach; less reliable than tool use. |

---

## Specific swap candidates — ranked

Listed from highest-ROI to lowest. Each is independently revertible.

### Rank 1: Anthropic tool use for structured output

- **What:** rewrite `extract.ts` / `extract-pdf.ts` / `extract-vision.ts` / `extract-email.ts` to use Anthropic's tool-use API for structured output
- **Effort:** ~half a day. Mechanical change to the messages.create call shape; schema stays the same.
- **Risk:** very low. Same model, same prompt, same schema — just different API surface.
- **Benefit:** eliminates entire class of "Claude wrapped in markdown fence" / "Claude added prose preamble" / "JSON truncated mid-array" failure modes. Failed-extraction logs become clearer.
- **Reversibility:** trivial; one PR can switch back.

### Rank 2: Jina Reader as HTML preprocessor

- **What:** before the LLM extraction step, run the URL through `r.jina.ai/<URL>` to get clean markdown. Then run the extraction prompt against the markdown instead of sanitized HTML.
- **Effort:** ~1 day. New `lib/scrapers/jina-reader.ts`; swap the `extractFromHtml` input source; keep `sanitize.ts` as a fallback for when Jina fails.
- **Risk:** medium. New external dependency (Jina). Need to handle their rate limits + failure modes.
- **Benefit:** simpler input to the LLM (markdown is denser and cleaner than HTML); fewer lost-in-the-noise failures; ~150 lines of custom HTML sanitization + UA-fallback code becomes vestigial.
- **Reversibility:** medium. Once switched, going back requires re-validating that `sanitize.ts` still works against current shul sites.

### Rank 3: LlamaParse for the PDF tier

- **What:** replace `extract-pdf.ts`'s direct-Claude approach with LlamaParse for the PDF→clean-markdown step, then run the existing extraction prompt against the markdown.
- **Effort:** ~1-2 days. New API integration; chunk LlamaParse's markdown output appropriately for our extraction prompt; cost/quota monitoring.
- **Risk:** medium. PDF tier is currently the weakest (admin reports lower confidence on multi-page bulletins), so improvement is likely; but LlamaParse pricing depends on volume.
- **Benefit:** higher extraction accuracy for the hardest tier; specialized OCR + layout parsing for complex multi-column bulletins.
- **Reversibility:** medium. PDF tier is small surface area; easy to swap back.

### Rank 4: Browserbase for JS rendering

- **What:** replace `lib/scrapers/render.ts`'s Browserless usage with Browserbase.
- **Effort:** ~half a day. API shape is similar; mostly a config swap.
- **Risk:** low. Both are managed Chromium services.
- **Benefit:** marginal. Possibly slightly better reliability + cheaper at our volume. Not a meaningful UX change.
- **Reversibility:** trivial.
- **My take:** wait until Browserless pricing or reliability becomes a real pain. Not worth swapping today.

### Rank 5: Move HTML extraction off custom infrastructure entirely (Firecrawl)

- **What:** replace the entire HTML + JS-render tier with Firecrawl's `/extract` endpoint (which handles fetch + JS render + clean text + structured extraction in one call).
- **Effort:** ~2-3 days. Significant refactor.
- **Risk:** high. Locks in to a vendor; harder to swap back; their extraction quality might or might not match our custom prompt's domain knowledge.
- **Benefit:** removes ~500 lines of custom code; faster to iterate on prompt + schema in their hosted environment.
- **Reversibility:** low. Once on Firecrawl, going back requires rebuilding everything.
- **My take:** don't do this. The custom code IS our differentiation. Firecrawl is good for new projects; we already have the equivalent built.

---

## Out-of-the-box reframes (architecture-level, not tier swaps)

The above swaps are incremental improvements to the existing extraction model. The reframes below challenge the model itself. None are commitments — they're documented here so they're considered during major-decision moments.

### Reframe 1: Flip the model — gabbai portal (push, not pull)

Already a Phase 2 candidate in FEATURES.md. Brief summary: stop scraping shuls; have gabbais publish their schedule to us via a free portal that also auto-generates their weekly bulletin email and a website widget. Solves the gabbai's actual ops pain; structured data falls out as a side effect. The Stripe playbook applied to shul ops.

When relevant: when daily users > 50, when there's a clear ICP (e.g. a Vaad asking to manage 30 shuls), when Isaac is ready to wear the "shul-acquisition" hat (different skill from engineering).

### Reframe 2: Compute the schedule, don't scrape it

A shul's full year of times is usually derivable from 8-15 rules ("Mincha = shkia − 18", "weekday Shacharis 6:45", "Shabbos Mincha 15 min before shkia"). The weekly bulletin is mostly those rules re-rendered for this week's dates.

If we capture rules ONCE per shul (via the portal above, or as a one-time data-entry pass), we compute the schedule for the next 365 days automatically — no scraping per week. The bulletin becomes a derived artifact, not a source of truth.

When relevant: same trigger as reframe 1. They're complementary.

### Reframe 3: Multi-source corroboration

Today we scrape one source per shul. Better: scrape every available source AND accept davener / community / gabbai inputs AND surface the consensus. When sources agree → high confidence; when they disagree → flag for review.

Sources per shul could include: website, bulletin email, davener QR check-ins, gabbai portal entries, WhatsApp bulletin postings, Vaad master schedules.

When relevant: when the user base is large enough that davener check-ins generate meaningful volume (probably > 100 daily active users). Premature now; powerful later.

### Reframe 4: Davener-as-sensor

Daveners attending the shul know the schedule better than any scraper. A QR poster in each shul → davener taps → "I'm here, mincha is at 7:15" → confirmation hits our DB. Combined with scraping: highest-trust freshness signal in the category.

When relevant: requires shul-side adoption (the poster). Pairs naturally with the portal reframe (#1).

### Reframe 5: Schema.org Event microdata

Convince shuls to publish standard Schema.org Event markup on their pages. Then our "scrape" becomes "fetch + parse standardized JSON-LD." No LLM needed. SEO bonus for the shul (events appear in Google search). Open standard, not proprietary.

When relevant: requires shul-side adoption. Most useful as an outbound advocacy / dev-rel motion; not a unilateral tech choice.

---

## Decision framework — how to evaluate a swap

Before committing to ANY swap, build a small evaluation rig:

1. **Pick a test set.** 10-15 hand-curated extractions across HTML / JS-rendered / PDF / vision / email tiers. Each test = source URL or document + the correct extracted rules. Hand-curated, so each result has a known-correct baseline.

2. **Run baseline.** Current cascade against the test set. Capture: rules extracted, confidence, cost, latency, failures.

3. **Run candidate.** Same test set against the swap (e.g. Jina Reader as preprocessor + same Claude extraction). Capture the same metrics.

4. **Diff.** Where did the candidate do better? Where worse? Where different in ways that need human judgement?

5. **Decide based on data, not vibes.** If candidate is meaningfully better OR equivalently good at half the code complexity, commit.

The "test set" doesn't exist yet. **Building it is a prerequisite to any swap decision.** Estimated effort: 4-6 hours to curate 15 shuls + write the correct rules + structure as JSON fixtures. That's a small investment that pays back forever — same test set evaluates every future swap candidate.

This pre-req is also captured in the FEATURES.md "Automated tests" gap entry — the same 15 fixtures could double as regression tests for the existing extraction pipeline.

---

## Open research questions

Things we don't yet know and would need to investigate before swapping anything.

### Quality questions

- **How does Jina Reader's markdown extraction compare against our `sanitize.ts` for shul-specific pages?** Build the test rig, measure per-tier accuracy.
- **Does LlamaParse's table-aware extraction improve PDF tier accuracy enough to justify the extra hop?** Same test rig, PDF subset.
- **How does Anthropic tool use compare to bare JSON parsing in practice?** Measure failure rate (parse errors per 100 extractions) on the current cascade vs a tool-use rewrite. Probably already low for us but worth quantifying.

### Cost questions

- **Per-extraction cost of the current cascade at production volumes** — gather from `data_source.config_json.usage` aggregates. Today this is anecdotal; should be a dashboard.
- **Break-even point for managed services.** If we hit 10K extractions/month, does Firecrawl's $99 tier start to make sense vs continuing direct Anthropic calls? Worth modeling at projected growth.
- **Whether the `pageContentHash` no-change shortcut (now fixed) has materially reduced our weekly cron spend.** First couple of Saturdays after the 2026-05-15 deploy will tell.

### Operational questions

- **Vendor reliability for managed services.** If Jina has a 4-hour outage, do shul rescrapes fail or queue gracefully? Need to design the fallback.
- **Rate limits + SLAs of each candidate.** Mapped to our peak load (Saturday-night cron fan-out of ~150 shuls in ~5 min).
- **Vendor lock-in risk.** Each new vendor is a future migration cost if their pricing changes or they pivot. Custom code is at least migration-proof.

### Domain questions

- **What's the next 100 shuls' tech distribution?** If we're moving from "Brooklyn + Toronto" (mostly WordPress / ShulCloud) to "South America + Australia + Russia" (different CMS landscape), the cascade may need re-tuning. The right tools differ if PDFs dominate vs HTML.
- **Are weekly bulletins actually the right primitive?** If the same email is forwarded 10 times in a week (different daveners forwarding the same source), do we deduplicate gracefully? Today: maybe.
- **What fraction of our future inventory will come via email vs URL?** This shapes which tier is the highest-leverage to optimize. Currently unknown.

---

## Cost ballparks — rough comparison

For a hypothetical run of 1000 extractions per month, all tiers exercised proportionally:

| Stack | Estimated monthly cost | Notes |
|---|---|---|
| **Current (direct Anthropic + Browserless)** | $30-80 | Variable by content change rate; hash-shortcut makes most weeks ~$0 |
| **Current + Anthropic tool use** | Same | Tool use is the same API surface, same per-token pricing |
| **Current + Jina Reader preprocessor** | $25-60 | Reduces total input tokens to Claude; net likely lower despite Jina cost |
| **Current + LlamaParse for PDF tier** | $35-90 | LlamaParse adds cost but PDF tier is small fraction of total |
| **Firecrawl all-tier replacement** | $99-333 | Tier-based pricing; less optimization possible |

These are educated guesses, not measurements. Real numbers require the test rig + a month of production data.

---

## Recommended sequencing (if/when we decide to swap)

If we eventually act on this research, the order matters. Smallest-blast-radius first:

1. **Build the evaluation test rig** (4-6 hours; prerequisite for everything else)
2. **Anthropic tool use migration** (half day; pure win)
3. **Run the test rig** on baseline + tool-use to validate equivalent behavior
4. **Add Jina Reader as preprocessor** with fallback to current `sanitize.ts` on Jina errors (1 day)
5. **Run test rig + 2-week production observation**; decide whether Jina is keeper
6. **If Jina is keeper:** consider Jina also for PDF tier (one less vendor)
7. **Otherwise:** add LlamaParse for PDF tier
8. **Skip Browserbase swap** unless Browserless becomes painful
9. **Never swap to Firecrawl full-replacement** unless we want to ditch the domain prompt advantage

---

## Sources / further reading

### Survey articles
- [Top 7 AI Web Scraping Tools of 2026 (ScrapeOps)](https://scrapeops.io/web-scraping-playbook/best-ai-web-scraping-tools/)
- [Best AI Web Scraping Tools for LLMs in 2026 (ZenRows)](https://www.zenrows.com/blog/ai-web-scraping-tools)
- [AI Web Scraping Tools Compared (Browse AI)](https://www.browse.ai/blog/the-best-ai-web-scraper-tools)
- [LLM-Powered Data Extraction: Structured Output Guide 2026](https://dataresearchtools.com/llm-data-extraction/)
- [Structured Data Extraction Using LLM Schemas (Simon Willison)](https://simonwillison.net/2025/Feb/28/llm-schemas/)

### Specific tools
- [Firecrawl](https://www.firecrawl.dev/)
- [Jina Reader](https://jina.ai/reader/) — [ReaderLM-v2](https://jina.ai/news/readerlm-v2-frontier-small-language-model-for-html-to-markdown-and-json/)
- [Crawl4AI (GitHub)](https://github.com/unclecode/crawl4ai)
- [ScrapeGraphAI](https://scrapegraphai.com/)
- [LlamaParse (LlamaIndex)](https://www.llamaindex.ai/insights/top-document-parsing-apis)
- [Reducto](https://reducto.ai/)
- [Docling (IBM, OSS)](https://github.com/DS4SD/docling)
- [Unstructured.io](https://unstructured.io/)
- [Browserbase](https://www.browserbase.com/)
- [Scrapfly](https://scrapfly.io/)
- [Anthropic tool use docs](https://docs.anthropic.com/en/docs/build-with-claude/tool-use)

### Benchmarks
- [PDF Table Extraction Showdown: Docling vs LlamaParse vs Unstructured (BoringBot)](https://boringbot.substack.com/p/pdf-table-extraction-showdown-docling)
- [Reducto vs LlamaParse Document Parser Comparison](https://llms.reducto.ai/document-parser-comparison)
- [Best PDF Parsers for AI and RAG Workflows in 2026 (Firecrawl)](https://www.firecrawl.dev/blog/best-pdf-parsers)

### Architectural papers
- [PARSE: LLM-Driven Schema Optimization for Reliable Entity Extraction (arxiv)](https://arxiv.org/abs/2510.08623)
- [LLM-based Schema-Guided Extraction (arxiv)](https://arxiv.org/abs/2604.06571)

---

## Notes for future updates to this document

- **Keep this living.** New tools land monthly in this space. When you see something interesting, add it to the "Tools surveyed" table even before evaluating.
- **Record decisions as they happen.** If we decide to swap to LlamaParse, add a "Decision: 2026-XX-XX adopted LlamaParse for PDF tier" section at the top so future-Isaac can see the history.
- **Capture surprises from production.** If a vendor we adopted disappoints, note WHY here. The lessons compound.
- **Don't merge this into FEATURES.md.** FEATURES.md is about product decisions; EXTRACTION.md is about the data-pipeline tech stack. They serve different audiences (PM vs engineer).
- **Re-read before any swap-related conversation.** Most "should we use X?" arguments are settled by re-reading the relevant section here.
