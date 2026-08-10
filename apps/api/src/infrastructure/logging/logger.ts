import pino from "pino";
import { env } from "../../config/env.js";
import { getContext } from "../context/httpContext.js";

export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: "rag-api" },
  mixin() {
    const ctx = getContext();
    if (!ctx) return {};
    return {
      traceId: ctx.traceId,
      requestId: ctx.requestId,
      userId: ctx.userId,
      role: ctx.role,
    };
  },
  transport:
    env.NODE_ENV === "development"
      ? { target: "pino-pretty", options: { colorize: true, translateTime: "SYS:standard" } }
      : undefined,
});

export function childLogger(bindings: Record<string, unknown>) {
  return logger.child(bindings);
}
