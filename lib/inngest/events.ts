// Typed Inngest event payloads. Use these instead of raw object literals
// so the producer and consumer stay in sync at compile time.

export interface InngestEvents {
  /** Sent when a new (or stale) data_source needs an LLM build. */
  "data-source.requested": {
    data: {
      shulId: number;
      url: string;
      sourceKind: "website_llm" | "shulcloud_website";
      /**
       * If true, create a new data_source row even if one already exists for
       * this (shulId, url). If false, update the existing one in place.
       */
      forceNew?: boolean;
    };
  };

  /**
   * Per-shul scrape — fired by the weekly cron for each active shul,
   * or manually for ad-hoc re-scrapes. Differs from `data-source.requested`
   * in that it OPERATES ON an existing data_source (refreshing rules)
   * rather than creating a new one.
   */
  "shul.scrape.requested": {
    data: {
      shulId: number;
      dataSourceId: number;
      reason: "weekly" | "manual";
    };
  };

  /**
   * Sent by the Postmark inbound webhook after a forwarded shul email
   * lands at submit@inbound.tfila.co.
   */
  "email.received": {
    data: {
      /** Email of the davener (or whoever forwarded). */
      forwarderEmail: string;
      /** Email of the original shul mailing-list sender (extracted from forwarded headers). */
      originalSenderEmail: string;
      originalSenderName: string | null;
      subject: string;
      /** Plain-text body (already trimmed/sanitized). */
      body: string;
      /** ISO timestamp of when the email reached our inbound endpoint. */
      receivedAt: string;
    };
  };

  /** Proof-of-life event (PR 0). */
  "hello.test": {
    data?: unknown;
  };
}
