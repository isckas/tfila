import * as cheerio from "cheerio";
import type { DayRule, ExtractedMinyan, Service, TimeKind } from "./extract";

interface RawEvent {
  name: string;
  dateStr: string;
  timeStr: string;
  description: string;
}

const SERVICE_KEYWORDS: Array<{ service: Service; re: RegExp }> = [
  { service: "shacharis", re: /\b(?:shacharis|shacharit|shaharit|hashkama|hashkamah|netz|vasikin|vatikin)\b/i },
  { service: "mincha", re: /\b(?:mincha|minchah|minha)\b/i },
  { service: "maariv", re: /\b(?:maariv|ma'ariv|mariv|arvit|arbit)\b/i },
  { service: "candles", re: /\b(?:candle\s*lighting|candle\s*light|hadlakat\s*nerot)\b/i },
  { service: "havdalah", re: /\b(?:havdalah|havdala)\b/i },
  { service: "selichos", re: /\b(?:selichos|selichot|slichos|slichot)\b/i },
];

const WEEKDAY_TO_RULE: Record<string, DayRule> = {
  sun: "sunday",
  mon: "monday",
  tue: "tuesday",
  wed: "wednesday",
  thu: "thursday",
  fri: "friday",
  sat: "shabbos",
};

export interface ShulCloudExtractResult {
  minyanim: ExtractedMinyan[];
  rawEvents: RawEvent[];
  recurrenceGroups: number;
}

export function extractFromShulCloudCalendar(html: string): ShulCloudExtractResult {
  const $ = cheerio.load(html);

  const triggers = $(".calendar_popover_trigger").toArray();
  if (triggers.length === 0) {
    return { minyanim: [], rawEvents: [], recurrenceGroups: 0 };
  }

  const rawEvents: RawEvent[] = [];
  for (const el of triggers) {
    const popup = $(el).attr("data-popuphtml");
    if (!popup) continue;
    const decoded = popup
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&#x27;/g, "'")
      .replace(/&#39;/g, "'");

    const nameMatch = decoded.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i);
    const datetimeMatch = decoded.match(
      /<div[^>]*class=["']?datetime["']?[^>]*>([\s\S]*?)<\/div>/i,
    );
    const descMatch = decoded.match(
      /<div[^>]*class=["']?description["']?[^>]*>([\s\S]*?)<\/div>/i,
    );

    const name = nameMatch ? stripTags(nameMatch[1]).trim() : "";
    const datetime = datetimeMatch
      ? stripTags(datetimeMatch[1]).replace(/\s+/g, " ").trim()
      : "";
    const description = descMatch ? stripTags(descMatch[1]).trim() : "";

    if (!name || !datetime) continue;

    const dateMatch = datetime.match(/(Sun|Mon|Tue|Wed|Thu|Fri|Sat)/i);
    const timeMatch = datetime.match(/\b(\d{1,2}):(\d{2})\s*(am|pm)\b/i);
    if (!dateMatch || !timeMatch) continue;

    rawEvents.push({
      name,
      dateStr: dateMatch[1],
      timeStr: `${timeMatch[1]}:${timeMatch[2]}${timeMatch[3].toLowerCase()}`,
      description,
    });
  }

  const instances: ExtractedMinyan[] = [];
  for (const ev of rawEvents) {
    const service = classifyService(ev.name);
    if (!service) continue;
    const dayRule = dayFromShortName(ev.dateStr);
    const timeFixed = parseTimeToHHMM(ev.timeStr);
    if (!timeFixed) continue;

    instances.push({
      service,
      dayRule,
      timeKind: "fixed" as TimeKind,
      timeFixed,
      rawText: `${ev.name} — ${ev.dateStr} ${ev.timeStr}`,
      confidence: 0.9,
    });
  }

  const grouped = collapseToRecurringRules(instances);
  return {
    minyanim: grouped,
    rawEvents,
    recurrenceGroups: grouped.length,
  };
}

function classifyService(name: string): Service | null {
  for (const k of SERVICE_KEYWORDS) if (k.re.test(name)) return k.service;
  return null;
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ");
}

function dayFromShortName(s: string): DayRule {
  return WEEKDAY_TO_RULE[s.toLowerCase().slice(0, 3)] ?? "weekday";
}

function parseTimeToHHMM(s: string): string | null {
  const m = s.match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = m[2];
  const isPm = /p/i.test(m[3]);
  if (h === 12) h = isPm ? 12 : 0;
  else if (isPm) h += 12;
  return `${String(h).padStart(2, "0")}:${min}`;
}

function collapseToRecurringRules(items: ExtractedMinyan[]): ExtractedMinyan[] {
  const byKey = new Map<string, Set<DayRule>>();
  const sample = new Map<string, ExtractedMinyan>();

  for (const m of items) {
    const key = `${m.service}|${m.timeKind}|${m.timeFixed ?? m.timeOffsetMinutes ?? ""}`;
    if (!byKey.has(key)) byKey.set(key, new Set());
    byKey.get(key)!.add(m.dayRule);
    if (!sample.has(key)) sample.set(key, m);
  }

  const out: ExtractedMinyan[] = [];
  for (const [key, daySet] of byKey.entries()) {
    const base = sample.get(key)!;
    const collapsed = collapseDays(daySet);
    for (const day of collapsed) {
      out.push({ ...base, dayRule: day, confidence: 0.92 });
    }
  }
  return out;
}

function collapseDays(set: Set<DayRule>): DayRule[] {
  const weekdayDays: DayRule[] = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday"];
  const isAllWeekdays = ["monday", "tuesday", "wednesday", "thursday", "friday"].every((d) =>
    set.has(d as DayRule),
  );
  const isSunThruFri = weekdayDays.every((d) => set.has(d));
  if (isSunThruFri && !set.has("shabbos")) {
    return ["weekday"];
  }
  if (isAllWeekdays && !set.has("sunday") && !set.has("shabbos")) {
    return ["weekday"];
  }
  return Array.from(set);
}
