// Focused, cheap LLM call that pulls just a street address out of an
// HTML page. Used by the address-backfill script — full schedule
// extraction (lib/llm/extract.ts) is overkill when we only want
// {address, confidence}.

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

const MAX_HTML_CHARS = 60_000;

export const AddressExtractionSchema = z.object({
  address: z
    .string()
    .max(300)
    .nullable()
    .describe(
      "Full street address as written on the page (street + city + state + zip if visible). Null if no address is clearly visible.",
    ),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe(
      "0-1. 0.9+ when address is unambiguous (clearly the shul's primary address, with street + city). Below 0.5 if address is ambiguous, just a PO box, or only partial.",
    ),
  reasoning: z
    .string()
    .max(1000)
    .describe("Where on the page did you find it (footer/contact section/etc) or why couldn't you find one."),
});

export type AddressExtraction = z.infer<typeof AddressExtractionSchema>;

const SYSTEM_PROMPT = `You extract the primary street address of a Jewish synagogue (shul) from its website HTML.

Look in: header/footer, contact page section, "directions" section, schema.org markup, Google Maps embed alt text, "info@" mailto links nearby.

Return the address as it appears on the page (don't reformat unless splitting onto a single line). Include city/state/zip when visible. US format: "123 Main St, Anytown, NY 11200". UK: "123 High St, London NW11 8AB". Israel: "Rechov Foo 12, Yerushalayim". Etc.

If the page has multiple addresses (e.g. shul has two campuses), return the primary/main one and mention the others in reasoning.

If no address is visible on the page (e.g. it's a calendar-widget page with no contact info), return null and explain in reasoning.

Confidence calibration:
- 0.9+: street + city + state/country, unambiguous
- 0.6-0.9: street + partial location info, or unambiguous but only city/town visible
- 0.3-0.6: only a city/town, or address appears in a non-contact context
- 0.0-0.3: no real address, just a PO box, or you're guessing

Output ONLY a JSON object matching the schema. No prose preamble, no markdown fences.`;

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
  // Strip opening fence (```json or ```)
  t = t.replace(/^```(?:json|JSON)?\s*\r?\n/, "");
  // Strip closing fence
  t = t.replace(/\r?\n\s*```\s*$/, "");
  return t.trim();
}

export async function extractAddressFromHtml(html: string): Promise<{
  extraction: AddressExtraction;
  inputTokens: number;
  outputTokens: number;
}> {
  const truncated = html.length > MAX_HTML_CHARS ? html.slice(0, MAX_HTML_CHARS) : html;
  const response = await getClient().messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 600,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: [{ type: "text", text: truncated }] }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Haiku returned no text block for address extraction.");
  }
  const json = stripJsonFences(textBlock.text);
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new Error(
      `Address-extractor returned invalid JSON: ${(err as Error).message}. Preview: ${textBlock.text.slice(0, 200)}`,
    );
  }
  const result = AddressExtractionSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Address-extractor validation failed: ${result.error.message}. Raw output: ${JSON.stringify(parsed).slice(0, 400)}`,
    );
  }
  return {
    extraction: result.data,
    inputTokens: response.usage.input_tokens ?? 0,
    outputTokens: response.usage.output_tokens ?? 0,
  };
}
