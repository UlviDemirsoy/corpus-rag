import type { Express, NextFunction, Request, Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Container } from "../../composition/container.js";
import { env } from "../../config/env.js";
import { logger } from "../../infrastructure/logging/logger.js";
import { createCorpusSearchServer } from "./createCorpusSearchServer.js";

function expressHeadersToWeb(req: Request): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    headers.set(key, Array.isArray(value) ? value.join(", ") : value);
  }
  return headers;
}

function wwwAuthenticate(authBaseUrl: string): string {
  return `Bearer resource_metadata="${authBaseUrl}/.well-known/oauth-protected-resource"`;
}

/**
 * Require Better Auth MCP OAuth access token (or optional shared MCP_API_KEY).
 * Unauthenticated clients get 401 + WWW-Authenticate so Cursor starts OAuth login.
 */
function requireMcpAuth(container: Container) {
  const authBase = `${env.BETTER_AUTH_URL.replace(/\/$/, "")}/api/auth`;

  return async (req: Request, res: Response, next: NextFunction) => {
    if (req.method === "OPTIONS") {
      next();
      return;
    }

    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";

    if (env.MCP_API_KEY && token && token === env.MCP_API_KEY) {
      next();
      return;
    }

    try {
      const session = await container.auth.api.getMcpSession({
        headers: expressHeadersToWeb(req),
      });
      if (session) {
        next();
        return;
      }
    } catch (err) {
      logger.warn({ err }, "MCP session lookup failed");
    }

    const challenge = wwwAuthenticate(authBase);
    res.setHeader("WWW-Authenticate", challenge);
    res.setHeader("Access-Control-Expose-Headers", "WWW-Authenticate");
    res.status(401).json({
      jsonrpc: "2.0",
      error: {
        code: -32001,
        message: "Unauthorized: sign in required (Google or email)",
      },
      id: null,
    });
  };
}

/**
 * Mount Streamable HTTP MCP at /mcp (and /api/mcp alias).
 * Stateless — safe for Vercel Fluid / multi-instance.
 */
export function mountHttpMcp(app: Express, container: Container) {
  const authGate = requireMcpAuth(container);

  const handler = async (req: Request, res: Response) => {
    const server = createCorpusSearchServer(container);
    const transport = new StreamableHTTPServerTransport({
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
    app.all(path, (req, res, next) => {
      void authGate(req, res, next);
    }, (req, res) => {
      void handler(req, res);
    });
  }

  logger.info({ paths, auth: "oauth+optional-api-key" }, "MCP Streamable HTTP mounted");
}
