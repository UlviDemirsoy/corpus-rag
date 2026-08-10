import type { ChunkStrategy } from "@rag/shared";
import type { TextChunk } from "../models.js";

export interface Chunker {
  readonly name: ChunkStrategy;
  chunk(text: string, meta: { documentId: string; source: string }): TextChunk[];
}
