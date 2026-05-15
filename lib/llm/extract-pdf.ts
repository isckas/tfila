// PDF extractor. Many shuls publish their schedule as a weekly
// bulletin PDF rather than HTML — e.g. theshul.org's "Weekly Magazine"
// or anash.ca's downloadable schedule. Claude's native PDF input
// handles both vector-text PDFs and scanned/image PDFs (OCRs them
// internally), so we don't need a separate OCR step.

import Anthropic from "@anthropic-ai/sdk";
import { ExtractionSchema, type Extraction } from "./schema";
import { fetchBinary } from "../scrapers/fetch-binary";

const HAIKU_CONFIDENCE_FLOOR = 0.4;

const SYSTEM_PROMPT = String.raw`You are extracting Jewish minyan/tefillah times from a shul's weekly bulletin or schedule PDF.

INPUT: a PDF document (one or more pages). The schedule may be on any page; bulletins often have ads/announcements before reaching the schedule.

OUTPUT: a single strict JSON object matching this schema:
{ confidence, reasoning, rules[], shulName?, shulAddress? }

No prose preamble, no markdown fences in your reply.

## What counts as a minyan
Shacharis (incl Vasikin/Hashkamah), Mincha, Maariv, Selichos, Neilah.

Skip: shiurim (Daf Yomi, Mishna Yomi, halacha shiur, parsha class), kiddush sponsors, mazal tov listings, divrei Torah, donation appeals, social events, candle-lighting / havdalah times (those are zmanim — handled elsewhere).

## Time formats
Fixed: {"kind":"fixed","clock":"HH:MM"} (24-hour). Convert PM ("7:30 PM" → "19:30").
Zmanim-relative: {"kind":"zmanim","anchor":"shkia|netz|alos|misheyakir|chatzos|mincha_gedolah|plag_mincha|tzeis_72|tzeis_42|sof_zman_shma_gra|sof_zman_shma_mga|sof_zman_tefillah_gra|sof_zman_tefillah_mga|candle_lighting","offsetMin":-18}.

## Days
daysOfWeek is an array of 0-6 (0=Sunday, 6=Shabbos). "Weekdays" usually = Mon-Fri = [1,2,3,4,5]; if Friday is listed separately, treat as such.

## Date-bounded rules
Bulletins often describe a SPECIFIC WEEK or holiday. Look at the cover for context ("Parshas Bamidbar", "Tisha B'Av", "Sefer Vayikra", etc.).

When the schedule is for a specific date range AND differs from the routine weekly pattern, emit DATE-BOUNDED rules with:
- validFrom / validTo (YYYY-MM-DD)
- specialScheduleKind: yom_tov | three_weeks | aseres_yemei_teshuvah | fast_day | rosh_chodesh | ad_hoc

When the bulletin is just the routine weekly schedule, emit specialScheduleKind: "regular" with daysOfWeek for the recurring pattern. No validFrom/To.

## Confidence
- 0.9+: clear schedule table/section, times unambiguous
- 0.6-0.9: schedule visible but mixed with other content; minor interpretation needed
- 0.4-0.6: partial / messy / mixed signals — reviewer should look
- < 0.4: PDF doesn't appear to have a minyan schedule (maybe a flyer, ad, donation appeal, etc.)

If you emit zero rules: confidence should be ≤0.3.

Output ONLY the JSON.`;

export interface PdfExtractionResult {
  extraction: Extraction;
  model: "claude-haiku-4-5" | "claude-sonnet-4-6";
  pdfUrl: string;
  usage: {
    haiku: TokenUsage;
    sonnet?: TokenUsage;
  };
}

interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}

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

async function callClaude(
  model: "claude-haiku-4-5" | "claude-sonnet-4-6",
  pdfBase64: string,
): Promise<{ extraction: Extraction; usage: TokenUsage }> {
  const r = await getClient().messages.create({
    model,
    max_tokens: 6_000,
    system: [
      { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
    ],
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: pdfBase64,
            },
          },
          {
            type: "text",
            text: "Extract the minyan schedule from this PDF. Output ONLY a JSON object matching the schema. No prose preamble, no markdown fences.",
          },
        ],
      },
    ],
  });

  const textBlock = r.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error(`${model} returned no text block.`);
  }
  const fullText = textBlock.text;
  const json = extractJsonObject(fullText);
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new Error(
      `${model} returned invalid JSON: ${(err as Error).message}. Preview: ${fullText.slice(0, 200)}`,
    );
  }
  const validated = ExtractionSchema.safeParse(parsed);
  if (!validated.success) {
    throw new Error(
      `${model} output failed Zod validation: ${validated.error.message}`,
    );
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

export async function extractFromPdfUrl(
  pdfUrl: string,
): Promise<PdfExtractionResult> {
  // Fetch the PDF ourselves (UA fallback for WAF/bot blocks) and send as
  // base64. Claude's URL fetcher respects robots.txt; ShulCloud's CDN
  // disallows automated agents there, but daveners are legitimately
  // viewing the shul's published bulletin.
  const fetched = await fetchBinary(pdfUrl, {
    timeoutMs: 25_000,
    accept: "application/pdf",
  });
  if (!fetched.ok || !fetched.bytes) {
    throw new Error(
      `PDF fetch failed for ${pdfUrl}: HTTP ${fetched.status}${
        fetched.fellBackToBrowserUa ? " (after browser-UA fallback)" : ""
      }`,
    );
  }
  const pdfBase64 = fetched.bytes.toString("base64");

  const haiku = await callClaude("claude-haiku-4-5", pdfBase64);
  if (haiku.extraction.confidence >= HAIKU_CONFIDENCE_FLOOR) {
    return {
      extraction: haiku.extraction,
      model: "claude-haiku-4-5",
      pdfUrl,
      usage: { haiku: haiku.usage },
    };
  }
  // Skip Sonnet when Haiku is sure the PDF has no schedule. Saves
  // ~$0.05/PDF on bulletins that are mostly community announcements.
  if (
    haiku.extraction.rules.length === 0 &&
    haiku.extraction.confidence < 0.2
  ) {
    return {
      extraction: haiku.extraction,
      model: "claude-haiku-4-5",
      pdfUrl,
      usage: { haiku: haiku.usage },
    };
  }
  const sonnet = await callClaude("claude-sonnet-4-6", pdfBase64);
  const winner =
    sonnet.extraction.confidence > haiku.extraction.confidence ? sonnet : haiku;
  return {
    extraction: winner.extraction,
    model: winner === sonnet ? "claude-sonnet-4-6" : "claude-haiku-4-5",
    pdfUrl,
    usage: { haiku: haiku.usage, sonnet: sonnet.usage },
  };
}
