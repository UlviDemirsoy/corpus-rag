import { eq } from "drizzle-orm";
import { env } from "../../config/env.js";
import { logger } from "../logging/logger.js";
import { createAuth } from "../auth/betterAuth.js";
import { applyMigrations } from "./migrate.js";
import { db } from "./client.js";
import { user } from "./schema.js";

async function upsertDemoUser(input: {
  email: string;
  password: string;
  name: string;
  role: "user" | "admin";
}) {
  const auth = createAuth();
  const existing = await db.query.user.findFirst({
    where: eq(user.email, input.email),
  });

  if (!existing) {
    const result = await auth.api.signUpEmail({
      body: {
        email: input.email,
        password: input.password,
        name: input.name,
      },
    });
    await db
      .update(user)
      .set({ role: input.role, updatedAt: new Date() })
      .where(eq(user.id, result.user.id));
    logger.info({ email: input.email, role: input.role }, "Created demo user");
    return;
  }

  await db
    .update(user)
    .set({ role: input.role, name: input.name, updatedAt: new Date() })
    .where(eq(user.id, existing.id));
  logger.info({ email: input.email, role: input.role }, "Demo user already present; role synced");
}

/** Idempotent demo users for local/demo environments. */
export async function seedDemoUsers(): Promise<void> {
  logger.info("Seeding demo users if needed");
  await upsertDemoUser({
    email: "user@demo.com",
    password: env.DEMO_USER_PASSWORD,
    name: "Demo User",
    role: "user",
  });
  await upsertDemoUser({
    email: "admin@demo.com",
    password: env.DEMO_ADMIN_PASSWORD,
    name: "Demo Admin",
    role: "admin",
  });
}

async function main() {
  await applyMigrations();
  await seedDemoUsers();
  process.exit(0);
}

const isDirectRun =
  process.argv[1]?.includes("seed") ||
  process.argv[1]?.replace(/\\/g, "/").endsWith("infrastructure/db/seed.ts");

if (isDirectRun) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
