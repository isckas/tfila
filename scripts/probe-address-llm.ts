import "dotenv/config";
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { fetchHtml } from "../lib/scrapers/fetch";
import Anthropic from "@anthropic-ai/sdk";

async function main() {
  const url = process.argv[2] ?? "https://www.jewishdowntown.org/";
  const f = await fetchHtml(url, { timeoutMs: 20_000 });
  console.log(`Fetched ${f.html.length} chars (status ${f.status}) → ${f.finalUrl}`);
  if (!f.ok) return;

  const client = new Anthropic();
  const r = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 600,
    system:
      'You extract the primary street address of a Jewish shul from HTML. Output ONLY a JSON object: {"address": "string or null", "confidence": 0-1, "reasoning": "string"}. No prose, no markdown.',
    messages: [{ role: "user", content: [{ type: "text", text: f.html.slice(0, 60_000) }] }],
  });
  for (const b of r.content) {
    if (b.type === "text") {
      console.log("─── RAW LLM OUTPUT ───");
      console.log(b.text);
      console.log("─── END ───");
    }
  }
  console.log("Tokens: in=", r.usage.input_tokens, "out=", r.usage.output_tokens);
}
main().catch((e) => {
  console.error("ERR:", e);
  process.exit(1);
});
