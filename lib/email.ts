// Lightweight transactional sender. Uses Resend HTTP API if RESEND_API_KEY
// is set, otherwise logs the message to the server console (dev fallback).

interface SendArgs {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export async function sendTransactional({
  to,
  subject,
  text,
  html,
}: SendArgs): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.AUTH_EMAIL_FROM ?? "hello@tfila.co";

  if (!apiKey) {
    console.log("\n────────────── EMAIL (console fallback — set RESEND_API_KEY to send) ──────────────");
    console.log("To:     ", to);
    console.log("From:   ", from);
    console.log("Subject:", subject);
    console.log("");
    console.log(text);
    console.log("─────────────────────────────────────────────────────────────────────────────────\n");
    return;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to,
      subject,
      text,
      html: html ?? `<pre style="font-family:ui-monospace,monospace;font-size:14px">${escapeHtml(text)}</pre>`,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend send failed (${res.status}): ${body}`);
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Send a one-line notification to the admin (ADMIN_EMAIL).
 * Used for new shul submissions, failed scrapes, etc.
 * No-ops if ADMIN_EMAIL is not set (warns loudly in prod — M12).
 *
 * By default errors are swallowed (a notification must never break a user
 * flow like /submit). Pass `critical: true` for alerts where a swallowed
 * failure means the ONLY signal is lost (the weekly digest, the dead-man's
 * switch) — it re-throws so the enclosing Inngest step retries instead of
 * vanishing.
 */
export async function notifyAdmin(args: {
  subject: string;
  text: string;
  critical?: boolean;
}): Promise<void> {
  const to = process.env.ADMIN_EMAIL;
  if (!to) {
    if (process.env.NODE_ENV === "production") {
      console.warn(
        "[notifyAdmin] ADMIN_EMAIL is not set in production — admin alerts are being silently dropped.",
      );
    }
    return;
  }
  try {
    await sendTransactional({
      to,
      subject: `[tfila] ${args.subject}`,
      text: args.text,
    });
  } catch (err) {
    console.error("[notifyAdmin] failed:", (err as Error).message);
    if (args.critical) throw err;
  }
}
