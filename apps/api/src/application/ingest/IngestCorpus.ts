import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, extname, join, relative, resolve } from "node:path";
import type { ChunkStrategy } from "@rag/shared";
import type { DocumentRepository } from "../../domain/document/DocumentRepository.js";
import type { IngestionJobRepository } from "../../domain/ingestion/IngestionJobRepository.js";
import type { Embedder } from "../../domain/search/Embedder.js";
import type { VectorStore } from "../../domain/search/VectorStore.js";
import type { VectorPoint } from "../../domain/models.js";
import { getChunker } from "../../infrastructure/chunking/chunkers.js";
import { logger } from "../../infrastructure/logging/logger.js";
import { getTraceId } from "../../infrastructure/context/httpContext.js";

const TEXT_EXTS = new Set([".md", ".txt", ".markdown", ".json", ".csv"]);

async function walkFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
        await walk(full);
      } else if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase();
        if (TEXT_EXTS.has(ext) || ext === "") {
          const s = await stat(full);
          if (s.size > 0 && s.size < 2_000_000) out.push(full);
        }
      }
    }
  }
  await walk(root);
  return out.sort();
}

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export class IngestCorpus {
  constructor(
    private readonly docs: DocumentRepository,
    private readonly jobs: IngestionJobRepository,
    private readonly vectors: VectorStore,
    private readonly embedder: Embedder,
    private readonly onIndexChange?: (strategy: ChunkStrategy) => void,
  ) {}

  async execute(input: {
    corpusPath: string;
    strategy: ChunkStrategy;
  }) {
    const corpusPath = resolve(input.corpusPath);
    const strategy = input.strategy;
    const chunker = getChunker(strategy);
    const job = await this.jobs.create({ strategy, corpusPath });
    const traceId = getTraceId();

    logger.info({ jobId: job.id, corpusPath, strategy, traceId }, "Ingestion started");

    await this.jobs.update(job.id, {
      status: "running",
      startedAt: new Date(),
    });

    try {
      await this.vectors.ensureCollection(strategy, this.embedder.dimensions);
      const files = await walkFiles(corpusPath);
      await this.jobs.update(job.id, { totalFiles: files.length });

      let processed = 0;
      let failed = 0;

      for (const filePath of files) {
        const rel = relative(corpusPath, filePath).replace(/\\/g, "/");
        try {
          const content = await readFile(filePath, "utf8");
          const contentHash = hashContent(content);
          const existing = await this.docs.findByPath(rel);

          if (
            existing &&
            existing.contentHash === contentHash &&
            existing.status === "indexed" &&
            existing.strategy === strategy
          ) {
            processed += 1;
            await this.jobs.update(job.id, { processedFiles: processed, failedFiles: failed });
            continue;
          }

          const title = basename(filePath);
          const provisional = await this.docs.upsertByPath({
            path: rel,
            title,
            contentHash,
            status: "pending",
            chunkCount: 0,
            strategy,
            errorMessage: null,
          });

          await this.vectors.deleteByDocumentId(strategy, provisional.id);
          const chunks = chunker.chunk(content, {
            documentId: provisional.id,
            source: rel,
          });

          const batchSize = 32;
          for (let i = 0; i < chunks.length; i += batchSize) {
            const batch = chunks.slice(i, i + batchSize);
            const embeddings = await this.embedder.embed(batch.map((c) => c.text));
            const points: VectorPoint[] = batch.map((c, idx) => ({
              id: c.id,
              vector: embeddings[idx],
              payload: {
                documentId: c.documentId,
                chunkId: c.id,
                source: c.source,
                text: c.text,
                strategy: c.strategy,
                chunkIndex: c.index,
              },
            }));
            await this.vectors.upsert(strategy, points);
          }

          await this.docs.upsertByPath({
            path: rel,
            title,
            contentHash,
            status: "indexed",
            chunkCount: chunks.length,
            strategy,
            errorMessage: null,
            indexedAt: new Date(),
          });
          processed += 1;
        } catch (err) {
          failed += 1;
          const message = err instanceof Error ? err.message : String(err);
          logger.error({ err, file: rel, jobId: job.id }, "Failed to ingest file");
          await this.docs.upsertByPath({
            path: rel,
            title: basename(filePath),
            contentHash: "unknown",
            status: "failed",
            chunkCount: 0,
            strategy,
            errorMessage: message,
          });
        }

        await this.jobs.update(job.id, {
          processedFiles: processed,
          failedFiles: failed,
        });
      }

      await this.docs.markRemovedMissing(
        files.map((f) => relative(corpusPath, f).replace(/\\/g, "/")),
      );

      const finalStatus = failed > 0 && processed === 0 ? "failed" : "succeeded";
      const updated = await this.jobs.update(job.id, {
        status: finalStatus,
        finishedAt: new Date(),
        errorMessage:
          failed > 0 ? `${failed} file(s) failed during ingestion` : null,
      });

      logger.info(
        { jobId: job.id, processed, failed, strategy, status: finalStatus },
        "Ingestion finished",
      );
      this.onIndexChange?.(strategy);
      return updated;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err, jobId: job.id }, "Ingestion job failed");
      return this.jobs.update(job.id, {
        status: "failed",
        finishedAt: new Date(),
        errorMessage: message,
      });
    }
  }
}
