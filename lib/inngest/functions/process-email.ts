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
import {
  dataSource,
  minyanRule,
  shul,
  serializeMinyanTime,
  type MinyanTime,
} from "../../../db/schema";
import { extractFromEmail } from "../../llm/extract-email";
import { slugify, nameFromTitle } from "../../slug";
import { matchDomainOf } from "../../dedup";
import { backfillShulLocation } from "../../geocoding";
import {
  extractCanonicalWebsiteFromEmail,
  isSharedMtaDomain,
  normalizeWebsiteUrl,
} from "../../inbound/extract-website";

export const processEmail = inngest.createFunction(
  {
    id: "email-received-process",
    concurrency: { key: "event.data.originalSenderEmail", limit: 1 },
    triggers: [{ event: "email.received" }],
    // Cap the whole function. With per-sender concurrency=1, a hung
    // step (LLM call timing out, DB lock, etc.) would block all other
    // emails from the same sender from being processed. 5 min is
    // generous — LLM extraction is ~30s worst case.
    timeouts: { finish: "5m" },
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

    // ─── 2. Resolve the shul's canonical website ────────────────
    // Dedup keys off the shul's OWN domain, never the sender's. The
    // "From" address on a forwarded email is often a shared mailing-
    // list provider (info@myshul.com, news@constantcontact.com) that
    // many different shuls use — match_domain on that would silently
    // merge every shul on the platform into one row.
    //
    // Both the LLM-extracted shulWebsite AND the regex fallback are
    // run through normalizeWebsiteUrl() so we get either a guaranteed-
    // parseable `https://<host>` or null. Without this, an LLM that
    // emits a bare domain crashes `new URL()` inside the persist
    // transaction, and an LLM that emits a shared-MTA domain (despite
    // the prompt) re-introduces the wrong-merge bug.
    const websiteUrl =
      normalizeWebsiteUrl(extracted.extraction.shulWebsite) ??
      normalizeWebsiteUrl(extractCanonicalWebsiteFromEmail(body));
    const shulMatchDomain = websiteUrl ? matchDomainOf(websiteUrl) : null;

    // ─── 3. Compute the data_source identifier ──────────────────
    // For non-shared senders, identifier = the sender email (so a
    // weekly forward from the same gabbai re-uses the same row).
    // For shared senders we need to disambiguate between shuls that
    // happen to use the same MTA: use a compound identifier when we
    // know which shul this is, or a body-hash-suffixed sentinel when
    // we don't (so we never wrong-merge by sender alone).
    const senderDomain = matchDomainOf(originalSenderEmail);
    const senderIsShared = isSharedMtaDomain(senderDomain);
    let identifier: string;
    if (senderIsShared && shulMatchDomain) {
      identifier = `${originalSenderEmail}::${shulMatchDomain}`;
    } else if (senderIsShared) {
      identifier = `${originalSenderEmail}::unknown-${extracted.bodyHash.slice(0, 12)}`;
    } else {
      identifier = originalSenderEmail;
    }

    // ─── 4. Find or create the data_source ──────────────────────
    const result = await step.run("persist", async () =>
      persistFromEmail({
        originalSenderEmail,
        originalSenderName,
        forwarderEmail,
        subject,
        extracted,
        identifier,
        shulMatchDomain,
        websiteUrl,
      }),
    );

    // ─── 5. Address backfill via Google Places ──────────────────
    // Weekly bulletin emails rarely include the shul's street address,
    // so extraction.shulAddress is usually null. Use the same Places
    // helper the URL path uses (FEATURES.md "Unified post-ingestion
    // pipeline") so email-derived shuls aren't second-class on the
    // geo feed. Guarded by helper: no-ops if shul already has an
    // address (e.g. attached to an existing shul via domain-merge).
    const addressBackfill = await step.run("address-fallback", async () =>
      backfillShulLocation({
        shulId: result.shulId,
        name: extracted.extraction.shulName ?? "",
        urlHint: websiteUrl,
      }),
    );

    return { ...result, addressBackfill };
  },
);

