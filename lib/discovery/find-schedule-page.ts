// Schedule-page discovery: given a shul's root URL, resolve it to the
// URL that actually contains the minyan/prayer schedule. Many shul
// sites bury the schedule on a sub-page (e.g. ShulCloud's opaque
// /templates/articlecco_cdo/aid/<number>/jewish/Times-and-Schedule.htm
// paths). Submitting the root URL straight into the extraction cascade
// would miss those.
//
// Strategy is hybrid by design (FEATURES.md: "Discovery: schedule
// page resolver"):
//   1. PATTERN — try ~15 common schedule paths; first one that loads
//      and contains schedule-ish content wins. Free, no LLM cost.
//   2. PAGE LINK SCAN — fetch the root page, scan the link text +
//      href for schedule keywords. Same-origin only. Free.
//   3. LLM SCOUT — if nothing matched, hand the link list to Claude
//      Haiku and ask which is most likely the schedule page. ~$0.005.
//   4. FALLBACK — return the root URL with a low-confidence flag.
//      The extraction cascade still gets a shot; weekly rescrape can
//      rediscover later.

import { fetchHtml } from "../scrapers/fetch";
import Anthropic from "@anthropic-ai/sdk";
import { load } from "cheerio";

const PATH_GUESSES = [
  // Generic English
  "/schedule",
  "/schedule.html",
  "/times",
  "/calendar",
  "/services",
  "/service-times",
  "/prayer-times",
  "/service-schedule",
  // Hebrew / Yeshivish terms
  "/minyan",
  "/minyan-times",
  "/minyanim",
  "/davening",
  "/davening-times",
  "/tefilla",
  "/tefillah",
  "/shacharis",
  "/shabbos",
  "/shabbat",
  "/worship/shabbat",
];

// Keywords that suggest a page is the schedule. Match against link
// text, hrefs, and rendered page content.
const SCHEDULE_KEYWORDS_RE =
  /\b(schedule|times|minyan|davening|prayer\s*times|service\s*times|tefilla|tefillah|shacharis|shacharit|mincha|maariv|shabbos|shabbat|kabbalat\s*shabbat|davening\s*times)\b/i;

// Look for *actual* time strings (e.g. "7:30 AM", "18:15") to confirm
// the page contains a schedule, not just a link to one.
const TIME_LIKE_RE = /\b\d{1,2}:\d{2}\s*(?:am|pm|AM|PM)?\b/;

export type ResolveVia = "root" | "pattern" | "page-link" | "llm-scout";

export interface ResolvedScheduleUrl {
  url: string;
  via: ResolveVia;
  /** 0-1 confidence that this is actually the schedule page. */
  confidence: number;
  /** Optional explanation, useful for admin UI banners. */
  reason?: string;
}

function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

