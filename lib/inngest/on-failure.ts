import { notifyAdmin } from "../email";

/**
 * Shared Inngest `onFailure` handler (M11). Fires when a function exhausts ALL
 * its retries and gives up — without this, a retry-exhausted function dies
 * silently in the Inngest dashboard with no email/Sentry, so a broken scrape or
 * email pipeline goes unnoticed (the failure class the dead-man's switch only
 * partially covers). Reports to Sentry + emails the admin.
 *
 * Typed loosely — Inngest's failure context shape is version-specific; we only
 * read `error` and `runId`. The richer real context is assignable to this.
 */
export function reportInngestFailure(fnId: string) {
  return async ({
    error,
    event,
  }: {
    error: Error;
    // Inngest runs onFailure as a SEPARATE function (triggered by the internal
    // `inngest/function.failed` event), so the top-level ctx.runId is THIS
    // notifier's run — the FAILED run id is on the failure event payload.
    event?: { data?: { run_id?: string } };
  }): Promise<void> => {
    const failedRunId = event?.data?.run_id ?? "unknown";
    try {
      const Sentry = await import("@sentry/nextjs");
      Sentry.captureException(error, {
        tags: { inngestFn: fnId, runId: failedRunId },
      });
    } catch {
      /* Sentry unavailable — the email below is the floor. */
    }
    await notifyAdmin({
      subject: `⚠️ Inngest function failed: ${fnId}`,
      text: [
        `Function "${fnId}" exhausted its retries and failed — it will NOT run again automatically.`,
        `runId: ${failedRunId}`,
        "",
        `Error: ${error?.message ?? String(error)}`,
      ].join("\n"),
      // Terminal alert — this only fires AFTER retries are exhausted, so a
      // swallowed send would lose the only signal. `critical` gives it a retry
      // budget + Sentry fallback when ADMIN_EMAIL is unset.
      critical: true,
    });
  };
}
