import { z } from "zod";

export const ChunkStrategySchema = z.enum(["fixed", "recursive", "sliding"]);
export type ChunkStrategy = z.infer<typeof ChunkStrategySchema>;

export const RoleSchema = z.enum(["user", "admin"]);
export type Role = z.infer<typeof RoleSchema>;

export const SearchRequestSchema = z.object({
  query: z.string().min(1).max(2000),
  topK: z.number().int().min(1).max(20).optional(),
  strategy: ChunkStrategySchema.optional(),
});
export type SearchRequest = z.infer<typeof SearchRequestSchema>;

export const ChatRequestSchema = z.object({
  question: z.string().min(1).max(4000),
  topK: z.number().int().min(1).max(20).optional(),
  strategy: ChunkStrategySchema.optional(),
});
export type ChatRequest = z.infer<typeof ChatRequestSchema>;

export const IngestRequestSchema = z.object({
  strategy: ChunkStrategySchema.optional(),
  corpusPath: z.string().optional(),
});
export type IngestRequest = z.infer<typeof IngestRequestSchema>;

export const PassageSchema = z.object({
  chunkId: z.string(),
  documentId: z.string(),
  source: z.string(),
  text: z.string(),
  score: z.number(),
  strategy: ChunkStrategySchema,
});
export type Passage = z.infer<typeof PassageSchema>;

export const CitationSchema = z.object({
  index: z.number().int(),
  documentId: z.string(),
  source: z.string(),
  chunkId: z.string(),
});
export type Citation = z.infer<typeof CitationSchema>;

export const SearchResponseSchema = z.object({
  query: z.string(),
  passages: z.array(PassageSchema),
  strategy: ChunkStrategySchema,
  traceId: z.string(),
});
export type SearchResponse = z.infer<typeof SearchResponseSchema>;

export const ChatResponseSchema = z.object({
  question: z.string(),
  answer: z.string(),
  grounded: z.boolean(),
  passages: z.array(PassageSchema),
  citations: z.array(CitationSchema),
  strategy: ChunkStrategySchema,
  traceId: z.string(),
});
export type ChatResponse = z.infer<typeof ChatResponseSchema>;

/** RFC 9457 Problem Details */
export const ProblemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string().optional(),
  instance: z.string().optional(),
  code: z.string().optional(),
  traceId: z.string().optional(),
  errors: z.unknown().optional(),
});
export type Problem = z.infer<typeof ProblemSchema>;

export const DocumentStatusSchema = z.enum([
  "pending",
  "indexed",
  "failed",
  "removed",
]);
export type DocumentStatus = z.infer<typeof DocumentStatusSchema>;

export const IngestionJobStatusSchema = z.enum([
  "pending",
  "running",
  "succeeded",
  "failed",
]);
export type IngestionJobStatus = z.infer<typeof IngestionJobStatusSchema>;
