import { NextResponse } from "next/server";

/**
 * Redirect back to the page that initiated the request when its Referer
 * is same-origin; otherwise fall back to the provided path. Prevents
 * the open-redirect risk of trusting an attacker-controlled Referer.
 *
 * Used by admin POST handlers that should return the admin to the page
 * they came from (multi-source workflows on /admin/shul/[slug] etc).
 */
export function safeRedirect(req: Request, fallback: string): NextResponse {
  const referer = req.headers.get("referer");
  if (referer) {
    try {
      const parsed = new URL(referer);
      const here = new URL(req.url);
      if (parsed.origin === here.origin) {
        return NextResponse.redirect(parsed, 303);
      }
    } catch {
      // fall through to fallback
    }
  }
  return NextResponse.redirect(new URL(fallback, req.url), 303);
}
