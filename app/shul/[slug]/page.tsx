import Link from "next/link";
import { notFound } from "next/navigation";
import { getShulBySlug, getLiveRulesForShul } from "@/lib/queries";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps) {
  const { slug } = await params;
  const shul = await getShulBySlug(slug);
  if (!shul) return { title: "Shul not found" };
  return { title: shul.name };
}

export default async function ShulPage({ params }: PageProps) {
  const { slug } = await params;
  const shul = await getShulBySlug(slug);
  if (!shul) notFound();

  const rules = await getLiveRulesForShul(shul.id);

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <Link href="/" className="text-sm text-neutral-600 hover:underline">
        ← back
      </Link>

      <h1 className="mt-3 text-2xl font-semibold">{shul.name}</h1>
      {shul.address && (
        <p className="text-sm text-neutral-600">{shul.address}</p>
      )}
      {shul.nusach && (
        <p className="text-xs uppercase tracking-wide text-neutral-500 mt-1">
          {shul.nusach}
        </p>
      )}

      <p className="mt-2 text-xs text-neutral-500">
        Status: <span className="font-mono">{shul.status}</span>
        {shul.lat != null && shul.lng != null && (
          <> · {shul.lat.toFixed(4)}, {shul.lng.toFixed(4)}</>
        )}
      </p>

      <section className="mt-8">
        <h2 className="text-lg font-medium mb-3">Minyan rules ({rules.length})</h2>
        {rules.length === 0 ? (
          <p className="text-sm text-neutral-600">No rules yet.</p>
        ) : (
          <p className="text-sm text-neutral-600">
            Detailed schedule display coming in a later sprint. {rules.length} rule
            {rules.length === 1 ? "" : "s"} stored.
          </p>
        )}
      </section>

      <p className="mt-10 text-xs text-neutral-500">
        Full public shul page (date picker, distance, map) lands in PR 5.
      </p>
    </main>
  );
}
