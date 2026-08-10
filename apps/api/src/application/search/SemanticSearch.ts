import type { ChunkStrategy, SearchResponse } from "@rag/shared";
import type { Embedder } from "../../domain/search/Embedder.js";
import type { SearchAnalyticsRepository } from "../../domain/search/SearchAnalyticsRepository.js";
import type { VectorStore } from "../../domain/search/VectorStore.js";
import { env } from "../../config/env.js";
import { getContext, getTraceId } from "../../infrastructure/context/httpContext.js";
import { logger } from "../../infrastructure/logging/logger.js";

export class SemanticSearch {
  constructor(
    private readonly embedder: Embedder,
    private readonly vectors: VectorStore,
    private readonly analytics: SearchAnalyticsRepository,
  ) {}

  async execute(input: {
    query: string;
    topK?: number;
    strategy?: ChunkStrategy;
    log?: boolean;
  }): Promise<SearchResponse> {
    const strategy = input.strategy ?? env.CHUNK_STRATEGY;
    const topK = input.topK ?? env.TOP_K;
    const started = Date.now();
    const traceId = getTraceId() ?? crypto.randomUUID();

    logger.info({ query: input.query, strategy, topK, traceId }, "Semantic search");

    // Future: hybrid (BM25 + vector) then optional rerank before returning passages.
    const embedding = await this.embedder.embedQuery(input.query);
    const passages = await this.vectors.search(strategy, embedding, topK);
    const latencyMs = Date.now() - started;

    if (input.log !== false) {
      const ctx = getContext();
      await this.analytics.log({
        query: input.query,
        strategy,
        topK,
        hitCount: passages.length,
        latencyMs,
        userId: ctx?.userId,
        traceId,
      });
    }

    return {
      query: input.query,
      passages: passages.map((p) => ({
        chunkId: p.chunkId,
        documentId: p.documentId,
        source: p.source,
        text: p.text,
        score: p.score,
        strategy: p.strategy,
      })),
      strategy,
      traceId,
    };
  }
}
