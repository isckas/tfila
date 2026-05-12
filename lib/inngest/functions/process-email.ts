// Process a forwarded shul email: extract the schedule, find or create
// the data_source keyed by the original sender's email, persist rules.
//
// Special-schedule rules ADD to existing rules (don't replace) — they
// have date bounds and specialScheduleKind set, so rule resolution at
// query time picks them over the regular rule for matching dates.
//
// Regular rules from a recurring weekly email REPLACE the existing
// regular rules for that data_source (treat the latest email as the
// authoritative weekly schedule).

import { and, eq, isNull, sql } from "drizzle-orm";
import { inngest } from "../client";
import { db } from "../../../db/client";
import { dataSource, minyanRule, shul, type MinyanTime } from "../../../db/schema";
import { extractFromEmail } from "../../llm/extract-email";
import { slugify, nameFromTitle } from "../../slug";

export const processEmail = inngest.createFunction(
  {
    id: "email-received-process",
    concurrency: { key: "event.data.originalSenderEmail", limit: 1 },
    triggers: [{ event: "email.received" }],
  },
  async ({ event, step }) => {
    const {
      originalSenderEmail,
      originalSenderName,
      subject,
      body,
      forwarderEmail,
    } = event.data as {
      originalSenderEmail: string;
      originalSenderName: string | null;
      subject: string;
      body: string;
      forwarderEmail: string;
      receivedAt: string;
    };

    if (process.env.SCRAPE_ENABLED === "false") {
      return { skipped: true, reason: "SCRAPE_ENABLED=false" };
    }

    // ─── 1. LLM extract ─────────────────────────────────────────
    const extracted = await step.run("llm-extract", async () =>
      extractFromEmail(subject, body),
    );

    if (
      extracted.extraction.rules.length === 0 ||
      extracted.extraction.confidence < 0.3
    ) {
      return {
        skipped: true,
        reason: "low confidence or no rules",
        confidence: extracted.extraction.confidence,
      };
    }

    // ─── 2. Find or create the data_source ──────────────────────
    const result = await step.run("persist", async () =>
      persistFromEmail({
        originalSenderEmail,
        originalSenderName,
        forwarderEmail,
        subject,
        extracted,
      }),
    );

    return result;
  },
);

interface PersistArgs {
  originalSenderEmail: string;
  originalSenderName: string | null;
  forwarderEmail: string;
  subject: string;
  extracted: Awaited<ReturnType<typeof extractFromEmail>>;
}

