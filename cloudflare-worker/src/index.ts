// tfila-inbound-email — Cloudflare Worker
//
// Two responsibilities:
//
// 1. Inbound email (email() handler): receives mail at submit@tfila.co
//    via Cloudflare Email Routing, parses with postal-mime, POSTs a
//    Postmark-shaped payload to tfila.co's /api/inbound/email.
//
// 2. Fetch proxy (fetch() handler): GET /fetch?url=<encoded> proxies
//    an HTTP fetch through Cloudflare's edge IPs. Used as a fallback
//    by tfila.co's extraction scrapers when the origin site blocks
//    Vercel's outbound IP range (anti-bot on Chabad.org-hosted sites
//    is the concrete trigger). Authenticated with FETCH_PROXY_TOKEN
//    so the proxy isn't an open relay for arbitrary outbound.
//
// Why Postmark-shaped (for email)? See history — the tfila.co side
// was originally built against Postmark; the Worker speaks that
// shape so swapping vendors is a config change, not code.
//
// Setup: see README.md.

import PostalMime from "postal-mime";

export interface Env {
  /** Where to POST the Postmark-shaped JSON. e.g. https://tfila.co/api/inbound/email */
  WEBHOOK_URL: string;
  /** HTTP Basic auth credentials, mirrored to Vercel as
   *  POSTMARK_INBOUND_USERNAME / POSTMARK_INBOUND_PASSWORD. */
  WEBHOOK_USER: string;
  WEBHOOK_PASS: string;
  /** Bearer token for the /fetch proxy endpoint, mirrored to Vercel
   *  as FETCH_PROXY_TOKEN. Without this, /fetch returns 401. */
  FETCH_PROXY_TOKEN: string;
}

// Hosts we'll proxy. Empty array = no allowlist (proxy any host) —
// the proxy fetches the long tail of shul domains, so an allowlist isn't
// practical; the SSRF guardrail is isBlockedHost() below + manual redirects,
// not a host allowlist. Populate this only if you want to additionally pin the
// proxy to specific suffixes.
const HOST_ALLOWLIST: string[] = [];

// SSRF guardrail for the proxy (M9). The tfila side already SSRF-validates
// before falling back to this proxy, but the proxy is a standalone endpoint a
// token-holder can call directly, so it re-checks here. Cloudflare Workers have
// no DNS resolver, so this catches LITERAL private/loopback/link-local/metadata
// IPs + local hostnames (and, with manual redirects below, redirects TO them).
// It cannot catch a hostname that DNS-resolves to a private IP — accepted.
const MAX_PROXY_REDIRECTS = 5;

function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    h === "localhost" ||
    h.endsWith(".localhost") ||
    h.endsWith(".local") ||
    h.endsWith(".internal")
  ) {
    return true;
  }
  // IPv6 literals ONLY — they always contain a colon (a bracketed
  // http://[fd00::1]/ becomes "fd00::1" after bracket-strip). Gating on the
  // colon stops the bare fc/fd ULA prefixes from wrongly blocking ordinary
  // domains like fda.gov / fcc.gov / fcbarcelona.com.
  if (h.includes(":")) {
    if (
      h === "::1" ||
      h === "::" ||
      h.startsWith("fe80:") ||
      h.startsWith("fc") ||
      h.startsWith("fd")
    ) {
      return true;
    }
  }
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 0 || a === 10 || a === 127) return true; // 0/8, 10/8, 127/8
  if (a === 169 && b === 254) return true; // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 168) return true; // 192.168/16
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  return false;
}

// Realistic browser UA. Some anti-bot systems still block well-known
// crawler UAs even on residential ASNs; using a desktop Chrome string
// matches the path most likely to succeed.
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

interface PostmarkShapedPayload {
  From: string;
  FromName: string;
  To: string;
  Subject: string;
  TextBody: string;
  HtmlBody: string;
  Headers: Array<{ Name: string; Value: string }>;
  Date: string;
  MessageID: string;
}

