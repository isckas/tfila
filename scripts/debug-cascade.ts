// Reproduce the cascade on a single URL with full error output, no DB writes.
// Run: npx tsx scripts/debug-cascade.ts <url>

import { fetchHtml } from "../lib/scrapers/fetch";
import { renderHtml } from "../lib/scrapers/render";
import { extractFromHtml } from "../lib/llm/extract";

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error("Usage: tsx scripts/debug-cascade.ts <url>");
    process.exit(1);
  }

  // ─── HTML tier ────────────────────────────────────────────
  console.log(`\n=== HTML tier: GET ${url} ===`);
  try {
    const fetched = await fetchHtml(url, { timeoutMs: 20_000 });
    console.log(`  HTTP ${fetched.status}, ${fetched.html.length} bytes, fellBackToBrowserUa=${fetched.fellBackToBrowserUa}`);
    if (fetched.ok) {
      try {
        const r = await extractFromHtml(fetched.html);
        console.log(
          `  extract OK: ${r.extraction.rules.length} rules, conf=${r.extraction.confidence.toFixed(2)}, model=${r.model}`,
        );
        console.log(`  reasoning: ${r.extraction.reasoning.slice(0, 200)}`);
      } catch (err) {
        console.log(`  extract THREW: ${(err as Error).message.slice(0, 500)}`);
      }
    }
  } catch (err) {
    console.log(`  fetch THREW: ${(err as Error).message}`);
  }

  // ─── JS-rendered tier ─────────────────────────────────────
  console.log(`\n=== JS-rendered tier: Browserless(${url}) ===`);
  const rendered = await renderHtml(url, { timeoutMs: 30_000 });
  console.log(`  ok=${rendered.ok}, status=${rendered.status}, bytes=${rendered.html?.length ?? 0}`);
  if (rendered.error) console.log(`  render error: ${rendered.error}`);
  if (rendered.html) {
    try {
      const r = await extractFromHtml(rendered.html);
      console.log(
        `  extract OK: ${r.extraction.rules.length} rules, conf=${r.extraction.confidence.toFixed(2)}, model=${r.model}`,
      );
      console.log(`  reasoning: ${r.extraction.reasoning.slice(0, 200)}`);
    } catch (err) {
      console.log(`  extract THREW: ${(err as Error).message}`);
      // Also print the stack to see where exactly
      console.log(`  stack: ${(err as Error).stack?.split("\n").slice(0, 6).join("\n         ")}`);
    }
  }

  // ─── PDF candidate inventory ──────────────────────────────
  console.log(`\n=== PDF link inventory (from original HTML) ===`);
  try {
    const fetched = await fetchHtml(url, { timeoutMs: 20_000 });
    if (fetched.ok) {
      // Permissive regex — just find href values ending in .pdf, no inner-text requirement.
      const matches = Array.from(
        fetched.html.matchAll(/href=["']([^"']+\.pdf[^"']*)["']/gi),
      );
      console.log(`  found ${matches.length} pdf hrefs`);
      for (const m of matches.slice(0, 10)) {
        console.log(`    ${m[1]}`);
      }
    }
  } catch (err) {
    console.log(`  inventory failed: ${(err as Error).message}`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("debug failed:", err);
  process.exit(1);
});
