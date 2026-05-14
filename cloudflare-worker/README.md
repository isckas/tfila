# tfila Cloudflare Worker

A Cloudflare Worker that handles two tfila.co concerns from Cloudflare's edge:

1. **Inbound email** (`email()` handler): receives mail at `submit@tfila.co` via Cloudflare Email Routing, parses with postal-mime, forwards a Postmark-shaped JSON payload to `/api/inbound/email`. Free at any volume.
2. **Fetch proxy** (`fetch()` handler at `/fetch`): server-to-server HTTP proxy that the main app's scrapers call as a fallback when an origin site blocks Vercel's outbound IPs (e.g. Chabad.org-hosted sites that anti-bot us-east-1 AWS ranges). Cloudflare's edge IPs aren't typically caught by the same blocks. Authenticated via bearer token.

This Worker is **standalone**: it has its own `package.json`, its own `wrangler.toml`, and deploys independently. The main app (in the parent directory) calls into it but isn't tightly coupled — turning the Worker off degrades gracefully (fetches just stop at the browser-UA attempt instead of getting a proxy retry).

---

## End-to-end setup (one-time, ~15 min)

### Prerequisites

- `tfila.co` DNS managed by Cloudflare (or `inbound.tfila.co` delegated to Cloudflare). If DNS is elsewhere right now, the easiest move is to point your registrar's nameservers at Cloudflare's — Cloudflare DNS is free and a strict upgrade. ~5 min.
- A Cloudflare account on a plan that includes Email Routing (free plan does).

### 1. Enable Email Routing on the domain

In the Cloudflare dashboard:

1. Pick the `tfila.co` zone
2. **Email → Email Routing**
3. Click **Get started** — Cloudflare will add the MX records and an SPF record to your zone automatically.
4. Verify the destination address (an email that gets the "did the routing work?" notifications). Use your personal email.

### 2. Install dependencies + log in to Cloudflare

```bash
cd cloudflare-worker
npm install
npx wrangler login        # opens browser, one-time
```

### 3. Generate webhook credentials

These will be HTTP Basic Auth between the Worker and tfila.co. Pick anything you'd use as a username + password. For example:

```bash
# Just pick something — these are random-bytes-sized strings
WEBHOOK_USER="tfila-worker"
WEBHOOK_PASS="$(openssl rand -hex 32)"
echo "WEBHOOK_USER=$WEBHOOK_USER"
echo "WEBHOOK_PASS=$WEBHOOK_PASS"
```

You'll need these in **both** the Worker (as wrangler secrets) AND in Vercel (so the main app can verify the incoming requests).

### 4. Set the Worker's secrets

```bash
echo "https://tfila.co/api/inbound/email" | npx wrangler secret put WEBHOOK_URL
echo "$WEBHOOK_USER" | npx wrangler secret put WEBHOOK_USER
echo "$WEBHOOK_PASS" | npx wrangler secret put WEBHOOK_PASS
```

### 5. Set the same credentials on Vercel

Back in the main repo (parent directory):

```bash
cd ..
echo "$WEBHOOK_USER" | vercel env add POSTMARK_INBOUND_USERNAME production
echo "$WEBHOOK_PASS" | vercel env add POSTMARK_INBOUND_PASSWORD production
vercel --prod --yes    # redeploy so the new env vars take effect
```

