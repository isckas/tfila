// Manually exercise the LLM extractor against a real shul URL without
// touching the database. Use this to ground-truth the extraction before
// wiring the submission form (PR 6).
//
//   ANTHROPIC_API_KEY=... npx tsx scripts/test-llm-extract.ts <url>
//
// Outputs: confidence, reasoning, rule count, sample rules, token usage.

import "dotenv/config";
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { fetchHtml } from "../lib/scrapers/fetch";
import { extractFromHtml, ExtractionError } from "../lib/llm/extract";

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error("Usage: tsx scripts/test-llm-extract.ts <url>");
    process.exit(2);
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY is not set. Add it to .env.local.");
    process.exit(2);
  }

  console.log(`Fetching ${url} ...`);
  const fetched = await fetchHtml(url, { timeoutMs: 20_000 });
  if (!fetched.ok) {
    console.error(`Fetch failed: HTTP ${fetched.status}`);
    process.exit(1);
  }
  console.log(
    `  ${fetched.html.length.toLocaleString()} chars · final URL: ${fetched.finalUrl}`,
  );

  console.log("\nRunning Haiku 4.5 first, Sonnet 4.6 fallback if low confidence ...");
  const result = await extractFromHtml(fetched.html);

  console.log("\n──────── Extraction ────────");
  console.log("Model used    :", result.model);
  console.log("Confidence    :", result.extraction.confidence.toFixed(2));
  console.log("Page hash     :", result.pageContentHash.slice(0, 12) + "...");
  if (result.extraction.shulName) {
    console.log("Shul (detected):", result.extraction.shulName);
  }
  if (result.extraction.shulAddress) {
    console.log("Address       :", result.extraction.shulAddress);
  }
  console.log("\nReasoning:");
  console.log("  " + result.extraction.reasoning);

  console.log(`\n──────── ${result.extraction.rules.length} rule(s) ────────`);
  for (const r of result.extraction.rules) {
    const days = r.daysOfWeek ? `days=${JSON.stringify(r.daysOfWeek)}` : "(no days)";
    const time =
      r.time.kind === "fixed"
        ? `clock=${r.time.clock}`
        : `${r.time.anchor}${r.time.offsetMin >= 0 ? "+" : ""}${r.time.offsetMin}m`;
    const tag = r.specialScheduleKind === "regular" ? "" : ` [${r.specialScheduleKind}]`;
    const range =
      r.validFrom || r.validTo ? ` (${r.validFrom ?? "-"}..${r.validTo ?? "-"})` : "";
    const notes = r.notes ? `  // ${r.notes}` : "";
    console.log(
      `  ${r.tefillah.padEnd(10)}  ${days.padEnd(28)}  ${time.padEnd(20)}${tag}${range}${notes}`,
    );
  }

  console.log("\n──────── Token usage ────────");
  const formatUsage = (u: typeof result.usage.haiku) =>
    `in=${u.inputTokens} (cache-read=${u.cacheReadInputTokens}, cache-write=${u.cacheCreationInputTokens}) · out=${u.outputTokens}`;
  console.log("Haiku  :", formatUsage(result.usage.haiku));
  if (result.usage.sonnet) {
    console.log("Sonnet :", formatUsage(result.usage.sonnet));
  }

  process.exit(0);
}

main().catch((err) => {
  if (err instanceof ExtractionError) {
    console.error("\nExtractionError:", err.message);
    if (err.cause) console.error("Cause:", err.cause);
  } else {
    console.error("\nFATAL:", err);
  }
  process.exit(1);
});
