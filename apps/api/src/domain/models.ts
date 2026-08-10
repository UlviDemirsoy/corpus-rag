import type { ChunkStrategy, DocumentStatus, Role } from "@rag/shared";

export type User = {
  id: string;
  email: string;
  name: string;
  role: Role;
};

export type Document = {
  id: string;
  path: string;
  title: string;
  contentHash: string;
  status: DocumentStatus;
  chunkCount: number;
  strategy: ChunkStrategy | null;
  errorMessage: string | null;
  indexedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type TextChunk = {
  id: string;
  documentId: string;
  source: string;
  text: string;
  index: number;
  strategy: ChunkStrategy;
};

export type VectorPoint = {
  id: string;
  vector: number[];
  payload: {
    documentId: string;
    chunkId: string;
    source: string;
    text: string;
    strategy: ChunkStrategy;
    chunkIndex: number;
  };
};

export type ScoredChunk = {
  chunkId: string;
  documentId: string;
  source: string;
  text: string;
  score: number;
  strategy: ChunkStrategy;
};
