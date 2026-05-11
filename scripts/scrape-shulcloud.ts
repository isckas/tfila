import "dotenv/config";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fetchHtml } from "../lib/scrapers/fetch";
import { extractFromHtml } from "../lib/scrapers/extract";
import { extractFromShulCloudCalendar } from "../lib/scrapers/shulcloud-calendar";

const INPUT = join(process.cwd(), "data", "shulcloud-shuls.json");
const OUTPUT = join(process.cwd(), "data", "scrape-results.json");

const CALENDAR_PATHS = ["/calendar", "/calendar.html"];

const FALLBACK_PATHS = [
  "/zmanim",
  "/zmanim.html",
  "/davening-schedule.html",
  "/daily-minyan.html",
  "/minyan",
  "/minyan.html",
  "/service-times.html",
  "/services",
  "/services.html",
  "",
];

interface DiscoveredShul {
  url: string;
  finalUrl: string;
  title: string;
  platform: string;
}

interface ScrapeOutput {
  shul: DiscoveredShul;
  pageUrl: string;
  pageStatus: number;
  strategy: "calendar" | "heuristic" | "none";
  candidateLines: number;
  meanConfidence: number;
  minyanim: ReturnType<typeof extractFromHtml>["minyanim"];
  scrapedAt: string;
  needsReview: boolean;
}

async function main() {
  if (process.env.SCRAPE_ENABLED === "false") {
    console.error(
      "SCRAPE_ENABLED=false — aborting. Unset or set to 'true' to allow scraping.",
    );
    process.exit(1);
  }

  const limitArg = process.argv.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? parseInt(limitArg.split("=")[1], 10) : undefined;

  const shuls: DiscoveredShul[] = JSON.parse(await readFile(INPUT, "utf8"));
  const target = limit ? shuls.slice(0, limit) : shuls;
  console.log(`Scraping ${target.length} shul(s)...`);

  const results: ScrapeOutput[] = [];

  for (let i = 0; i < target.length; i++) {
    const shul = target[i];
    const result = await scrapeShul(shul);
    results.push(result);
    console.log(
      `  [${i + 1}/${target.length}] ${shul.url} -> ${result.minyanim.length} minyan(s), strategy=${result.strategy}, conf=${result.meanConfidence.toFixed(2)} ${result.needsReview ? "[REVIEW]" : ""}`,
    );
    await sleep(800);
  }

  await writeFile(OUTPUT, JSON.stringify(results, null, 2) + "\n");
  const totalMinyanim = results.reduce((s, r) => s + r.minyanim.length, 0);
  const reviewCount = results.filter((r) => r.needsReview).length;
  console.log(
    `\nDone. ${totalMinyanim} minyanim across ${results.length} shul(s). ${reviewCount} flagged for review.`,
  );
  console.log(`Wrote ${OUTPUT}`);
}

async function scrapeShul(shul: DiscoveredShul): Promise<ScrapeOutput> {
  const base = shul.finalUrl.replace(/\/$/, "");

  for (const path of CALENDAR_PATHS) {
    try {
      const fetched = await fetchHtml(`${base}${path}`);
      if (!fetched.ok) continue;
      const calExtract = extractFromShulCloudCalendar(fetched.html);
      if (calExtract.minyanim.length > 0) {
        const meanConfidence =
          calExtract.minyanim.reduce((s, m) => s + m.confidence, 0) /
          calExtract.minyanim.length;
        return {
          shul,
          pageUrl: fetched.finalUrl,
          pageStatus: fetched.status,
          strategy: "calendar",
          candidateLines: calExtract.rawEvents.length,
          meanConfidence,
          minyanim: calExtract.minyanim,
          scrapedAt: new Date().toISOString(),
          needsReview: meanConfidence < 0.7,
        };
      }
    } catch {
      /* fall through */
    }
  }

  let bestPage: { url: string; status: number; html: string } | null = null;
  let bestExtract: ReturnType<typeof extractFromHtml> | null = null;

  for (const path of FALLBACK_PATHS) {
    const candidateUrl = path ? `${base}${path}` : base;
    try {
      const fetched = await fetchHtml(candidateUrl);
      if (!fetched.ok) continue;
      const extracted = extractFromHtml(fetched.html);
      if (
        !bestExtract ||
        extracted.minyanim.length > bestExtract.minyanim.length
      ) {
        bestExtract = extracted;
        bestPage = {
          url: fetched.finalUrl,
          status: fetched.status,
          html: fetched.html,
        };
      }
      if (extracted.minyanim.length >= 6) break;
    } catch {
      /* ignore */
    }
  }

  const minyanim = bestExtract?.minyanim ?? [];
  const meanConfidence = bestExtract?.meanConfidence ?? 0;

  return {
    shul,
    pageUrl: bestPage?.url ?? base,
    pageStatus: bestPage?.status ?? 0,
    strategy: minyanim.length > 0 ? "heuristic" : "none",
    candidateLines: bestExtract?.candidateLines ?? 0,
    meanConfidence,
    minyanim,
    scrapedAt: new Date().toISOString(),
    needsReview: minyanim.length === 0 || meanConfidence < 0.6,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
