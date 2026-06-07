"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

export interface LookupShul {
  slug: string;
  name: string;
  address: string | null;
}

interface Props {
  shuls: LookupShul[];
}

const MAX_RESULTS = 8;

/**
 * Look-up card on the home landing. Live fuzzy search across all
 * active shuls, computed client-side from the server-passed list —
 * no API roundtrip per keystroke.
 *
 * The matcher uses subsequence matching (the classic fuzzy-finder
 * algorithm): the query characters must appear in order in the
 * haystack but don't need to be contiguous. So "agdh sth" matches
 * "Agudath South".
 */
export function LookupCard({ shuls }: Props) {
  const [q, setQ] = useState("");
  const trimmed = q.trim();

  const results = useMemo(() => {
    if (!trimmed) return [];
    const needle = trimmed.toLowerCase();
    return shuls
      .map((s) => {
        const hay = (s.name + " " + (s.address ?? "")).toLowerCase();
        const score = fuzzyScore(needle, hay, s.name.toLowerCase());
        return score > 0 ? { ...s, score } : null;
      })
      .filter((r): r is LookupShul & { score: number } => r !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_RESULTS);
  }, [trimmed, shuls]);

  return (
    <div className="flex h-full flex-col rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <span aria-hidden className="text-2xl">
          🔍
        </span>
        <h2 className="text-lg font-semibold text-neutral-900">
          Look up a shul
        </h2>
      </div>
      <p className="mb-3 text-sm text-neutral-600">
        Search by name — matches as you type.
      </p>

      <label htmlFor="lookupcard-q" className="sr-only">
        Shul name to search for
      </label>
      <input
        id="lookupcard-q"
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        aria-label="Shul name"
        placeholder="e.g. Agudah, Young Israel…"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
      />

      {trimmed && (
        <div className="mt-2 max-h-72 overflow-y-auto rounded-lg border border-neutral-200 bg-neutral-50">
          {results.length === 0 ? (
            <div className="px-3 py-2.5 text-xs text-neutral-500">
              No shul matches &ldquo;{trimmed}&rdquo;. Try a different name or{" "}
              <Link
                href="/submit"
                className="text-amber-800 underline-offset-2 hover:underline"
              >
                add it
              </Link>
              .
            </div>
          ) : (
            <ul>
              {results.map((r) => (
                <li
                  key={r.slug}
                  className="border-b border-neutral-200 last:border-b-0"
                >
                  <Link
                    href={`/shul/${r.slug}`}
                    className="block px-3 py-2 hover:bg-white"
                  >
                    <div className="truncate text-sm font-medium text-neutral-900">
                      {r.name}
                    </div>
                    {r.address && (
                      <div className="truncate text-xs text-neutral-500">
                        {r.address}
                      </div>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {!trimmed && (
        <p className="mt-auto pt-3 text-xs text-neutral-400">
          Refreshed every Motzei Shabbat.
        </p>
      )}
    </div>
  );
}

/**
 * Subsequence match scorer. Returns 0 if needle's characters don't
 * appear in haystack in order; otherwise a positive score where:
 *   - Higher is better
 *   - Consecutive matches score higher than spread-out ones
 *   - Word-boundary matches (start of token) get a bonus
 *   - Match in the name (vs. address) gets a bonus
 *   - Earlier matches get a bonus over later ones
 */
function fuzzyScore(needle: string, haystack: string, name: string): number {
  // Cheap pre-check: every needle char must exist somewhere
  for (const c of needle) {
    if (!haystack.includes(c)) return 0;
  }

  // Boost: exact substring match
  let baseBoost = 0;
  if (name.includes(needle)) {
    baseBoost += 200;
    if (name.startsWith(needle)) baseBoost += 100;
  } else if (haystack.includes(needle)) {
    baseBoost += 50;
  }

  // Subsequence walk with consecutive-run bonus
  let ni = 0; // needle index
  let score = 0;
  let consecutive = 0;
  let prevMatched = false;
  for (let hi = 0; hi < haystack.length && ni < needle.length; hi++) {
    const hc = haystack[hi];
    if (hc === needle[ni]) {
      score += 10;
      if (prevMatched) {
        consecutive++;
        score += 10 + consecutive * 2;
      } else {
        consecutive = 0;
      }
      // Word-boundary bonus
      if (hi === 0 || /\s/.test(haystack[hi - 1])) {
        score += 15;
      }
      ni++;
      prevMatched = true;
    } else {
      prevMatched = false;
    }
  }

  if (ni < needle.length) return 0; // didn't find all chars in order

  // Bonus for matching earlier in the string (closer to position 0)
  const firstMatchPenalty = haystack.indexOf(needle[0]);
  score -= Math.min(firstMatchPenalty, 30);

  return score + baseBoost;
}