(The variable names start with `POSTMARK_` for historical reasons — the auth check lives in `app/api/inbound/email/route.ts`. We kept the names so the receiver code doesn't need to change.)

### 6. Deploy the Worker

```bash
cd cloudflare-worker
npx wrangler deploy
```

Wrangler will print the Worker's URL. Confirm the deploy by tailing logs:

```bash
npx wrangler tail
```

### 7. Wire the Email Routing rule

In the Cloudflare dashboard:

1. **Email → Email Routing → Routes**
2. **Custom address → Create address**
3. Custom address: `submit@tfila.co`
4. Action: **Send to a Worker**
5. Worker: pick `tfila-inbound-email` from the dropdown
6. **Save**

### 8. Verify

Send a test email to `submit@tfila.co` (e.g. forward one of your own shul's weekly bulletins).

- **In Cloudflare Worker logs** (`npx wrangler tail`): should see a successful invocation with HTTP 202 from the webhook.
- **In Vercel logs**: should see `POST /api/inbound/email` return 202 and an Inngest event being sent.
- **In the admin queue at `/admin/queue`**: a new shul should appear within ~30 seconds.

---

## Routine operation

After setup, you don't need to think about it. The Worker runs forever on Cloudflare's free tier (100k requests/day max — we're nowhere near that). Email Routing is also free with no volume cap for our scenario.

Re-deploy after editing this Worker:

```bash
cd cloudflare-worker
npx wrangler deploy
```

Tail live logs:

```bash
npx wrangler tail
```

---

## How it talks to the main app

The Worker speaks **Postmark inbound webhook format**. Same payload shape Postmark would have sent, same auth scheme (HTTP Basic). This keeps the main app's `app/api/inbound/email/route.ts` Cloudflare-agnostic — if we ever switch back to Postmark or to another vendor, we just turn off the Worker and configure the alternative.

If you want to inspect what the Worker is sending, edit `src/index.ts` and add a `console.log(payload)` before the `fetch()`. Logs appear in `wrangler tail`.

---

## Cost

| | Free tier | At our projected volume |
|---|---|---|
| Cloudflare Email Routing | unlimited messages | unlimited |
| Cloudflare Workers requests | 100k requests/day | < 100/day |
| Email-tier execution time | 30s per invocation | < 1s typical |
| **Total** | | **$0/month** |

Compare to Postmark: ~$15/month at any volume that includes inbound parsing.

---

## Troubleshooting

- **Worker logs show HTTP 401 from the webhook**: `WEBHOOK_USER` / `WEBHOOK_PASS` don't match what Vercel has. Re-run step 5 + redeploy.
- **Mail bounces back to sender**: the Worker is throwing. `wrangler tail` shows why. Common cause: malformed email passed through `postal-mime` parsing. Edge cases like calendar invites can do this.
- **Mail arrives in Cloudflare but doesn't reach the Worker**: the Email Routing rule isn't pointing at this Worker. Re-check step 7.
- **Mail arrives at Cloudflare but `wrangler tail` shows nothing**: the destination address verification (step 1, "Cloudflare emails you to confirm") wasn't completed.

---

## Future enhancements

- **Reject obvious spam / non-bulletins** in the Worker before paying for an LLM call. Right now we forward everything. A 3-line check (subject keywords, sender domain blocklist) could save ~10% of LLM costs.
- **Forward parsing errors to an admin address** via Cloudflare's "send to a destination" action as a fallback, so bounces don't silently disappear.

---

## Fetch proxy — setup + usage

The `fetch()` handler at `/fetch` lets the main app's scrapers bypass anti-bot blocks that target Vercel's outbound IPs (Chabad.org's CMS is the concrete case — returns 403 to AWS us-east-1 IPs even with a real browser UA, but answers fine from Cloudflare edge).

### 1. Generate a bearer token

```bash
FETCH_PROXY_TOKEN="$(openssl rand -hex 32)"
echo "FETCH_PROXY_TOKEN=$FETCH_PROXY_TOKEN"
```

Same value goes into the Worker (as a wrangler secret) AND into Vercel (so the main app knows what to send).

### 2. Add the secret to the Worker + redeploy

```bash
cd cloudflare-worker
echo "$FETCH_PROXY_TOKEN" | npx wrangler secret put FETCH_PROXY_TOKEN
npx wrangler deploy
```

After deploy, the Worker is reachable at:

```
https://tfila-inbound-email.<your-cf-subdomain>.workers.dev
```

The `<your-cf-subdomain>` is shown in wrangler's deploy output and in the Cloudflare dashboard → Workers & Pages → tfila-inbound-email. Note it.

### 3. Mirror env to Vercel

```bash
vercel env add FETCH_PROXY_URL production
# paste: https://tfila-inbound-email.<your-cf-subdomain>.workers.dev/fetch

vercel env add FETCH_PROXY_TOKEN production
# paste: the same value you used in step 1
```

Or via Vercel dashboard → Settings → Environment Variables → Production. Then redeploy.

### 4. Verify

After the Vercel redeploy promotes:

```bash
# Quick sanity check — should return 200 with the Worker's hello message
curl -sS "https://tfila-inbound-email.<your-cf-subdomain>.workers.dev/"

# Auth check — should return 401 without a token
curl -sS "https://tfila-inbound-email.<your-cf-subdomain>.workers.dev/fetch?url=https://example.com"
```

The first scraper invocation that hits a 403/406 will automatically retry via the proxy. The `data_source.configJson.cascade_attempts[].fellBackToCfProxy` flag records when this happens (visible on the admin shul page).

### How it works at runtime

`lib/scrapers/fetch.ts` extends the existing UA-fallback chain by one step:

```
1. branded UA  (Tfila-Bot)              ← polite default
2. browser UA  (Chrome)                  ← runs only on 403/406
3. /fetch proxy via Cloudflare Worker    ← runs only when (2) is also 403/406 AND
                                            FETCH_PROXY_URL is set
```

When step 3 fires, the Worker forwards the request from Cloudflare's edge with a real browser UA + Accept headers. The response body comes back to Vercel; status is in the `X-Original-Status` response header. The main app treats the result identically to a direct fetch.

### Security

- The proxy is **bearer-token authenticated**. Don't share the token. Rotate via `wrangler secret put FETCH_PROXY_TOKEN` if it leaks.
- The Worker forwards GET only; no POST, no header pass-through. The caller can't send cookies, auth tokens, or POST bodies through the proxy.
- `HOST_ALLOWLIST` in `src/index.ts` is empty by default (proxy any host). Populate with specific suffixes (`["chabad.org", "shulcloud.com"]`) for a hard guardrail.
