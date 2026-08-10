import type { ChunkStrategy, DocumentStatus } from "@rag/shared";
import type { Document } from "../models.js";

export type UpsertDocumentInput = {
  path: string;
  title: string;
  contentHash: string;
  status: DocumentStatus;
  chunkCount: number;
  strategy: ChunkStrategy | null;
  errorMessage?: string | null;
  indexedAt?: Date | null;
};

export interface DocumentRepository {
  list(): Promise<Document[]>;
  findByPath(path: string): Promise<Document | null>;
  upsertByPath(input: UpsertDocumentInput): Promise<Document>;
  markRemovedMissing(activePaths: string[]): Promise<number>;
}
