import { asc, count, eq, sql } from "drizzle-orm";
import type { Role } from "@rag/shared";
import type { ManagedUser, UserRepository } from "../../../domain/user/UserRepository.js";
import type { Db } from "../client.js";
import { user } from "../schema.js";

function mapUser(row: typeof user.$inferSelect): ManagedUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class DrizzleUserRepository implements UserRepository {
  constructor(private readonly db: Db) {}

  async list(): Promise<ManagedUser[]> {
    const rows = await this.db.select().from(user).orderBy(asc(user.createdAt));
    return rows.map(mapUser);
  }

  async findById(id: string): Promise<ManagedUser | null> {
    const rows = await this.db.select().from(user).where(eq(user.id, id)).limit(1);
    return rows[0] ? mapUser(rows[0]) : null;
  }

  async findByEmail(email: string): Promise<ManagedUser | null> {
    const normalized = email.trim().toLowerCase();
    const rows = await this.db
      .select()
      .from(user)
      .where(sql`lower(${user.email}) = ${normalized}`)
      .limit(1);
    return rows[0] ? mapUser(rows[0]) : null;
  }

  async updateRole(id: string, role: Role): Promise<ManagedUser> {
    const rows = await this.db
      .update(user)
      .set({ role, updatedAt: new Date() })
      .where(eq(user.id, id))
      .returning();
    return mapUser(rows[0]!);
  }

  async countByRole(role: Role): Promise<number> {
    const rows = await this.db
      .select({ value: count() })
      .from(user)
      .where(eq(user.role, role));
    return Number(rows[0]?.value ?? 0);
  }
}
