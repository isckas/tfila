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
OUTPUT: a single strict JSON object matching the schema {confidence, reasoning, rules[], shulName?, shulAddress?, shulWebsite?}. No prose preamble, no markdown fences.

## Identifying the shul (shulName, shulAddress, shulWebsite)

The "From" header of a forwarded shul email is OFTEN a shared mailing-list service (e.g. info@myshul.com, list@mailchimp.com, news@constantcontact.com) — NOT the shul itself. To identify the actual shul:
- shulName: look for the shul's name in the subject line, body greeting, header, or footer (e.g. "Edmond J. Safra Synagogue", "Bris Avrohom of Fair Lawn"). Do NOT use the mailing-list provider's name.
- shulWebsite: extract the shul's own website root URL (e.g. "https://edmondjsafrasynagogue.com"). RULES:
  * Return ONLY the bare origin: "https://hostname" with no path, query, or fragment.
  * SKIP link-tracking redirects (url429.myshul.com, click.*, track.*, url\d+\..*, sendgrid wrappers).
  * SKIP mailing-list platforms (myshul.com, mailchimp.com, list-manage.com, constantcontact.com, sendgrid.*, mailgun.*).
  * SKIP image CDNs (cdn.*, *.cloudfront.net, mcauto-images-production.sendgrid.net).
  * SKIP social media (facebook.com, instagram.com, x.com, twitter.com, youtube.com, tiktok.com, linkedin.com).
  * SKIP shortlinks (bit.ly, goo.gl, t.co, tinyurl.com).
  * SKIP generic mail providers (gmail.com, yahoo.com, outlook.com).
  * If nothing qualifying is present, OMIT the field — do not invent one.

## What counts as a minyan
Shacharis (incl Vasikin/Hashkamah), Mincha, Maariv, Selichos, Neilah.

Skip: shiurim (Daf Yomi, Mishna Yomi, halacha class, parsha class), kiddush sponsors, mazal tov, divrei Torah, donation asks, social events, candle lighting / havdalah (those are zmanim — handled elsewhere).

## Time formats
Fixed: \`{"kind":"fixed","clock":"HH:MM"}\` (24-hour). PM times must be converted ("7:30 PM" → "19:30").
Zmanim-relative: \`{"kind":"zmanim","anchor":"shkia"|"netz"|"alos"|"misheyakir"|"chatzos"|"mincha_gedolah"|"plag_mincha"|"tzeis_72"|"tzeis_42"|"sof_zman_shma_gra"|"sof_zman_shma_mga"|"sof_zman_tefillah_gra"|"sof_zman_tefillah_mga"|"candle_lighting","offsetMin":-18}\`.

## Days
\`daysOfWeek\` is an array of 0-6 (0=Sunday, 6=Shabbos). "Weekdays" usually = Mon-Fri = [1,2,3,4,5]; if Friday is listed separately, treat it as such.

## Regular vs date-bounded (CRITICAL — read carefully)

**Default to REGULAR weekly rules.** Most shul-bulletin emails describe the standard week-after-week schedule, even when they include this week's parsha name and date range as a header ("Schedule for May 8-9 — Parshas Behar"). The parsha + dates are decoration; the *times* repeat every week.

Emit REGULAR rules (\`specialScheduleKind: "regular"\`, NO validFrom/validTo, USE \`daysOfWeek\` for the recurring weekday pattern) when:
  - The schedule shows standard weekday/Friday/Shabbos times in a recurring shape (Shacharis times, Mincha/Maariv pair, Shabbos morning + afternoon)
  - The email is a routine bulletin even if it mentions the parsha or this week's dates
  - There's no language explicitly framing the times as a one-off ("this Sunday only", "special schedule for…")

Emit DATE-BOUNDED rules (\`validFrom\` + \`validTo\` as YYYY-MM-DD, \`specialScheduleKind\`: \`yom_tov\` | \`three_weeks\` | \`aseres_yemei_teshuvah\` | \`fast_day\` | \`rosh_chodesh\` | \`ad_hoc\`) ONLY when:
  - The times themselves are unusual / labeled as one-off ("Tisha B'Av Schedule", "Yom Kippur Schedule", "Erev Rosh Hashana times")
  - The email explicitly says these are special-event times that differ from the normal week
  - A specific holiday or fast is named that anchors a non-recurring schedule

When in doubt — the times look like a normal Fri/Shabbos schedule — emit REGULAR. A wrong regular rule is easy to override; a wrong date-bounded rule makes the shul invisible to all future queries.

## Date handling

When dates appear without a year ("May 8-9", "Parshas Behar"), DO NOT guess a year and emit validFrom/validTo. Either the schedule is recurring (no validFrom/To needed) or you should leave the rule undated. Never default to a year in the past. If a year is genuinely required (a date-bounded special-schedule rule) and only month/day are present, use the most recent or upcoming occurrence — never older than the email's own date.

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
  "shulName": "Bris Avrohom of Fair Lawn",
  "shulWebsite": "https://brisavrohomfl.org",
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
  // Skip Sonnet when Haiku is sure the email body has no schedule.
  if (
    haiku.extraction.rules.length === 0 &&
    haiku.extraction.confidence < 0.2
  ) {
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
