# tfila.co

A mobile-first directory of Jewish shul minyan times. Open the app, see the next minyanim near you, sorted by start time. Times stay fresh because shuls submit their website (or weekly email) once and we re-scrape — no admin login required, no rot.

## Status

**Phase 1 build in progress.** See `SCOPE.md` for locked scope, `PROGRESS.md` for what's done / in flight, `IDEAS.md` for parking lot.

## Stack

- **Frontend**: Next.js 16 App Router + Tailwind v4 + TypeScript + React 19
- **Data**: Neon Postgres + Drizzle ORM + PostGIS (for radius queries)
- **Jobs**: Inngest (background scrapes, LLM schema-build, email ingestion)
- **Extraction cascade**: `html → js_rendered → pdf_document → vision_image → failed`. Each tier escalates only if the previous yielded 0 useful rules; the winning tier is persisted on `data_source` so weekly rescrapes skip earlier ones.
  - **LLM**: Anthropic API (Haiku 4.5 first-pass → Sonnet 4.6 fallback). Used for HTML, PDF, and image extraction. Prompt caching + Zod validation + tolerant JSON parser.
  - **JS rendering**: Browserless `/content` endpoint for SPAs / sites with JS-injected schedules.
- **Hosting**: Vercel
- **Observability**: Sentry + structured logs

## Development

```bash
# Install dependencies
npm install

# Copy env template and fill in real values
cp .env.example .env.local

# Run dev server
npm run dev
```

In a second terminal, start the Inngest dev server for background jobs:

```bash
npx inngest-cli@latest dev
```

Then open <http://localhost:3000>.

## Scripts

**npm scripts** (in `package.json`):
- `npm run dev` — Next.js dev server (Turbopack default in v16)
- `npm run build` — production build
- `npm run db:generate` — generate Drizzle migrations
- `npm run db:push` — push schema to DB
- `npm run db:studio` — open Drizzle Studio

**Diagnostic / one-shot scripts** (run with `npx tsx scripts/<name>.ts`):
- `verify-migration-0003.ts` — sanity check migration 0003 (extraction_strategy)
- `inspect-failed-extraction.ts <url-substring>` — show the cascade_attempts breakdown for failed extractions
- `debug-cascade.ts <url>` — run the cascade end-to-end without DB writes; full per-tier output
- `test-llm-extract.ts <url>` — manual HTML extraction test
- `test-inbound-email.ts` — synthetic Postmark webhook payload (for the email flow)

**Legacy** (sprint-1, kept for occasional re-runs):
- `npm run discover:shulcloud`, `npm run scrape:shulcloud`, `npm run migrate:sprint1`

## Docs

- [`SCOPE.md`](./SCOPE.md) — locked product scope, source of truth
- [`PROGRESS.md`](./PROGRESS.md) — rolling build log + **"Now — pickup tomorrow"** section for active work
- [`STYLE.md`](./STYLE.md) — UX principles (minimal clicking, simple clean aesthetics)
- [`IDEAS.md`](./IDEAS.md) — parking lot for non-MVP ideas
- `/bot` page (live) — public description of `Tfila-Bot/1.0` scraper for shul webmasters

## Project conventions

Read `AGENTS.md` before working on the code — this repo uses Next.js 16 with breaking changes that may not match older training data.
