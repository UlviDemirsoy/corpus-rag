import { createHash } from "node:crypto";
import type { ChunkStrategy } from "@rag/shared";
import type { Chunker } from "../../domain/document/Chunker.js";
import type { TextChunk } from "../../domain/models.js";

/** Approximate tokens via whitespace-ish char heuristic (~4 chars/token). */
function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Deterministic UUID from content (valid Qdrant point id). */
function chunkUuid(seed: string): string {
  const hex = createHash("sha256").update(seed).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function sliceByTokens(text: string, maxTokens: number, overlapTokens: number): string[] {
  if (!text.trim()) return [];
  const maxChars = maxTokens * 4;
  const overlapChars = overlapTokens * 4;
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + maxChars);
    if (end < text.length) {
      const slice = text.slice(start, end);
      const lastBreak = Math.max(slice.lastIndexOf("\n"), slice.lastIndexOf(" "), slice.lastIndexOf(". "));
      if (lastBreak > maxChars * 0.5) {
        end = start + lastBreak + 1;
      }
    }
    const piece = text.slice(start, end).trim();
    if (piece) chunks.push(piece);
    if (end >= text.length) break;
    start = Math.max(0, end - overlapChars);
  }
  return chunks;
}

function toChunks(
  pieces: string[],
  meta: { documentId: string; source: string },
  strategy: ChunkStrategy,
): TextChunk[] {
  return pieces.map((text, index) => ({
    id: chunkUuid(`${meta.documentId}:${strategy}:${index}:${text}`),
    documentId: meta.documentId,
    source: meta.source,
    text,
    index,
    strategy,
  }));
}

export class FixedChunker implements Chunker {
  readonly name = "fixed" as const;
  constructor(
    private readonly size = 512,
    private readonly overlap = 64,
  ) {}

  chunk(text: string, meta: { documentId: string; source: string }): TextChunk[] {
    return toChunks(sliceByTokens(text, this.size, this.overlap), meta, this.name);
  }
}

export class SlidingChunker implements Chunker {
  readonly name = "sliding" as const;
  constructor(
    private readonly size = 256,
    private readonly overlap = 32,
  ) {}

  chunk(text: string, meta: { documentId: string; source: string }): TextChunk[] {
    return toChunks(sliceByTokens(text, this.size, this.overlap), meta, this.name);
  }
}

export class RecursiveChunker implements Chunker {
  readonly name = "recursive" as const;
  constructor(
    private readonly size = 512,
    private readonly overlap = 64,
  ) {}

  chunk(text: string, meta: { documentId: string; source: string }): TextChunk[] {
    const separators = ["\n\n", "\n", ". ", " "];
    const parts = this.splitRecursive(text.trim(), separators);
    const merged: string[] = [];
    let buf = "";
    for (const part of parts) {
      const candidate = buf ? `${buf} ${part}`.replace(/ +/g, " ").trim() : part.trim();
      if (approxTokens(candidate) <= this.size) {
        buf = candidate;
      } else {
        if (buf) merged.push(buf);
        if (approxTokens(part) > this.size) {
          merged.push(...sliceByTokens(part, this.size, this.overlap));
          buf = "";
        } else {
          buf = part.trim();
        }
      }
    }
    if (buf) merged.push(buf);

    if (merged.length <= 1) return toChunks(merged, meta, this.name);
    const withOverlap: string[] = [];
    for (let i = 0; i < merged.length; i++) {
      if (i === 0) {
        withOverlap.push(merged[i]);
        continue;
      }
      const prev = merged[i - 1];
      const overlapText = prev.slice(Math.max(0, prev.length - this.overlap * 4));
      withOverlap.push(`${overlapText} ${merged[i]}`.trim());
    }
    return toChunks(withOverlap, meta, this.name);
  }

  private splitRecursive(text: string, separators: string[]): string[] {
    if (!text) return [];
    if (approxTokens(text) <= this.size || separators.length === 0) {
      return [text];
    }
    const sep = separators[0];
    const rest = separators.slice(1);
    const pieces = text.split(sep);
    const out: string[] = [];
    for (let i = 0; i < pieces.length; i++) {
      const piece = i < pieces.length - 1 ? `${pieces[i]}${sep}` : pieces[i];
      if (!piece.trim()) continue;
      if (approxTokens(piece) > this.size) {
        out.push(...this.splitRecursive(piece, rest));
      } else {
        out.push(piece);
      }
    }
    return out;
  }
}

export function getChunker(strategy: ChunkStrategy): Chunker {
  switch (strategy) {
    case "fixed":
      return new FixedChunker();
    case "sliding":
      return new SlidingChunker();
    case "recursive":
      return new RecursiveChunker();
    default: {
      const _exhaustive: never = strategy;
      return _exhaustive;
    }
  }
}
