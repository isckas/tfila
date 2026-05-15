import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "../db/client";
import { consumedMagicLink } from "../db/schema";

const COOKIE_NAME = "tfila_admin";
const COOKIE_MAX_AGE_S = 60 * 60 * 24 * 30; // 30 days
const TOKEN_MAX_AGE_S = 60 * 15; // 15 min magic-link expiry

interface TokenPayload {
  email: string;
  exp: number; // unix seconds
  kind: "magic" | "session";
}

function getSecret(): Buffer {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) {
    throw new Error("AUTH_SECRET missing or too short (need ≥32 chars).");
  }
  return Buffer.from(s, "utf8");
}

function b64urlEncode(buf: Buffer | string): string {
  const b = typeof buf === "string" ? Buffer.from(buf, "utf8") : buf;
  return b
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function b64urlDecode(s: string): Buffer {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice(0, (4 - (s.length % 4)) % 4);
  return Buffer.from(padded, "base64");
}

function sign(payload: TokenPayload): string {
  const json = JSON.stringify(payload);
  const body = b64urlEncode(json);
  const sig = createHmac("sha256", getSecret()).update(body).digest();
  return body + "." + b64urlEncode(sig);
}

function verify(token: string): TokenPayload | null {
  const i = token.indexOf(".");
  if (i < 0) return null;
  const body = token.slice(0, i);
  const sigGiven = b64urlDecode(token.slice(i + 1));
  const sigExpected = createHmac("sha256", getSecret()).update(body).digest();
  if (sigGiven.length !== sigExpected.length) return null;
  if (!timingSafeEqual(sigGiven, sigExpected)) return null;
  try {
    const payload = JSON.parse(b64urlDecode(body).toString("utf8")) as TokenPayload;
    if (typeof payload.exp !== "number" || Date.now() / 1000 > payload.exp) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export function isAllowedAdmin(email: string): boolean {
  const allowed = process.env.ADMIN_EMAIL?.toLowerCase().trim();
  if (!allowed) return false;
  return email.toLowerCase().trim() === allowed;
}

export function signMagicLinkToken(email: string): string {
  return sign({
    email: email.toLowerCase().trim(),
    exp: Math.floor(Date.now() / 1000) + TOKEN_MAX_AGE_S,
    kind: "magic",
  });
}

export function verifyMagicLinkToken(token: string): string | null {
  const p = verify(token);
  return p && p.kind === "magic" && isAllowedAdmin(p.email) ? p.email : null;
}

/**
 * Mark a magic-link token as consumed. Returns true on first use,
 * false if the token has already been consumed (replay attempt).
 *
 * Stores SHA-256 of the token (not the token itself) so a DB read
 * can't impersonate. Idempotent via the PRIMARY KEY conflict.
 */
export async function consumeMagicLinkToken(token: string): Promise<boolean> {
  const hash = createHash("sha256").update(token, "utf8").digest("hex");
  const result = await db
    .insert(consumedMagicLink)
    .values({ tokenHash: hash })
    .onConflictDoNothing({ target: consumedMagicLink.tokenHash })
    .returning({ tokenHash: consumedMagicLink.tokenHash });
  return result.length > 0;
}

function signSessionToken(email: string): string {
  return sign({
    email,
    exp: Math.floor(Date.now() / 1000) + COOKIE_MAX_AGE_S,
    kind: "session",
  });
}

export async function setAdminSession(email: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, signSessionToken(email), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: COOKIE_MAX_AGE_S,
  });
}

export async function clearAdminSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

export async function getAdminSession(): Promise<{ email: string } | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  const p = verify(token);
  if (!p || p.kind !== "session" || !isAllowedAdmin(p.email)) return null;
  return { email: p.email };
}

/** Use inside server components / route handlers that require admin auth. */
export async function requireAdmin(): Promise<{ email: string }> {
  const session = await getAdminSession();
  if (!session) redirect("/signin");
  return session;
}
