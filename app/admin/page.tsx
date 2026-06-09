import Link from "next/link";
import { buildAdminFeed, type AdminFeedShulItem } from "@/lib/admin-feed";
import { BulkReextractButton } from "@/components/BulkReextractButton";
import { FreshnessBadge } from "@/components/badges/FreshnessBadge";
import { formatRelativeDays } from "@/lib/format";
import { requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Admin mission-control. Anchored on the two recurring jobs, not the internal
 * state enum:
 *   🆕 NEW    — shuls that have never gone live: review the first extraction.
 *   🔧 BROKEN — shuls that were live and broke: re-extract / fix.
 * Plus thin secondary areas: wrong-time reports + pending discovery candidates.
 * Inline actions are native form-posts to the existing routes (which now
 * Referer-redirect back here). Expand-in-place rule review = Phase 3.
 */
export default async function AdminHomePage({
  searchParams,
}: {
  searchParams: Promise<{
    reextract?: string;
    rebuilt?: string;
    err?: string;
    ran?: string;
    new?: string;
    dup?: string;
    queries?: string;
  }>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const feed = await buildAdminFeed();
  const { counts } = feed;

  return (
    <div className="mx-auto max-w-4xl px-5 py-8">
      <h1 className="text-2xl font-semibold">Admin</h1>
      <p className="mt-1 text-sm text-neutral-600">
        <strong className="text-neutral-900">{counts.new}</strong> new ·{" "}
        <strong className="text-neutral-900">{counts.broken}</strong> broken ·{" "}
        {counts.reports} report{counts.reports === 1 ? "" : "s"} ·{" "}
        {counts.candidates} to add
      </p>

      {/* Banners */}
      {sp.err && <Banner tone="rose">{decodeURIComponent(sp.err)}</Banner>}
      {sp.reextract != null && (
        <Banner tone={sp.reextract === "error" ? "rose" : "emerald"}>
          {sp.reextract === "error"
            ? "Couldn't queue the re-extraction — check the logs."
            : `Queued ${sp.reextract} re-extraction${sp.reextract === "1" ? "" : "s"} (throttled to 3 at a time). They'll move out of Broken as they recover.`}
        </Banner>
      )}
      {sp.rebuilt != null && (
        <Banner tone="emerald">
          Queued a re-extraction — it runs in the background (~1–2 min). No need
          to click again; reload to see the result.
        </Banner>
      )}
      {sp.ran && (
        <Banner tone={Number(sp.queries ?? "0") > 0 ? "amber" : "emerald"}>
          Ran discovery for <strong>{sp.ran}</strong>: {sp.new ?? 0} new,{" "}
          {sp.dup ?? 0} duplicate. New finds are under "Discovery" below.
        </Banner>
      )}

      {counts.broken > 0 && (
        <div className="mt-3">
          <BulkReextractButton count={counts.broken} />
        </div>
      )}

      {/* ─── 🆕 NEW — review first extraction ─────────────────── */}
      <Lane
        title="🆕 New shuls — review"
        hint="New submissions + approved discovery finds. Vet the first extraction, then approve."
        items={feed.newItems}
        empty="✓ No new shuls awaiting review."
      />

      {/* ─── 🔧 BROKEN — needs fixing ─────────────────────────── */}
      <Lane
        title="🔧 Broken — needs fixing"
        hint="Were live, broke on the weekly re-extraction. Re-extract or fix the URL."
        items={feed.brokenItems}
        empty="✓ Nothing broken — every live shul is healthy."
      />

      {/* ─── 🚩 Reports ───────────────────────────────────────── */}
      {feed.reports.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-1 text-sm font-semibold text-neutral-700">
            🚩 Wrong-time reports
          </h2>
          <ul className="space-y-2">
            {feed.reports.map((r) => (
              <li
                key={r.id}
                className="rounded-xl border border-amber-200 bg-amber-50/40 px-4 py-3"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <Link
                    href={`/admin/shul/${r.shulSlug}`}
                    className="font-medium text-neutral-900 underline-offset-2 hover:underline"
                  >
                    {r.shulName}
                  </Link>
                  <span className="text-xs text-neutral-500">
                    {new Date(r.createdAt).toLocaleString()}
                  </span>
                </div>
                <p className="mt-1 text-sm text-neutral-700">
                  {r.note ? `“${r.note}”` : <em className="text-neutral-400">(no note)</em>}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                  <Link
                    href={`/shul/${r.shulSlug}`}
                    target="_blank"
                    className="text-neutral-500 underline-offset-2 hover:underline"
                  >
                    view public page →
                  </Link>
                  <Link
                    href={`/admin/shul/${r.shulSlug}`}
                    className="text-amber-800 underline-offset-2 hover:underline"
                  >
                    fix in detail →
                  </Link>
                  <ResolveForm reportId={r.id} status="resolved" label="Mark resolved" tone="emerald" />
                  <ResolveForm reportId={r.id} status="dismissed" label="Dismiss" tone="neutral" />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ─── 🔍 Discovery — approve to add ───────────────────── */}
      <section className="mt-8">
        <details open={feed.candidates.length > 0}>
          <summary className="cursor-pointer text-sm font-semibold text-neutral-700">
            🔍 Discovery — {feed.candidates.length} to add
            <span className="ml-1 font-normal text-neutral-400">
              (approving creates a shul → shows up under New)
            </span>
          </summary>
          {feed.candidates.length === 0 ? (
            <p className="mt-2 text-sm text-neutral-500">
              None pending.{" "}
              <Link href="/admin/candidates" className="text-amber-800 underline-offset-2 hover:underline">
                Run discovery →
              </Link>
            </p>
          ) : (
            <ul className="mt-2 space-y-2">
              {feed.candidates.map((c) => (
                <li
                  key={c.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-neutral-200 bg-white px-4 py-2.5"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-neutral-900">
                      {c.name}
                    </div>
                    {c.formattedAddress && (
                      <div className="truncate text-xs text-neutral-500">
                        {c.formattedAddress}
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2 text-xs">
                    {c.websiteUri ? (
                      <form method="post" action={`/api/admin/candidate/${c.id}/approve`}>
                        <button
                          type="submit"
                          className="rounded-lg bg-emerald-700 px-3 py-1.5 font-medium text-white hover:bg-emerald-800"
                        >
                          Approve (extract)
                        </button>
                      </form>
                    ) : (
                      <Link
                        href="/admin/candidates"
                        className="rounded-lg border border-neutral-300 px-3 py-1.5 text-neutral-700 hover:bg-neutral-100"
                      >
                        Add URL →
                      </Link>
                    )}
                    <Link
                      href="/admin/candidates"
                      className="text-neutral-500 underline-offset-2 hover:underline"
                    >
                      more
                    </Link>
                  </div>
                </li>
              ))}
              <li className="pt-1 text-xs">
                <Link href="/admin/candidates" className="text-amber-800 underline-offset-2 hover:underline">
                  Run discovery / full triage →
                </Link>
              </li>
            </ul>
          )}
        </details>
      </section>

      {/* ─── Shortcuts ───────────────────────────────────────── */}
      <section className="mt-10 text-xs text-neutral-500">
        <Link href="/admin/shuls" className="underline-offset-2 hover:underline">
          All shuls →
        </Link>
        {" · "}
        <Link href="/admin/candidates" className="underline-offset-2 hover:underline">
          Discovery →
        </Link>
        {" · "}
        <Link href="/admin/changelog" className="underline-offset-2 hover:underline">
          Changelog →
        </Link>
        {" · "}
        <Link href="/" className="underline-offset-2 hover:underline">
          Public feed →
        </Link>
      </section>
    </div>
  );
}

// ─── Lane (a NEW or BROKEN section) ────────────────────────────────────────
function Lane({
  title,
  hint,
  items,
  empty,
}: {
  title: string;
  hint: string;
  items: AdminFeedShulItem[];
  empty: string;
}) {
  return (
    <section className="mt-8">
      <h2 className="text-sm font-semibold text-neutral-700">
        {title}{" "}
        <span className="font-normal text-neutral-400">({items.length})</span>
      </h2>
      <p className="mb-2 text-xs text-neutral-500">{hint}</p>
      {items.length === 0 ? (
        <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-5 text-sm text-neutral-600">
          {empty}
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <ShulRow key={item.shul.id} item={item} />
          ))}
        </ul>
      )}
    </section>
  );
}

// ─── One shul row (NEW or BROKEN) ──────────────────────────────────────────
function ShulRow({ item }: { item: AdminFeedShulItem }) {
  const { shul } = item;
  const meta = shulRowMeta(item);
  const tone: Record<string, string> = {
    rose: "border-l-rose-400",
    amber: "border-l-amber-400",
    neutral: "border-l-neutral-300",
  };
  const verbTone: Record<string, string> = {
    rose: "text-rose-800",
    amber: "text-amber-900",
    neutral: "text-neutral-600",
  };
  return (
    <li
      className={`rounded-xl border border-l-4 border-neutral-200 bg-white px-4 py-3 ${tone[meta.tone]}`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <div className={`text-sm font-semibold ${verbTone[meta.tone]}`}>
            {meta.verb}
          </div>
          <div className="mt-0.5 truncate font-medium text-neutral-900">
            {shul.name}
          </div>
          {shul.address && (
            <div className="truncate text-xs text-neutral-500">{shul.address}</div>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1 text-xs">
          <FreshnessBadge lastFreshAt={shul.lastFreshAt ? new Date(shul.lastFreshAt) : null} />
          {item.lane === "broken" && shul.firstBrokenAt && (
            <span className="rounded bg-rose-50 px-1.5 py-0.5 text-[10px] tracking-wide text-rose-700">
              broken {formatRelativeDays(new Date(shul.firstBrokenAt))}
            </span>
          )}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        {meta.canReview && shul.pendingDataSourceId != null && (
          <Link
            href={`/admin/data-source/${shul.pendingDataSourceId}`}
            className="rounded-lg bg-amber-800 px-3 py-1.5 font-medium text-white hover:bg-amber-900"
          >
            Review {shul.pendingSourceCount > 1 ? `${shul.pendingSourceCount} sources` : "rules"} →
          </Link>
        )}
        {meta.canReextract && shul.submittedUrl && (
          <form method="post" action={`/api/admin/shul/${shul.id}/extract`}>
            <button
              type="submit"
              className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-neutral-700 hover:bg-neutral-100"
            >
              Re-extract
            </button>
          </form>
        )}
        {/* No source URL on file — re-extract can't run; send the admin to
            Details where they can paste one. Otherwise the row's verb
            ("re-extract / fix the URL") would promise an action it can't do. */}
        {meta.canReextract && !shul.submittedUrl && (
          <Link
            href={`/admin/shul/${shul.slug}`}
            className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-1.5 font-medium text-rose-800 hover:bg-rose-100"
          >
            Add a source URL →
          </Link>
        )}
        <Link
          href={`/admin/shul/${shul.slug}`}
          className="rounded-lg border border-neutral-300 px-3 py-1.5 text-neutral-700 hover:bg-neutral-100"
        >
          Details →
        </Link>
        <form method="post" action={`/api/admin/shul/${shul.id}/archive`} className="ml-auto">
          <button
            type="submit"
            className="rounded-lg px-2 py-1.5 text-neutral-400 hover:text-neutral-700 hover:underline"
          >
            Archive
          </button>
        </form>
      </div>
    </li>
  );
}

/** Lane-aware label + which actions a row supports. */
function shulRowMeta(item: AdminFeedShulItem): {
  verb: string;
  tone: "rose" | "amber" | "neutral";
  canReview: boolean;
  canReextract: boolean;
} {
  const { lane, state, shul } = item;
  const hasReviewable = shul.pendingDataSourceId != null;
  if (lane === "new") {
    if (state === "awaiting_extraction") {
      return { verb: "Extracting first run…", tone: "amber", canReview: false, canReextract: true };
    }
    if (hasReviewable) {
      return { verb: "Review first extraction", tone: "amber", canReview: true, canReextract: true };
    }
    return { verb: "First extraction failed — try another URL", tone: "rose", canReview: false, canReextract: true };
  }
  // broken lane (was live)
  if (hasReviewable) {
    return { verb: "Re-extracted — review the fix", tone: "amber", canReview: true, canReextract: true };
  }
  if (state === "stale") {
    return { verb: "Stale — re-extract", tone: "amber", canReview: false, canReextract: true };
  }
  return { verb: "Broke — re-extract or fix the URL", tone: "rose", canReview: false, canReextract: true };
}

function Banner({ tone, children }: { tone: "rose" | "amber" | "emerald"; children: React.ReactNode }) {
  const styles: Record<string, string> = {
    rose: "border-rose-300 bg-rose-50 text-rose-900",
    amber: "border-amber-300 bg-amber-50 text-amber-900",
    emerald: "border-emerald-300 bg-emerald-50 text-emerald-900",
  };
  return (
    <div className={`mt-3 rounded-lg border px-3 py-1.5 text-sm ${styles[tone]}`}>
      {children}
    </div>
  );
}

function ResolveForm({
  reportId,
  status,
  label,
  tone,
}: {
  reportId: number;
  status: "resolved" | "dismissed";
  label: string;
  tone: "emerald" | "neutral";
}) {
  const cls =
    tone === "emerald"
      ? "border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
      : "border-neutral-300 text-neutral-600 hover:bg-neutral-100";
  return (
    <form method="post" action={`/api/admin/report/${reportId}/resolve`} className="inline">
      <input type="hidden" name="status" value={status} />
      <button type="submit" className={`rounded border px-2 py-1 ${cls}`}>
        {label}
      </button>
    </form>
  );
}
