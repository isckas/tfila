import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Submit your shul",
  description:
    "Add your shul to tfila.co. Submit a URL once, or just forward your shul's weekly email — we'll do the rest.",
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
          1. Submit a URL
        </h2>
        <p className="mt-1 text-sm text-neutral-600">
          Drop in the URL of your shul&apos;s website (or schedule page).
          We&apos;ll fetch it and extract the minyan times.
        </p>

        <form method="post" action="/api/submit" className="mt-5 space-y-4">
          <label className="block">
            <span className="text-sm font-medium text-neutral-800">
              Shul website URL
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

      {/* ─── Option 2: Forward an email ───────────────────────────── */}
      <section className="mt-6 rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-neutral-900">
          2. Or, forward your shul&apos;s weekly email
        </h2>
        <p className="mt-1 text-sm text-neutral-600">
          You already get the weekly bulletin in your inbox.{" "}
          <strong>Forward it once</strong>, and we&apos;ll learn your shul plus
          extract the schedule. Forward again next week and we&apos;ll just
          update — same shul, no duplicate.
        </p>

        <div className="mt-5 rounded-lg bg-amber-50 px-4 py-3 ring-1 ring-amber-200">
          <div className="text-xs uppercase tracking-wide text-amber-900">
            Forward to
          </div>
          <div className="mt-1 font-mono text-base font-semibold text-amber-950 select-all">
            {INBOUND_ADDRESS}
          </div>
        </div>

        <details className="mt-5 text-sm">
          <summary className="cursor-pointer font-medium text-neutral-800">
            Hate forwarding every week? Set up an auto-forward (one-time, 2 min)
          </summary>
          <div className="mt-3 space-y-3 text-neutral-700">
            <div>
              <p className="font-medium text-neutral-900">Gmail</p>
              <ol className="ml-5 mt-1 list-decimal space-y-0.5 text-xs text-neutral-700">
                <li>Settings (gear) → See all settings</li>
                <li>Filters and Blocked Addresses → Create a new filter</li>
                <li>
                  In <strong>From</strong>: enter your shul&apos;s sender (e.g.{" "}
                  <code>@yourshul.org</code>) → Create filter
                </li>
                <li>
                  Check <strong>Forward it to</strong>:
                  <code className="ml-1">{INBOUND_ADDRESS}</code>
                </li>
              </ol>
            </div>
            <div>
              <p className="font-medium text-neutral-900">Outlook / Hotmail</p>
              <ol className="ml-5 mt-1 list-decimal space-y-0.5 text-xs text-neutral-700">
                <li>Settings → Mail → Rules → Add new rule</li>
                <li>
                  Condition: From contains <code>@yourshul.org</code>
                </li>
                <li>
                  Action: Forward to <code>{INBOUND_ADDRESS}</code>
                </li>
              </ol>
            </div>
          </div>
        </details>

        <p className="mt-5 text-xs text-neutral-500">
          We extract the original sender from your forwarded email&apos;s
          headers. Future emails forwarded from the same original sender go to
          the same shul — even if a different person does the forwarding.
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
