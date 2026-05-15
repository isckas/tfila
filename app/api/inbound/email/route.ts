import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { inngest } from "@/lib/inngest/client";
import { extractOriginalSender } from "@/lib/inbound/extract-original-sender";

// Postmark Inbound webhook handler.
//
// Postmark POSTs us a parsed-email payload when an email reaches our
// inbound stream. Auth: HTTP Basic with creds configured in env
// (POSTMARK_INBOUND_USERNAME + POSTMARK_INBOUND_PASSWORD). When unset
// (e.g. local dev / synthetic tests), we accept the request without
// auth — production deploys MUST set both vars.
//
// We don't run the LLM here — too slow for a webhook response. We
// extract the original-sender heuristically, then fire an Inngest
// event for async processing.

export const dynamic = "force-dynamic";
export const maxDuration = 30;

interface PostmarkInboundPayload {
  FromName?: string;
  From?: string;
  To?: string;
  Subject?: string;
  TextBody?: string;
  HtmlBody?: string;
  // ... many other fields we don't use
}

function checkAuth(req: Request): boolean {
  const u = process.env.POSTMARK_INBOUND_USERNAME;
  const p = process.env.POSTMARK_INBOUND_PASSWORD;

  // Fail closed in production — a misconfigured prod deploy must reject
  // unauthenticated webhook calls. Dev / test still accepts to avoid
  // breaking local synthetic POSTs.
  if (!u || !p) {
    if (process.env.NODE_ENV === "production") {
      console.error(
        "[inbound/email] POSTMARK_INBOUND_USERNAME/PASSWORD not set in production — refusing webhook",
      );
      return false;
    }
    return true;
  }

  const header = req.headers.get("authorization");
  if (!header || !header.startsWith("Basic ")) return false;
  try {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const [user, ...rest] = decoded.split(":");
    const pass = rest.join(":");
    // Constant-time comparison so the configured creds aren't exposed
    // to a timing oracle.
    return safeStringEq(user, u) && safeStringEq(pass, p);
  } catch {
    return false;
  }
}

function safeStringEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export async function POST(req: Request): Promise<NextResponse> {
  if (!checkAuth(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let payload: PostmarkInboundPayload;
  try {
    payload = (await req.json()) as PostmarkInboundPayload;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const forwarderEmail = (payload.From ?? "").toLowerCase().trim();
  const subject = (payload.Subject ?? "").trim();
  const body = (payload.TextBody ?? "").trim();
  if (!forwarderEmail || !body) {
    return NextResponse.json(
      { error: "missing From or TextBody" },
      { status: 400 },
    );
  }

  // Find the ORIGINAL sender — i.e., the shul's mailing list — from the
  // forwarded headers in the body. If we can't find one, fall back to
  // treating the forwarder as the original (unusual but possible if a
  // gabbai is directly subscribing us).
  const original = extractOriginalSender(body);
  const originalSenderEmail = (original?.email ?? forwarderEmail).toLowerCase();
  const originalSenderName = original?.name ?? null;

  // Fire async — the LLM extraction + DB writes happen in the Inngest function.
  await inngest.send({
    name: "email.received",
    data: {
      forwarderEmail,
      originalSenderEmail,
      originalSenderName,
      subject,
      body,
      receivedAt: new Date().toISOString(),
    },
  });

  return NextResponse.json({ ok: true, originalSenderEmail }, { status: 202 });
}
