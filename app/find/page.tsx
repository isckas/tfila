import Link from "next/link";
import { searchActiveShuls } from "@/lib/queries";

interface PageProps {
  searchParams: Promise<{ q?: string }>;
}

export const dynamic = "force-dynamic";

export default async function FindShulPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const q = sp.q?.trim() ?? "";
  const results = q.length >= 2 ? await searchActiveShuls(q, 50) : [];

  return (
    <main className="mx-auto max-w-2xl px-5 py-10">
      <Link href="/" className="text-xs text-neutral-500 hover:underline">
        ← home
      </Link>

      <h1 className="mt-3 text-3xl font-semibold tracking-tight text-neutral-900">
        Find a shul
      </h1>
      <p className="mt-1 text-neutral-700">
        Search by name. To find what&apos;s near you instead, use{" "}
        <Link href="/" className="text-amber-800 underline-offset-2 hover:underline">
          the location feed
        </Link>
        .
      </p>

      <form method="get" action="/find" className="mt-6 flex gap-2">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Shul name, e.g. Aish Thornhill"
          required
          autoFocus
          className="flex-1 rounded border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
        />
        <button
          type="submit"
          className="rounded bg-amber-800 px-4 py-2 text-sm font-medium text-white hover:bg-amber-900"
        >
          Search
        </button>
      </form>

      {q.length > 0 && q.length < 2 && (
        <p className="mt-4 text-sm text-neutral-500">
          Type at least 2 characters.
        </p>
      )}

      {q.length >= 2 && (
        <section className="mt-6">
          <p className="text-xs text-neutral-500">
            {results.length} match{results.length === 1 ? "" : "es"} for &ldquo;
            {q}&rdquo;
          </p>
          {results.length === 0 ? (
            <div className="mt-3 rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-6 text-sm text-neutral-600">
              No active shuls matching that name. Try a partial name, or{" "}
              <Link href="/submit" className="text-amber-800 underline-offset-2 hover:underline">
                submit yours
              </Link>
              .
            </div>
          ) : (
            <ul className="mt-3 space-y-2">
              {results.map((s) => (
                <li key={s.id}>
                  <Link
                    href={`/shul/${s.slug}`}
                    className="block rounded-xl border border-neutral-200 bg-white px-4 py-3 hover:border-neutral-300 hover:bg-neutral-50"
                  >
                    <div className="font-medium text-neutral-900">{s.name}</div>
                    {s.address && (
                      <div className="text-sm text-neutral-600">{s.address}</div>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </main>
  );
}
