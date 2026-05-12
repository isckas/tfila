import { NextResponse } from "next/server";
import { isAllowedAdmin, signMagicLinkToken } from "@/lib/auth";
import { sendTransactional } from "@/lib/email";

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const emailRaw = form.get("email");
    const email =
      typeof emailRaw === "string" ? emailRaw.toLowerCase().trim() : "";

    if (!email || !email.includes("@")) {
      return NextResponse.json(
        { error: "Valid email required" },
        { status: 400 },
      );
    }

    // Defensive: don't reveal whether an email is on the allow-list. Always
    // return success; only actually send if allowed.
    if (isAllowedAdmin(email)) {
      const token = signMagicLinkToken(email);
      const origin =
        req.headers.get("origin") ??
        process.env.AUTH_URL ??
        new URL(req.url).origin;
      const link = `${origin}/api/admin/verify-link?token=${encodeURIComponent(token)}`;
      await sendTransactional({
        to: email,
        subject: "Your tfila.co admin sign-in link",
        text: `Click to sign in to tfila.co admin (valid 15 min):\n\n${link}\n\nIf you didn't request this, ignore this email.`,
      });
    }

    // Always redirect to the "check your inbox" page regardless of allow-list
    return NextResponse.redirect(new URL("/signin?sent=1", req.url), 303);
  } catch (err) {
    // Surface the underlying error to the response so we can debug in prod
    // (no Sentry yet). Safe because /signin?err= UI sanitizes the value.
    const msg = (err as Error)?.message ?? String(err);
    console.error("[request-link] error:", msg);
    return NextResponse.redirect(
      new URL(
        `/signin?err=send&detail=${encodeURIComponent(msg.slice(0, 200))}`,
        req.url,
      ),
      303,
    );
  }
}
