import { config } from "dotenv";
import { resolve, dirname, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(here, "../../../../");

config({ path: resolve(REPO_ROOT, ".env") });
config();

const boolEnv = (defaultValue: boolean) =>
  z
    .enum(["true", "false"])
    .default(defaultValue ? "true" : "false")
    .transform((v) => v === "true");

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3001),
  LOG_LEVEL: z.string().default("info"),
  DATABASE_URL: z.string().min(1),
  QDRANT_URL: z.string().url().default("http://localhost:6333"),
  OPENAI_API_KEY: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().url().default("http://localhost:3001"),
  WEB_ORIGIN: z.string().url().default("http://localhost:3000"),
  CORPUS_PATH: z.string().default("./data/corpus"),
  CHUNK_STRATEGY: z.enum(["fixed", "recursive", "sliding"]).default("recursive"),
  EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
  CHAT_MODEL: z.string().default("gpt-4o-mini"),
  TOP_K: z.coerce.number().int().positive().default(5),
  DEMO_USER_PASSWORD: z.string().default("user1234"),
  DEMO_ADMIN_PASSWORD: z.string().default("admin1234"),
  AUTO_INGEST: boolEnv(true),
  AUTO_INGEST_ALL_STRATEGIES: boolEnv(true),
  SEED_ON_BOOT: boolEnv(true),
  /** Watch corpus folder and re-ingest incrementally on add/change/delete. */
  CORPUS_WATCH: boolEnv(true),
  CORPUS_WATCH_ALL_STRATEGIES: boolEnv(false),
  CORPUS_WATCH_DEBOUNCE_MS: z.coerce.number().int().positive().default(2500),
});

export type Env = z.infer<typeof EnvSchema>;

const parsed = EnvSchema.parse(process.env);

export const env: Env = {
  ...parsed,
  CORPUS_PATH: isAbsolute(parsed.CORPUS_PATH)
    ? parsed.CORPUS_PATH
    : resolve(REPO_ROOT, parsed.CORPUS_PATH),
};
