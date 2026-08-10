import { QdrantClient } from "@qdrant/js-client-rest";
import type { ChunkStrategy } from "@rag/shared";
import type { IndexHealth, VectorStore } from "../../domain/search/VectorStore.js";
import type { ScoredChunk, VectorPoint } from "../../domain/models.js";
import { env } from "../../config/env.js";
import { withRetry } from "../resilience/retry.js";
import { logger } from "../logging/logger.js";

function collectionName(strategy: ChunkStrategy): string {
  return `chunks_${strategy}`;
}

export class QdrantVectorStore implements VectorStore {
  private readonly client: QdrantClient;

  constructor(url = env.QDRANT_URL) {
    this.client = new QdrantClient({ url, checkCompatibility: false });
  }

  async ensureCollection(strategy: ChunkStrategy, vectorSize: number): Promise<void> {
    const name = collectionName(strategy);
    await withRetry(`qdrant.ensureCollection.${name}`, async () => {
      const collections = await this.client.getCollections();
      const exists = collections.collections.some((c) => c.name === name);
      if (exists) return;
      await this.client.createCollection(name, {
        vectors: { size: vectorSize, distance: "Cosine" },
      });
      await this.client.createPayloadIndex(name, {
        field_name: "documentId",
        field_schema: "keyword",
      });
      logger.info({ collection: name, vectorSize }, "Created Qdrant collection");
    });
  }

  async upsert(strategy: ChunkStrategy, points: VectorPoint[]): Promise<void> {
    if (points.length === 0) return;
    const name = collectionName(strategy);
    await withRetry(`qdrant.upsert.${name}`, async () => {
      await this.client.upsert(name, {
        wait: true,
        points: points.map((p) => ({
          id: p.id,
          vector: p.vector,
          payload: p.payload,
        })),
      });
    });
  }

  async deleteByDocumentId(strategy: ChunkStrategy, documentId: string): Promise<void> {
    const name = collectionName(strategy);
    await withRetry(`qdrant.delete.${name}`, async () => {
      const collections = await this.client.getCollections();
      if (!collections.collections.some((c) => c.name === name)) return;
      await this.client.delete(name, {
        wait: true,
        filter: {
          must: [{ key: "documentId", match: { value: documentId } }],
        },
      });
    });
  }

  async search(
    strategy: ChunkStrategy,
    embedding: number[],
    topK: number,
  ): Promise<ScoredChunk[]> {
    const name = collectionName(strategy);
    return withRetry(`qdrant.search.${name}`, async () => {
      const collections = await this.client.getCollections();
      if (!collections.collections.some((c) => c.name === name)) return [];

      const results = await this.client.query(name, {
        query: embedding,
        limit: topK,
        with_payload: true,
      });

      return (results.points ?? []).map((r) => {
        const payload = (r.payload ?? {}) as Record<string, unknown>;
        return {
          chunkId: String(payload.chunkId ?? r.id),
          documentId: String(payload.documentId ?? ""),
          source: String(payload.source ?? ""),
          text: String(payload.text ?? ""),
          score: r.score ?? 0,
          strategy,
        };
      });
    });
  }

  async getHealth(strategy: ChunkStrategy): Promise<IndexHealth> {
    const name = collectionName(strategy);
    return withRetry(`qdrant.health.${name}`, async () => {
      const collections = await this.client.getCollections();
      const exists = collections.collections.some((c) => c.name === name);
      if (!exists) {
        return { collection: name, strategy, pointsCount: 0, status: "missing" };
      }
      const info = await this.client.getCollection(name);
      const pointsCount =
        typeof info.points_count === "number" ? info.points_count : Number(info.points_count ?? 0);
      return {
        collection: name,
        strategy,
        pointsCount,
        status: String(info.status ?? "unknown"),
      };
    });
  }
}
