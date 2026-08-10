import OpenAI from "openai";
import type { GroundedAnswer, LlmClient } from "../../domain/search/LlmClient.js";
import { env } from "../../config/env.js";
import { withRetry } from "../resilience/retry.js";
import { logger } from "../logging/logger.js";

const SYSTEM = `You are a careful RAG assistant. Answer ONLY using the provided passages.
Rules:
- If the passages do not contain enough information, say you cannot find the answer in the corpus.
- Do not invent facts.
- Cite sources using [n] where n is the passage index.
- Keep answers concise and grounded.`;

export class OpenAIChatClient implements LlmClient {
  private readonly client: OpenAI;

  constructor(
    private readonly model = env.CHAT_MODEL,
    apiKey = env.OPENAI_API_KEY,
  ) {
    this.client = new OpenAI({ apiKey });
  }

  async answerWithContext(input: {
    question: string;
    passages: Array<{ index: number; source: string; text: string }>;
  }): Promise<GroundedAnswer> {
    if (input.passages.length === 0) {
      return {
        answer:
          "I could not find relevant information in the indexed corpus for this question.",
        grounded: false,
        usedCitationIndexes: [],
      };
    }

    const context = input.passages
      .map((p) => `[${p.index}] (${p.source})\n${p.text}`)
      .join("\n\n");

    const completion = await withRetry("openai.chat", async () =>
      this.client.chat.completions.create({
        model: this.model,
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM },
          {
            role: "user",
            content: `Question: ${input.question}\n\nPassages:\n${context}\n\nReturn JSON: {"answer": string, "grounded": boolean, "citations": number[]}`,
          },
        ],
      }),
    );

    const raw = completion.choices[0]?.message?.content ?? "{}";
    try {
      const parsed = JSON.parse(raw) as {
        answer?: string;
        grounded?: boolean;
        citations?: number[];
      };
      return {
        answer:
          parsed.answer ??
          "I could not find relevant information in the indexed corpus for this question.",
        grounded: Boolean(parsed.grounded),
        usedCitationIndexes: Array.isArray(parsed.citations) ? parsed.citations : [],
      };
    } catch (err) {
      logger.warn({ err, raw }, "Failed to parse LLM JSON; falling back");
      return {
        answer: raw,
        grounded: true,
        usedCitationIndexes: input.passages.map((p) => p.index),
      };
    }
  }
}
