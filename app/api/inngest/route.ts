import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { helloProofOfLife } from "@/lib/inngest/functions/hello";
import { buildDataSource } from "@/lib/inngest/functions/build-data-source";
import { scrapeOneShul } from "@/lib/inngest/functions/scrape-one-shul";
import { weeklyRescrape } from "@/lib/inngest/functions/weekly-rescrape";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    helloProofOfLife,
    buildDataSource,
    scrapeOneShul,
    weeklyRescrape,
  ],
});
