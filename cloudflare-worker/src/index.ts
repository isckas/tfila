// tfila-inbound-email — Cloudflare Email Worker
//
// Receives mail at submit@inbound.tfila.co (wired via the Cloudflare
// Email Routing dashboard, NOT in this code). Parses the raw RFC 822
// message with postal-mime, then POSTs a Postmark-compatible JSON
// payload to tfila.co's existing /api/inbound/email endpoint.
//
// Why Postmark-shaped? The webhook receiver on tfila.co was originally
// designed against Postmark's inbound payload format. Keeping the
// Worker speak that shape means the tfila.co side has zero Cloudflare-
// specific code; we could swap back to Postmark later by just turning
// off the Worker.
//
// Setup: see README.md (DNS / Email Routing / wrangler secrets / rules).

import PostalMime from "postal-mime";

export interface Env {
  /** Where to POST the Postmark-shaped JSON. e.g. https://tfila.co/api/inbound/email */
  WEBHOOK_URL: string;
  /** HTTP Basic auth credentials, mirrored to Vercel as
   *  POSTMARK_INBOUND_USERNAME / POSTMARK_INBOUND_PASSWORD. */
  WEBHOOK_USER: string;
  WEBHOOK_PASS: string;
}

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
};
