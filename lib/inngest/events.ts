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

  /** Proof-of-life event (PR 0). */
  "hello.test": {
    data?: unknown;
  };
}
