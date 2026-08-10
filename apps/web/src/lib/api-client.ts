import type { ChatStreamEvent, Problem } from "@rag/shared";

/** Prefer same-origin (Next rewrite). Override only if you intentionally call API cross-origin. */
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

export class ApiError extends Error {
  readonly problem: Problem;

  constructor(problem: Problem) {
    super(problem.detail ?? problem.title);
    this.name = "ApiError";
    this.problem = problem;
  }
}

function newTraceId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `web-${Date.now()}`;
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const traceId = newTraceId();
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type") && init.body) {
    headers.set("Content-Type", "application/json");
  }
  headers.set("x-trace-id", traceId);

  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers,
    credentials: "include",
  });

  if (!res.ok) {
    let problem: Problem;
    try {
      problem = (await res.json()) as Problem;
    } catch {
      problem = {
        type: "urn:problem:http",
        title: res.statusText || "Request failed",
        status: res.status,
        detail: `HTTP ${res.status}`,
        traceId,
      };
    }
    if (!problem.traceId) problem.traceId = traceId;
    throw new ApiError(problem);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Consume POST /api/chat/stream SSE events. */
export async function streamChat(
  body: unknown,
  onEvent: (event: ChatStreamEvent) => void,
  init: { signal?: AbortSignal } = {},
): Promise<void> {
  const traceId = newTraceId();
  const res = await fetch(`${API_URL}/api/chat/stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      "x-trace-id": traceId,
    },
    credentials: "include",
    body: JSON.stringify(body),
    signal: init.signal,
  });

  if (!res.ok) {
    let problem: Problem;
    try {
      problem = (await res.json()) as Problem;
    } catch {
      problem = {
        type: "urn:problem:http",
        title: res.statusText || "Request failed",
        status: res.status,
        detail: `HTTP ${res.status}`,
        traceId,
      };
    }
    if (!problem.traceId) problem.traceId = traceId;
    throw new ApiError(problem);
  }

  if (!res.body) {
    throw new Error("Streaming response has no body");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) >= 0) {
      const rawEvent = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const dataLines = rawEvent
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart());
      if (dataLines.length === 0) continue;
      const data = dataLines.join("\n");
      if (data === "[DONE]") return;
      try {
        onEvent(JSON.parse(data) as ChatStreamEvent);
      } catch {
        // ignore malformed chunk
      }
    }
  }
}

export function getProblemMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const base = err.problem.detail ?? err.problem.title;
    return err.problem.traceId ? `${base} (trace: ${err.problem.traceId})` : base;
  }
  if (err instanceof Error) return err.message;
  return "Something went wrong";
}
