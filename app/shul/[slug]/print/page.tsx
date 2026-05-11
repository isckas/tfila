import { notFound } from "next/navigation";
import { getShulBySlug } from "@/lib/queries";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export const dynamic = "force-dynamic";

export default async function ShulPrintPage({ params }: PageProps) {
  const { slug } = await params;
  const shul = await getShulBySlug(slug);
  if (!shul) notFound();

  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <h1 className="text-2xl font-semibold">{shul.name}</h1>
      <p className="text-sm text-neutral-500">
        Printable schedule view — full version in PR 5.
      </p>
    </main>
  );
}
