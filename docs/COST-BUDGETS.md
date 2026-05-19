# LLM Cost Budgets

How much we're willing to spend on Anthropic per day before the circuit breaker trips. Update these numbers when traffic warrants — don't outgrow them silently.

## Daily ceilings (current)

| Ceiling | Value | Where set | Trigger |
|---|---|---|---|
| Daily LLM spend (sum of haiku + sonnet, input + output) | **$25 USD** | `LLM_DAILY_BUDGET_USD` env var (defaults to 25 if unset) | Circuit breaker in `lib/llm/cost-gate.ts` returns `daily_budget_exceeded`, cascade exits early with `strategy=failed` |
| Kill switch | hard `off` | `EXTRACTION_DISABLED=true` env var | Same circuit breaker returns `kill_switch`, all extractions short-circuit |

The ceiling is the sum across both models, scoped to data_sources created in the current UTC day. New extractions block once today's accumulated spend crosses it.

## Where Anthropic-side alerts come from

In addition to the in-app gate, set hard caps + email alerts at the API-key level on console.anthropic.com. Two layers, different failure modes:

- **Anthropic console cap**: hard cap on the API key. If the gate misses (e.g. DB is down and we fail open), this catches it. Set to ~2× the daily ceiling, monthly.
- **Anthropic console email alert**: heads-up at 50% / 75% / 100% of cap. Helps you decide whether to raise the gate before it bites.

## What "$25/day" buys (rough scaling)

Based on the v2 BAYT canary baseline (~60k input + 4k output tokens per extraction, mostly Haiku, ~$0.07/extraction):

- $25/day ≈ ~350 extractions/day
- Weekly cron rescrape on ~50 shuls = ~$3.50/week amortized
- 100 organic /submit and email-inbound events/day = $7/day

There is significant headroom at current scale (51 shuls + low organic traffic). The ceiling exists to catch runaway loops, not to constrain normal usage.

## When to revisit

- Daily spend crosses 50% of the ceiling for 3 days running → raise ceiling proactively
- Shul count crosses 200 → re-derive baseline (more parallel cron load) and bump
- New tier added (e.g. a new vision-image variant) → re-derive per-extraction cost and re-bump
- Anthropic price change → update `PRICE_INPUT_PER_MTOK` / `PRICE_OUTPUT_PER_MTOK` constants in `cost-gate.ts`

## Operator notes

To temporarily raise the ceiling for a planned bulk operation:
```bash
vercel env add LLM_DAILY_BUDGET_USD production
# enter e.g. 100 for a one-day import
# remember to revert: vercel env rm LLM_DAILY_BUDGET_USD production
```

To kill all new LLM traffic immediately during an incident:
```bash
vercel env add EXTRACTION_DISABLED true production
```
(See [RUNBOOK.md](./RUNBOOK.md) "Cost spike on Anthropic" for the full procedure.)
