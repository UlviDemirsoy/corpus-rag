import type { NextFunction, Request, Response } from "express";
import type { Role } from "@rag/shared";
import { ForbiddenError, UnauthorizedError } from "../../../domain/errors/AppError.js";
import type { Container } from "../../../composition/container.js";
import { httpContext } from "../../../infrastructure/context/httpContext.js";

export type AuthedRequest = Request & {
  user?: { id: string; email: string; name: string; role: Role };
};

export function createAuthMiddleware(container: Container) {
  return async (req: AuthedRequest, _res: Response, next: NextFunction) => {
    try {
      const session = await container.auth.api.getSession({
        headers: fromNodeHeaders(req.headers),
      });
      if (!session) {
        throw new UnauthorizedError();
      }
      const role = (session.user as { role?: Role }).role ?? "user";
      req.user = {
        id: session.user.id,
        email: session.user.email,
        name: session.user.name,
        role,
      };
      const store = httpContext.getStore();
      if (store) {
        store.userId = session.user.id;
        store.role = role;
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

export function requireRole(...roles: Role[]) {
  return (req: AuthedRequest, _res: Response, next: NextFunction) => {
    if (!req.user) {
      next(new UnauthorizedError());
      return;
    }
    if (!roles.includes(req.user.role)) {
      next(new ForbiddenError(`Requires one of roles: ${roles.join(", ")}`));
      return;
    }
    next();
  };
}

/** Convert Node/Express headers to Headers for better-auth. */
function fromNodeHeaders(headers: Request["headers"]): Headers {
  const h = new Headers();
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value) h.append(key, v);
    } else {
      h.set(key, value);
    }
  }
  return h;
}
