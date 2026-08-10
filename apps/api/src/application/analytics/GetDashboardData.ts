import type { ChunkStrategy } from "@rag/shared";
import type { DocumentRepository } from "../../domain/document/DocumentRepository.js";
import type { IngestionJobRepository } from "../../domain/ingestion/IngestionJobRepository.js";
import type { SearchAnalyticsRepository } from "../../domain/search/SearchAnalyticsRepository.js";
import type { VectorStore } from "../../domain/search/VectorStore.js";
import { env } from "../../config/env.js";

const STRATEGIES: ChunkStrategy[] = ["fixed", "recursive", "sliding"];

export class GetDashboardData {
  constructor(
    private readonly docs: DocumentRepository,
    private readonly jobs: IngestionJobRepository,
    private readonly analytics: SearchAnalyticsRepository,
    private readonly vectors: VectorStore,
  ) {}

  async execute() {
    const [documents, latestJob, recentJobs, stats, indexHealth] = await Promise.all([
      this.docs.list(),
      this.jobs.getLatest(),
      this.jobs.list(10),
      this.analytics.getStats(),
      Promise.all(STRATEGIES.map((s) => this.vectors.getHealth(s))),
    ]);

    return {
      documents,
      latestJob,
      recentJobs,
      searchStats: stats,
      indexHealth,
      defaultStrategy: env.CHUNK_STRATEGY,
      selfUpdatingPipeline: {
        enabled: env.CORPUS_WATCH,
        corpusPath: env.CORPUS_PATH,
        debounceMs: env.CORPUS_WATCH_DEBOUNCE_MS,
        watchAllStrategies: env.CORPUS_WATCH_ALL_STRATEGIES,
        behavior:
          "Watches CORPUS_PATH for add/change/delete, then runs incremental ingest (content-hash skip + removal sync) without a full manual rebuild.",
      },
    };
  }
}
