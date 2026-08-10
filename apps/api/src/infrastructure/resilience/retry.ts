import { ServiceUnavailableError } from "../../domain/errors/AppError.js";
import { logger } from "../logging/logger.js";

const TRANSIENT_CODES = new Set([429, 500, 502, 503, 504]);

export function isTransientError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as {
    status?: number;
    statusCode?: number;
    code?: string;
    message?: string;
  };
  const status = e.status ?? e.statusCode;
  if (status && TRANSIENT_CODES.has(status)) return true;
  const code = e.code?.toUpperCase?.() ?? "";
  if (["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN"].includes(code)) {
    return true;
  }
  const msg = (e.message ?? "").toLowerCase();
  return msg.includes("timeout") || msg.includes("temporarily") || msg.includes("rate limit");
}

export async function withRetry<T>(
  label: string,
  fn: () => Promise<T>,
  opts: { retries?: number; minDelayMs?: number; maxDelayMs?: number } = {},
): Promise<T> {
  const retries = opts.retries ?? 3;
  const minDelayMs = opts.minDelayMs ?? 200;
  const maxDelayMs = opts.maxDelayMs ?? 2000;
  let lastError: unknown;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isTransientError(error) || attempt === retries) break;
      const delay = Math.min(maxDelayMs, minDelayMs * 2 ** (attempt - 1));
      logger.warn({ err: error, attempt, delay, label }, "Transient error, retrying");
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  logger.error({ err: lastError, label }, "Operation failed after retries");
  throw new ServiceUnavailableError(`${label} is temporarily unavailable`);
}
