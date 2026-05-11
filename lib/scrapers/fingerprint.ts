import * as cheerio from "cheerio";

export type Platform =
  | "shulcloud"
  | "shulspace"
  | "shulhub"
  | "wix"
  | "manual"
  | "unknown";

export interface FingerprintResult {
  platform: Platform;
  confidence: number;
  signals: string[];
}

const SHULCLOUD_HOSTS = ["shulcloud.com", "images.shulcloud.com"];
const SHULSPACE_HOSTS = ["shulspace.com", "cdn.shulspace.com"];
const SHULHUB_HOSTS = ["shulhub.com"];
const WIX_HOSTS = ["wixstatic.com", "wix.com", "parastorage.com"];

export function fingerprint(html: string, url?: string): FingerprintResult {
  const $ = cheerio.load(html);
  const signals: string[] = [];

  const lowerHtml = html.toLowerCase();
  const hostBag = collectHosts($);

  let shulcloud = 0;
  if (SHULCLOUD_HOSTS.some((h) => hostBag.has(h))) {
    shulcloud += 2;
    signals.push("shulcloud:asset-host");
  }
  if (lowerHtml.includes("powered by shulcloud")) {
    shulcloud += 3;
    signals.push("shulcloud:footer-text");
  }
  if (url && /\.shulcloud\.com/i.test(url)) {
    shulcloud += 3;
    signals.push("shulcloud:domain");
  }
  if ($('meta[name="generator"][content*="ShulCloud" i]').length) {
    shulcloud += 2;
    signals.push("shulcloud:meta-generator");
  }

  let shulspace = 0;
  if (SHULSPACE_HOSTS.some((h) => hostBag.has(h))) {
    shulspace += 2;
    signals.push("shulspace:asset-host");
  }
  if (lowerHtml.includes("powered by shulspace")) {
    shulspace += 3;
    signals.push("shulspace:footer-text");
  }

  let shulhub = 0;
  if (SHULHUB_HOSTS.some((h) => hostBag.has(h))) {
    shulhub += 2;
    signals.push("shulhub:asset-host");
  }
  if (lowerHtml.includes("powered by shulhub")) {
    shulhub += 3;
    signals.push("shulhub:footer-text");
  }

  let wix = 0;
  if (WIX_HOSTS.some((h) => hostBag.has(h))) {
    wix += 2;
    signals.push("wix:asset-host");
  }
  if ($('meta[name="generator"][content*="Wix" i]').length) {
    wix += 2;
    signals.push("wix:meta-generator");
  }

  const scores: Array<{ platform: Platform; score: number }> = [
    { platform: "shulcloud", score: shulcloud },
    { platform: "shulspace", score: shulspace },
    { platform: "shulhub", score: shulhub },
    { platform: "wix", score: wix },
  ];
  scores.sort((a, b) => b.score - a.score);

  const top = scores[0];
  if (top.score < 2) {
    return { platform: "unknown", confidence: 0, signals };
  }

  return {
    platform: top.platform,
    confidence: Math.min(1, top.score / 5),
    signals,
  };
}

function collectHosts($: cheerio.CheerioAPI): Set<string> {
  const hosts = new Set<string>();
  const attrs: Array<[string, string]> = [
    ["script", "src"],
    ["link", "href"],
    ["img", "src"],
    ["a", "href"],
  ];
  for (const [tag, attr] of attrs) {
    $(tag).each((_, el) => {
      const val = $(el).attr(attr);
      if (!val) return;
      try {
        const u = new URL(val, "https://placeholder.invalid");
        if (u.hostname && u.hostname !== "placeholder.invalid") {
          hosts.add(u.hostname.toLowerCase());
        }
      } catch {
        /* ignore */
      }
    });
  }
  return hosts;
}
