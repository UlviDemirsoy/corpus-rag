import type { Express, NextFunction, Request, Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Container } from "../../composition/container.js";
import { env } from "../../config/env.js";
import { logger } from "../../infrastructure/logging/logger.js";
import { createCorpusSearchServer } from "./createCorpusSearchServer.js";

function requireMcpApiKey(req: Request, res: Response, next: NextFunction) {
  if (!env.MCP_API_KEY) {
    next();
    return;
  }
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (token && token === env.MCP_API_KEY) {
    next();
    return;
  }
  res.status(401).json({
    jsonrpc: "2.0",
    error: { code: -32001, message: "Unauthorized: Bearer MCP_API_KEY required" },
    id: null,
  });
}

/**
 * Mount Streamable HTTP MCP at /mcp (and /api/mcp alias).
 * Stateless — safe for Vercel Fluid / multi-instance.
 */
export function mountHttpMcp(app: Express, container: Container) {
  const handler = async (req: Request, res: Response) => {
    const server = createCorpusSearchServer(container);
    const transport = new StreamableHTTPServerTransport({
      // Stateless: no session affinity required on Vercel
      sessionIdGenerator: undefined,
    });

    res.on("close", () => {
      void transport.close();
      void server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      logger.error({ err }, "MCP HTTP request failed");
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal MCP error" },
          id: null,
        });
      }
    }
  };

  const paths = ["/mcp", "/api/mcp"];
  for (const path of paths) {
    app.all(path, requireMcpApiKey, (req, res) => {
      void handler(req, res);
    });
  }

  logger.info(
    { paths, auth: Boolean(env.MCP_API_KEY) },
    "MCP Streamable HTTP mounted",
  );
}
