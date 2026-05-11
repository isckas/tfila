import * as cheerio from "cheerio";

export type Service =
  | "shacharis"
  | "mincha"
  | "maariv"
  | "candles"
  | "havdalah"
  | "selichos"
  | "other";

export type DayRule =
  | "sunday"
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "shabbos"
  | "weekday"
  | "rosh_chodesh"
  | "yom_tov"
  | "specific_date";

export type TimeKind =
  | "fixed"
  | "relative_sunrise"
  | "relative_sunset"
  | "relative_plag"
  | "relative_chatzos";

export interface ExtractedMinyan {
  service: Service;
  dayRule: DayRule;
  timeKind: TimeKind;
  timeFixed?: string;
  timeOffsetMinutes?: number;
  rawText: string;
  confidence: number;
}

export interface ExtractResult {
  minyanim: ExtractedMinyan[];
  candidateLines: number;
  meanConfidence: number;
}

const SERVICE_PATTERNS: Array<{ service: Service; re: RegExp }> = [
  { service: "shacharis", re: /\b(?:shacharis|shacharit|shaharit|hashkama|hashkamah|netz|vasikin|vatikin|sunrise minyan|morning service|morning minyan)\b/i },
  { service: "mincha", re: /\b(?:mincha|minchah|minha|afternoon service|afternoon minyan)\b/i },
  { service: "maariv", re: /\b(?:maariv|ma'ariv|mariv|arvit|arbit|evening service|evening minyan|night minyan)\b/i },
  { service: "candles", re: /\b(?:candle\s*lighting|candle\s*light|hadlakat\s*nerot|licht\s*benschen|candles?)\b/i },
  { service: "havdalah", re: /\b(?:havdalah|havdala)\b/i },
  { service: "selichos", re: /\b(?:selichos|selichot|slichos|slichot)\b/i },
];

const DAY_PATTERNS: Array<{ day: DayRule; re: RegExp }> = [
  { day: "shabbos", re: /\b(?:shabbos|shabbat|shabbath|saturday morning|fri(?:day)?\s*night|kabbalat\s*shabbat)\b/i },
  { day: "rosh_chodesh", re: /\brosh\s*chodesh\b/i },
  { day: "yom_tov", re: /\b(?:yom\s*tov|festival|chag|holiday)\b/i },
  { day: "sunday", re: /\b(?:sunday|sundays|sun\.?)\b/i },
  { day: "monday", re: /\b(?:monday|mondays|mon\.?)\b/i },
  { day: "tuesday", re: /\b(?:tuesday|tuesdays|tue\.?|tues\.?)\b/i },
  { day: "wednesday", re: /\b(?:wednesday|wednesdays|wed\.?)\b/i },
  { day: "thursday", re: /\b(?:thursday|thursdays|thu\.?|thur\.?|thurs\.?)\b/i },
  { day: "friday", re: /\b(?:friday|fridays|fri\.?)\b/i },
  { day: "weekday", re: /\b(?:weekday|weekdays|mon(?:day)?\s*[-–—to]+\s*fri(?:day)?|sun(?:day)?\s*[-–—to]+\s*fri(?:day)?|mon(?:day)?\s*[-–—to]+\s*thu(?:rsday)?)\b/i },
];

const TIME_FIXED = /\b(\d{1,2}):(\d{2})\s*(a\.?m\.?|p\.?m\.?)\b/i;

const TIME_RELATIVE = /\b(\d{1,3})\s*(?:minutes?|mins?|min)\s*(before|after|prior to|past)\s*(sunset|sunrise|netz|shkia|shkiah|plag|chatzos|chatzot)\b/i;

const SERVICE_RANK: Record<Service, number> = {
  shacharis: 0,
  mincha: 1,
  maariv: 2,
  candles: 3,
  havdalah: 4,
  selichos: 5,
  other: 6,
};

export function extractFromHtml(html: string): ExtractResult {
  const $ = cheerio.load(html);

  $("header, nav, footer, script, style, .header, .footer, .navigation, .nav, .menu, #header, #footer, #nav, #menu").remove();

  const main =
    $("main").first().html() ||
    $("article").first().html() ||
    $("#content, .content, .main, #main").first().html() ||
    $("body").html() ||
    "";

  const $$ = cheerio.load(main || "");
  const text = $$.root()
    .text()
    .replace(/ /g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n");

  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && l.length < 240);

  const minyanim: ExtractedMinyan[] = [];
  let candidateLines = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fixed = TIME_FIXED.exec(line);
    const relative = TIME_RELATIVE.exec(line);
    if (!fixed && !relative) continue;
    candidateLines++;

    const window = [lines[i - 1], line, lines[i + 1]].filter(Boolean).join(" | ");

    const service = detectService(window);
    if (!service) continue;

    const day = detectDay(window) ?? "weekday";

    if (relative) {
      const offset = parseInt(relative[1], 10);
      const direction = /before|prior/i.test(relative[2]) ? -1 : 1;
      const ref = relative[3].toLowerCase();
      let timeKind: TimeKind = "relative_sunset";
      if (/sunrise|netz/.test(ref)) timeKind = "relative_sunrise";
      else if (/plag/.test(ref)) timeKind = "relative_plag";
      else if (/chatz/.test(ref)) timeKind = "relative_chatzos";

      minyanim.push({
        service,
        dayRule: day,
        timeKind,
        timeOffsetMinutes: offset * direction,
        rawText: line,
        confidence: scoreConfidence(line, window, service, day, true),
      });
    } else if (fixed) {
      const hour24 = to24h(parseInt(fixed[1], 10), fixed[3]);
      const minute = fixed[2];
      const fixedStr = `${String(hour24).padStart(2, "0")}:${minute}`;
      minyanim.push({
        service,
        dayRule: day,
        timeKind: "fixed",
        timeFixed: fixedStr,
        rawText: line,
        confidence: scoreConfidence(line, window, service, day, false),
      });
    }
  }

  const deduped = dedupe(minyanim);
  const meanConfidence =
    deduped.length === 0
      ? 0
      : deduped.reduce((s, m) => s + m.confidence, 0) / deduped.length;

  return {
    minyanim: deduped.sort(
      (a, b) =>
        SERVICE_RANK[a.service] - SERVICE_RANK[b.service] ||
        a.dayRule.localeCompare(b.dayRule),
    ),
    candidateLines,
    meanConfidence,
  };
}

function detectService(window: string): Service | null {
  for (const p of SERVICE_PATTERNS) if (p.re.test(window)) return p.service;
  return null;
}

function detectDay(window: string): DayRule | null {
  for (const p of DAY_PATTERNS) if (p.re.test(window)) return p.day;
  return null;
}

function to24h(hour: number, ampm: string): number {
  const isPm = /p/i.test(ampm);
  if (hour === 12) return isPm ? 12 : 0;
  return isPm ? hour + 12 : hour;
}

function scoreConfidence(
  line: string,
  window: string,
  service: Service,
  day: DayRule,
  relative: boolean,
): number {
  let score = 0.4;
  if (SERVICE_PATTERNS.find((p) => p.service === service)?.re.test(line)) score += 0.2;
  if (DAY_PATTERNS.find((p) => p.day === day)?.re.test(line)) score += 0.15;
  if (line.length < 80) score += 0.1;
  if (relative) score += 0.05;
  if (/\bschedule|times?|minyan|davening\b/i.test(window)) score += 0.05;
  return Math.min(1, score);
}

function dedupe(list: ExtractedMinyan[]): ExtractedMinyan[] {
  const seen = new Map<string, ExtractedMinyan>();
  for (const m of list) {
    const key = `${m.service}|${m.dayRule}|${m.timeKind}|${m.timeFixed ?? m.timeOffsetMinutes ?? ""}`;
    const existing = seen.get(key);
    if (!existing || m.confidence > existing.confidence) seen.set(key, m);
  }
  return Array.from(seen.values());
}
