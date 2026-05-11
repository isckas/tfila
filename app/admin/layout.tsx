import Link from "next/link";
import { requireAdmin } from "@/lib/auth";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireAdmin();

  return (
    <div className="min-h-full">
      <header className="border-b border-neutral-200 bg-neutral-50">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-6 text-sm">
            <Link href="/admin/queue" className="font-semibold">
              tfila admin
            </Link>
            <Link href="/admin/queue" className="text-neutral-600 hover:text-neutral-900">
              Queue
            </Link>
          </div>
          <div className="flex items-center gap-3 text-sm text-neutral-600">
            <span>{session.email}</span>
            <form method="post" action="/api/admin/logout" className="inline">
              <button
                type="submit"
                className="rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <main>{children}</main>
    </div>
  );
}
