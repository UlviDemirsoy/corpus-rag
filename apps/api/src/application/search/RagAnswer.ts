import type { ChatResponse, ChunkStrategy } from "@rag/shared";
import type { LlmClient } from "../../domain/search/LlmClient.js";
import type { SearchAnalyticsRepository } from "../../domain/search/SearchAnalyticsRepository.js";
import { SemanticSearch } from "./SemanticSearch.js";
import { getContext, getTraceId } from "../../infrastructure/context/httpContext.js";
import { logger } from "../../infrastructure/logging/logger.js";

export class RagAnswer {
  constructor(
    private readonly search: SemanticSearch,
    private readonly llm: LlmClient,
    private readonly analytics: SearchAnalyticsRepository,
  ) {}

  async execute(input: {
    question: string;
    topK?: number;
    strategy?: ChunkStrategy;
  }): Promise<ChatResponse> {
    const started = Date.now();
    const searchResult = await this.search.execute({
      query: input.question,
      topK: input.topK,
      strategy: input.strategy,
      log: false,
    });

    const indexedPassages = searchResult.passages.map((p, i) => ({
      index: i + 1,
      source: p.source,
      text: p.text,
    }));

    const llmResult = await this.llm.answerWithContext({
      question: input.question,
      passages: indexedPassages,
    });

    const citationIndexes = llmResult.usedCitationIndexes.length
      ? llmResult.usedCitationIndexes
      : llmResult.grounded
        ? indexedPassages.map((p) => p.index)
        : [];

    const citations = citationIndexes
      .map((index) => {
        const passage = searchResult.passages[index - 1];
        if (!passage) return null;
        return {
          index,
          documentId: passage.documentId,
          source: passage.source,
          chunkId: passage.chunkId,
        };
      })
      .filter((c): c is NonNullable<typeof c> => c !== null);

    const traceId = searchResult.traceId || getTraceId() || crypto.randomUUID();
    const latencyMs = Date.now() - started;
    const ctx = getContext();

    await this.analytics.log({
      query: input.question,
      strategy: searchResult.strategy,
      topK: input.topK ?? searchResult.passages.length,
      hitCount: searchResult.passages.length,
      latencyMs,
      userId: ctx?.userId,
      grounded: llmResult.grounded,
      traceId,
    });

    logger.info(
      {
        traceId,
        grounded: llmResult.grounded,
        hits: searchResult.passages.length,
        latencyMs,
      },
      "RAG answer generated",
    );

    return {
      question: input.question,
      answer: llmResult.answer,
      grounded: llmResult.grounded,
      passages: searchResult.passages,
      citations,
      strategy: searchResult.strategy,
      traceId,
    };
  }
}
