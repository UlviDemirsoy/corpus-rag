import { watch, type FSWatcher } from "chokidar";
import type { ChunkStrategy } from "@rag/shared";
import type { IngestCorpus } from "../../application/ingest/IngestCorpus.js";
import { env } from "../../config/env.js";
import { logger } from "../logging/logger.js";
import { httpContext } from "../context/httpContext.js";
import { randomUUID } from "node:crypto";

/**
 * Watches CORPUS_PATH and triggers incremental ingest (hash skip + removals)
 * when files are added, changed, or deleted. Debounced to coalesce bursts.
 */
export class CorpusWatcher {
  private watcher: FSWatcher | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private queued = false;
  private readonly pendingReasons = new Set<string>();

  constructor(
    private readonly ingest: IngestCorpus,
    private readonly options: {
      corpusPath: string;
      strategies: ChunkStrategy[];
      debounceMs: number;
    },
  ) {}

  get enabled() {
    return this.watcher !== null;
  }

  start() {
    if (this.watcher) return;

    const { corpusPath, debounceMs } = this.options;
    this.watcher = watch(corpusPath, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 200 },
      ignored: /(^|[/\\])\../,
      depth: 12,
    });

    const onEvent = (event: string, filePath?: string) => {
      const reason = filePath ? `${event}:${filePath}` : event;
      this.pendingReasons.add(reason);
      logger.info({ event, filePath, corpusPath }, "Corpus change detected");
      this.schedule();
    };

    this.watcher
      .on("add", (p) => onEvent("add", p))
      .on("change", (p) => onEvent("change", p))
      .on("unlink", (p) => onEvent("unlink", p))
      .on("addDir", (p) => onEvent("addDir", p))
      .on("unlinkDir", (p) => onEvent("unlinkDir", p))
      .on("error", (err) => logger.error({ err }, "Corpus watcher error"));

    logger.info(
      {
        corpusPath,
        strategies: this.options.strategies,
        debounceMs,
      },
      "Self-updating corpus watcher started",
    );
  }

  async stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
  }

  private schedule() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.runIncremental();
    }, this.options.debounceMs);
  }

  private async runIncremental() {
    if (this.running) {
      this.queued = true;
      return;
    }
    this.running = true;
    const reasons = [...this.pendingReasons];
    this.pendingReasons.clear();

    const traceId = randomUUID();
    await httpContext.run(
      {
        traceId,
        requestId: randomUUID(),
        path: "watcher:ingest",
        method: "WATCH",
      },
      async () => {
        logger.info(
          { traceId, reasons: reasons.slice(0, 20), reasonCount: reasons.length },
          "Running incremental self-update ingest",
        );
        for (const strategy of this.options.strategies) {
          try {
            const job = await this.ingest.execute({
              strategy,
              corpusPath: this.options.corpusPath,
            });
            logger.info(
              {
                strategy,
                jobId: job.id,
                status: job.status,
                processed: job.processedFiles,
                failed: job.failedFiles,
              },
              "Incremental ingest finished",
            );
          } catch (err) {
            logger.error({ err, strategy }, "Incremental ingest failed");
          }
        }
      },
    );

    this.running = false;
    if (this.queued) {
      this.queued = false;
      this.schedule();
    }
  }
}

export function createCorpusWatcher(ingest: IngestCorpus): CorpusWatcher {
  const strategies: ChunkStrategy[] = env.CORPUS_WATCH_ALL_STRATEGIES
    ? ["fixed", "recursive", "sliding"]
    : [env.CHUNK_STRATEGY];

  return new CorpusWatcher(ingest, {
    corpusPath: env.CORPUS_PATH,
    strategies,
    debounceMs: env.CORPUS_WATCH_DEBOUNCE_MS,
  });
}
