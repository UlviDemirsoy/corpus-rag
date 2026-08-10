import OpenAI from "openai";
import type { Embedder } from "../../domain/search/Embedder.js";
import { env } from "../../config/env.js";
import { withRetry } from "../resilience/retry.js";

export class OpenAIEmbedder implements Embedder {
  readonly dimensions = 1536;
  private readonly client: OpenAI;

  constructor(
    private readonly model = env.EMBEDDING_MODEL,
    apiKey = env.OPENAI_API_KEY,
  ) {
    this.client = new OpenAI({ apiKey });
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    return withRetry("openai.embed", async () => {
      const response = await this.client.embeddings.create({
        model: this.model,
        input: texts,
      });
      return response.data
        .sort((a, b) => a.index - b.index)
        .map((d) => d.embedding);
    });
  }

  async embedQuery(text: string): Promise<number[]> {
    const [vec] = await this.embed([text]);
    return vec;
  }
}
