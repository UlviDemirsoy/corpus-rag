import type { ChunkStrategy } from "@rag/shared";
import type { ScoredChunk } from "../../domain/models.js";
import type { LexicalSearch } from "../../domain/search/LexicalSearch.js";
import type { VectorStore } from "../../domain/search/VectorStore.js";

const K1 = 1.2;
const B = 0.75;

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((t) => t.length > 1);
}

type IndexedDoc = {
  chunk: ScoredChunk;
  tf: Map<string, number>;
  length: number;
};

/**
 * In-house Okapi BM25 over Qdrant chunk payloads (no npm BM25 package).
 * IDF uses the common form: log(1 + (N - df + 0.5) / (df + 0.5))
 */
export class OkapiBm25LexicalSearch implements LexicalSearch {
  private cache = new Map<ChunkStrategy, { docs: IndexedDoc[]; avgdl: number; df: Map<string, number> }>();

  constructor(private readonly vectors: VectorStore) {}

  invalidate(strategy?: ChunkStrategy): void {
    if (strategy) this.cache.delete(strategy);
    else this.cache.clear();
  }

  async search(strategy: ChunkStrategy, query: string, topK: number): Promise<ScoredChunk[]> {
    const index = await this.getIndex(strategy);
    if (index.docs.length === 0 || topK <= 0) return [];

    const qTerms = tokenize(query);
    if (qTerms.length === 0) return [];

    const N = index.docs.length;
    const scored: ScoredChunk[] = [];

    for (const doc of index.docs) {
      let score = 0;
      for (const term of qTerms) {
        const tf = doc.tf.get(term) ?? 0;
        if (tf === 0) continue;
        const df = index.df.get(term) ?? 0;
        const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
        const denom = tf + K1 * (1 - B + B * (doc.length / index.avgdl));
        score += idf * ((tf * (K1 + 1)) / denom);
      }
      if (score > 0) {
        scored.push({ ...doc.chunk, score });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  private async getIndex(strategy: ChunkStrategy) {
    const cached = this.cache.get(strategy);
    if (cached) return cached;

    const chunks = await this.vectors.listChunks(strategy);
    const docs: IndexedDoc[] = [];
    const df = new Map<string, number>();
    let totalLen = 0;

    for (const chunk of chunks) {
      const tokens = tokenize(chunk.text);
      const tf = new Map<string, number>();
      for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
      for (const t of tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
      docs.push({ chunk: { ...chunk, score: 0 }, tf, length: Math.max(tokens.length, 1) });
      totalLen += Math.max(tokens.length, 1);
    }

    const built = {
      docs,
      avgdl: docs.length === 0 ? 1 : totalLen / docs.length,
      df,
    };
    this.cache.set(strategy, built);
    return built;
  }
}
