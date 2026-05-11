import { inngest } from "../client";

export const helloProofOfLife = inngest.createFunction(
  {
    id: "hello-proof-of-life",
    triggers: [{ event: "hello.test" }],
  },
  async ({ event, step }) => {
    await step.run("acknowledge", async () => {
      return { received: event.data ?? null, at: new Date().toISOString() };
    });
    return { ok: true };
  },
);
