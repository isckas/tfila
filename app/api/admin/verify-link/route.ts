import { NextResponse } from "next/server";
import {
  consumeMagicLinkToken,
  setAdminSession,
  verifyMagicLinkToken,
} from "@/lib/auth";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  if (!token) {
    return NextResponse.redirect(new URL("/signin?error=missing", req.url), 303);
  }
  const email = verifyMagicLinkToken(token);
  if (!email) {
    return NextResponse.redirect(new URL("/signin?error=invalid", req.url), 303);
  }
  // Single-use guard — closes the 15-min replay window. If the token
  // was already consumed (link clicked twice, prefetch ran first,
  // referrer leak), reject. See lib/auth.ts:consumeMagicLinkToken.
  const firstUse = await consumeMagicLinkToken(token);
  if (!firstUse) {
    return NextResponse.redirect(
      new URL("/signin?error=already-used", req.url),
      303,
    );
  }
  await setAdminSession(email);
  return NextResponse.redirect(new URL("/admin", req.url), 303);
}