interface PersistArgs {
  originalSenderEmail: string;
  originalSenderName: string | null;
  forwarderEmail: string;
  subject: string;
  extracted: Awaited<ReturnType<typeof extractFromEmail>>;
  identifier: string;
  shulMatchDomain: string | null;
  websiteUrl: string | null;
}

async function persistFromEmail(args: PersistArgs) {
  const {
    originalSenderEmail,
    originalSenderName,
    subject,
    extracted,
    identifier,
    shulMatchDomain,
    websiteUrl,
  } = args;
  const now = new Date();

  return db.transaction(async (tx) => {
    // Look up existing data_source by (kind=email_newsletter, identifier).
    // Identifier may be the plain sender email or a compound key when the
    // sender is a shared MTA — see processEmail() for the construction.
    const existing = await tx
      .select({ id: dataSource.id, shulId: dataSource.shulId, configJson: dataSource.configJson })
      .from(dataSource)
      .where(
        and(
          eq(dataSource.kind, "email_newsletter"),
          eq(dataSource.identifier, identifier),
        ),
      )
      .limit(1);

    let shulId: number;
    let dataSourceId: number;
    let isNewShul = false;

    if (existing[0]) {
      // Exact identifier match — refresh rules on the existing data_source.
      shulId = existing[0].shulId;
      dataSourceId = existing[0].id;
    } else {
      // No exact identifier match. Try domain-match dedup before creating a
      // brand-new shul: if there's already a shul with the same registrable
      // domain as the shul's OWN website (LLM-extracted, NOT the sender),
      // attach this email source as a new data_source under it.
      let mergedShul: { id: number } | null = null;
      if (shulMatchDomain) {
        const sameDomain = await tx
          .select({ id: shul.id })
          .from(shul)
          .where(eq(shul.matchDomain, shulMatchDomain))
          .limit(1);
        if (sameDomain[0]) mergedShul = sameDomain[0];
      }

      if (mergedShul) {
        // Attach as new email_newsletter data_source under existing shul.
        shulId = mergedShul.id;

        const [insertedSource] = await tx
          .insert(dataSource)
          .values({
            shulId,
            kind: "email_newsletter",
            identifier,
            configJson: {
              version: 1,
              prompt_version: "tfila-email-v1",
              first_received_at: now.toISOString(),
              last_subject: subject,
              forwarder: args.forwarderEmail,
              sender_email: originalSenderEmail,
              shul_website: websiteUrl,
              auto_merged_by_domain: shulMatchDomain,
            },
            confidenceScore: args.extracted.extraction.confidence,
            priority: 60,
            builtAt: now,
            builtBy: "llm",
            lastRunAt: now,
            lastReceivedAt: now,
            lastRunStatus: "ok",
            reviewStatus: "pending",
          })
          .returning({ id: dataSource.id });
        dataSourceId = insertedSource.id;
      } else {
        // First-ever email for this shul AND no domain match → create a
        // new shul + data_source. Shul name preference: LLM-extracted
        // name > sender's display name > website hostname > sender domain.
        const detectedName =
          args.extracted.extraction.shulName ??
          originalSenderName ??
          (websiteUrl ? nameFromTitle(new URL(websiteUrl).hostname.replace(/^www\./, "")) : null) ??
          nameFromTitle(originalSenderEmail.split("@")[1] ?? "") ??
          originalSenderEmail;

        const baseSlug = slugify(detectedName) || slugify(originalSenderEmail);
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
            submittedUrl: websiteUrl,
            matchDomain: shulMatchDomain,
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
            identifier,
            configJson: {
              version: 1,
              prompt_version: "tfila-email-v1",
              first_received_at: now.toISOString(),
              last_subject: subject,
              forwarder: args.forwarderEmail,
              sender_email: originalSenderEmail,
              shul_website: websiteUrl,
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
        time: serializeMinyanTime(time),
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
