import Link from "next/link";
import { countByShulStatus, listPendingDataSources } from "@/lib/queries";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  pending_review: "Pending review",
  active: "Active",
  broken: "Broken",
  archived: "Archived",
  unsupported: "Unsupported",
};

export default async function AdminHomePage() {
  const [statusCounts, pending] = await Promise.all([
    countByShulStatus(),
    listPendingDataSources(),
  ]);
  const total = statusCounts.reduce((s, c) => s + Number(c.n), 0);

  return (
    <div className="mx-auto max-w-3xl px-5 py-8">
      <h1 className="text-2xl font-semibold">Admin</h1>
      <p className="mt-1 text-sm text-neutral-600">
        Manage shuls, review submissions, and run the pipeline.
      </p>

      {/* Quick counts */}
      <section className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Total shuls" value={total} href="/admin/shuls" />
        <Tile
          label="Pending review"
          value={pending.length}
          href="/admin/queue"
          highlight={pending.length > 0}
        />
        {statusCounts.map((c) => (
          <Tile
            key={c.status}
            label={STATUS_LABEL[c.status] ?? c.status}
            value={Number(c.n)}
            href={`/admin/shuls?status=${c.status}`}
          />
        ))}
      </section>

      {/* Big buttons */}
      <section className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <BigLink
          href="/admin/queue"
          title="Review queue"
          desc="Approve or reject newly-extracted data sources."
          badge={pending.length > 0 ? `${pending.length} pending` : null}
        />
        <BigLink
          href="/admin/shuls"
          title="All shuls"
          desc="Search, filter, drill into any shul."
        />
      </section>

      {/* Other shortcuts */}
      <section className="mt-6 text-sm">
        <h2 className="mb-2 text-xs uppercase tracking-wide text-neutral-500">
          Other
        </h2>
        <ul className="space-y-1 text-neutral-700">
          <li>
            <Link
              href="/admin/shuls?status=broken"
              className="underline-offset-2 hover:underline"
            >
              Broken shuls →
            </Link>
          </li>
          <li>
            <Link href="/bot" className="underline-offset-2 hover:underline">
              Public /bot page →
            </Link>
          </li>
          <li>
            <Link href="/" className="underline-offset-2 hover:underline">
              Public feed (as a davener sees it) →
            </Link>
          </li>
        </ul>
      </section>
    </div>
  );
}

function Tile({
  label,
  value,
  href,
  highlight,
}: {
  label: string;
  value: number;
  href: string;
  highlight?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`block rounded-xl border px-4 py-3 hover:bg-neutral-50 ${
        highlight
          ? "border-amber-300 bg-amber-50"
          : "border-neutral-200 bg-white"
      }`}
    >
      <div className="text-xs uppercase tracking-wide text-neutral-500">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-neutral-900">
        {value}
      </div>
    </Link>
  );
}

function BigLink({
  href,
  title,
  desc,
  badge,
}: {
  href: string;
  title: string;
  desc: string;
  badge?: string | null;
}) {
  return (
    <Link
      href={href}
      className="block rounded-xl border border-neutral-200 bg-white p-5 hover:border-amber-300 hover:shadow-sm"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-base font-medium text-neutral-900">{title}</span>
        {badge && (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900">
            {badge}
          </span>
        )}
      </div>
      <div className="mt-1 text-sm text-neutral-600">{desc}</div>
    </Link>
  );
}
