import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { shul } from "@/db/schema";
import { slugify, nameFromTitle } from "@/lib/slug";
import { inngest } from "@/lib/inngest/client";

// Submissions are processed ASYNC. We validate + dedupe + create a
// placeholder shul row + fire an Inngest event in <1s, then return
// success. The Inngest `data-source.requested` function (PR 3) does
// the LLM extraction + persistence in the background, with automatic
// retries if Anthropic is briefly unavailable.
//
// The user sees a fast success page; the shul appears in the public
// feed after the admin approves the extracted data_source.

export const dynamic = "force-dynamic";

function fail(req: Request, code: string): NextResponse {
  return NextResponse.redirect(new URL(`/submit?err=${code}`, req.url), 303);
}

export async function POST(req: Request): Promise<NextResponse> {
  const form = await req.formData();
  const url = (form.get("url") as string | null)?.trim() ?? "";
  const email = (form.get("email") as string | null)?.trim() || null;

  // ─── Validate URL ────────────────────────────────────────────
  let parsed: URL;
  try {
    parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return fail(req, "invalid");
    }
  } catch {
    return fail(req, "invalid");
  }

  // ─── Dedupe ─────────────────────────────────────────────────
  const existing = await db
    .select({ id: shul.id })
    .from(shul)
    .where(eq(shul.submittedUrl, url))
    .limit(1);
  if (existing[0]) {
    return fail(req, "duplicate");
  }

  // ─── Create placeholder shul ────────────────────────────────
  // The LLM will overwrite name + (optionally) address when it runs.
  const placeholderName =
    nameFromTitle(parsed.hostname.replace(/^www\./, "")) ??
    parsed.hostname.replace(/^www\./, "");
  const baseSlug =
    slugify(placeholderName) || slugify(parsed.hostname) || "shul";
  let candidateSlug = baseSlug;
  for (let n = 2; n < 100; n++) {
    const collision = await db
      .select({ id: shul.id })
      .from(shul)
      .where(eq(shul.slug, candidateSlug))
      .limit(1);
    if (!collision[0]) break;
    candidateSlug = `${baseSlug}-${n}`;
  }

  const [newShul] = await db
    .insert(shul)
    .values({
      slug: candidateSlug,
      name: placeholderName,
      submittedUrl: url,
      contactEmail: email,
      status: "pending_review",
    })
    .returning({ id: shul.id, slug: shul.slug });

  // ─── Fire async ─────────────────────────────────────────────
  // If Inngest send fails (e.g. INNGEST_EVENT_KEY not set), the
  // submission is dropped silently. We accept that risk in dev; in
  // prod Inngest is wired and this is reliable.
  try {
    await inngest.send({
      name: "data-source.requested",
      data: {
        shulId: newShul.id,
        url,
        sourceKind: "website_llm",
      },
    });
  } catch (err) {
    // Log but don't fail the user — the shul row exists; an admin can
    // retry from /admin/queue once a manual-retry button is built.
    console.error("[submit] inngest.send failed:", (err as Error).message);
  }

  return NextResponse.redirect(
    new URL(`/submit?ok=1&slug=${encodeURIComponent(newShul.slug)}`, req.url),
    303,
  );
}
