import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { Container } from "../../composition/container.js";
import { httpContext } from "../../infrastructure/context/httpContext.js";
import { logger } from "../../infrastructure/logging/logger.js";

export const SEARCH_TOOL_DESCRIPTION = [
  "Search the Playable Factory RAG corpus (mobile playable-ad docs: AppLovin, Unity Ads, IronSource, size limits, HTML5 packaging, store policies).",
  "Use this when the user asks a factual question that may be answered from those docs.",
  "Returns ranked passages with text, source path, score, and strategy — ground your answer in those passages; if evidence is weak or missing, say so.",
  "Defaults (when omitted): strategy=recursive, topK from server env, hybrid/rerank from server env.",
  "Remote MCP: Streamable HTTP at /mcp (optional Bearer MCP_API_KEY). Local stdio also supported.",
].join(" ");

/** Shared MCP server factory (stdio + Streamable HTTP). */
export function createCorpusSearchServer(container: Container): McpServer {
  const server = new McpServer({
    name: "corpus-search",
    version: "1.0.0",
  });

  server.tool(
    "search",
    SEARCH_TOOL_DESCRIPTION,
    {
      query: z
        .string()
        .min(1)
        .describe(
          "Natural-language question or keywords about playable ads / ad networks / packaging. Prefer a full question over a single keyword.",
        ),
      topK: z
        .number()
        .int()
        .min(1)
        .max(20)
        .optional()
        .describe(
          "How many passages to return (1–20). Use 5 for focused answers; 8–12 when exploring or comparing networks.",
        ),
      strategy: z
        .enum(["fixed", "recursive", "sliding"])
        .optional()
        .describe(
          "Which chunk collection to search. recursive (default): markdown/section-aware, best general choice. sliding: shorter windows for exact limits/numbers. fixed: baseline equal-size windows for A/B comparison.",
        ),
      useRerank: z
        .boolean()
        .optional()
        .describe(
          "If true, over-fetch dense candidates then OpenAI-rerank before returning. Prefer true for precision; false for lower latency/cost.",
        ),
      useHybrid: z
        .boolean()
        .optional()
        .describe(
          "If true, blend dense vector similarity with Okapi BM25 lexical scores. Prefer true when the query has exact terms (SDK names, MB limits, API keys).",
        ),
      hybridAlpha: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .describe(
          "Weight for dense vs BM25 when useHybrid=true: score = alpha * dense_norm + (1-alpha) * bm25_norm. 1.0 = dense only, 0.0 = BM25 only, 0.5 = balanced. Ignored when useHybrid=false.",
        ),
    },
    async ({ query, topK, strategy, useRerank, useHybrid, hybridAlpha }) => {
      const traceId = randomUUID();
      return httpContext.run(
        { traceId, requestId: randomUUID(), path: "mcp:search", method: "MCP" },
        async () => {
          logger.info(
            { query, topK, strategy, useRerank, useHybrid, hybridAlpha, traceId },
            "MCP search tool invoked",
          );
          const result = await container.semanticSearch.execute({
            query,
            topK,
            strategy,
            useRerank,
            useHybrid,
            hybridAlpha,
          });
          const guidance =
            result.passages.length === 0
              ? "No passages found. Tell the user the corpus has no supporting evidence; do not invent facts."
              : "Use passages below as evidence. Cite source paths. Prefer higher scores. Do not invent facts beyond this text.";
          return {
            content: [
              {
                type: "text" as const,
                text: `${guidance}\n\n${JSON.stringify(result, null, 2)}`,
              },
            ],
          };
        },
      );
    },
  );

  return server;
}