function absoluteUrl(href: string, base: string): string | null {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

function htmlLooksLikeSchedule(html: string): boolean {
  // Cheap check: at least 2 time-like strings within the visible text
  // AND a schedule keyword somewhere on the page. Avoids matching pages
  // that just LINK to the schedule (where keywords appear in nav but
  // no actual times are on this page).
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ");
  const keywordHit = SCHEDULE_KEYWORDS_RE.test(text);
  if (!keywordHit) return false;
  // Count time-like patterns
  const matches = text.match(/\b\d{1,2}:\d{2}\s*(?:am|pm|AM|PM)?\b/g) ?? [];
  return matches.length >= 2;
}

/**
 * Pull links from a page with their visible text. Returns at most `limit`
 * same-origin links. Excludes mailto/tel/anchor/javascript URLs.
 */
function extractLinks(
  html: string,
  baseUrl: string,
  limit = 200,
): Array<{ href: string; text: string }> {
  const $ = load(html);
  const out: Array<{ href: string; text: string }> = [];
  const seen = new Set<string>();
  $("a[href]").each((_, el) => {
    if (out.length >= limit) return false;
    const rawHref = $(el).attr("href")?.trim();
    if (!rawHref) return;
    if (
      rawHref.startsWith("#") ||
      rawHref.startsWith("mailto:") ||
      rawHref.startsWith("tel:") ||
      rawHref.startsWith("javascript:")
    ) {
      return;
    }
    const abs = absoluteUrl(rawHref, baseUrl);
    if (!abs || !sameOrigin(abs, baseUrl)) return;
    if (seen.has(abs)) return;
    seen.add(abs);
    const text = $(el).text().replace(/\s+/g, " ").trim();
    if (!text) return;
    out.push({ href: abs, text });
  });
  return out;
}

async function tryPattern(
  origin: string,
): Promise<ResolvedScheduleUrl | null> {
  for (const path of PATH_GUESSES) {
    const candidate = `${origin}${path}`;
    try {
      const r = await fetchHtml(candidate, { timeoutMs: 6_000 });
      if (!r.ok || !r.html) continue;
      if (htmlLooksLikeSchedule(r.html)) {
        return {
          url: r.finalUrl || candidate,
          via: "pattern",
          confidence: 0.85,
          reason: `Matched common path ${path}`,
        };
      }
    } catch {
      // ignore — try next path
    }
  }
  return null;
}

function tryPageLinkScan(
  rootHtml: string,
  rootUrl: string,
): ResolvedScheduleUrl | null {
  const links = extractLinks(rootHtml, rootUrl, 200);
  for (const { href, text } of links) {
    const path = (() => {
      try {
        return new URL(href).pathname.toLowerCase();
      } catch {
        return "";
      }
    })();
    if (
      SCHEDULE_KEYWORDS_RE.test(text.toLowerCase()) ||
      SCHEDULE_KEYWORDS_RE.test(path)
    ) {
      return {
        url: href,
        via: "page-link",
        confidence: 0.75,
        reason: `Found navigation link "${text.slice(0, 80)}"`,
      };
    }
  }
  return null;
}

async function tryLlmScout(
  rootUrl: string,
  links: Array<{ href: string; text: string }>,
): Promise<ResolvedScheduleUrl | null> {
  if (!process.env.ANTHROPIC_API_KEY || links.length === 0) return null;

  // Cap link list so we don't blow Haiku's context with a huge nav menu.
  const sampled = links.slice(0, 80);
  const linkLines = sampled
    .map((l, i) => `${i + 1}. ${l.text} | ${l.href}`)
    .join("\n");

  const client = new Anthropic();
  const SYSTEM = String.raw`You are helping discover the schedule page of a Jewish shul (synagogue) website.

You will be given:
- The shul's homepage URL.
- A list of links from the homepage, each with its visible text and href.

Your job is to identify which ONE link most likely leads to the page that lists the shul's minyan/prayer/davening times.

Strong signals: link text contains "schedule", "times", "minyan", "davening", "prayer", "service times", "tefilla", or related terms. Paths like /schedule, /minyan-times, /davening, /times, /worship/shabbat. ShulCloud sites often use /templates/articlecco_cdo/aid/<id>/jewish/Times-and-Schedule.htm or similar; the link text is usually still descriptive ("Schedule", "Service Times", "Davening Times").

Weak signals / SKIP: events calendars (often /events, /calendar), past services, blog posts, donation pages, contact, about, sermons, classes, "this week's schedule" links that are clearly an article and not a recurring schedule.

Respond with ONLY the href (full URL) of the chosen link. If none of the links looks like a schedule page, respond with: NONE`;

  try {
    const r = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 200,
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: `HOMEPAGE: ${rootUrl}\n\nLINKS:\n${linkLines}`,
        },
      ],
    });
    const block = r.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") return null;
    const picked = block.text.trim();
    if (picked === "NONE" || !picked) return null;
    // Validate it's one of the offered hrefs (the LLM sometimes
    // hallucinates a near-match URL); only accept exact matches.
    const match = sampled.find((l) => l.href === picked);
    if (!match) return null;
    return {
      url: match.href,
      via: "llm-scout",
      confidence: 0.6,
      reason: `LLM picked "${match.text.slice(0, 80)}"`,
    };
  } catch {
    return null;
  }
}

/**
 * Resolve a root URL to the URL that contains the shul's minyan schedule.
 * Always returns a result — falls back to the input URL with low
 * confidence if nothing better was found.
 */
export async function resolveScheduleUrl(
  rootUrl: string,
): Promise<ResolvedScheduleUrl> {
  let parsed: URL;
  try {
    parsed = new URL(rootUrl);
  } catch {
    return {
      url: rootUrl,
      via: "root",
      confidence: 0,
      reason: "input not a valid URL",
    };
  }

  // If the input already includes a path past "/", trust it. The
  // resolver is for "I have the root domain, find me the schedule"
  // not "I have a deep URL, second-guess it."
  const hasMeaningfulPath =
    parsed.pathname !== "/" && parsed.pathname.length > 1;
  if (hasMeaningfulPath) {
    return {
      url: rootUrl,
      via: "root",
      confidence: 1,
      reason: "URL already has a specific path; trusting it",
    };
  }

  // Step 1: pattern try
  const fromPattern = await tryPattern(parsed.origin);
  if (fromPattern) return fromPattern;

  // Step 2 + 3: fetch root page, then scan + LLM-scout from same payload
  let rootHtml = "";
  try {
    const r = await fetchHtml(parsed.origin, { timeoutMs: 10_000 });
    if (r.ok) rootHtml = r.html ?? "";
  } catch {
    // ignore
  }

  if (rootHtml) {
    const fromScan = tryPageLinkScan(rootHtml, rootUrl);
    if (fromScan) return fromScan;

    const links = extractLinks(rootHtml, rootUrl, 200);
    const fromLlm = await tryLlmScout(rootUrl, links);
    if (fromLlm) return fromLlm;
  }

  return {
    url: rootUrl,
    via: "root",
    confidence: 0.4,
    reason: "no schedule sub-page found; using root URL",
  };
}
