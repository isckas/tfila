import { fetchHtml } from "../lib/scrapers/fetch";
import { extractFromShulCloudCalendar } from "../lib/scrapers/shulcloud-calendar";
import * as cheerio from "cheerio";

const sites = [
  "https://www.ozny.org/calendar",
  "https://www.skylakesynagogue.com/calendar",
  "https://www.bnaidavid.com/calendar",
  "https://thehamptonsynagogue.shulcloud.com/calendar",
];

(async () => {
  for (const url of sites) {
    const r = await fetchHtml(url, { timeoutMs: 12000 });
    const $ = cheerio.load(r.html);
    const triggers = $(".calendar_popover_trigger").length;
    const eventNames = $(".ce_event_name").length;
    const result = extractFromShulCloudCalendar(r.html);

    console.log(`\n=== ${url} ===`);
    console.log(`  triggers=${triggers} eventNames=${eventNames}`);
    console.log(`  raw events parsed: ${result.rawEvents.length}`);
    console.log(`  classified minyanim: ${result.minyanim.length}`);

    if (triggers > 0 && result.rawEvents.length === 0) {
      const first = $(".calendar_popover_trigger").first();
      const popup = first.attr("data-popuphtml") || "";
      console.log(`  first popup raw (300 chars): ${popup.slice(0, 300)}`);
    }
    if (result.rawEvents.length > 0 && result.minyanim.length === 0) {
      console.log(`  raw event names (first 5): ${result.rawEvents.slice(0, 5).map(e => e.name).join(" | ")}`);
    }
    if (result.rawEvents[0]) {
      console.log(`  sample raw: ${JSON.stringify(result.rawEvents[0])}`);
    }
  }
})();
