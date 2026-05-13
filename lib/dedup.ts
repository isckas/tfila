// Submission dedup helper. Computes the registrable domain (eTLD+1)
// from either a URL or an email address. Same registrable domain →
// same shul, regardless of submission channel.
//
// Examples:
//   "https://www.theshul.org/calendar"     → "theshul.org"
//   "https://theshul.org"                  → "theshul.org"
//   "gabbai@theshul.org"                   → "theshul.org"
//   "Bulletin@theshul.org"                 → "theshul.org"  (lowercased)
//   "shul.under.someshared.host.com"       → "someshared.host.com"
//   "garbage"                              → null
//   ""                                     → null
//
// See FEATURES.md "Deduplication: same shul, different submissions"
// for the design + decision (Option A).

import { getDomain } from "tldts";

/**
 * Extract a registrable domain from either a URL or an email address.
 * Returns null for unparseable inputs.
 */
export function matchDomainOf(input: string): string | null {
  const s = input.trim().toLowerCase();
  if (!s) return null;

  // Email path: pull the right-of-@ portion.
  const atIdx = s.lastIndexOf("@");
  if (atIdx > 0 && atIdx < s.length - 1) {
    const host = s.slice(atIdx + 1).trim();
    return getDomain(host);
  }

  // URL path: try parsing it, fall back to treating the whole string
  // as a host (for bare-domain submissions like "theshul.org").
  let host = s;
  try {
    const u = new URL(s);
    host = u.host;
  } catch {
    // Not a URL — treat as bare host
  }
  return getDomain(host);
}
