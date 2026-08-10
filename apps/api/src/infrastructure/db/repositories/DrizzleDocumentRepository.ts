import { and, eq, notInArray, sql } from "drizzle-orm";
import type {
  DocumentRepository,
  UpsertDocumentInput,
} from "../../../domain/document/DocumentRepository.js";
import type { Document } from "../../../domain/models.js";
import type { Db } from "../client.js";
import { documents } from "../schema.js";

function mapDoc(row: typeof documents.$inferSelect): Document {
  return {
    id: row.id,
    path: row.path,
    title: row.title,
    contentHash: row.contentHash,
    status: row.status,
    chunkCount: row.chunkCount,
    strategy: row.strategy,
    errorMessage: row.errorMessage,
    indexedAt: row.indexedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class DrizzleDocumentRepository implements DocumentRepository {
  constructor(private readonly db: Db) {}

  async list(): Promise<Document[]> {
    const rows = await this.db.select().from(documents).orderBy(documents.path);
    return rows.map(mapDoc);
  }

  async findByPath(path: string): Promise<Document | null> {
    const rows = await this.db
      .select()
      .from(documents)
      .where(eq(documents.path, path))
      .limit(1);
    return rows[0] ? mapDoc(rows[0]) : null;
  }

  async upsertByPath(input: UpsertDocumentInput): Promise<Document> {
    const existing = await this.findByPath(input.path);
    if (existing) {
      const [row] = await this.db
        .update(documents)
        .set({
          title: input.title,
          contentHash: input.contentHash,
          status: input.status,
          chunkCount: input.chunkCount,
          strategy: input.strategy,
          errorMessage: input.errorMessage ?? null,
          indexedAt: input.indexedAt ?? null,
          updatedAt: new Date(),
        })
        .where(eq(documents.id, existing.id))
        .returning();
      return mapDoc(row);
    }

    const [row] = await this.db
      .insert(documents)
      .values({
        path: input.path,
        title: input.title,
        contentHash: input.contentHash,
        status: input.status,
        chunkCount: input.chunkCount,
        strategy: input.strategy,
        errorMessage: input.errorMessage ?? null,
        indexedAt: input.indexedAt ?? null,
      })
      .returning();
    return mapDoc(row);
  }

  async markRemovedMissing(activePaths: string[]): Promise<number> {
    if (activePaths.length === 0) {
      const result = await this.db
        .update(documents)
        .set({ status: "removed", updatedAt: new Date() })
        .where(sql`${documents.status} <> 'removed'`)
        .returning({ id: documents.id });
      return result.length;
    }
    const result = await this.db
      .update(documents)
      .set({ status: "removed", updatedAt: new Date() })
      .where(and(notInArray(documents.path, activePaths), sql`${documents.status} <> 'removed'`))
      .returning({ id: documents.id });
    return result.length;
  }
}
