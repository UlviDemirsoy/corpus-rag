import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "../../config/env.js";
import { logger } from "../logging/logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function getMigrationsFolder(): string {
  return resolve(__dirname, "../../../drizzle");
}

/** Idempotent: applies only pending Drizzle migrations. */
export async function applyMigrations(connectionString = env.DATABASE_URL): Promise<void> {
  const migrationsFolder = getMigrationsFolder();
  const pool = new pg.Pool({ connectionString });
  try {
    const db = drizzle(pool);
    logger.info({ migrationsFolder }, "Applying database migrations if needed");
    await migrate(db, { migrationsFolder });
    logger.info("Database migrations up to date");
  } finally {
    await pool.end();
  }
}

/** CLI entry: `pnpm db:migrate` */
async function main() {
  await applyMigrations();
}

const isDirectRun =
  process.argv[1]?.includes("migrate") ||
  process.argv[1]?.replace(/\\/g, "/").endsWith("infrastructure/db/migrate.ts");

if (isDirectRun) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
