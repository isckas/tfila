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
