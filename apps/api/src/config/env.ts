import { config } from "dotenv";
import { resolve, dirname, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(here, "../../../../");

config({ path: resolve(REPO_ROOT, ".env") });
config();

/** Vercel / Vercel Services inject VERCEL=1 (and often VERCEL_URL per deployment). */
const onVercel = process.env.VERCEL === "1";
/** Current deployment host (preview or prod). Override with BETTER_AUTH_URL / WEB_ORIGIN for custom domains. */
const vercelPublicUrl = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : undefined;

const boolEnv = (defaultValue: boolean) =>
  z
    .enum(["true", "false"])
    .default(defaultValue ? "true" : "false")
    .transform((v) => v === "true");

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : undefined));

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3001),
  LOG_LEVEL: z.string().default("info"),
  DATABASE_URL: z.string().min(1),
  QDRANT_URL: z.string().url().default("http://localhost:6333"),
  /** Qdrant Cloud (and secured self-hosted) API key. */
  QDRANT_API_KEY: optionalString,
  OPENAI_API_KEY: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z
    .string()
    .url()
    .default(vercelPublicUrl ?? "http://localhost:3001"),
  WEB_ORIGIN: z
    .string()
    .url()
    .default(vercelPublicUrl ?? "http://localhost:3000"),
  /** Optional — when both set, Google social login is enabled. Empty string → unset. */
  GOOGLE_CLIENT_ID: optionalString,
  GOOGLE_CLIENT_SECRET: optionalString,
  /**
   * Optional Bearer token for Streamable HTTP MCP (`/mcp`).
   * When unset, remote MCP is open (demo). Set in production if you want a shared secret.
   */
  MCP_API_KEY: optionalString,
  CORPUS_PATH: z.string().default("./data/corpus"),
  CHUNK_STRATEGY: z.enum(["fixed", "recursive", "sliding"]).default("recursive"),
  EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
  CHAT_MODEL: z.string().default("gpt-4o-mini"),
  TOP_K: z.coerce.number().int().positive().default(5),
  /** Dense retrieve this many candidates, then OpenAI-rerank down to TOP_K. */
  RERANK_ENABLED: boolEnv(true),
  RERANK_CANDIDATES: z.coerce.number().int().positive().default(20),
  /** Blend dense + BM25 via s = α·densê + (1−α)·BM25̂ */
  HYBRID_ENABLED: boolEnv(true),
  HYBRID_ALPHA: z.coerce.number().min(0).max(1).default(0.5),
  DEMO_USER_PASSWORD: z.string().default("user1234"),
  DEMO_ADMIN_PASSWORD: z.string().default("admin1234"),
  /** Off by default on Vercel — cold-start ingest is too slow; run admin ingest once. */
  AUTO_INGEST: boolEnv(!onVercel),
  AUTO_INGEST_ALL_STRATEGIES: boolEnv(!onVercel),
  SEED_ON_BOOT: boolEnv(true),
  /** Off by default on Vercel — no durable local FS to watch. */
  CORPUS_WATCH: boolEnv(!onVercel),
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
