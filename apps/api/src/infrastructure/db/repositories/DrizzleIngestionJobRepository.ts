import { desc, eq } from "drizzle-orm";
import type { ChunkStrategy } from "@rag/shared";
import type {
  IngestionJob,
  IngestionJobRepository,
} from "../../../domain/ingestion/IngestionJobRepository.js";
import type { Db } from "../client.js";
import { ingestionJobs } from "../schema.js";

function mapJob(row: typeof ingestionJobs.$inferSelect): IngestionJob {
  return {
    id: row.id,
    strategy: row.strategy,
    status: row.status,
    corpusPath: row.corpusPath,
    totalFiles: row.totalFiles,
    processedFiles: row.processedFiles,
    failedFiles: row.failedFiles,
    errorMessage: row.errorMessage,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    createdAt: row.createdAt,
  };
}

export class DrizzleIngestionJobRepository implements IngestionJobRepository {
  constructor(private readonly db: Db) {}

  async create(input: {
    strategy: ChunkStrategy;
    corpusPath: string;
  }): Promise<IngestionJob> {
    const [row] = await this.db
      .insert(ingestionJobs)
      .values({
        strategy: input.strategy,
        corpusPath: input.corpusPath,
        status: "pending",
      })
      .returning();
    return mapJob(row);
  }

  async update(
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
  ): Promise<IngestionJob> {
    const [row] = await this.db
      .update(ingestionJobs)
      .set(patch)
      .where(eq(ingestionJobs.id, id))
      .returning();
    return mapJob(row);
  }

  async getLatest(): Promise<IngestionJob | null> {
    const rows = await this.db
      .select()
      .from(ingestionJobs)
      .orderBy(desc(ingestionJobs.createdAt))
      .limit(1);
    return rows[0] ? mapJob(rows[0]) : null;
  }

  async getById(id: string): Promise<IngestionJob | null> {
    const rows = await this.db
      .select()
      .from(ingestionJobs)
      .where(eq(ingestionJobs.id, id))
      .limit(1);
    return rows[0] ? mapJob(rows[0]) : null;
  }

  async list(limit = 20): Promise<IngestionJob[]> {
    const rows = await this.db
      .select()
      .from(ingestionJobs)
      .orderBy(desc(ingestionJobs.createdAt))
      .limit(limit);
    return rows.map(mapJob);
  }
}
