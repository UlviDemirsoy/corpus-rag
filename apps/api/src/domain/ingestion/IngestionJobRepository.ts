import type { ChunkStrategy, IngestionJobStatus } from "@rag/shared";

export type IngestionJob = {
  id: string;
  strategy: ChunkStrategy;
  status: IngestionJobStatus;
  corpusPath: string;
  totalFiles: number;
  processedFiles: number;
  failedFiles: number;
  errorMessage: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
};

export interface IngestionJobRepository {
  create(input: {
    strategy: ChunkStrategy;
    corpusPath: string;
  }): Promise<IngestionJob>;
  update(
    id: string,
    patch: Partial<
      Pick<
        IngestionJob,
        | "status"
        | "totalFiles"
        | "processedFiles"
        | "failedFiles"
        | "errorMessage"
        | "startedAt"
        | "finishedAt"
      >
    >,
  ): Promise<IngestionJob>;
  getLatest(): Promise<IngestionJob | null>;
  getById(id: string): Promise<IngestionJob | null>;
  list(limit?: number): Promise<IngestionJob[]>;
}
