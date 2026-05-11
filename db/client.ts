import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

// During PR 1 (and any future schema-migration cycle), DATABASE_URL_BRANCH
// points at a Neon branch isolated from prod. When the branch is promoted
// to main (or the project graduates past migration), clear that env var
// and we fall back to DATABASE_URL automatically.
export function resolveDatabaseUrl(): string {
  const branch = process.env.DATABASE_URL_BRANCH;
  if (branch && branch.trim().length > 0) return branch;
  const prod = process.env.DATABASE_URL;
  if (prod && prod.trim().length > 0) return prod;
  throw new Error(
    "Neither DATABASE_URL_BRANCH nor DATABASE_URL is set. Add one to .env.local.",
  );
}

const globalForDb = globalThis as unknown as { pool?: Pool };

const pool =
  globalForDb.pool ??
  new Pool({
    connectionString: resolveDatabaseUrl(),
    max: 10,
  });

if (process.env.NODE_ENV !== "production") globalForDb.pool = pool;

export const db = drizzle(pool, { schema });
export { schema };
