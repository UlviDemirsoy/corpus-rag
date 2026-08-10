import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { applyMigrations } from "../infrastructure/db/migrate.js";
import { createContainer } from "../composition/container.js";
import { env } from "../config/env.js";
import { logger } from "../infrastructure/logging/logger.js";
import { httpContext } from "../infrastructure/context/httpContext.js";

async function main() {
  await applyMigrations();

  const strategyArg = process.argv.find((a) => a.startsWith("--strategy="));
  const pathArg = process.argv.find((a) => a.startsWith("--path="));
  const strategy =
    (strategyArg?.split("=")[1] as "fixed" | "recursive" | "sliding" | undefined) ??
    env.CHUNK_STRATEGY;
  const corpusPath = pathArg?.split("=")[1] ?? env.CORPUS_PATH;

  const container = createContainer();
  const traceId = randomUUID();

  await httpContext.run(
    { traceId, requestId: randomUUID(), path: "cli:ingest", method: "CLI" },
    async () => {
      logger.info({ strategy, corpusPath: resolve(corpusPath), traceId }, "CLI ingest");
      const job = await container.ingestCorpus.execute({
        strategy,
        corpusPath,
      });
      logger.info({ job }, "CLI ingest finished");
      console.log(JSON.stringify(job, null, 2));
    },
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
