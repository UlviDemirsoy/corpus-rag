import { AsyncLocalStorage } from "node:async_hooks";
import type { Role } from "@rag/shared";

export type RequestContext = {
  traceId: string;
  requestId: string;
  userId?: string;
  role?: Role;
  path?: string;
  method?: string;
};

export const httpContext = new AsyncLocalStorage<RequestContext>();

export function getContext(): RequestContext | undefined {
  return httpContext.getStore();
}

export function getTraceId(): string | undefined {
  return httpContext.getStore()?.traceId;
}

export function requireContext(): RequestContext {
  const ctx = httpContext.getStore();
  if (!ctx) {
    throw new Error("Request context is not available");
  }
  return ctx;
}
