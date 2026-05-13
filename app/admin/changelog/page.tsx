import Link from "next/link";
import { loadChangelog } from "@/lib/changelog";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Changelog · tfila admin",
};

export default async function AdminChangelogPage() {
  const { versions } = await loadChangelog();
  const current = versions[0] ?? null;

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <header className="mb-6 flex items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900">
            Changelog
          </h1>
          <p className="mt-1 text-sm text-neutral-600">
            Day-versioned log of features, functions, and stack/code notes.
            New versions are written automatically at midnight ET from the
            day&apos;s commits.
          </p>
        </div>
        {current && (
          <span className="shrink-0 rounded-full bg-amber-100 px-3 py-1 text-sm font-semibold text-amber-900 ring-1 ring-amber-300">
            Current: {current.version}
          </span>
        )}
      </header>

      {versions.length === 0 ? (
        <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-6 text-sm text-neutral-600">
          No versions parsed from{" "}
          <code className="rounded bg-neutral-100 px-1.5 py-0.5">CHANGELOG.md</code>
          . Add an entry like{" "}
          <code className="rounded bg-neutral-100 px-1.5 py-0.5">## v1 — YYYY-MM-DD</code>{" "}
          to the file.
        </div>
      ) : (
        <ol className="space-y-6">
          {versions.map((v) => (
            <li
              key={v.version}
              className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm"
            >
              <header className="mb-3 flex flex-wrap items-baseline justify-between gap-3 border-b border-neutral-100 pb-3">
                <h2 className="text-xl font-semibold tracking-tight text-neutral-900">
                  {v.version}
                </h2>
                {v.date && (
                  <span className="text-sm tabular-nums text-neutral-500">
                    {v.date}
                  </span>
                )}
              </header>

              {v.intro && (
                <p className="mb-4 whitespace-pre-line text-sm text-neutral-700">
                  {v.intro}
                </p>
              )}

              {v.sections.length === 0 ? (
                <pre className="overflow-x-auto rounded bg-neutral-50 p-3 text-xs text-neutral-700">
                  {v.raw}
                </pre>
              ) : (
                <div className="space-y-4">
                  {v.sections.map((s) => (
                    <section key={s.heading}>
                      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                        {s.heading}
                      </h3>
                      {s.bullets.length === 0 ? (
                        <p className="text-xs italic text-neutral-400">
                          (no items)
                        </p>
                      ) : (
                        <ul className="space-y-1.5 text-sm text-neutral-800">
                          {s.bullets.map((b, i) => (
                            <li
                              key={i}
                              className="flex gap-2 leading-relaxed"
                            >
                              <span aria-hidden className="text-neutral-400">
                                ·
                              </span>
                              <span
                                className="whitespace-pre-line"
                                dangerouslySetInnerHTML={{
                                  __html: renderInlineMarkdown(b),
                                }}
                              />
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ol>
      )}

      <footer className="mt-8 text-xs text-neutral-500">
        Source:{" "}
        <code className="rounded bg-neutral-100 px-1.5 py-0.5">CHANGELOG.md</code>{" "}
        at repo root. Edit there for permanent changes; the midnight cron only
        appends new versions and never rewrites past ones.{" "}
        <Link href="/admin" className="underline-offset-2 hover:underline">
          ← admin home
        </Link>
      </footer>
    </div>
  );
}

/**
 * Very small inline-markdown renderer: bold (**x**), inline code (`x`),
 * and bare URLs. Anything else passes through. Keeps the admin page
 * presentable without pulling in a full markdown library for the
 * tiny set of inline features changelog bullets actually use.
 */
function renderInlineMarkdown(text: string): string {
  // Escape HTML first
  let out = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  // Inline code: `…`
  out = out.replace(
    /`([^`]+)`/g,
    '<code class="rounded bg-neutral-100 px-1 py-0.5 font-mono text-[12px] text-neutral-800">$1</code>',
  );
  // Bold: **…**
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong class="font-semibold">$1</strong>');
  // Bare URLs (http or https) — only when not already inside an href.
  out = out.replace(
    /(\b)(https?:\/\/[^\s<>"')]+)/g,
    '$1<a href="$2" target="_blank" rel="noopener noreferrer" class="break-all text-amber-800 underline-offset-2 hover:underline">$2</a>',
  );
  return out;
}
