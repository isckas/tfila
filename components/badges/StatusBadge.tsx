interface Props {
  status: string;
}

const STATUS_LABELS: Record<string, string> = {
  pending_review: "Pending review",
  active: "Active",
  broken: "Broken",
  archived: "Archived",
  unsupported: "Unsupported",
};

const STYLES: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-800",
  pending_review: "bg-amber-100 text-amber-800",
  broken: "bg-rose-100 text-rose-800",
  archived: "bg-neutral-100 text-neutral-600",
  unsupported: "bg-rose-100 text-rose-900",
};

/**
 * Shared shul.status pill. Was previously duplicated as `StatusPill`
 * on /admin/shul/[slug] and `StatusBadge` on /admin/shuls — same code,
 * same labels, same colors, two definitions.
 */
export function StatusBadge({ status }: Props) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-xs ${STYLES[status] ?? "bg-neutral-100 text-neutral-700"}`}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

export { STATUS_LABELS as SHUL_STATUS_LABELS };
