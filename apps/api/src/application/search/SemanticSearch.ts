import type { ChunkStrategy, SearchResponse } from "@rag/shared";
import type { Embedder } from "../../domain/search/Embedder.js";
import type { LexicalSearch } from "../../domain/search/LexicalSearch.js";
import type { Reranker } from "../../domain/search/Reranker.js";
import type { SearchAnalyticsRepository } from "../../domain/search/SearchAnalyticsRepository.js";
import type { VectorStore } from "../../domain/search/VectorStore.js";
import { env } from "../../config/env.js";
import { getContext, getTraceId } from "../../infrastructure/context/httpContext.js";
import { logger } from "../../infrastructure/logging/logger.js";
import { alphaFuse } from "./alphaFusion.js";

export class SemanticSearch {
  constructor(
    private readonly embedder: Embedder,
    private readonly vectors: VectorStore,
    private readonly analytics: SearchAnalyticsRepository,
    private readonly reranker: Reranker,
    private readonly lexical: LexicalSearch,
  ) {}

  async execute(input: {
    query: string;
    topK?: number;
    strategy?: ChunkStrategy;
    useRerank?: boolean;
    useHybrid?: boolean;
    hybridAlpha?: number;
    log?: boolean;
  }): Promise<SearchResponse> {
    const strategy = input.strategy ?? env.CHUNK_STRATEGY;
    const topK = input.topK ?? env.TOP_K;
    const useRerank = input.useRerank ?? env.RERANK_ENABLED;
    const useHybrid = input.useHybrid ?? env.HYBRID_ENABLED;
    const hybridAlpha = clampAlpha(input.hybridAlpha ?? env.HYBRID_ALPHA);
    const started = Date.now();
    const traceId = getTraceId() ?? crypto.randomUUID();

    const candidateK =
      useRerank || useHybrid ? Math.max(topK, env.RERANK_CANDIDATES) : topK;

    logger.info(
      {
        query: input.query,
        strategy,
        topK,
        candidateK,
        useRerank,
        useHybrid,
        hybridAlpha,
        traceId,
      },
      "Semantic search",
    );

    // Dense (+ optional BM25 α-fusion) → optional OpenAI rerank → final topK.
    const embedding = await this.embedder.embedQuery(input.query);
    const dense = await this.vectors.search(strategy, embedding, candidateK);

    let passages = dense;
    let hybrid = false;
    if (useHybrid) {
      const bm25 = await this.lexical.search(strategy, input.query, candidateK);
      passages = alphaFuse({
        dense,
        bm25,
        alpha: hybridAlpha,
        limit: candidateK,
      });
      hybrid = true;
    }

    let reranked = false;
    if (useRerank && passages.length > 1) {
      passages = await this.reranker.rerank(input.query, passages);
      reranked = true;
    }
    passages = passages.slice(0, topK);

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
      hybrid,
      hybridAlpha: hybrid ? hybridAlpha : null,
      reranked,
      traceId,
    };
  }
}

function clampAlpha(value: number): number {
  if (!Number.isFinite(value)) return env.HYBRID_ALPHA;
  return Math.min(1, Math.max(0, value));
}
