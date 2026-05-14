import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Submit your shul",
  description:
    "Add your shul to tfila.co. Paste the URL of your schedule page, or subscribe submit@tfila.co to your shul's mailing list.",
};

interface PageProps {
  searchParams: Promise<{ ok?: string; err?: string; slug?: string }>;
}

// The address daveners forward their shul's weekly email to. When prod
// inbound email is wired (Postmark), this should match the Reply-To /
// MAIL FROM address. Until then, surfaced as a string only.
const INBOUND_ADDRESS = "submit@tfila.co";

export default async function SubmitPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const ok = sp.ok === "1";
  const err = sp.err;

  return (
    <main className="mx-auto max-w-2xl px-5 py-10">
      <Link href="/" className="text-xs text-neutral-500 hover:underline">
        ← back to feed
      </Link>

      <h1 className="mt-3 text-3xl font-semibold tracking-tight text-neutral-900">
        Add your shul
      </h1>
      <p className="mt-2 text-neutral-700">
        Two ways. Pick whichever is easier — both end up in the same review
        queue, and no gabbai action is needed for either.
      </p>

      {ok && (
        <div className="mt-6 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          <strong>Got it.</strong> We&apos;re extracting the schedule in the
          background — usually 30 seconds or less. The shul will appear in the
          public feed once an admin approves the extraction.
          {sp.slug && (
            <>
              {" "}You can check on it at{" "}
              <Link
                href={`/shul/${sp.slug}`}
                className="underline-offset-2 hover:underline font-medium"
              >
                /shul/{sp.slug}
              </Link>
              .
            </>
          )}
        </div>
      )}
      {err && (
        <div className="mt-6 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          {err === "invalid"
            ? "That URL doesn't look right. Use a full https:// URL."
            : err === "duplicate"
              ? "We already have this shul. Email us if you want to update it."
              : err === "service-unavailable"
                ? "Our extraction service is temporarily unavailable. Please try again in a few minutes (or use the email option below — it's queued, not synchronous)."
                : err === "extract"
                  ? "We couldn't extract minyan times from that URL. Try the schedule/calendar page directly, or use the email option below."
                  : "Something went wrong. Try again, or email us."}
        </div>
      )}

      {/* ─── Option 1: URL submission ──────────────────────────────── */}
      <section className="mt-8 rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-neutral-900">
          1. Submit your schedule-page URL
        </h2>
        <p className="mt-1 text-sm text-neutral-600">
          The page where the calendar / minyan times actually live —{" "}
          <strong>not the homepage</strong>. For example,{" "}
          <code>your-shul.org/schedule</code> or{" "}
          <code>your-shul.org/davening-times</code>. We&apos;ll find it
          if you paste a homepage, but submitting the direct URL works
          more reliably.
        </p>

        <form method="post" action="/api/submit" className="mt-5 space-y-4">
          <label className="block">
            <span className="text-sm font-medium text-neutral-800">
              Schedule page URL
            </span>
            <input
              type="url"
              name="url"
              required
              placeholder="https://example-shul.org/schedule"
              className="mt-1 block w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-neutral-800">
              Contact email{" "}
              <span className="font-normal text-neutral-500">(optional)</span>
            </span>
            <input
              type="email"
              name="email"
              placeholder="rabbi@example-shul.org"
              className="mt-1 block w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
            />
            <span className="mt-1 block text-xs text-neutral-500">
              Only used if our weekly scrape breaks.
            </span>
          </label>
          <button
            type="submit"
            className="rounded-lg bg-amber-800 px-4 py-2 text-sm font-medium text-white hover:bg-amber-900"
          >
            Submit URL
          </button>
        </form>
      </section>

      {/* ─── Option 2: Subscribe to the mailing list ──────────────── */}
      <section className="mt-6 rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-neutral-900">
          2. Or, subscribe us to your shul&apos;s mailing list
        </h2>
        <p className="mt-1 text-sm text-neutral-600">
          One-time setup. Add the address below as a subscriber on
          your shul&apos;s weekly-newsletter list. Every bulletin
          reaches us automatically; we update the times and skip
          duplicates. Nothing else for you to do.
        </p>

        <div className="mt-5 rounded-lg bg-amber-50 px-4 py-3 ring-1 ring-amber-200">
          <div className="text-xs uppercase tracking-wide text-amber-900">
            Add this address to the mailing list
          </div>
          <div className="mt-1 font-mono text-base font-semibold text-amber-950 select-all">
            {INBOUND_ADDRESS}
          </div>
        </div>

        <details className="mt-5 text-sm">
          <summary className="cursor-pointer font-medium text-neutral-800">
            Don&apos;t know how to subscribe? Quick guide
          </summary>
          <div className="mt-3 space-y-3 text-sm text-neutral-700">
            <p>
              Most shul mailing lists have a public signup form on the
              shul&apos;s website &mdash; usually a &ldquo;Subscribe&rdquo; or
              &ldquo;Newsletter&rdquo; link in the footer.
            </p>
            <ol className="ml-5 list-decimal space-y-1 text-sm">
              <li>
                Find your shul&apos;s newsletter signup. Common spots:
                footer link, sidebar widget, or a separate /subscribe page.
              </li>
              <li>
                Enter <code className="font-mono">{INBOUND_ADDRESS}</code>{" "}
                as the email address. Name can be{" "}
                <em>&ldquo;tfila.co indexer&rdquo;</em> or anything;
                doesn&apos;t matter.
              </li>
              <li>
                Confirm any double-opt-in email if the list sends one
                &mdash; we&apos;ll see it and auto-confirm.
              </li>
            </ol>
            <p className="text-xs text-neutral-500">
              No public signup form? Ask your gabbai to add us, or
              forward us a single bulletin via the URL option above
              while you sort the subscription out.
            </p>
          </div>
        </details>

        <p className="mt-5 text-xs text-neutral-500">
          The shul&apos;s mailing-list address becomes our source of
          record. Future bulletins from the same sender keep updating
          the same shul &mdash; no duplicate entries.
        </p>
      </section>

      <p className="mt-8 text-xs text-neutral-500">
        About what we do:{" "}
        <Link href="/bot" className="underline-offset-2 hover:underline">
          /bot
        </Link>
        .
      </p>
    </main>
  );
}
