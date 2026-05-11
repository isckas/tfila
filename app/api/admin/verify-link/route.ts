import { NextResponse } from "next/server";
import { setAdminSession, verifyMagicLinkToken } from "@/lib/auth";

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
  await setAdminSession(email);
  return NextResponse.redirect(new URL("/admin/queue", req.url), 303);
}
