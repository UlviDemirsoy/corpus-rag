import type { ChunkStrategy } from "@rag/shared";
import type { ScoredChunk } from "../models.js";

export interface LexicalSearch {
  search(strategy: ChunkStrategy, query: string, topK: number): Promise<ScoredChunk[]>;
}
