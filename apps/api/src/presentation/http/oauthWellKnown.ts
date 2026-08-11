import type { Express, Request, Response } from "express";
import type { Container } from "../../composition/container.js";
import { logger } from "../../infrastructure/logging/logger.js";

function expressHeadersToWeb(req: Request): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    headers.set(key, Array.isArray(value) ? value.join(", ") : value);
  }
  return headers;
}

const corsJson = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
} as const;

/**
 * Root `/.well-known/*` for MCP clients that probe the site origin
 * (Better Auth also serves the same under `/api/auth/.well-known/*`).
 */
export function mountOAuthWellKnown(app: Express, container: Container) {
  const sendOptions = (_req: Request, res: Response) => {
    res.set(corsJson).status(204).end();
  };

  app.options("/.well-known/oauth-authorization-server", sendOptions);
  app.get("/.well-known/oauth-authorization-server", async (req, res) => {
    try {
      const metadata = await container.auth.api.getMcpOAuthConfig({
        headers: expressHeadersToWeb(req),
      });
      res.set(corsJson).status(200).json(metadata);
    } catch (err) {
      logger.error({ err }, "OAuth AS metadata failed");
      res.set(corsJson).status(500).json({ error: "metadata_unavailable" });
    }
  });

  const protectedResource = async (req: Request, res: Response) => {
    try {
      const metadata = await container.auth.api.getMCPProtectedResource({
        headers: expressHeadersToWeb(req),
      });
      res.set(corsJson).status(200).json(metadata);
    } catch (err) {
      logger.error({ err }, "OAuth PR metadata failed");
      res.set(corsJson).status(500).json({ error: "metadata_unavailable" });
    }
  };

  app.options("/.well-known/oauth-protected-resource", sendOptions);
  app.get("/.well-known/oauth-protected-resource", (req, res) => {
    void protectedResource(req, res);
  });
  // Path-aware discovery for resource https://host/mcp
  app.options("/.well-known/oauth-protected-resource/mcp", sendOptions);
  app.get("/.well-known/oauth-protected-resource/mcp", (req, res) => {
    void protectedResource(req, res);
  });
}
