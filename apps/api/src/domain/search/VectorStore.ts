import type { ChunkStrategy } from "@rag/shared";
import type { ScoredChunk, VectorPoint } from "../models.js";

export type IndexHealth = {
  collection: string;
  strategy: ChunkStrategy;
  pointsCount: number;
  status: string;
};

export interface VectorStore {
  ensureCollection(strategy: ChunkStrategy, vectorSize: number): Promise<void>;
  upsert(strategy: ChunkStrategy, points: VectorPoint[]): Promise<void>;
  deleteByDocumentId(strategy: ChunkStrategy, documentId: string): Promise<void>;
  search(
    strategy: ChunkStrategy,
    embedding: number[],
    topK: number,
  ): Promise<ScoredChunk[]>;
  getHealth(strategy: ChunkStrategy): Promise<IndexHealth>;
}
