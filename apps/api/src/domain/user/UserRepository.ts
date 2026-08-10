import type { Role } from "@rag/shared";
import type { User } from "../models.js";

export type ManagedUser = User & {
  createdAt: Date;
  updatedAt: Date;
};

export interface UserRepository {
  list(): Promise<ManagedUser[]>;
  findById(id: string): Promise<ManagedUser | null>;
  findByEmail(email: string): Promise<ManagedUser | null>;
  updateRole(id: string, role: Role): Promise<ManagedUser>;
  countByRole(role: Role): Promise<number>;
}
