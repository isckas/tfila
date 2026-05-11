import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });
import type { Config } from "drizzle-kit";

// Prefer the migration branch URL if set (PR 1 flow).
const url = process.env.DATABASE_URL_BRANCH || process.env.DATABASE_URL;
if (!url) {
  throw new Error(
    "Set DATABASE_URL_BRANCH (preferred during migration) or DATABASE_URL.",
  );
}

export default {
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dialect: "postgresql",
  dbCredentials: { url },
} satisfies Config;
