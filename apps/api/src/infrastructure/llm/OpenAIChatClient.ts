import OpenAI from "openai";
import type { GroundedAnswer, LlmClient, PassageForLlm } from "../../domain/search/LlmClient.js";
import { env } from "../../config/env.js";
import { withRetry } from "../resilience/retry.js";
import { logger } from "../logging/logger.js";

const SYSTEM_JSON = `You are a careful RAG assistant. Answer ONLY using the provided passages.
Rules:
- If the passages do not contain enough information, say you cannot find the answer in the corpus and set grounded=false with citations=[].
- Do not invent facts.
- When grounded=true, cite sources inline in the answer using [n] where n is the passage index, and list those same indexes in the citations array.
- Only cite passage indexes that actually support the answer.
- Keep answers concise and grounded.`;

const SYSTEM_STREAM = `You are a careful RAG assistant. Answer ONLY using the provided passages.
Rules:
- Write a plain-text answer (no JSON).
- If the passages do not contain enough information, say clearly that you could not find the answer in the corpus. Do not invent facts.
- When you can answer, cite supporting passages inline with [n] (passage index).
- Keep answers concise and grounded.`;

const EMPTY_ANSWER =
  "I could not find relevant information in the indexed corpus for this question.";

function formatContext(passages: PassageForLlm[]): string {
  return passages.map((p) => `[${p.index}] (${p.source})\n${p.text}`).join("\n\n");
}

function parseCitations(answer: string, maxIndex: number): number[] {
  return [
    ...new Set(
      [...answer.matchAll(/\[(\d+)\]/g)]
        .map((m) => Number(m[1]))
        .filter((n) => Number.isInteger(n) && n >= 1 && n <= maxIndex),
    ),
  ];
}

function inferGrounded(answer: string, citations: number[]): boolean {
  const lower = answer.toLowerCase();
  const refusal =
    lower.includes("could not find") ||
    lower.includes("cannot find") ||
    lower.includes("don't contain") ||
    lower.includes("do not contain") ||
    lower.includes("not in the corpus") ||
    lower.includes("no relevant information");
  if (refusal && citations.length === 0) return false;
  return answer.trim().length > 0 && (!refusal || citations.length > 0);
}

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
    passages: PassageForLlm[];
  }): Promise<GroundedAnswer> {
    if (input.passages.length === 0) {
      return {
        answer: EMPTY_ANSWER,
        grounded: false,
        usedCitationIndexes: [],
      };
    }

    const context = formatContext(input.passages);
    const completion = await withRetry("openai.chat", async () =>
      this.client.chat.completions.create({
        model: this.model,
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_JSON },
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
        answer: parsed.answer ?? EMPTY_ANSWER,
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

  async *streamAnswerWithContext(input: {
    question: string;
    passages: PassageForLlm[];
  }): AsyncGenerator<string, GroundedAnswer, void> {
    if (input.passages.length === 0) {
      yield EMPTY_ANSWER;
      return {
        answer: EMPTY_ANSWER,
        grounded: false,
        usedCitationIndexes: [],
      };
    }

    const context = formatContext(input.passages);
    const stream = await withRetry("openai.chat.stream", async () =>
      this.client.chat.completions.create({
        model: this.model,
        temperature: 0.1,
        stream: true,
        messages: [
          { role: "system", content: SYSTEM_STREAM },
          {
            role: "user",
            content: `Question: ${input.question}\n\nPassages:\n${context}\n\nWrite the grounded answer now.`,
          },
        ],
      }),
    );

    let full = "";
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (!delta) continue;
      full += delta;
      yield delta;
    }

    const usedCitationIndexes = parseCitations(full, input.passages.length);
    const grounded = inferGrounded(full, usedCitationIndexes);
    return {
      answer: full.trim() || EMPTY_ANSWER,
      grounded,
      usedCitationIndexes: grounded ? usedCitationIndexes : [],
    };
  }
}
