import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;

const redis = url && token ? new Redis({ url, token }) : null;

function makeLimiter(
  prefix: string,
  limit: number,
  window: Parameters<typeof Ratelimit.slidingWindow>[1],
): Ratelimit | null {
  if (!redis) return null;
  return new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(limit, window),
    prefix: `rl:${prefix}`,
    analytics: false,
  });
}

const limiters = {
  submitIp: makeLimiter("submit:ip", 5, "1 h"),
  adminLinkIp: makeLimiter("admin-link:ip", 10, "1 h"),
  adminLinkEmail: makeLimiter("admin-link:email", 3, "1 h"),
  inboundEmail: makeLimiter("inbound-email", 100, "1 d"),
  // "Report a wrong time" (E-B5). Generous per-IP cap — a coarse abuse guard
  // on top of the per-(shul, reporter, day) dedupe done in the route. One
  // person legitimately reporting a handful of shuls in an hour is fine.
  reportTimeIp: makeLimiter("report-time:ip", 20, "1 h"),
};

/**
 * Fail-open by design — under any of:
 *   - Upstash env vars unset (local dev or pre-wire)
 *   - Empty identifier (caller couldn't extract a key)
 *   - Upstash transient error (Redis timeout, network blip, 5xx)
 * the gate returns success. The cost of a missed rate-limit is one
 * extra request through to the underlying handler; the cost of failing
 * closed is the whole route 5xx'ing on Upstash availability blips —
 * which would also retry-storm the inbound-email webhook.
 */
export async function checkRateLimit(
  kind: keyof typeof limiters,
  identifier: string,
): Promise<{ success: boolean; remaining: number; reset: number }> {
  const limiter = limiters[kind];
  if (!limiter || !identifier) {
    return { success: true, remaining: Infinity, reset: 0 };
  }
  try {
    const { success, remaining, reset } = await limiter.limit(identifier);
    return { success, remaining, reset };
  } catch (err) {
    console.error(`[rate-limit] ${kind} check failed; failing open`, err);
    return { success: true, remaining: Infinity, reset: 0 };
  }
}

/**
 * Best-effort client IP extraction. Vercel sets `x-forwarded-for`. Falls
 * back to a constant string so the rate-limit doesn't divide-by-undefined.
 */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}
