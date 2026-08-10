"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { apiFetch, getProblemMessage } from "@/lib/api-client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type User = { id: string; email: string; name: string; role: "user" | "admin" };

export function AppHeader({ user }: { user: User | null }) {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    try {
      await apiFetch("/api/auth/sign-out", { method: "POST", body: "{}" });
      router.push("/login");
      router.refresh();
    } catch (err) {
      toast.error(getProblemMessage(err));
    }
  }

  const links = [
    { href: "/chat", label: "Chat" },
    ...(user?.role === "admin"
      ? [
          { href: "/dashboard", label: "Dashboard" },
          { href: "/dashboard/users", label: "Users" },
        ]
      : []),
  ];

  return (
    <header className="border-b border-[var(--border)] bg-white/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <div className="flex items-center gap-6">
          <Link href="/chat" className="text-base font-semibold tracking-tight">
            Corpus RAG
          </Link>
          <nav className="flex items-center gap-2">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm",
                  (l.href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(l.href))
                    ? "bg-teal-50 text-teal-900"
                    : "text-slate-600 hover:bg-slate-100",
                )}
              >
                {l.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          {user ? (
            <>
              <span className="hidden text-sm text-slate-600 sm:inline">
                {user.email} · {user.role}
              </span>
              <Button variant="outline" size="sm" onClick={logout}>
                Sign out
              </Button>
            </>
          ) : (
            <Button asChild size="sm">
              <Link href="/login">Sign in</Link>
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
