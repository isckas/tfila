import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Submit your shul",
  description:
    "Submit your shul's website. tfila.co will extract the minyan schedule and add it to the directory after review.",
};

interface PageProps {
  searchParams: Promise<{ ok?: string; err?: string }>;
}

export default async function SubmitPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const ok = sp.ok === "1";
  const err = sp.err;

  return (
    <main className="mx-auto max-w-xl px-4 py-10">
      <h1 className="text-2xl font-semibold">Submit your shul</h1>
      <p className="mt-2 text-sm text-neutral-600">
        Drop in the URL of your shul&apos;s website (or schedule page). We&apos;ll
        pull the minyan times, check them, and add the shul to the public
        directory.
      </p>

      {ok && (
        <div className="mt-6 rounded border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          <strong>Got it.</strong> The submission is in the review queue. Once
          approved, the shul will appear in the public feed at tfila.co.
        </div>
      )}

      {err && (
        <div className="mt-6 rounded border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          {err === "invalid"
            ? "That URL doesn't look right. Use a full https:// URL."
            : err === "duplicate"
              ? "We already have this shul. If you want to update its info, email us."
              : err === "extract"
                ? "We couldn't extract minyan times from that URL. Try a different page (e.g. the schedule/calendar page), or email us to add it manually."
                : "Something went wrong. Try again, or email us."}
        </div>
      )}

      <form method="post" action="/api/submit" className="mt-6 space-y-4">
        <label className="block">
          <span className="text-sm font-medium text-neutral-800">Shul website URL</span>
          <input
            type="url"
            name="url"
            required
            placeholder="https://example-shul.org/schedule"
            className="mt-1 block w-full rounded border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
          />
          <span className="mt-1 block text-xs text-neutral-500">
            Use the page that lists weekly minyan times. ShulCloud /calendar
            pages work; so do prose schedule pages.
          </span>
        </label>

        <label className="block">
          <span className="text-sm font-medium text-neutral-800">
            Contact email <span className="font-normal text-neutral-500">(optional)</span>
          </span>
          <input
            type="email"
            name="email"
            placeholder="rabbi@example-shul.org"
            className="mt-1 block w-full rounded border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
          />
          <span className="mt-1 block text-xs text-neutral-500">
            We&apos;ll email this address only if our weekly scrape breaks.
          </span>
        </label>

        <button
          type="submit"
          className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
        >
          Submit
        </button>
      </form>

      <p className="mt-8 text-xs text-neutral-500">
        First-time submissions take ~30 seconds to process (we extract the
        minyan times from your page). About what we do:{" "}
        <a href="/bot" className="underline-offset-2 hover:underline">/bot</a>.
      </p>
    </main>
  );
}
