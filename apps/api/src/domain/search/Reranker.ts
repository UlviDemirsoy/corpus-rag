import type { ScoredChunk } from "../models.js";

export interface Reranker {
  rerank(query: string, passages: ScoredChunk[]): Promise<ScoredChunk[]>;
}
