import cors from "cors";
import express from "express";
import { toNodeHandler } from "better-auth/node";
import type { Container } from "../../composition/container.js";
import { env } from "../../config/env.js";
import { logger } from "../../infrastructure/logging/logger.js";
import { mountHttpMcp } from "../mcp/httpMcp.js";
import { errorHandler, traceMiddleware } from "./middleware/errorHandler.js";
import { mountOAuthWellKnown } from "./oauthWellKnown.js";
import { createRouter } from "./routes.js";

export function createHttpServer(container: Container) {
  const app = express();

  // Remote MCP clients (Cursor, etc.) — permissive CORS on MCP paths only
  const mcpCors = cors({
    origin: true,
    exposedHeaders: ["WWW-Authenticate"],
  });
  app.use("/mcp", mcpCors);
  app.use("/api/mcp", mcpCors);
  app.use("/.well-known", cors({ origin: true }));
  app.use(
    cors({
      origin: env.WEB_ORIGIN,
      credentials: true,
    }),
  );
  app.use(traceMiddleware);

  // better-auth must receive the raw body; mount before express.json()
  app.all("/api/auth/*", toNodeHandler(container.auth));

  app.use(express.json({ limit: "2mb" }));

  app.use((req, res, next) => {
    const started = Date.now();
    res.on("finish", () => {
      logger.info(
        {
          method: req.method,
          path: req.originalUrl,
          status: res.statusCode,
          durationMs: Date.now() - started,
        },
        "HTTP request",
      );
    });
    next();
  });

  mountOAuthWellKnown(app, container);
  // Remote MCP (Streamable HTTP) — OAuth required
  mountHttpMcp(app, container);

  app.use("/api", createRouter(container));
  app.use(errorHandler);

  return app;
}
