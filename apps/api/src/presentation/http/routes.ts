import { Router } from "express";
import {
  ChatRequestSchema,
  IngestRequestSchema,
  InviteUserRequestSchema,
  SearchRequestSchema,
  UpdateUserRoleRequestSchema,
} from "@rag/shared";
import type { Container } from "../../composition/container.js";
import { ValidationError } from "../../domain/errors/AppError.js";
import { isGoogleAuthEnabled } from "../../infrastructure/auth/betterAuth.js";
import { createAuthMiddleware, requireRole, type AuthedRequest } from "./middleware/auth.js";

export function createRouter(container: Container) {
  const router = Router();
  const requireAuth = createAuthMiddleware(container);

  router.get("/health", (_req, res) => {
    res.json({ ok: true, service: "rag-api" });
  });

  /** Public — which login methods the UI should show. */
  router.get("/auth-options", (_req, res) => {
    res.json({ google: isGoogleAuthEnabled() });
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

  router.post("/chat/stream", requireAuth, async (req, res, next) => {
    try {
      const parsed = ChatRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ValidationError("Invalid chat request", parsed.error.flatten());
      }

      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders?.();

      const send = (payload: unknown) => {
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      };

      try {
        for await (const event of container.ragAnswer.executeStream(parsed.data)) {
          send(event);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Stream failed";
        send({ type: "error", message });
      } finally {
        res.write("data: [DONE]\n\n");
        res.end();
      }
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

  router.get(
    "/admin/users",
    requireAuth,
    requireRole("admin"),
    async (_req, res, next) => {
      try {
        const data = await container.manageUsers.list();
        res.json(data);
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    "/admin/users",
    requireAuth,
    requireRole("admin"),
    async (req, res, next) => {
      try {
        const parsed = InviteUserRequestSchema.safeParse(req.body ?? {});
        if (!parsed.success) {
          throw new ValidationError("Invalid invite request", parsed.error.flatten());
        }
        const data = await container.manageUsers.invite(parsed.data);
        res.status(201).json(data);
      } catch (err) {
        next(err);
      }
    },
  );

  router.patch(
    "/admin/users/:id/role",
    requireAuth,
    requireRole("admin"),
    async (req: AuthedRequest, res, next) => {
      try {
        const parsed = UpdateUserRoleRequestSchema.safeParse(req.body ?? {});
        if (!parsed.success) {
          throw new ValidationError("Invalid role update", parsed.error.flatten());
        }
        if (!req.user) {
          throw new ValidationError("Authenticated admin required");
        }
        const data = await container.manageUsers.updateRole({
          userId: String(req.params.id),
          role: parsed.data.role,
          actorId: req.user.id,
        });
        res.json(data);
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