export default {
  /**
   * Cloudflare Email Worker entrypoint. Fires once per inbound message
   * matching the Email Routing rule that points to this Worker.
   *
   * On error, we throw — Cloudflare bounces the message back to the
   * sender with a temporary failure, which is the right semantic for
   * "tfila.co is down right now, please try again."
   */
  async email(message: ForwardableEmailMessage, env: Env): Promise<void> {
    // 1. Read raw RFC 822 bytes from the stream.
    const rawBytes = await new Response(message.raw).arrayBuffer();

    // 2. Parse with postal-mime — handles MIME, multipart, encodings.
    const parsed = await PostalMime.parse(rawBytes);

    // 3. Build the Postmark-shaped payload our /api/inbound/email expects.
    const payload: PostmarkShapedPayload = {
      From: parsed.from?.address ?? message.from ?? "",
      FromName: parsed.from?.name ?? "",
      To: message.to ?? "",
      Subject: parsed.subject ?? "",
      TextBody: parsed.text ?? "",
      HtmlBody: parsed.html ?? "",
      Headers: (parsed.headers ?? []).map((h) => ({
        Name: h.key,
        Value: h.value,
      })),
      Date: parsed.date ?? new Date().toISOString(),
      MessageID: parsed.messageId ?? "",
    };

    // 4. POST with HTTP Basic Auth.
    const authHeader = "Basic " + btoa(`${env.WEBHOOK_USER}:${env.WEBHOOK_PASS}`);
    const res = await fetch(env.WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
        "User-Agent": "tfila-inbound-email-worker/1.0",
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      throw new Error(
        `Webhook returned HTTP ${res.status}: ${errBody.slice(0, 200)}`,
      );
    }
  },

  /**
   * HTTP fetch proxy. Used by tfila.co scrapers when the origin site
   * blocks Vercel's outbound IPs (e.g. Chabad.org anti-bot).
   *
   *   GET /fetch?url=<urlencoded URL>
   *   Authorization: Bearer <FETCH_PROXY_TOKEN>
   *
   * Returns the upstream body verbatim, with these response headers:
   *   - X-Original-Status: upstream HTTP status code (numeric)
   *   - X-Original-Url: final URL after redirects
   *   - Content-Type: copied from upstream when present
   *
   * Errors return JSON `{ error: string }` with appropriate status.
   * No CORS — this is meant for server-to-server use only.
   */
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Health check / open at root so wrangler tail / curl can sanity-check.
    if (url.pathname === "/") {
      return new Response("tfila worker — POST email handler + GET /fetch proxy");
    }

    if (url.pathname !== "/fetch") {
      return new Response("not found", { status: 404 });
    }

    if (request.method !== "GET") {
      return new Response("method not allowed", {
        status: 405,
        headers: { Allow: "GET" },
      });
    }

    // Auth
    const auth = request.headers.get("Authorization") ?? "";
    const expected = `Bearer ${env.FETCH_PROXY_TOKEN}`;
    if (!env.FETCH_PROXY_TOKEN || auth !== expected) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }

    // Target URL
    const targetRaw = url.searchParams.get("url");
    if (!targetRaw) {
      return Response.json({ error: "missing url query param" }, { status: 400 });
    }
    let target: URL;
    try {
      target = new URL(targetRaw);
    } catch {
      return Response.json({ error: "invalid url" }, { status: 400 });
    }
    if (target.protocol !== "http:" && target.protocol !== "https:") {
      return Response.json({ error: "only http(s) urls" }, { status: 400 });
    }
    if (isBlockedHost(target.hostname)) {
      return Response.json({ error: "blocked host" }, { status: 403 });
    }
    if (HOST_ALLOWLIST.length > 0) {
      const ok = HOST_ALLOWLIST.some((suffix) =>
        target.hostname === suffix || target.hostname.endsWith("." + suffix),
      );
      if (!ok) {
        return Response.json({ error: "host not allowlisted" }, { status: 403 });
      }
    }

    // Forward. 12s ceiling — Cloudflare's default is generous but we
    // want a tight cap so a hung upstream doesn't tie up a Worker
    // invocation indefinitely.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12_000);

    // Follow redirects MANUALLY (M9) so a redirect to a private/metadata IP
    // can't slip past the isBlockedHost check above.
    let upstream!: Response;
    let currentUrl = target.toString();
    try {
      for (let hop = 0; ; hop++) {
        upstream = await fetch(currentUrl, {
          method: "GET",
          headers: {
            "User-Agent": BROWSER_UA,
            // Mirror what a real browser sends; some anti-bot systems
            // 403 requests missing Accept/Accept-Language entirely.
            Accept:
              "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
          },
          redirect: "manual",
          signal: controller.signal,
        });
        const loc = upstream.headers.get("location");
        if (upstream.status >= 300 && upstream.status < 400 && loc) {
          if (hop >= MAX_PROXY_REDIRECTS) break;
          const next = new URL(loc, currentUrl);
          if (
            (next.protocol !== "http:" && next.protocol !== "https:") ||
            isBlockedHost(next.hostname)
          ) {
            clearTimeout(timeoutId);
            return Response.json({ error: "blocked redirect" }, { status: 403 });
          }
          currentUrl = next.toString();
          continue;
        }
        break;
      }
    } catch (e) {
      clearTimeout(timeoutId);
      const msg = e instanceof Error ? e.message : String(e);
      return Response.json(
        { error: "upstream fetch failed", detail: msg.slice(0, 300) },
        { status: 502 },
      );
    }
    clearTimeout(timeoutId);

    const body = await upstream.arrayBuffer();
    const headers = new Headers();
    headers.set("X-Original-Status", String(upstream.status));
    headers.set("X-Original-Url", upstream.url);
    const ct = upstream.headers.get("Content-Type");
    if (ct) headers.set("Content-Type", ct);

    return new Response(body, {
      // Always return 200 to the caller — actual upstream status is in
      // X-Original-Status. This makes the caller's error handling simpler
      // (a 5xx from us means the proxy itself broke, not the target).
      status: 200,
      headers,
    });
  },
};
