import { apiFetch } from "./api-client";

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: "user" | "admin";
};

export async function getMe(): Promise<SessionUser | null> {
  try {
    const data = await apiFetch<{ user: SessionUser }>("/api/me");
    return data.user;
  } catch {
    return null;
  }
}

export async function signIn(email: string, password: string) {
  return apiFetch("/api/auth/sign-in/email", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

/**
 * Sign-in that follows Better Auth MCP OAuth continue redirects
 * (oidc_login_prompt cookie → authorize → Cursor callback).
 */
export async function signInEmailContinue(
  email: string,
  password: string,
): Promise<{ redirected: boolean }> {
  const res = await fetch("/api/auth/sign-in/email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    redirect: "manual",
    body: JSON.stringify({ email, password }),
  });

  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get("Location");
    if (loc) {
      window.location.href = loc;
      return { redirected: true };
    }
  }

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { message?: string; detail?: string };
      detail = body.detail ?? body.message ?? detail;
    } catch {
      // ignore
    }
    throw new Error(detail);
  }

  return { redirected: false };
}

export async function signUp(input: {
  email: string;
  password: string;
  name: string;
}) {
  return apiFetch("/api/auth/sign-up/email", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function getAuthOptions(): Promise<{ google: boolean }> {
  try {
    return await apiFetch<{ google: boolean }>("/api/auth-options");
  } catch {
    return { google: false };
  }
}

/** Starts Google OAuth; redirects the browser to Google then back with a session cookie. */
export async function signInWithGoogle(callbackPath = "/chat") {
  const callbackURL =
    typeof window !== "undefined"
      ? `${window.location.origin}${callbackPath}`
      : callbackPath;
  const data = await apiFetch<{ url?: string; redirect?: boolean }>(
    "/api/auth/sign-in/social",
    {
      method: "POST",
      body: JSON.stringify({ provider: "google", callbackURL }),
    },
  );
  if (data.url) {
    window.location.href = data.url;
    return;
  }
  throw new Error("Google sign-in did not return a redirect URL");
}

/** After login, continue MCP authorize if OAuth query params are present. */
export function mcpAuthorizeContinuePath(search: string): string | null {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  if (!params.has("client_id")) return null;
  return `/api/auth/mcp/authorize?${params.toString()}`;
}
