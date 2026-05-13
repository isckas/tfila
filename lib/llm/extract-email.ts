// Email-tuned LLM extractor. Re-uses the schedule Zod schema from
// lib/llm/schema.ts, with a different system prompt because emails are
// flat-text, often have explicit date context ("Schedule for Parshas Behar"),
// and special-schedule keywords are easier to detect than from raw HTML.

import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";
import { ExtractionSchema, type Extraction } from "./schema";

const MAX_BODY_CHARS = 30_000;
const HAIKU_CONFIDENCE_FLOOR = 0.4;

const SYSTEM_PROMPT = String.raw`You are extracting minyan times from a Jewish shul's weekly email newsletter.

INPUT: subject line + plain-text body (email may include forwarded headers — ignore those, focus on the schedule).
OUTPUT: a single strict JSON object matching the schema {confidence, reasoning, rules[], shulName?, shulAddress?}. No prose preamble, no markdown fences.

## What counts as a minyan
Shacharis (incl Vasikin/Hashkamah), Mincha, Maariv, Selichos, Neilah.

Skip: shiurim (Daf Yomi, Mishna Yomi, halacha class, parsha class), kiddush sponsors, mazal tov, divrei Torah, donation asks, social events, candle lighting / havdalah (those are zmanim — handled elsewhere).

## Time formats
Fixed: \`{"kind":"fixed","clock":"HH:MM"}\` (24-hour). PM times must be converted ("7:30 PM" → "19:30").
Zmanim-relative: \`{"kind":"zmanim","anchor":"shkia"|"netz"|"alos"|"misheyakir"|"chatzos"|"mincha_gedolah"|"plag_mincha"|"tzeis_72"|"tzeis_42"|"sof_zman_shma_gra"|"sof_zman_shma_mga"|"sof_zman_tefillah_gra"|"sof_zman_tefillah_mga"|"candle_lighting","offsetMin":-18}\`.

## Days
\`daysOfWeek\` is an array of 0-6 (0=Sunday, 6=Shabbos). "Weekdays" usually = Mon-Fri = [1,2,3,4,5]; if Friday is listed separately, treat it as such.

## Date-bounded rules (KEY: emails often describe SPECIFIC WEEKS)
Emails routinely come with a date header like:
  - "Schedule for the week of May 18-24"
  - "Parshas Behar — May 23"
  - "Tisha B'Av Schedule"
  - "Three Weeks Schedule"

When the email is for a specific week or date range AND the times described differ from a typical weekly pattern, emit DATE-BOUNDED rules:
  - \`validFrom\` + \`validTo\` set to the date range (YYYY-MM-DD)
  - \`specialScheduleKind\` set to: \`yom_tov\` | \`three_weeks\` | \`aseres_yemei_teshuvah\` | \`fast_day\` | \`rosh_chodesh\` | \`ad_hoc\`

When the email is just the routine weekly schedule (e.g. "Weekly Schedule" with no special context), emit \`specialScheduleKind: "regular"\` and no validFrom/validTo. Use \`daysOfWeek\` for the recurring weekly pattern.

## Confidence
- 0.9+: explicit times, clearly minyanim, dates unambiguous
- 0.6-0.9: standard schedule with minor interpretation
- 0.4-0.6: messy / mixed signals — reviewer should look
- < 0.4: probably not a schedule email (or too vague)

## Examples

EX 1 — routine weekly:
SUBJECT: Weekly Bulletin – Parshas Behar
BODY: |
  Shacharis: Mon-Fri 7:00 AM, Sun 8:00 AM
  Mincha/Maariv: 7:35 PM Mon-Thu, 7:30 PM Fri
  Shabbos Shacharis: 9:15 AM
  Shabbos Mincha: 18 min before sunset

JSON: {
  "confidence": 0.92,
  "reasoning": "Clean routine weekly schedule for Parshas Behar. Recurring weekly times.",
  "rules": [
    {"tefillah":"shacharis","daysOfWeek":[1,2,3,4,5],"time":{"kind":"fixed","clock":"07:00"}},
    {"tefillah":"shacharis","daysOfWeek":[0],"time":{"kind":"fixed","clock":"08:00"}},
    {"tefillah":"mincha","daysOfWeek":[1,2,3,4],"time":{"kind":"fixed","clock":"19:35"}},
    {"tefillah":"maariv","daysOfWeek":[1,2,3,4],"time":{"kind":"fixed","clock":"19:35"}},
    {"tefillah":"mincha","daysOfWeek":[5],"time":{"kind":"fixed","clock":"19:30"}},
    {"tefillah":"shacharis","daysOfWeek":[6],"time":{"kind":"fixed","clock":"09:15"}},
    {"tefillah":"mincha","daysOfWeek":[6],"time":{"kind":"zmanim","anchor":"shkia","offsetMin":-18}}
  ]
}

EX 2 — special schedule (Tisha B'Av):
SUBJECT: Tisha B'Av Schedule – Thursday August 13
BODY: |
  Erev Tisha B'Av (Wed Aug 12):
    Mincha 7:30 PM
    Maariv + Eicha 9:15 PM
  Tisha B'Av (Thu Aug 13):
    Shacharis 7:00 AM
    Mincha 7:00 PM
    Maariv (after fast) 8:45 PM

JSON: {
  "confidence": 0.95,
  "reasoning": "Explicitly labeled Tisha B'Av schedule with specific dates. All rules date-bounded with specialScheduleKind=fast_day.",
  "rules": [
    {"tefillah":"mincha","validFrom":"2026-08-12","validTo":"2026-08-12","specialScheduleKind":"fast_day","time":{"kind":"fixed","clock":"19:30"},"notes":"Erev Tisha B'Av"},
    {"tefillah":"maariv","validFrom":"2026-08-12","validTo":"2026-08-12","specialScheduleKind":"fast_day","time":{"kind":"fixed","clock":"21:15"},"notes":"Maariv + Eicha"},
    {"tefillah":"shacharis","validFrom":"2026-08-13","validTo":"2026-08-13","specialScheduleKind":"fast_day","time":{"kind":"fixed","clock":"07:00"}},
    {"tefillah":"mincha","validFrom":"2026-08-13","validTo":"2026-08-13","specialScheduleKind":"fast_day","time":{"kind":"fixed","clock":"19:00"}},
    {"tefillah":"maariv","validFrom":"2026-08-13","validTo":"2026-08-13","specialScheduleKind":"fast_day","time":{"kind":"fixed","clock":"20:45"}}
  ]
}

EX 3 — non-schedule email:
SUBJECT: Mazal tov to the Cohen family!
BODY: |
  We are thrilled to share the engagement of Sara to David...

JSON: {
  "confidence": 0.05,
  "reasoning": "Mazal tov announcement, no minyan schedule.",
  "rules": []
}

Now process the input. Output ONLY the JSON.`;

