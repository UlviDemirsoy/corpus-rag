import type { Problem } from "@rag/shared";

export class AppError extends Error {
  readonly status: number;
  readonly title: string;
  readonly detail?: string;
  readonly code: string;
  readonly type: string;
  readonly extensions?: Record<string, unknown>;

  constructor(params: {
    status: number;
    title: string;
    code: string;
    detail?: string;
    type?: string;
    extensions?: Record<string, unknown>;
  }) {
    super(params.detail ?? params.title);
    this.name = "AppError";
    this.status = params.status;
    this.title = params.title;
    this.detail = params.detail;
    this.code = params.code;
    this.type = params.type ?? `urn:problem:${params.code.toLowerCase()}`;
    this.extensions = params.extensions;
  }

  toProblem(instance?: string, traceId?: string): Problem {
    return {
      type: this.type,
      title: this.title,
      status: this.status,
      detail: this.detail,
      instance,
      code: this.code,
      traceId,
      ...(this.extensions ?? {}),
    };
  }
}

export class ValidationError extends AppError {
  constructor(detail: string, errors?: unknown) {
    super({
      status: 400,
      title: "Bad Request",
      code: "VALIDATION_ERROR",
      detail,
      extensions: errors ? { errors } : undefined,
    });
  }
}

export class UnauthorizedError extends AppError {
  constructor(detail = "Authentication required") {
    super({
      status: 401,
      title: "Unauthorized",
      code: "UNAUTHORIZED",
      detail,
    });
  }
}

export class ForbiddenError extends AppError {
  constructor(detail = "Insufficient permissions") {
    super({
      status: 403,
      title: "Forbidden",
      code: "FORBIDDEN",
      detail,
    });
  }
}

export class NotFoundError extends AppError {
  constructor(detail = "Resource not found") {
    super({
      status: 404,
      title: "Not Found",
      code: "NOT_FOUND",
      detail,
    });
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(detail = "A dependency is temporarily unavailable") {
    super({
      status: 503,
      title: "Service Unavailable",
      code: "SERVICE_UNAVAILABLE",
      detail,
    });
  }
}
