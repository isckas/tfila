import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { helloProofOfLife } from "@/lib/inngest/functions/hello";
import { buildDataSource } from "@/lib/inngest/functions/build-data-source";
import { scrapeOneShul } from "@/lib/inngest/functions/scrape-one-shul";
import { weeklyRescrape } from "@/lib/inngest/functions/weekly-rescrape";
import { dailyRecheck } from "@/lib/inngest/functions/daily-recheck";
import { weeklyRescrapeSummary } from "@/lib/inngest/functions/weekly-rescrape-summary";
import { processEmail } from "@/lib/inngest/functions/process-email";
import { nightlyVersionBump } from "@/lib/inngest/functions/nightly-version-bump";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    helloProofOfLife,
    buildDataSource,
    scrapeOneShul,
    weeklyRescrape,
    dailyRecheck,
    weeklyRescrapeSummary,
    processEmail,
    nightlyVersionBump,
  ],
});
