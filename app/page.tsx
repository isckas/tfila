import Link from "next/link";
import { countByShulStatus } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const counts = await countByShulStatus();
  const total = counts.reduce((sum, c) => sum + Number(c.n), 0);

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-3xl font-semibold mb-2">tfila.co</h1>
      <p className="text-neutral-600 mb-6">
        Find your next minyan near you. (Coming soon.)
      </p>

      <div className="rounded border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm">
        <p className="text-neutral-700">
          <strong>{total}</strong> shul{total === 1 ? "" : "s"} in the database.
          {" "}Public &ldquo;next minyan near me&rdquo; feed lands in PR 5.
        </p>
      </div>

      <section className="mt-10 text-sm text-neutral-600 space-y-2">
        <p>Want your shul listed? <Link href="/submit" className="underline">Submit your shul</Link> (form coming soon).</p>
        <p>About our scraper: <Link href="/bot" className="underline">/bot</Link></p>
      </section>
    </main>
  );
}
