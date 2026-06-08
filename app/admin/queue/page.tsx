import { listAdminShuls } from "@/lib/queries";
import { deriveAdminShulState } from "@/lib/admin-state";
import { AdminInbox } from "@/components/AdminInbox";
import { requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Filtered view of the admin inbox: only shuls whose derived state is
 * "pending_review" — i.e. they have at least one data_source whose
 * review_status='pending'. One row per shul (vs the old data_source-
 * keyed listing where a shul with 2 pending sources showed up twice).
 *
 * Click → /admin/shul/[slug], where every data_source is shown inline
 * and admin can approve/reject each.
 */
export default async function AdminQueuePage() {
  await requireAdmin();
  const shuls = await listAdminShuls({ q: null, status: null, limit: 500 });
  const inbox = shuls
    .filter((s) => deriveAdminShulState(s) === "pending_review")
    .sort((a, b) => {
      // Oldest pending first — gives the slowest-to-be-reviewed top billing
      const at = (a.lastFreshAt ?? a.submittedAt).valueOf();
      const bt = (b.lastFreshAt ?? b.submittedAt).valueOf();
      return at - bt;
    });

  return (
    <div className="mx-auto max-w-4xl px-5 py-8">
      <h1 className="text-2xl font-semibold">Pending review</h1>
      <p className="mt-1 text-sm text-neutral-600">
        Shuls with at least one extraction waiting for admin sign-off. Click any
        shul to review its rules and approve or reject each data source inline.
      </p>

      <section className="mt-6">
        <AdminInbox
          rows={inbox}
          emptyMessage="✓ No shuls awaiting review."
        />
      </section>
    </div>
  );
}
