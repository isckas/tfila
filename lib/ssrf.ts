// SSRF (Server-Side Request Forgery) guards. Resolves a URL's hostname
// to its IPs and refuses if any IP is in a private / loopback /
// link-local / metadata range. Called before the server fetches any
// URL submitted by an unauthenticated user.
//
// Without this, /submit accepts arbitrary URLs and the server fetches
// them. On Vercel that means the function can probe internal endpoints
// (169.254.169.254 metadata, 10/8 RFC1918, 127/8 loopback), or abuse
// the Cloudflare proxy at FETCH_PROXY_URL as a free fetcher.

import { promises as dns } from "node:dns";

export class UnsafeHostError extends Error {
  constructor(
    message: string,
    public readonly hostname: string,
    public readonly ip?: string,
  ) {
    super(message);
    this.name = "UnsafeHostError";
  }
}

/**
 * Throws UnsafeHostError if the URL's hostname is missing, a literal
 * private IP, or DNS-resolves to one. Allows http(s) only — refuses
 * file:, ftp:, gopher:, etc.
 */
export async function assertPublicHttpUrl(url: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new UnsafeHostError("Malformed URL", url);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new UnsafeHostError(
      `Refusing non-http(s) protocol ${parsed.protocol}`,
      parsed.hostname,
    );
  }

  const hostname = parsed.hostname;
  if (!hostname) throw new UnsafeHostError("Empty hostname", "");

  // Refuse literal local hostnames before DNS — cheaper + can't be
  // bypassed by a tailored DNS response.
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    throw new UnsafeHostError(
      `Refusing local hostname ${hostname}`,
      hostname,
    );
  }

  // If hostname is already a literal IP, skip DNS and check directly.
  // Otherwise resolve. Note: a host can resolve to multiple IPs; refuse
  // if ANY are private (defense against split-horizon DNS tricks).
  let ips: string[];
  if (isLiteralIp(hostname)) {
    ips = [stripIpv4Brackets(hostname)];
  } else {
    try {
      const records = await dns.lookup(hostname, { all: true });
      ips = records.map((r) => r.address);
    } catch (e) {
      throw new UnsafeHostError(
        `DNS lookup failed for ${hostname}: ${(e as Error).message}`,
        hostname,
      );
    }
  }

  for (const ip of ips) {
    if (isPrivateIp(ip)) {
      throw new UnsafeHostError(
        `Refusing private IP ${ip} (${hostname})`,
        hostname,
        ip,
      );
    }
  }
}

function isLiteralIp(host: string): boolean {
  // Strips IPv6 brackets if present, then tests dotted-quad or hex.
  const h = stripIpv4Brackets(host);
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(h) || /^[0-9a-f:]+$/i.test(h);
}

function stripIpv4Brackets(host: string): string {
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

/**
 * Returns true for: loopback (127/8 + ::1), link-local (169.254/16 +
 * fe80::/10), RFC1918 (10/8, 172.16/12, 192.168/16), CGNAT (100.64/10),
 * AWS/Azure/GCP metadata (169.254.169.254), unspecified (0.0.0.0, ::),
 * IPv4-mapped IPv6 of any of those.
 */
function isPrivateIp(ip: string): boolean {
  // Normalize IPv4-mapped IPv6: ::ffff:10.0.0.1 → 10.0.0.1
  const v4Mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(ip);
  if (v4Mapped) return isPrivateIp(v4Mapped[1]);

  // IPv4
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (v4) {
    const [, aS, bS, cS, dS] = v4;
    const a = Number(aS),
      b = Number(bS),
      c = Number(cS),
      d = Number(dS);
    if (a > 255 || b > 255 || c > 255 || d > 255) return true; // malformed → safer to refuse
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 10) return true; // 10/8
    if (a === 127) return true; // 127/8 loopback
    if (a === 169 && b === 254) return true; // 169.254/16 link-local + cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
    if (a === 192 && b === 168) return true; // 192.168/16
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT
    return false;
  }

  // IPv6 — coarse but sufficient
  const lower = ip.toLowerCase();
  if (lower === "::" || lower === "::1") return true;
  if (lower.startsWith("fe80:") || lower.startsWith("fec0:")) return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // fc00::/7 ULA
  return false;
}
