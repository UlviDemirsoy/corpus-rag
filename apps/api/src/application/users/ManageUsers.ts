import type { AdminUser, InviteUserRequest, Role } from "@rag/shared";
import type { Auth } from "../../infrastructure/auth/betterAuth.js";
import type { ManagedUser, UserRepository } from "../../domain/user/UserRepository.js";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../../domain/errors/AppError.js";
import { logger } from "../../infrastructure/logging/logger.js";

function toAdminUser(u: ManagedUser): AdminUser {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    createdAt: u.createdAt.toISOString(),
    updatedAt: u.updatedAt.toISOString(),
  };
}

export class ManageUsers {
  constructor(
    private readonly users: UserRepository,
    private readonly auth: Auth,
  ) {}

  async list(): Promise<{ users: AdminUser[] }> {
    const rows = await this.users.list();
    return { users: rows.map(toAdminUser) };
  }

  async invite(input: InviteUserRequest): Promise<{ user: AdminUser }> {
    const email = input.email.trim().toLowerCase();
    const existing = await this.users.findByEmail(email);
    if (existing) {
      throw new ConflictError(`User already exists: ${email}`);
    }

    let createdId: string;
    try {
      const result = await this.auth.api.signUpEmail({
        body: {
          email,
          password: input.password,
          name: input.name.trim(),
        },
      });
      createdId = result.user.id;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/already|exist|unique/i.test(message)) {
        throw new ConflictError(`User already exists: ${email}`);
      }
      logger.error({ err, email }, "Failed to invite user via Better Auth");
      throw new ValidationError(`Could not create user: ${message}`);
    }

    const user =
      input.role === "user"
        ? await this.users.findById(createdId)
        : await this.users.updateRole(createdId, input.role);

    if (!user) {
      throw new NotFoundError("User was created but could not be loaded");
    }

    logger.info({ email, role: user.role, userId: user.id }, "Admin invited user");
    return { user: toAdminUser(user) };
  }

  async updateRole(input: {
    userId: string;
    role: Role;
    actorId: string;
  }): Promise<{ user: AdminUser }> {
    const target = await this.users.findById(input.userId);
    if (!target) {
      throw new NotFoundError("User not found");
    }

    if (target.role === input.role) {
      return { user: toAdminUser(target) };
    }

    if (input.userId === input.actorId && input.role !== "admin") {
      throw new ForbiddenError("You cannot demote your own admin role");
    }

    if (target.role === "admin" && input.role !== "admin") {
      const adminCount = await this.users.countByRole("admin");
      if (adminCount <= 1) {
        throw new ForbiddenError("Cannot demote the last remaining admin");
      }
    }

    const updated = await this.users.updateRole(input.userId, input.role);
    logger.info(
      { userId: updated.id, role: updated.role, actorId: input.actorId },
      "Admin updated user role",
    );
    return { user: toAdminUser(updated) };
  }
}
