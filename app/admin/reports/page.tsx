import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Retired in the mission-control redesign. Open wrong-time reports are now
 * triaged inline in the unified inbox at /admin (the "Wrong-time reports"
 * strip — resolve/dismiss + re-extract from there). Kept as a redirect so old
 * links/bookmarks resolve.
 */
export default function AdminReportsPage() {
  redirect("/admin");
}
