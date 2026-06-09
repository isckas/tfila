import { NextResponse } from "next/server";

/**
 * Redirect back to the page that initiated the request when its Referer
 * is same-origin; otherwise fall back to the provided path. Prevents
 * the open-redirect risk of trusting an attacker-controlled Referer.
 *
 * Used by admin POST handlers that should return the admin to the page
 * they came from (multi-source workflows on /admin/shul/[slug] etc).
 *
 * `search` (optional) merges feedback params (e.g. `{ rebuilt: "1" }`)
 * onto WHICHEVER target wins — Referer or fallback. Without this, a
 * fallback like `/admin/shul/x?rebuilt=1` loses its `?rebuilt=1` when the
 * same-origin Referer is honored, so an inline inbox action would land on
 * a bare `/admin` with no confirmation banner.
 */
export function safeRedirect(
  req: Request,
  fallback: string,
  search?: Record<string, string>,
): NextResponse {
  const target = resolveSafeTarget(req, fallback);
  if (search) {
    for (const [key, value] of Object.entries(search)) {
      target.searchParams.set(key, value);
    }
  }
  return NextResponse.redirect(target, 303);
}

function resolveSafeTarget(req: Request, fallback: string): URL {
  const referer = req.headers.get("referer");
  if (referer) {
    try {
      const parsed = new URL(referer);
      const here = new URL(req.url);
      if (parsed.origin === here.origin) {
        return parsed;
      }
    } catch {
      // fall through to fallback
    }
  }
  return new URL(fallback, req.url);
}
