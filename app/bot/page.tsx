import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "About Tfila-Bot",
  description:
    "Tfila-Bot is the automated scraper that keeps tfila.co's minyan times current.",
};

export default function BotPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-12 prose prose-neutral">
      {/* UI-4: home link so /bot isn't a dead-end. */}
      <Link href="/" className="text-sm text-neutral-500 no-underline hover:underline">
        ← tfila.co
      </Link>
      <h1>About Tfila-Bot</h1>

      <p>
        <strong>tfila.co</strong> is a directory of Jewish shul minyan times. To
        keep schedules current without burdening volunteer admins, we run an
        automated scraper called <code>Tfila-Bot/1.0</code> that reads
        publicly-published times from shul websites on a weekly schedule.
      </p>

      <h2>How to identify us</h2>
      <p>Our User-Agent string is:</p>
      <pre>
        Tfila-Bot/1.0 (+https://tfila.co/bot; contact:hello@tfila.co)
      </pre>

      <h2>What we do</h2>
      <ul>
        <li>Fetch publicly-accessible pages on shul websites that list minyan times.</li>
        <li>Respect <code>robots.txt</code>. If you disallow our path, we will not visit it.</li>
        <li>Send <code>If-None-Match</code> / <code>If-Modified-Since</code> headers so we don&apos;t re-download unchanged pages.</li>
        <li>Limit concurrency per host so we never burden a single web server.</li>
      </ul>

      <h2>What we don&apos;t do</h2>
      <ul>
        <li>Crawl pages outside of what&apos;s needed to extract minyan times.</li>
        <li>Collect, store, or surface congregant personal information.</li>
        <li>Republish full page content. We extract structured times only.</li>
      </ul>

      <h2>Data retention</h2>
      <p>
        We store the raw HTML we fetched (used for re-processing when we improve
        our extractor) and the parsed schedule. We do not retain personally
        identifying information from the source page.
      </p>

      <h2>Contact</h2>
      <p>
        Questions, removal requests, or scraping concerns:{" "}
        <a href="mailto:hello@tfila.co">hello@tfila.co</a>
      </p>
    </main>
  );
}
