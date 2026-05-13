// Regex fallback for extracting the shul's canonical website from a
// forwarded email body, used when the LLM doesn't return shulWebsite
// (e.g. confidence below escalation floor, or the LLM missed it).
//
// Also exports the shared-MTA / generic-mail / social denylist so the
// email-processing path can detect when the "From" address is a shared
// mailing-list provider (info@myshul.com) rather than the actual shul.
// Without this, match_domain dedup would silently merge every MyShul-
// hosted shul into a single row.

import { getDomain } from "tldts";

// Registrable domains (eTLD+1) that we know are shared by many shuls
// or are generic infrastructure. NEVER use these as the dedup key.
export const SHARED_MTA_DOMAINS: ReadonlySet<string> = new Set([
  // Shul mailing-list platforms
  "myshul.com",
  // General-purpose mailing-list / marketing platforms
  "mailchimp.com",
  "list-manage.com",
  "campaign-archive.com",
  "createsend.com",
  "mailerlite.com",
  "constantcontact.com",
  "rs6.net",
  "sendgrid.net",
  "sendgrid.com",
  "mailgun.org",
  "mailgun.com",
  "mailgun.net",
  "mandrillapp.com",
  "convertkit-mail.com",
  "beehiiv.net",
  "substack.com",
  "klaviyo.com",
  "cmail19.com",
  "cmail20.com",
  // Generic mail providers (gabbai's personal account, not the shul)
  "gmail.com",
  "googlemail.com",
  "googlegroups.com",
  "yahoo.com",
  "ymail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "protonmail.com",
  "proton.me",
  // Social / shortlinks / CDNs that should never be treated as the shul's domain
  "facebook.com",
  "fb.com",
  "instagram.com",
  "twitter.com",
  "x.com",
  "youtube.com",
  "youtu.be",
  "linkedin.com",
  "tiktok.com",
  "pinterest.com",
  "whatsapp.com",
  "wa.me",
  "t.me",
  "bit.ly",
  "tinyurl.com",
  "t.co",
  "goo.gl",
  "cloudfront.net",
  "akamaized.net",
]);

export function isSharedMtaDomain(domain: string | null | undefined): boolean {
  if (!domain) return false;
  return SHARED_MTA_DOMAINS.has(domain.toLowerCase());
}

// Hostname patterns for known tracking/redirect subdomains regardless
// of registrable domain (so we catch url429.myshul.com, click.foo.com,
// etc.).
const TRACKING_HOST_PATTERNS = [
  /^url\d+\./,
  /^click\./,
  /^track\./,
  /^link\./,
  /^email\./,
  /^em\./,
  /^e\./,
  /^t\./,
  /^trk\./,
];

const TRACKING_PATH_PATTERNS = [
  /\/ls\/click/i,
  /\/click\?/i,
  /\/unsubscribe/i,
  /\/wf\/open/i,
];

const IMAGE_OR_DOC_RE = /\.(png|jpe?g|gif|svg|webp|ico|bmp|pdf|zip)(\?|$)/i;

const URL_RE = /https?:\/\/[^\s"'<>)\]]+/gi;

/**
 * Normalize any string the LLM (or other channel) hands us as a "shul
 * website" into a guaranteed-parseable `https://<host>` URL — or null
 * if it can't be made into one or resolves to a shared-MTA domain.
 *
 * Why this exists: ExtractionSchema.shulWebsite is a free string; the
 * LLM occasionally emits bare domains ("edmondjsafrasynagogue.com"),
 * tracker URLs that slipped past the prompt, or shared-MTA domains
 * ("myshul.com") despite explicit instructions to skip them. Without
 * this guard, downstream `new URL(raw)` throws inside the persist
 * transaction, or a shared-MTA value gets written to shul.matchDomain
 * and re-introduces the wrong-merge bug this normalization is here
 * to prevent.
 *
 * Returns null when:
 *  - input is empty / nullish
 *  - the parsed hostname's registrable domain is in SHARED_MTA_DOMAINS
 *  - no hostname can be parsed even after prepending https://
 */
export function normalizeWebsiteUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let u: URL;
  try {
    u = new URL(candidate);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  if (!host) return null;
  const domain = getDomain(host);
  if (!domain) return null;
  if (isSharedMtaDomain(domain)) return null;
  return `https://${host}`;
}

/**
 * Scan a (forwarded) email body for the shul's canonical website root.
 * Returns null if nothing plausible found.
 *
 * Strategy: take the first URL whose registrable domain is NOT in the
 * shared-MTA denylist, whose hostname doesn't match tracking patterns,
 * and whose path isn't an image / unsubscribe / click-tracker. Strip
 * everything but the origin.
 */
export function extractCanonicalWebsiteFromEmail(body: string): string | null {
  for (const match of body.matchAll(URL_RE)) {
    const raw = match[0].replace(/[.,;:!?>)\]\s]+$/, "");
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      continue;
    }
    const host = u.hostname.toLowerCase();
    if (TRACKING_HOST_PATTERNS.some((rx) => rx.test(host))) continue;
    if (TRACKING_PATH_PATTERNS.some((rx) => rx.test(u.pathname))) continue;
    if (IMAGE_OR_DOC_RE.test(u.pathname)) continue;

    const domain = getDomain(host);
    if (!domain) continue;
    if (isSharedMtaDomain(domain)) continue;

    return `https://${host}`;
  }
  return null;
}