async function persistFromEmail(args: PersistArgs) {
  const { originalSenderEmail, originalSenderName, subject, extracted } = args;
  const now = new Date();

  return db.transaction(async (tx) => {
    // Look up existing data_source by (kind=email_newsletter, identifier=email)
    const existing = await tx
      .select({ id: dataSource.id, shulId: dataSource.shulId, configJson: dataSource.configJson })
      .from(dataSource)
      .where(
        and(
          eq(dataSource.kind, "email_newsletter"),
          eq(dataSource.identifier, originalSenderEmail),
        ),
      )
      .limit(1);

    let shulId: number;
    let dataSourceId: number;
    let isNewShul = false;

    if (existing[0]) {
      shulId = existing[0].shulId;
      dataSourceId = existing[0].id;
    } else {
      // First-ever email from this sender → create a new shul + data_source.
      // Shul name preference: LLM-extracted name > original sender's display
      // name > derived from the sender's email domain.
      const detectedName =
        args.extracted.extraction.shulName ??
        originalSenderName ??
        nameFromTitle(originalSenderEmail.split("@")[1] ?? "") ??
        originalSenderEmail;

      let baseSlug = slugify(detectedName) || slugify(originalSenderEmail);
      let candidateSlug = baseSlug;
      for (let n = 2; n < 100; n++) {
        const collision = await tx
          .select({ id: shul.id })
          .from(shul)
          .where(eq(shul.slug, candidateSlug))
          .limit(1);
        if (!collision[0]) break;
        candidateSlug = `${baseSlug}-${n}`;
      }

      const [insertedShul] = await tx
        .insert(shul)
        .values({
          slug: candidateSlug,
          name: detectedName,
          address: args.extracted.extraction.shulAddress ?? null,
          contactEmail: originalSenderEmail,
          status: "pending_review",
        })
        .returning({ id: shul.id });
      shulId = insertedShul.id;
      isNewShul = true;

      const [insertedSource] = await tx
        .insert(dataSource)
        .values({
          shulId,
          kind: "email_newsletter",
          identifier: originalSenderEmail,
          configJson: {
            version: 1,
            prompt_version: "tfila-email-v1",
            first_received_at: now.toISOString(),
            last_subject: subject,
            forwarder: args.forwarderEmail,
          },
          confidenceScore: args.extracted.extraction.confidence,
          priority: 60, // email > website (SCOPE.md §6 lock)
          builtAt: now,
          builtBy: "llm",
          lastRunAt: now,
          lastReceivedAt: now,
          lastRunStatus: "ok",
          reviewStatus: "pending",
        })
        .returning({ id: dataSource.id });
      dataSourceId = insertedSource.id;
    }

    // ─── 3. Apply rules ─────────────────────────────────────────
    // Regular rules REPLACE existing regular rules for this data_source.
    // Date-bounded special rules ADD to whatever's there.
    const regularRules = args.extracted.extraction.rules.filter(
      (r) => r.specialScheduleKind === "regular" || !r.specialScheduleKind,
    );
    const specialRules = args.extracted.extraction.rules.filter(
      (r) => r.specialScheduleKind && r.specialScheduleKind !== "regular",
    );

    if (regularRules.length > 0) {
      await tx
        .update(minyanRule)
        .set({ deletedAt: now, updatedAt: now })
        .where(
          and(
            eq(minyanRule.dataSourceId, dataSourceId),
            eq(minyanRule.specialScheduleKind, "regular"),
            isNull(minyanRule.deletedAt),
          ),
        );
    }

    for (const r of [...regularRules, ...specialRules]) {
      const time: MinyanTime =
        r.time.kind === "fixed"
          ? { kind: "fixed", clock: r.time.clock }
          : { kind: "zmanim", anchor: r.time.anchor, offsetMin: r.time.offsetMin };
      await tx.insert(minyanRule).values({
        shulId,
        dataSourceId,
        tefillah: r.tefillah,
        tefillahLabel: r.tefillahLabel ?? null,
        daysOfWeek: r.daysOfWeek ?? null,
        time: time as unknown as object,
        validFrom: r.validFrom ?? null,
        validTo: r.validTo ?? null,
        specialScheduleKind: r.specialScheduleKind ?? "regular",
        priority: r.specialScheduleKind && r.specialScheduleKind !== "regular" ? 10 : 0,
        nusach: r.nusach ?? null,
        notes: r.notes ?? null,
        lastSeenInScrapeAt: now,
      });
    }

    // ─── 4. Update data_source metadata ─────────────────────────
    const prevConfig = (existing[0]?.configJson as object | null) ?? {};
    await tx
      .update(dataSource)
      .set({
        configJson: {
          ...prevConfig,
          last_subject: subject,
          last_received_at: now.toISOString(),
          last_body_hash: args.extracted.bodyHash,
          last_model: args.extracted.model,
          last_usage: args.extracted.usage,
          last_reasoning: args.extracted.extraction.reasoning,
        },
        confidenceScore: args.extracted.extraction.confidence,
        lastRunAt: now,
        lastReceivedAt: now,
        lastRunStatus: "ok",
        updatedAt: now,
      })
      .where(eq(dataSource.id, dataSourceId));

    return {
      isNewShul,
      shulId,
      dataSourceId,
      regularRulesAdded: regularRules.length,
      specialRulesAdded: specialRules.length,
      confidence: args.extracted.extraction.confidence,
      model: args.extracted.model,
    };
  });
}
