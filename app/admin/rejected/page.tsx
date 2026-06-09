import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Retired in the mission-control redesign. "No good source" shuls (every
 * data_source rejected, none approved) now surface in the BROKEN lane of the
 * unified inbox at /admin. Kept as a redirect so old links/bookmarks resolve.
 */
export default function AdminRejectedPage() {
  redirect("/admin");
}
