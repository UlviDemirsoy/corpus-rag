import type { ChatResponse, ChatStreamEvent, ChunkStrategy } from "@rag/shared";
import type { LlmClient } from "../../domain/search/LlmClient.js";
import type { SearchAnalyticsRepository } from "../../domain/search/SearchAnalyticsRepository.js";
import { SemanticSearch } from "./SemanticSearch.js";
import { getContext, getTraceId } from "../../infrastructure/context/httpContext.js";
import { logger } from "../../infrastructure/logging/logger.js";

type RagInput = {
  question: string;
  topK?: number;
  strategy?: ChunkStrategy;
  useRerank?: boolean;
  useHybrid?: boolean;
  hybridAlpha?: number;
};

function buildCitations(
  indexes: number[],
  passages: ChatResponse["passages"],
): ChatResponse["citations"] {
  return indexes
    .map((index) => {
      const passage = passages[index - 1];
      if (!passage) return null;
      return {
        index,
        documentId: passage.documentId,
        source: passage.source,
        chunkId: passage.chunkId,
      };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null);
}

function resolveCitationIndexes(input: {
  fromLlm: number[];
  grounded: boolean;
  answer: string;
  passageCount: number;
}): number[] {
  const valid = (n: number) => Number.isInteger(n) && n >= 1 && n <= input.passageCount;
  const fromLlm = [...new Set(input.fromLlm.filter(valid))];
  if (fromLlm.length) return fromLlm;
  if (!input.grounded) return [];
  const fromText = [
    ...new Set(
      [...input.answer.matchAll(/\[(\d+)\]/g)]
        .map((m) => Number(m[1]))
        .filter(valid),
    ),
  ];
  if (fromText.length) return fromText;
  return Array.from({ length: input.passageCount }, (_, i) => i + 1);
}

export class RagAnswer {
  constructor(
    private readonly search: SemanticSearch,
    private readonly llm: LlmClient,
    private readonly analytics: SearchAnalyticsRepository,
  ) {}

  async execute(input: RagInput): Promise<ChatResponse> {
    const started = Date.now();
    const searchResult = await this.search.execute({
      query: input.question,
      topK: input.topK,
      strategy: input.strategy,
      useRerank: input.useRerank,
      useHybrid: input.useHybrid,
      hybridAlpha: input.hybridAlpha,
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

    const citationIndexes = resolveCitationIndexes({
      fromLlm: llmResult.usedCitationIndexes,
      grounded: llmResult.grounded,
      answer: llmResult.answer,
      passageCount: indexedPassages.length,
    });
    const citations = buildCitations(citationIndexes, searchResult.passages);
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
      hybrid: searchResult.hybrid,
      hybridAlpha: searchResult.hybridAlpha,
      reranked: searchResult.reranked,
      traceId,
    };
  }

  async *executeStream(input: RagInput): AsyncGenerator<ChatStreamEvent> {
    const started = Date.now();
    const searchResult = await this.search.execute({
      query: input.question,
      topK: input.topK,
      strategy: input.strategy,
      useRerank: input.useRerank,
      useHybrid: input.useHybrid,
      hybridAlpha: input.hybridAlpha,
      log: false,
    });

    const traceId = searchResult.traceId || getTraceId() || crypto.randomUUID();

    yield {
      type: "meta",
      question: input.question,
      strategy: searchResult.strategy,
      hybrid: searchResult.hybrid,
      hybridAlpha: searchResult.hybridAlpha,
      reranked: searchResult.reranked,
      traceId,
    };

    yield {
      type: "passages",
      passages: searchResult.passages,
    };

    const indexedPassages = searchResult.passages.map((p, i) => ({
      index: i + 1,
      source: p.source,
      text: p.text,
    }));

    const stream = this.llm.streamAnswerWithContext({
      question: input.question,
      passages: indexedPassages,
    });

    let llmResult = await stream.next();
    while (!llmResult.done) {
      yield { type: "delta", text: llmResult.value };
      llmResult = await stream.next();
    }

    const finalLlm = llmResult.value;
    const citationIndexes = resolveCitationIndexes({
      fromLlm: finalLlm.usedCitationIndexes,
      grounded: finalLlm.grounded,
      answer: finalLlm.answer,
      passageCount: indexedPassages.length,
    });
    const citations = buildCitations(citationIndexes, searchResult.passages);
    const latencyMs = Date.now() - started;
    const ctx = getContext();

    await this.analytics.log({
      query: input.question,
      strategy: searchResult.strategy,
      topK: input.topK ?? searchResult.passages.length,
      hitCount: searchResult.passages.length,
      latencyMs,
      userId: ctx?.userId,
      grounded: finalLlm.grounded,
      traceId,
    });

    logger.info(
      {
        traceId,
        grounded: finalLlm.grounded,
        hits: searchResult.passages.length,
        latencyMs,
        streamed: true,
      },
      "RAG answer streamed",
    );

    const result: ChatResponse = {
      question: input.question,
      answer: finalLlm.answer,
      grounded: finalLlm.grounded,
      passages: searchResult.passages,
      citations,
      strategy: searchResult.strategy,
      hybrid: searchResult.hybrid,
      hybridAlpha: searchResult.hybridAlpha,
      reranked: searchResult.reranked,
      traceId,
    };

    yield { type: "done", result };
  }
}
