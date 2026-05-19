# tfila.co — Operational Runbook

What to do when things break. Each scenario follows the same shape:

- **Trigger**: how you notice
- **Dashboard**: where to look first
- **Command**: what to type
- **Verify**: how to confirm it worked

Keep this doc lean — link out rather than rephrase. Update after every real incident so the next-you has a faster path.

---

## Site is down

**Trigger**: UptimeRobot email "tfila.co is down", curl times out, friend says "the link doesn't work."

**Dashboard**:
1. https://vercel.com/yossis-projects-9ae4ab2e/tfila → check deployment status of the production alias
2. https://tfila.co/api/health → if it returns 503 the DB is the issue; if it times out the app is the issue
3. Vercel runtime logs (project → Logs tab, filter by route)
4. https://sentry.io → check for an error spike

**Command — rollback the last deploy**:
```bash
vercel ls                                     # find a known-good prior deployment
vercel rollback <good-deployment-url>         # alias prod back to that one
```

**Command — kill traffic without rolling back** (last resort, mid-investigation):
```bash
vercel env add MAINTENANCE_MODE true production
# (Site has no maintenance check today — add one if you reach for this.)
```

**Verify**: hit `https://tfila.co/api/health`, expect `{ ok: true, db: { ok: true, latencyMs: <small> } }`.

---

## Weekly cron silently failed

**Trigger**: Sunday morning passes with no `Weekly cron · …` email from `weekly-rescrape-summary`. Or you see one with all-`broken` rows.

**Dashboard**:
1. https://app.inngest.com → Functions → `weekly-rescrape` — was the cron fired? Did it complete?
2. Same dashboard → `scrape-one-shul` — fan-out children, look for failures
3. `scripts/cron-summary.mjs --hours 24` from a local terminal — bulk failure tally + per-shul breakdown

**Command — re-run a single shul**:
```
Inngest dashboard → scrape-one-shul → find failed event → "Retry"
```

**Command — manually trigger the whole weekly cron**:
```
Inngest dashboard → weekly-rescrape → "Run now"
```

Or from a local terminal (forge an event):
```bash
node scripts/extract-one-shul.ts <shulId>
```

**Verify**:
- New row in `scrape_run` table for the affected shul with `status='ok'`
- New `data_source` row attached (if v2: `source_quote` populated)
- The cron-summary email arrives next Sunday with the affected shul as `ok`

---

## Cost spike on Anthropic

**Trigger**:
- Anthropic console alert email (cap is set there)
- Vercel billing surprise
- A failed extraction loop visible in Inngest with 100s of retries

**Dashboard**:
1. https://console.anthropic.com → Usage → daily breakdown by model
2. Inngest → `build-data-source` / `scrape-one-shul` → look for events with >5 retries
3. Postgres query (via `mcp__pg-neon__query`):
   ```sql
   SELECT created_at::date, COUNT(*),
          SUM((config_json->'usage'->'haiku'->>'inputTokens')::int) AS haiku_in
     FROM data_source
    WHERE created_at > NOW() - INTERVAL '3 days'
    GROUP BY 1 ORDER BY 1 DESC;
   ```

**Command — kill all new LLM traffic immediately**:
```bash
vercel env add EXTRACTION_DISABLED true production
# (cascade.ts must check this flag — wire up if not present)
```

**Command — disable v2 specifically** (if v2 is suspected):
```bash
vercel env rm EXTRACTION_PIPELINE_V2 production
# Optionally also: vercel env rm EXTRACTION_V2_SHUL_IDS production
```

**Verify**: Anthropic console usage flatlines within 5 min. Inngest function queue stays empty for new events.

---

## Credential leak / rotate-all

**Trigger**: a secret got committed; a key showed up in logs; an API responded with 401 you didn't expect.

**Rotation order (highest blast radius first)**:
1. **Anthropic** (`ANTHROPIC_API_KEY`) — console.anthropic.com → API keys → rotate → update Vercel prod env
2. **Inngest** (`INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`, `INNGEST_API_KEY`) — Inngest dashboard → Settings → rotate
3. **Resend** (`RESEND_API_KEY`) — resend.com → API keys → rotate (transactional email)
4. **Postmark inbound** (`POSTMARK_INBOUND_USERNAME` / `POSTMARK_INBOUND_PASSWORD`) — Postmark account → rotate, update webhook URL
5. **Google Geocoding** (`GOOGLE_GEOCODING_API_KEY`) — console.cloud.google.com → APIs & Services → rotate
6. **Jina** (`JINA_API_KEY`), **HF** (`HF_TOKEN`) — respective dashboards
7. **AUTH_SECRET** — rotates all admin sessions (forces re-sign-in). Generate fresh: `openssl rand -base64 48`. Update Vercel prod env. Last because it nukes your own session.

For each: update via CLI:
```bash
vercel env rm <KEY> production
vercel env add <KEY> production
# (paste new value when prompted; Vercel auto-redeploys)
```

**Verify**:
- Hit `/api/health` after each rotation cycle — should still return 200
- Sign in to admin yourself (after AUTH_SECRET rotation)
- Check Inngest dashboard — events still firing

---

## Database emergency

**Trigger**: `/api/health` returns 503; queries failing across the site; Drizzle errors in Sentry.

**Dashboard**:
1. https://console.neon.tech → check pool status, recent migrations, branch state
2. https://tfila.co/api/health → if 503, DB ping is failing

**Command — quick rollback to a snapshot**:
```
Neon console → tfila DB → Branches → create branch from snapshot at <time>
→ promote branch to primary
```

**Command — read-only safe inspection** (from Claude Code with Postgres MCP installed):
```
mcp__pg-neon__query "SELECT COUNT(*) FROM shul WHERE status='active'"
```

**Verify**:
- `/api/health` returns 200
- The home feed renders normally with shul cards visible
- One known shul (e.g. `/shul/bayt`) loads with rules

---

## Cheat sheet

| If you see this... | First action |
|---|---|
| UptimeRobot "down" alert | `/api/health` + Vercel deployment status |
| Anthropic cap alert | `vercel env add EXTRACTION_DISABLED true production` |
| Sunday with no cron email | `node scripts/cron-summary.mjs --hours 24` |
| Admin session expired everyone | Did you rotate `AUTH_SECRET`? Expected. |
| A shul's data is wrong / stale | Admin Extract Now button on the shul detail page |
| LLM extraction loops forever | Inngest → kill function → set `EXTRACTION_DISABLED=true` |
| New deploy broke the site | `vercel rollback <prior-good-deployment>` |

---

Update this file after each incident. The post-mortem note is more valuable than the incident itself.
