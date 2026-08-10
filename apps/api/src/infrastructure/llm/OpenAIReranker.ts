import OpenAI from "openai";
import type { ScoredChunk } from "../../domain/models.js";
import type { Reranker } from "../../domain/search/Reranker.js";
import { env } from "../../config/env.js";
import { withRetry } from "../resilience/retry.js";
import { logger } from "../logging/logger.js";

const SYSTEM = `You are a relevance ranker for a RAG system.
Score how relevant each passage is to answering the query.
Return ONLY JSON: {"scores":[{"index":number,"score":number}]}
- index is the passage index (0-based)
- score is a float from 0 to 1 (1 = highly relevant)
- Include every passage exactly once.`;

const MAX_PASSAGE_CHARS = 1200;

export class OpenAIReranker implements Reranker {
  private readonly client: OpenAI;

  constructor(
    private readonly model = env.CHAT_MODEL,
    apiKey = env.OPENAI_API_KEY,
  ) {
    this.client = new OpenAI({ apiKey });
  }

  async rerank(query: string, passages: ScoredChunk[]): Promise<ScoredChunk[]> {
    if (passages.length <= 1) return passages;

    const listed = passages
      .map((p, index) => {
        const text =
          p.text.length > MAX_PASSAGE_CHARS
            ? `${p.text.slice(0, MAX_PASSAGE_CHARS)}…`
            : p.text;
        return `[${index}] (${p.source})\n${text}`;
      })
      .join("\n\n");

    try {
      const completion = await withRetry("openai.rerank", async () =>
        this.client.chat.completions.create({
          model: this.model,
          temperature: 0,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: SYSTEM },
            {
              role: "user",
              content: `Query: ${query}\n\nPassages:\n${listed}\n\nReturn JSON scores for all ${passages.length} passages.`,
            },
          ],
        }),
      );

      const raw = completion.choices[0]?.message?.content ?? "{}";
      const parsed = JSON.parse(raw) as {
        scores?: Array<{ index?: number; score?: number }>;
      };
      const scoreList = Array.isArray(parsed.scores) ? parsed.scores : [];
      const byIndex = new Map<number, number>();
      for (const item of scoreList) {
        if (typeof item.index !== "number" || typeof item.score !== "number") continue;
        if (item.index < 0 || item.index >= passages.length) continue;
        byIndex.set(item.index, Math.min(1, Math.max(0, item.score)));
      }

      if (byIndex.size === 0) {
        logger.warn({ raw }, "Rerank returned no usable scores; keeping vector order");
        return passages;
      }

      return passages
        .map((p, index) => ({
          ...p,
          score: byIndex.get(index) ?? 0,
        }))
        .sort((a, b) => b.score - a.score);
    } catch (err) {
      logger.warn({ err }, "Rerank failed; keeping vector order");
      return passages;
    }
  }
}
