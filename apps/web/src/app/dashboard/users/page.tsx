"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { AdminUser, Role } from "@rag/shared";
import { AppHeader } from "@/components/app-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch, getProblemMessage } from "@/lib/api-client";
import { getMe, type SessionUser } from "@/lib/auth";

export default function UsersAdminPage() {
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviting, setInviting] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("user");

  async function loadUsers() {
    const data = await apiFetch<{ users: AdminUser[] }>("/api/admin/users");
    setUsers(data.users);
  }

  useEffect(() => {
    getMe()
      .then(async (u) => {
        if (!u) {
          router.replace("/login");
          return;
        }
        if (u.role !== "admin") {
          toast.error("Admin role required");
          router.replace("/chat");
          return;
        }
        setUser(u);
        await loadUsers();
      })
      .catch((err) => toast.error(getProblemMessage(err)))
      .finally(() => setLoading(false));
  }, [router]);

  async function onInvite(e: FormEvent) {
    e.preventDefault();
    setInviting(true);
    try {
      await apiFetch("/api/admin/users", {
        method: "POST",
        body: JSON.stringify({ name, email, password, role }),
      });
      toast.success("User invited");
      setName("");
      setEmail("");
      setPassword("");
      setRole("user");
      await loadUsers();
    } catch (err) {
      toast.error(getProblemMessage(err));
    } finally {
      setInviting(false);
    }
  }

  async function onRoleChange(target: AdminUser, nextRole: Role) {
    if (target.role === nextRole) return;
    try {
      await apiFetch(`/api/admin/users/${target.id}/role`, {
        method: "PATCH",
        body: JSON.stringify({ role: nextRole }),
      });
      toast.success(`Updated ${target.email} → ${nextRole}`);
      await loadUsers();
      if (user && target.id === user.id) {
        const me = await getMe();
        if (me) setUser(me);
      }
    } catch (err) {
      toast.error(getProblemMessage(err));
    }
  }

  if (!user || loading) {
    return <main className="p-8 text-sm text-slate-600">Loading users...</main>;
  }

  return (
    <div className="min-h-screen">
      <AppHeader user={user} />
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
          <p className="mt-1 text-sm text-slate-600">
            Invite accounts and manage roles. No email delivery — share the password out of band.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Invite user</CardTitle>
            <CardDescription>Creates a login with the chosen role</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="grid gap-4 sm:grid-cols-2" onSubmit={onInvite}>
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Initial password</Label>
                <Input
                  id="password"
                  type="password"
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="role">Role</Label>
                <select
                  id="role"
                  className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm"
                  value={role}
                  onChange={(e) => setRole(e.target.value as Role)}
                >
                  <option value="user">user</option>
                  <option value="admin">admin</option>
                </select>
              </div>
              <div className="sm:col-span-2">
                <Button type="submit" disabled={inviting}>
                  {inviting ? "Inviting..." : "Invite"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>All users</CardTitle>
            <CardDescription>{users.length} account(s)</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-b border-[var(--border)] text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-2 pr-3 font-medium">Name</th>
                  <th className="py-2 pr-3 font-medium">Email</th>
                  <th className="py-2 pr-3 font-medium">Role</th>
                  <th className="py-2 pr-3 font-medium">Created</th>
                  <th className="py-2 font-medium">Manage</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b border-[var(--border)]/70">
                    <td className="py-2.5 pr-3">
                      {u.name}
                      {u.id === user.id ? (
                        <Badge className="ml-2">you</Badge>
                      ) : null}
                    </td>
                    <td className="py-2.5 pr-3 text-slate-700">{u.email}</td>
                    <td className="py-2.5 pr-3">
                      <Badge
                        className={
                          u.role === "admin"
                            ? undefined
                            : "bg-slate-100 text-slate-700 ring-slate-600/10"
                        }
                      >
                        {u.role}
                      </Badge>
                    </td>
                    <td className="py-2.5 pr-3 text-slate-500">
                      {new Date(u.createdAt).toLocaleDateString()}
                    </td>
                    <td className="py-2.5">
                      <select
                        className="h-9 rounded-md border border-[var(--border)] bg-white px-2 text-sm"
                        value={u.role}
                        onChange={(e) => onRoleChange(u, e.target.value as Role)}
                        aria-label={`Role for ${u.email}`}
                      >
                        <option value="user">user</option>
                        <option value="admin">admin</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
