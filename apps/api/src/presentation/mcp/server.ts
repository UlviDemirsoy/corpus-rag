import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { applyMigrations } from "../../infrastructure/db/migrate.js";
import { createContainer } from "../../composition/container.js";
import { httpContext } from "../../infrastructure/context/httpContext.js";
import { logger } from "../../infrastructure/logging/logger.js";

async function main() {
  await applyMigrations();
  const container = createContainer();
  const server = new McpServer({
    name: "corpus-search",
    version: "1.0.0",
  });

  server.tool(
    "search",
    "Semantic search over the indexed document corpus. Returns relevant passages with scores and sources.",
    {
      query: z.string().min(1).describe("Natural language search query"),
      topK: z.number().int().min(1).max(20).optional().describe("Number of passages to return"),
      strategy: z
        .enum(["fixed", "recursive", "sliding"])
        .optional()
        .describe("Chunking strategy / collection to search"),
      useRerank: z
        .boolean()
        .optional()
        .describe("Over-fetch dense candidates and OpenAI-rerank before returning"),
      useHybrid: z
        .boolean()
        .optional()
        .describe("Blend dense vector scores with Okapi BM25 via hybridAlpha"),
      hybridAlpha: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .describe("α in s = α·densê + (1−α)·BM25̂"),
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
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        },
      );
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("MCP search server started (stdio)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