let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (_client) return _client;
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set.");
  }
  _client = new Anthropic();
  return _client;
}

function stripJsonFences(text: string): string {
  let t = text.trim();
  t = t.replace(/^```(?:json|JSON)?\s*\r?\n/, "");
  t = t.replace(/\r?\n\s*```\s*$/, "");
  return t.trim();
}

function extractJsonObject(text: string): string {
  const cleaned = stripJsonFences(text);
  try {
    JSON.parse(cleaned);
    return cleaned;
  } catch {
    // fall through
  }
  const start = cleaned.indexOf("{");
  if (start === -1) return cleaned;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < cleaned.length; i++) {
    const c = cleaned[i];
    if (inString) {
      if (escape) { escape = false; continue; }
      if (c === "\\") { escape = true; continue; }
      if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; continue; }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return cleaned.slice(start, i + 1);
    }
  }
  return cleaned;
}

export interface EmailExtractionResult {
  extraction: Extraction;
  model: "claude-haiku-4-5" | "claude-sonnet-4-6";
  bodyHash: string;
  usage: {
    haiku: { inputTokens: number; outputTokens: number; cacheCreationInputTokens: number; cacheReadInputTokens: number };
    sonnet?: { inputTokens: number; outputTokens: number; cacheCreationInputTokens: number; cacheReadInputTokens: number };
  };
}

async function callClaude(
  model: "claude-haiku-4-5" | "claude-sonnet-4-6",
  subject: string,
  body: string,
): Promise<{ extraction: Extraction; usage: EmailExtractionResult["usage"]["haiku"] }> {
  const r = await getClient().messages.create({
    model,
    max_tokens: 6_000,
    system: [
      { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
    ],
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: `SUBJECT: ${subject}\nBODY:\n${body}` }],
      },
    ],
  });

  const textBlock = r.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error(`${model} returned no text block.`);
  }
  const json = extractJsonObject(textBlock.text);
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new Error(
      `${model} returned invalid JSON: ${(err as Error).message}. Preview: ${textBlock.text.slice(0, 200)}`,
    );
  }
  const validated = ExtractionSchema.safeParse(parsed);
  if (!validated.success) {
    throw new Error(`${model} output failed Zod validation: ${validated.error.message}`);
  }

  return {
    extraction: validated.data,
    usage: {
      inputTokens: r.usage.input_tokens ?? 0,
      outputTokens: r.usage.output_tokens ?? 0,
      cacheCreationInputTokens: r.usage.cache_creation_input_tokens ?? 0,
      cacheReadInputTokens: r.usage.cache_read_input_tokens ?? 0,
    },
  };
}

export async function extractFromEmail(
  subject: string,
  body: string,
): Promise<EmailExtractionResult> {
  const trimmed = body.length > MAX_BODY_CHARS ? body.slice(0, MAX_BODY_CHARS) : body;
  const bodyHash = createHash("sha256").update(trimmed, "utf8").digest("hex");

  const haiku = await callClaude("claude-haiku-4-5", subject, trimmed);
  if (haiku.extraction.confidence >= HAIKU_CONFIDENCE_FLOOR) {
    return {
      extraction: haiku.extraction,
      model: "claude-haiku-4-5",
      bodyHash,
      usage: { haiku: haiku.usage },
    };
  }
  const sonnet = await callClaude("claude-sonnet-4-6", subject, trimmed);
  const winner =
    sonnet.extraction.confidence > haiku.extraction.confidence ? sonnet : haiku;
  return {
    extraction: winner.extraction,
    model: winner === sonnet ? "claude-sonnet-4-6" : "claude-haiku-4-5",
    bodyHash,
    usage: { haiku: haiku.usage, sonnet: sonnet.usage },
  };
}
