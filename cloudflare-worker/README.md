# tfila inbound-email Cloudflare Worker

Receives mail sent to `submit@tfila.co`, parses it, and forwards a Postmark-shaped JSON payload to the main app at `https://tfila.co/api/inbound/email`. Free at any volume — replaces the originally-planned Postmark setup.

This Worker is **standalone**: it has its own `package.json`, its own `wrangler.toml`, and deploys independently. The main app (in the parent directory) does not depend on it and is not affected when the Worker is updated.

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
