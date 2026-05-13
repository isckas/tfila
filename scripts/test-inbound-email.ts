// Posts a synthetic Postmark-shaped forwarded-email payload to the
// local /api/inbound/email endpoint. Verifies the pipeline end-to-end
// (sender extraction → Inngest dispatch → LLM extract → DB persist)
// without needing Postmark + DNS set up.
//
// Run with the dev server running:
//   npm run dev          # in one terminal
//   npx inngest-cli@latest dev   # in another terminal (for the function execution)
//   npx tsx scripts/test-inbound-email.ts   # in a third
//
// Pass --url=https://tfila.vercel.app to test against prod (slow, needs
// real ANTHROPIC_API_KEY in prod env, costs ~$0.025 per run).

import "dotenv/config";
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

const SAMPLE_FORWARDED_EMAIL = `Hi friends - forwarding this from my shul for tfila.co.

---------- Forwarded message ----------
From: Bris Avrohom of Fair Lawn <bulletin@brisavrohomfl.org>
Date: Mon, May 12, 2026 at 7:42 AM
Subject: Weekly Schedule – Parshas Behar
To: Members <list@brisavrohomfl.org>

Dear Friends,

Below is the schedule for this week (Parshas Behar):

WEEKDAY MINYANIM
  Shacharis  Sun       8:00 AM
  Shacharis  Mon-Fri   7:00 AM
  Mincha     Sun-Thu   7:35 PM
  Maariv     Sun-Thu   7:50 PM
  Mincha     Fri       7:30 PM
  Mincha     Shabbos   7:25 PM

SHABBOS
  Shacharis  10:00 AM
  Mincha     18 min before sunset

Kiddush sponsored by the Cohen family in honor of Sara's bat mitzvah.

Daf Yomi at 6:00 AM in the beis medrash, Rabbi Kraft.

Kol tuv,
Gabbai
`;

async function main() {
  const urlFlag = process.argv.find((a) => a.startsWith("--url="));
  const baseUrl = urlFlag ? urlFlag.split("=")[1] : "http://localhost:3000";
  const endpoint = `${baseUrl}/api/inbound/email`;

  const payload = {
    FromName: "Davener Test",
    From: "davener.test@gmail.com",
    To: "submit@tfila.co",
    Subject: "Fwd: Weekly Schedule – Parshas Behar",
    TextBody: SAMPLE_FORWARDED_EMAIL,
    HtmlBody: `<pre>${SAMPLE_FORWARDED_EMAIL}</pre>`,
  };

  console.log(`POSTing synthetic email to ${endpoint}`);
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  console.log(`Status: ${res.status}`);
  console.log(`Body  : ${text}`);
  if (!res.ok) process.exit(1);

  console.log(
    "\nWebhook accepted. Watch the Inngest dev dashboard or your Inngest cloud → Runs to see the function execute and write rules to the DB.",
  );
}
main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
