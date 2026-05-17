// Shared Anthropic tool-execution loop.
//
// The v2 extraction architecture uses Claude as a small agent — it
// can call tools (lookupHebrewDate, getSunsetRange, etc.) mid-task
// and the loop feeds the results back until the model emits its
// final output via the dedicated emit_extraction tool.
//
// Pattern:
//   1. Send initial message with tools[]
//   2. Model responds with tool_use blocks (executes them)
//   3. Send tool_result blocks back in a new user message
//   4. Repeat until model calls the FINAL tool (emit_extraction)
//      OR hits the max-iterations safety cap
//
// Per EXTRACTION-ONE-SHOT-PLAN.md → "Tool-augmented extraction"
// section. Used by both extract-v2.ts (step 9) and extract-critique.ts
// (step 8).

import Anthropic from "@anthropic-ai/sdk";

export interface AgentLoopArgs {
  model: "claude-haiku-4-5" | "claude-sonnet-4-6";
  system: string | Anthropic.Messages.TextBlockParam[];
  initialMessages: Anthropic.Messages.MessageParam[];
  tools: Anthropic.Messages.Tool[];
  /** Tool dispatchers keyed by tool.name. Throw to bubble errors back to model. */
  toolHandlers: Record<string, (input: unknown) => Promise<unknown>>;
  /** Name of the FINAL tool. When the model calls this, we stop and return its args. */
  finalToolName: string;
  /** Max tool-execution rounds before giving up. Default 8. */
  maxIterations?: number;
  maxTokens?: number;
  /** Optional: enable Anthropic extended-thinking mode (Sonnet only). */
  enableThinking?: boolean;
  thinkingBudgetTokens?: number;
}

export interface AgentLoopResult {
  /** The arguments passed to the final tool call. The caller parses these per its schema. */
  finalToolInput: unknown;
  /** Total usage across every API call in the loop. */
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens: number;
    cacheReadInputTokens: number;
  };
  /** Number of tool-execution rounds before final answer. */
  iterations: number;
  /** Audit trail of which tools were called and with what args. */
  toolCalls: Array<{
    name: string;
    input: unknown;
    /** Stringified for logging — actual return value is the tool_result content. */
    outputPreview: string;
  }>;
}

export class AgentLoopError extends Error {
  constructor(
    message: string,
    public readonly partial?: Partial<AgentLoopResult>,
  ) {
    super(message);
  }
}

let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (_client) return _client;
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }
  _client = new Anthropic();
  return _client;
}

export async function runAgentLoop(
  args: AgentLoopArgs,
): Promise<AgentLoopResult> {
  const maxIterations = args.maxIterations ?? 8;
  const maxTokens = args.maxTokens ?? 8_000;
  const client = getClient();

  // Running totals
  const usage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
  };
  const toolCalls: AgentLoopResult["toolCalls"] = [];
  const messages: Anthropic.Messages.MessageParam[] = [...args.initialMessages];

  // Build createParams once; reuse the same tools/system across iterations.
  const baseParams: Anthropic.Messages.MessageCreateParamsNonStreaming = {
    model: args.model,
    max_tokens: maxTokens,
    system: args.system as never,
    tools: args.tools,
    messages: [],
  };
  if (args.enableThinking) {
    (baseParams as unknown as Record<string, unknown>).thinking = {
      type: "enabled",
      budget_tokens: args.thinkingBudgetTokens ?? 4_000,
    };
  }

  for (let iter = 1; iter <= maxIterations; iter++) {
    const response = await client.messages.create({
      ...baseParams,
      messages,
    });

    // Tally usage
    usage.inputTokens += response.usage.input_tokens;
    usage.outputTokens += response.usage.output_tokens;
    usage.cacheCreationInputTokens += response.usage.cache_creation_input_tokens ?? 0;
    usage.cacheReadInputTokens += response.usage.cache_read_input_tokens ?? 0;

    // Look for the final tool call FIRST — when present, we're done.
    const finalCall = response.content.find(
      (b): b is Anthropic.Messages.ToolUseBlock =>
        b.type === "tool_use" && b.name === args.finalToolName,
    );
    if (finalCall) {
      toolCalls.push({
        name: finalCall.name,
        input: finalCall.input,
        outputPreview: "(final result)",
      });
      return {
        finalToolInput: finalCall.input,
        usage,
        iterations: iter,
        toolCalls,
      };
    }

    // Otherwise execute any mid-task tool_use blocks
    const midToolUses = response.content.filter(
      (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use",
    );
    if (midToolUses.length === 0) {
      // Model returned text without calling any tool. Could mean it's
      // confused about the schema. Push back with a reminder and try
      // one more iteration.
      messages.push({ role: "assistant", content: response.content });
      messages.push({
        role: "user",
        content: `You must complete the task by calling the ${args.finalToolName} tool. Do not respond with plain text.`,
      });
      continue;
    }

    // Execute each tool_use and collect results
    const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
    for (const tu of midToolUses) {
      const handler = args.toolHandlers[tu.name];
      if (!handler) {
        toolResults.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: `Error: tool '${tu.name}' has no handler. Available tools: ${Object.keys(args.toolHandlers).join(", ")}`,
          is_error: true,
        });
        continue;
      }
      try {
        const out = await handler(tu.input);
        const outStr = typeof out === "string" ? out : JSON.stringify(out);
        toolCalls.push({
          name: tu.name,
          input: tu.input,
          outputPreview: outStr.slice(0, 200),
        });
        toolResults.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: outStr,
        });
      } catch (err) {
        const msg = (err as Error).message;
        toolCalls.push({
          name: tu.name,
          input: tu.input,
          outputPreview: `ERROR: ${msg}`,
        });
        toolResults.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: `Tool execution failed: ${msg}`,
          is_error: true,
        });
      }
    }

    // Append assistant's tool_use response + user's tool_result reply
    messages.push({ role: "assistant", content: response.content });
    messages.push({ role: "user", content: toolResults });
  }

  throw new AgentLoopError(
    `Agent loop hit max iterations (${maxIterations}) without calling ${args.finalToolName}`,
    { usage, iterations: maxIterations, toolCalls },
  );
}
