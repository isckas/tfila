import { listAdminShuls } from "@/lib/queries";
import { deriveAdminShulState } from "@/lib/admin-state";
import { AdminInbox } from "@/components/AdminInbox";

export const dynamic = "force-dynamic";

/**
 * Filtered view of the admin inbox: shuls whose every data_source is
 * rejected (zero approved). These shuls have no usable source — admin
 * needs to find a better URL, re-extract from a different angle, or
 * archive the shul. One row per shul.
 *
 * Shuls with both rejected AND approved sources are healthy on the
 * approved side, so they show up in /admin/queue or /admin (active)
 * depending on freshness — not here.
 */
export default async function AdminRejectedPage() {
  const shuls = await listAdminShuls({ q: null, status: null, limit: 500 });
  const inbox = shuls
    .filter((s) => deriveAdminShulState(s) === "no_good_source")
    .sort((a, b) => a.submittedAt.valueOf() - b.submittedAt.valueOf());

  return (
    <div className="mx-auto max-w-4xl px-5 py-8">
      <h1 className="text-2xl font-semibold">No good source</h1>
      <p className="mt-1 text-sm text-neutral-600">
        Shuls where every extracted data source has been rejected and none
        approved. Click into each shul to re-extract from a different URL, or
        archive if the shul can&apos;t be sourced. To see individual rejected
        data sources for a shul that also has approved ones, open the shul
        directly.
      </p>

      <section className="mt-6">
        <AdminInbox
          rows={inbox}
          emptyMessage="✓ No shuls are source-less."
        />
      </section>
    </div>
  );
}
