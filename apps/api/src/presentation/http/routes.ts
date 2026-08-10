import { Router } from "express";
import {
  ChatRequestSchema,
  IngestRequestSchema,
  SearchRequestSchema,
} from "@rag/shared";
import type { Container } from "../../composition/container.js";
import { ValidationError } from "../../domain/errors/AppError.js";
import { createAuthMiddleware, requireRole, type AuthedRequest } from "./middleware/auth.js";

export function createRouter(container: Container) {
  const router = Router();
  const requireAuth = createAuthMiddleware(container);

  router.get("/health", (_req, res) => {
    res.json({ ok: true, service: "rag-api" });
  });

  router.get("/me", requireAuth, (req: AuthedRequest, res) => {
    res.json({ user: req.user });
  });

  router.post("/search", requireAuth, async (req, res, next) => {
    try {
      const parsed = SearchRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ValidationError("Invalid search request", parsed.error.flatten());
      }
      const result = await container.semanticSearch.execute(parsed.data);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  router.post("/chat", requireAuth, async (req, res, next) => {
    try {
      const parsed = ChatRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ValidationError("Invalid chat request", parsed.error.flatten());
      }
      const result = await container.ragAnswer.execute(parsed.data);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  router.get(
    "/admin/dashboard",
    requireAuth,
    requireRole("admin"),
    async (_req, res, next) => {
      try {
        const data = await container.getDashboardData.execute();
        res.json(data);
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    "/admin/ingest",
    requireAuth,
    requireRole("admin"),
    async (req, res, next) => {
      try {
        const parsed = IngestRequestSchema.safeParse(req.body ?? {});
        if (!parsed.success) {
          throw new ValidationError("Invalid ingest request", parsed.error.flatten());
        }
        const strategy = parsed.data.strategy ?? container.env.CHUNK_STRATEGY;
        const corpusPath = parsed.data.corpusPath ?? container.env.CORPUS_PATH;
        // fire and track via job; await completion for observability in demo
        const job = await container.ingestCorpus.execute({ strategy, corpusPath });
        res.status(202).json({ job });
      } catch (err) {
        next(err);
      }
    },
  );

  router.get(
    "/admin/jobs",
    requireAuth,
    requireRole("admin"),
    async (_req, res, next) => {
      try {
        const jobs = await container.jobs.list(20);
        res.json({ jobs });
      } catch (err) {
        next(err);
      }
    },
  );

  router.get(
    "/admin/documents",
    requireAuth,
    requireRole("admin"),
    async (_req, res, next) => {
      try {
        const documents = await container.documents.list();
        res.json({ documents });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
