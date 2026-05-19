import { NextResponse } from "next/server";
import { isAllowedAdmin, signMagicLinkToken } from "@/lib/auth";
import { sendTransactional } from "@/lib/email";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";

export async function POST(req: Request) {
  try {
    const ipCheck = await checkRateLimit("adminLinkIp", clientIp(req));
    if (!ipCheck.success) {
      return NextResponse.redirect(
        new URL("/signin?err=rate-limited", req.url),
        303,
      );
    }

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

    const emailCheck = await checkRateLimit("adminLinkEmail", email);
    if (!emailCheck.success) {
      // Still redirect to the success page — don't reveal the rate-limit
      // state to a probing attacker. Just silently drop the send.
      return NextResponse.redirect(new URL("/signin?sent=1", req.url), 303);
    }

    // Defensive: don't reveal whether an email is on the allow-list. Always
    // return success; only actually send if allowed.
    if (isAllowedAdmin(email)) {
      const token = signMagicLinkToken(email);
      // Origin MUST come from server-controlled config (AUTH_URL env)
      // or the request's actual URL — never from the client-supplied
      // Origin header. Otherwise an attacker on evil.com submits this
      // form with `Origin: https://evil.com`, the email gets sent with
      // a link pointing at evil.com, and clicking it leaks the token.
      const origin =
        process.env.AUTH_URL ?? new URL(req.url).origin;
      const link = `${origin}/api/admin/verify-link?token=${encodeURIComponent(token)}`;
      await sendTransactional({
        to: email,
        subject: "Your tfila.co admin sign-in link",
        text: `Click to sign in to tfila.co admin (valid 15 min, single-use):\n\n${link}\n\nIf you didn't request this, ignore this email.`,
      });
    }

    // Always redirect to the "check your inbox" page regardless of allow-list
    return NextResponse.redirect(new URL("/signin?sent=1", req.url), 303);
  } catch (err) {
    // Log server-side; never echo error details into the URL — prior
    // behavior leaked SMTP creds / internal hostnames into ?detail=.
    const msg = (err as Error)?.message ?? String(err);
    console.error("[request-link] error:", msg);
    return NextResponse.redirect(
      new URL("/signin?err=send", req.url),
      303,
    );
  }
}
