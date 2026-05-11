import "dotenv/config";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { existsSync } from "node:fs";
import { fingerprint } from "../lib/scrapers/fingerprint";
import { fetchHtml } from "../lib/scrapers/fetch";

const CANDIDATES_FILE = join(process.cwd(), "data", "candidates.txt");
const OUTPUT_FILE = join(process.cwd(), "data", "shulcloud-shuls.json");
const CONCURRENCY = 6;

interface Verified {
  url: string;
  finalUrl: string;
  title: string;
  platform: string;
  confidence: number;
  signals: string[];
  status: number;
  checkedAt: string;
}

async function main() {
  if (!existsSync(CANDIDATES_FILE)) {
    console.error(`Missing ${CANDIDATES_FILE}.`);
    console.error("Create it with one URL per line, then re-run.");
    process.exit(1);
  }
  const raw = await readFile(CANDIDATES_FILE, "utf8");
  const urls = Array.from(
    new Set(
      raw
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#"))
        .map(normalizeUrl),
    ),
  );

  console.log(`Checking ${urls.length} candidate(s)...`);

  const results: Verified[] = [];
  const skipped: { url: string; reason: string }[] = [];

  let cursor = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (cursor < urls.length) {
        const idx = cursor++;
        const url = urls[idx];
        try {
          const r = await fetchHtml(url);
          if (!r.ok) {
            skipped.push({ url, reason: `http ${r.status}` });
            console.log(`  [${idx + 1}/${urls.length}] ${url} -> http ${r.status}`);
            continue;
          }
          const fp = fingerprint(r.html, r.finalUrl);
          if (fp.platform !== "shulcloud") {
            skipped.push({ url, reason: `platform=${fp.platform}` });
            console.log(
              `  [${idx + 1}/${urls.length}] ${url} -> ${fp.platform} (skipped)`,
            );
            continue;
          }
          const title = extractTitle(r.html);
          results.push({
            url,
            finalUrl: r.finalUrl,
            title,
            platform: fp.platform,
            confidence: fp.confidence,
            signals: fp.signals,
            status: r.status,
            checkedAt: new Date().toISOString(),
          });
          console.log(
            `  [${idx + 1}/${urls.length}] ${url} -> shulcloud (${fp.confidence.toFixed(2)})`,
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          skipped.push({ url, reason: `error: ${msg}` });
          console.log(`  [${idx + 1}/${urls.length}] ${url} -> error ${msg}`);
        }
      }
    }),
  );

  await mkdir(dirname(OUTPUT_FILE), { recursive: true });
  await writeFile(OUTPUT_FILE, JSON.stringify(results, null, 2) + "\n");
  console.log(
    `\nVerified ${results.length} ShulCloud shul(s). Skipped ${skipped.length}.`,
  );
  console.log(`Wrote ${OUTPUT_FILE}`);
}

function normalizeUrl(input: string): string {
  let u = input;
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  try {
    const parsed = new URL(u);
    parsed.hash = "";
    parsed.search = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return u;
  }
}

function extractTitle(html: string): string {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? m[1].replace(/\s+/g, " ").trim().slice(0, 200) : "";
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
