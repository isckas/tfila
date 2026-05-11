# tfila.co

A mobile-first directory of Jewish shul minyan times. Open the app, see the next minyanim near you, sorted by start time. Times stay fresh because shuls submit their website (or weekly email) once and we re-scrape — no admin login required, no rot.

## Status

**Phase 1 build in progress.** See `SCOPE.md` for locked scope, `PROGRESS.md` for what's done / in flight, `IDEAS.md` for parking lot.

## Stack

- **Frontend**: Next.js 16 App Router + Tailwind v4 + TypeScript + React 19
- **Data**: Neon Postgres + Drizzle ORM + PostGIS (for radius queries)
- **Jobs**: Inngest (background scrapes, LLM schema-build, email ingestion)
- **LLM**: Anthropic API (Haiku 4.5 first-pass → Sonnet 4.6 fallback) for per-shul scrape-config generation
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

- `npm run dev` — Next.js dev server (Turbopack default in v16)
- `npm run build` — production build
- `npm run db:generate` — generate Drizzle migrations
- `npm run db:push` — push schema to DB
- `npm run db:studio` — open Drizzle Studio
- `npm run discover:shulcloud` — discover ShulCloud-hosted shuls
- `npm run scrape:shulcloud` — scrape known ShulCloud shuls (respects `SCRAPE_ENABLED`)
- `npm run seed` — seed DB from scrape results

## Docs

- [`SCOPE.md`](./SCOPE.md) — locked product scope, source of truth
- [`PROGRESS.md`](./PROGRESS.md) — rolling build log
- [`IDEAS.md`](./IDEAS.md) — parking lot for non-MVP ideas
- `/bot` page (live) — public description of `Tfila-Bot/1.0` scraper for shul webmasters

## Project conventions

Read `AGENTS.md` before working on the code — this repo uses Next.js 16 with breaking changes that may not match older training data.
