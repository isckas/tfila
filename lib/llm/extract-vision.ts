// Vision extractor. Some shuls publish their schedule as a single
// raster image (PNG/JPG) — e.g. anash.ca/daven's davening-schedule
// image. Claude reads times directly off the image, including
// handwritten or stylized typography.
//
// Vision is the last-resort tier: more expensive than HTML/PDF and
// occasionally hallucinates structure from unclear images, so the
// extracted rules should always be reviewed.

import Anthropic from "@anthropic-ai/sdk";
import { ExtractionSchema, type Extraction } from "./schema";

// Skip Haiku entirely for vision — Sonnet is the right starting tier
// for image-based schedules. Haiku's vision is too weak to be worth
// the round-trip.
const VISION_MODEL = "claude-sonnet-4-6" as const;

const SYSTEM_PROMPT = String.raw`You are extracting Jewish minyan/tefillah times from an image of a shul's schedule.

INPUT: a single image — typically a printed/typed schedule, sometimes handwritten or a screenshot of a calendar.

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
Schedule images often describe a SPECIFIC WEEK. Look for a parsha name or date range in the image header/footer.

When the image shows a special schedule (Yom Tov, Tisha B'Av, Three Weeks, etc.), emit date-bounded rules with validFrom/validTo and the appropriate specialScheduleKind.

When it's a routine weekly schedule with no special context, emit specialScheduleKind: "regular" + daysOfWeek.

## Be conservative with handwritten / unclear text
If a number is genuinely ambiguous (could be 7:00 or 1:00), prefer to OMIT that rule and lower confidence rather than guess. The reviewer can re-extract.

## Confidence calibration for images
- 0.8-1.0: crisp typed schedule, all rows clearly legible
- 0.5-0.8: legible but stylized (fancy fonts, faded scan, color overlay)
- 0.3-0.5: handwritten or low-res; some uncertainty on times
- < 0.3: image doesn't appear to be a minyan schedule (flyer, ad, photograph)

If you emit zero rules: confidence should be ≤0.3.

Output ONLY the JSON.`;

export interface VisionExtractionResult {
  extraction: Extraction;
  model: typeof VISION_MODEL;
  imageUrl: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens: number;
    cacheReadInputTokens: number;
  };
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

export async function extractFromImageUrl(
  imageUrl: string,
): Promise<VisionExtractionResult> {
  const r = await getClient().messages.create({
    model: VISION_MODEL,
    max_tokens: 6_000,
    system: [
      { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
    ],
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "url", url: imageUrl },
          },
          {
            type: "text",
            text: "Extract the minyan schedule from this image.",
          },
        ],
      },
      { role: "assistant", content: [{ type: "text", text: "{" }] },
    ],
  });

  const textBlock = r.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error(`${VISION_MODEL} returned no text block.`);
  }
  const fullText = "{" + textBlock.text;
  const json = extractJsonObject(fullText);
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new Error(
      `${VISION_MODEL} returned invalid JSON: ${(err as Error).message}. Preview: ${fullText.slice(0, 200)}`,
    );
  }
  const validated = ExtractionSchema.safeParse(parsed);
  if (!validated.success) {
    throw new Error(
      `${VISION_MODEL} output failed Zod validation: ${validated.error.message}`,
    );
  }
  return {
    extraction: validated.data,
    model: VISION_MODEL,
    imageUrl,
    usage: {
      inputTokens: r.usage.input_tokens ?? 0,
      outputTokens: r.usage.output_tokens ?? 0,
      cacheCreationInputTokens: r.usage.cache_creation_input_tokens ?? 0,
      cacheReadInputTokens: r.usage.cache_read_input_tokens ?? 0,
    },
  };
}
