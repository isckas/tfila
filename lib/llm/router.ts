// Page-type classifier. Runs BEFORE extraction in the v2 pipeline.
// One cheap Haiku call classifies the input into:
//   - weekly_schedule:    standard weekly tfila page → full extraction
//   - yom_tov_special:    YT / fast / Selichos / Yamim Tovim → variant prompt
//   - calendar_widget:    JS-rendered widget → re-render via Browserless
//   - about_marketing:    About / Contact / Donate / News → skip extraction
//   - blog_news:          single article → skip extraction
//   - error_or_empty:     404 / stub → mark unsupported
//   - other:              unclear → fall through to main prompt
//
// Saves cost on the 10-20% of pages that aren't schedules + improves
// quality on specialized pages via the variant prompt.
//
// Per EXTRACTION-ONE-SHOT-PLAN.md → "Router — cheap pre-classification".

import Anthropic from "@anthropic-ai/sdk";

export type PageType =
  | "weekly_schedule"
  | "yom_tov_special"
  | "calendar_widget"
  | "about_marketing"
  | "blog_news"
  | "error_or_empty"
  | "other";

export interface RouterResult {
  pageType: PageType;
  /** One-line reasoning from Claude. */
  reasoning: string;
  /** Approximate cost of this routing call (input tokens × Haiku rate). */
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens: number;
    cacheReadInputTokens: number;
  };
}

/** When to short-circuit and skip the full extraction. */
export function shouldSkipExtraction(t: PageType): boolean {
  return t === "about_marketing" || t === "blog_news" || t === "error_or_empty";
}

/** When the cascade should re-render (currently in HTML, needs JS). */
export function shouldRerenderJs(t: PageType): boolean {
  return t === "calendar_widget";
}

const SYSTEM_PROMPT = `You classify pages from Jewish shul websites for an extraction pipeline. You read the page content (markdown or HTML) and emit a single classification.

Classify into ONE of:
- weekly_schedule:    The page is a regular weekly minyan / tfila schedule. Multiple tefillah times listed for weekdays / Shabbos.
- yom_tov_special:    The page is specifically for a Yom Tov, fast day, Selichos, Yamim Tovim, or similar date-bounded special schedule. Times tied to specific dates.
- calendar_widget:    The page has an embedded calendar widget (ShulCloud, Google Calendar iframe) and the visible content is sparse — the schedule lives behind JS that hasn't rendered.
- about_marketing:    The page is About / Contact / Mission / Donate / Membership / Staff. No minyan times present.
- blog_news:          The page is a single article, news post, sermon, event announcement. No schedule.
- error_or_empty:     404, empty stub, "page not found", access denied, or near-empty page.
- other:              Doesn't fit cleanly. Could still be a schedule; fall through to main extraction.

Output via the classify_page tool. Add a 1-sentence reasoning.`;

const CLASSIFY_TOOL: Anthropic.Messages.Tool = {
  name: "classify_page",
  description:
    "Emit the page classification with a 1-sentence reason. Use exactly one of the allowed pageType values.",
  input_schema: {
    type: "object",
    properties: {
      pageType: {
        type: "string",
        enum: [
          "weekly_schedule",
          "yom_tov_special",
          "calendar_widget",
          "about_marketing",
          "blog_news",
          "error_or_empty",
          "other",
        ],
      },
      reasoning: {
        type: "string",
        maxLength: 200,
        description: "One sentence on why you picked this category.",
      },
    },
    required: ["pageType", "reasoning"],
  },
};

const MAX_INPUT_CHARS = 20_000;

let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (_client) return _client;
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }
  _client = new Anthropic();
  return _client;
}

/**
 * Classify the input. Costs ~$0.001 (Haiku, ~3-5K input tokens after
 * truncation, ~50 output tokens). Always returns SOMETHING — defaults
 * to "other" on errors so the cascade still proceeds.
 */
export async function classifyPage(input: string): Promise<RouterResult> {
  // Truncate aggressively — the classifier only needs the page's gist,
  // not the full content. Saves cost.
  const truncated =
    input.length > MAX_INPUT_CHARS ? input.slice(0, MAX_INPUT_CHARS) : input;

  let response: Anthropic.Messages.Message;
  try {
    response = await getClient().messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 200,
      system: SYSTEM_PROMPT,
      tools: [CLASSIFY_TOOL],
      tool_choice: { type: "tool", name: "classify_page" },
      messages: [
        {
          role: "user",
          content:
            input.length > MAX_INPUT_CHARS
              ? `[Note: input truncated to ${MAX_INPUT_CHARS} chars]\n\n${truncated}`
              : truncated,
        },
      ],
    });
  } catch (err) {
    // On error, return "other" so the cascade falls through to main extraction.
    return {
      pageType: "other",
      reasoning: `classifier error: ${(err as Error).message.slice(0, 100)}`,
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
      },
    };
  }

  // Extract tool-use result
  const toolUse = response.content.find(
    (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use",
  );
  if (!toolUse || toolUse.name !== "classify_page") {
    return {
      pageType: "other",
      reasoning: "router: no tool_use block in response",
      usage: extractUsage(response),
    };
  }

  const args = toolUse.input as { pageType: PageType; reasoning: string };
  return {
    pageType: args.pageType,
    reasoning: args.reasoning,
    usage: extractUsage(response),
  };
}

function extractUsage(
  r: Anthropic.Messages.Message,
): RouterResult["usage"] {
  return {
    inputTokens: r.usage.input_tokens,
    outputTokens: r.usage.output_tokens,
    cacheCreationInputTokens: r.usage.cache_creation_input_tokens ?? 0,
    cacheReadInputTokens: r.usage.cache_read_input_tokens ?? 0,
  };
}
