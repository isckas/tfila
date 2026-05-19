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
};

/**
 * Fail-open by design — when Upstash env vars are unset (local dev or
 * before the user has wired up the Redis instance), every check returns
 * success. Once the env vars land, real limits kick in automatically.
 */
export async function checkRateLimit(
  kind: keyof typeof limiters,
  identifier: string,
): Promise<{ success: boolean; remaining: number; reset: number }> {
  const limiter = limiters[kind];
  if (!limiter || !identifier) {
    return { success: true, remaining: Infinity, reset: 0 };
  }
  const { success, remaining, reset } = await limiter.limit(identifier);
  return { success, remaining, reset };
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
