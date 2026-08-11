import type { ChunkStrategy } from "@rag/shared";
import { applyMigrations } from "./infrastructure/db/migrate.js";
import { seedDemoUsers } from "./infrastructure/db/seed.js";
import { createContainer } from "./composition/container.js";
import { env } from "./config/env.js";
import { logger } from "./infrastructure/logging/logger.js";
import { createHttpServer } from "./presentation/http/server.js";
import { createCorpusWatcher } from "./infrastructure/ingestion/CorpusWatcher.js";

const ALL_STRATEGIES: ChunkStrategy[] = ["fixed", "recursive", "sliding"];

async function maybeAutoIngest(
  container: ReturnType<typeof createContainer>,
): Promise<void> {
  if (!env.AUTO_INGEST) {
    logger.info("AUTO_INGEST disabled; skipping boot ingest");
    return;
  }

  const strategies = env.AUTO_INGEST_ALL_STRATEGIES
    ? ALL_STRATEGIES
    : [env.CHUNK_STRATEGY];

  logger.info(
    { strategies, corpusPath: env.CORPUS_PATH },
    "Checking indexes for auto-ingest",
  );

  void (async () => {
    for (const strategy of strategies) {
      try {
        const health = await container.vectors.getHealth(strategy);
        if (health.pointsCount > 0) {
          logger.info(
            { strategy, pointsCount: health.pointsCount },
            "Index already populated; skipping strategy",
          );
          continue;
        }
        logger.info({ strategy }, "Empty index — ingesting strategy");
        const job = await container.ingestCorpus.execute({
          strategy,
          corpusPath: env.CORPUS_PATH,
        });
        logger.info(
          { strategy, jobId: job.id, status: job.status },
          "Auto-ingest finished for strategy",
        );
      } catch (err) {
        logger.error({ err, strategy }, "Auto-ingest failed for strategy");
      }
    }
  })();
}

async function main() {
  await applyMigrations();
  if (env.SEED_ON_BOOT || env.NODE_ENV !== "production") {
    await seedDemoUsers();
  }

  const container = createContainer();
  const app = createHttpServer(container);
  const watcher = env.CORPUS_WATCH
    ? createCorpusWatcher(container.ingestCorpus)
    : null;

  // Vercel container / Fluid injects PORT (often 80); Docker Compose uses 3001.
  app.listen(env.PORT, "0.0.0.0", () => {
    logger.info(
      {
        port: env.PORT,
        webOrigin: env.WEB_ORIGIN,
        betterAuthUrl: env.BETTER_AUTH_URL,
        corpusWatch: Boolean(watcher),
        autoIngest: env.AUTO_INGEST,
        vercel: process.env.VERCEL === "1",
      },
      "API listening",
    );
  });

  await maybeAutoIngest(container);
  watcher?.start();

  const shutdown = async () => {
    await watcher?.stop();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
