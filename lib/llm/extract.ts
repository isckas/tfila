import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";
import { ExtractionSchema, type Extraction } from "./schema";
import { SYSTEM_PROMPT } from "./prompts";

// We send the page HTML up to this many chars to Claude. Beyond this, we
// truncate (and note it in reasoning so the reviewer knows). Most shul
// pages are well under 50K chars; the cap is a safety net.
const MAX_HTML_CHARS = 80_000;

// Confidence below this triggers the Sonnet fallback.
const HAIKU_CONFIDENCE_FLOOR = 0.4;

export interface ExtractionResult {
  /** Validated, parsed output from Claude. */
  extraction: Extraction;
  /** Which model produced the winning result. */
  model: "claude-haiku-4-5" | "claude-sonnet-4-6";
  /** SHA-256 of the input HTML (after truncation), used as a change-detection key. */
  pageContentHash: string;
  /** Token accounting per call (Haiku always; Sonnet only if it ran). */
  usage: {
    haiku: TokenUsage;
    sonnet?: TokenUsage;
  };
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}

export class ExtractionError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
  }
}

let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (_client) return _client;
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new ExtractionError(
      "ANTHROPIC_API_KEY is not set. Add it to .env.local before running the LLM extractor.",
    );
  }
  _client = new Anthropic();
  return _client;
}

function trimHtml(html: string): { html: string; truncated: boolean } {
  if (html.length <= MAX_HTML_CHARS) return { html, truncated: false };
  return { html: html.slice(0, MAX_HTML_CHARS), truncated: true };
}

function hashHtml(html: string): string {
  return createHash("sha256").update(html, "utf8").digest("hex");
}

async function callClaude(
  model: "claude-haiku-4-5" | "claude-sonnet-4-6",
  html: string,
  truncated: boolean,
): Promise<{ extraction: Extraction; usage: TokenUsage }> {
  const client = getClient();
  const userText = truncated
    ? `[NOTE: HTML truncated at ${MAX_HTML_CHARS} chars. Anything past that is missing.]\n\n${html}`
    : html;

  const response = await client.messages.create({
    model,
    max_tokens: 8_000,
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: userText }],
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new ExtractionError(`Model ${model} returned no text block.`);
  }
  const jsonStr = stripJsonFences(textBlock.text);
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(jsonStr);
  } catch (err) {
    throw new ExtractionError(
      `Model ${model} returned invalid JSON: ${(err as Error).message}. Output preview: ${textBlock.text.slice(0, 200)}`,
      err,
    );
  }
  const validated = ExtractionSchema.safeParse(parsedJson);
  if (!validated.success) {
    throw new ExtractionError(
      `Model ${model} output failed Zod validation: ${validated.error.message}`,
      validated.error,
    );
  }

  return {
    extraction: validated.data,
    usage: {
      inputTokens: response.usage.input_tokens ?? 0,
      outputTokens: response.usage.output_tokens ?? 0,
      cacheCreationInputTokens: response.usage.cache_creation_input_tokens ?? 0,
      cacheReadInputTokens: response.usage.cache_read_input_tokens ?? 0,
    },
  };
}

function stripJsonFences(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\n([\s\S]*?)\n```$/);
  return fenced ? fenced[1].trim() : trimmed;
}

export async function extractFromHtml(html: string): Promise<ExtractionResult> {
  const { html: trimmedHtml, truncated } = trimHtml(html);
  const pageContentHash = hashHtml(trimmedHtml);

  const haiku = await callClaude("claude-haiku-4-5", trimmedHtml, truncated);

  if (haiku.extraction.confidence >= HAIKU_CONFIDENCE_FLOOR) {
    return {
      extraction: haiku.extraction,
      model: "claude-haiku-4-5",
      pageContentHash,
      usage: { haiku: haiku.usage },
    };
  }

  // Fallback to Sonnet for low-confidence pages
  const sonnet = await callClaude("claude-sonnet-4-6", trimmedHtml, truncated);
  const winner =
    sonnet.extraction.confidence > haiku.extraction.confidence ? sonnet : haiku;
  return {
    extraction: winner.extraction,
    model: winner === sonnet ? "claude-sonnet-4-6" : "claude-haiku-4-5",
    pageContentHash,
    usage: { haiku: haiku.usage, sonnet: sonnet.usage },
  };
}
