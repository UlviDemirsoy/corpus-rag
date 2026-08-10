import { z } from "zod";

export const ChunkStrategySchema = z.enum(["fixed", "recursive", "sliding"]);
export type ChunkStrategy = z.infer<typeof ChunkStrategySchema>;

export const RoleSchema = z.enum(["user", "admin"]);
export type Role = z.infer<typeof RoleSchema>;

export const SearchRequestSchema = z.object({
  query: z.string().min(1).max(2000),
  topK: z.number().int().min(1).max(20).optional(),
  strategy: ChunkStrategySchema.optional(),
  /** Override server default; when true, over-fetch then OpenAI-rerank. */
  useRerank: z.boolean().optional(),
  /** Blend dense + BM25 with hybridAlpha. */
  useHybrid: z.boolean().optional(),
  /** α in s = α·densê + (1−α)·BM25̂ ; range [0, 1]. */
  hybridAlpha: z.number().min(0).max(1).optional(),
});
export type SearchRequest = z.infer<typeof SearchRequestSchema>;

export const ChatRequestSchema = z.object({
  question: z.string().min(1).max(4000),
  topK: z.number().int().min(1).max(20).optional(),
  strategy: ChunkStrategySchema.optional(),
  useRerank: z.boolean().optional(),
  useHybrid: z.boolean().optional(),
  hybridAlpha: z.number().min(0).max(1).optional(),
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
  hybrid: z.boolean(),
  hybridAlpha: z.number().min(0).max(1).nullable(),
  reranked: z.boolean(),
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
  hybrid: z.boolean(),
  hybridAlpha: z.number().min(0).max(1).nullable(),
  reranked: z.boolean(),
  traceId: z.string(),
});
export type ChatResponse = z.infer<typeof ChatResponseSchema>;

/** Server-Sent Events payload for POST /api/chat/stream */
export const ChatStreamEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("meta"),
    question: z.string(),
    strategy: ChunkStrategySchema,
    hybrid: z.boolean(),
    hybridAlpha: z.number().min(0).max(1).nullable(),
    reranked: z.boolean(),
    traceId: z.string(),
  }),
  z.object({
    type: z.literal("passages"),
    passages: z.array(PassageSchema),
  }),
  z.object({
    type: z.literal("delta"),
    text: z.string(),
  }),
  z.object({
    type: z.literal("done"),
    result: ChatResponseSchema,
  }),
  z.object({
    type: z.literal("error"),
    message: z.string(),
  }),
]);
export type ChatStreamEvent = z.infer<typeof ChatStreamEventSchema>;

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

export const AdminUserSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  name: z.string(),
  role: RoleSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AdminUser = z.infer<typeof AdminUserSchema>;

export const InviteUserRequestSchema = z.object({
  email: z.string().email().max(320),
  name: z.string().min(1).max(120),
  password: z.string().min(8).max(128),
  role: RoleSchema.default("user"),
});
export type InviteUserRequest = z.infer<typeof InviteUserRequestSchema>;

export const UpdateUserRoleRequestSchema = z.object({
  role: RoleSchema,
});
export type UpdateUserRoleRequest = z.infer<typeof UpdateUserRoleRequestSchema>;
