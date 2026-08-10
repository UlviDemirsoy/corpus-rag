import type { NextFunction, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { AppError } from "../../../domain/errors/AppError.js";
import { httpContext, type RequestContext } from "../../../infrastructure/context/httpContext.js";
import { logger } from "../../../infrastructure/logging/logger.js";

export function traceMiddleware(req: Request, res: Response, next: NextFunction) {
  const headerTrace = req.header("x-trace-id") || req.header("x-request-id");
  const traceId = headerTrace && headerTrace.trim() ? headerTrace.trim() : randomUUID();
  const requestId = randomUUID();

  const ctx: RequestContext = {
    traceId,
    requestId,
    path: req.path,
    method: req.method,
  };

  res.setHeader("x-trace-id", traceId);
  res.setHeader("x-request-id", requestId);

  httpContext.run(ctx, () => next());
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  const ctx = httpContext.getStore();
  const instance = req.originalUrl;

  if (err instanceof AppError) {
    const appErr = err;
    logger.warn(
      { err: appErr, status: appErr.status, code: appErr.code, traceId: ctx?.traceId },
      appErr.title,
    );
    res
      .status(appErr.status)
      .type("application/problem+json")
      .json(appErr.toProblem(instance, ctx?.traceId));
    return;
  }

  logger.error({ err, traceId: ctx?.traceId }, "Unhandled error");
  res.status(500).type("application/problem+json").json({
    type: "urn:problem:internal",
    title: "Internal Server Error",
    status: 500,
    detail: "An unexpected error occurred",
    code: "INTERNAL",
    instance,
    traceId: ctx?.traceId,
  });
}
