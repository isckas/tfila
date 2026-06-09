import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Retired in the mission-control redesign. "Pending review" shuls now live in
 * the NEW lane of the unified inbox at /admin (review the first extraction
 * inline). Kept as a redirect so old links/bookmarks still resolve.
 */
export default function AdminQueuePage() {
  redirect("/admin");
}
