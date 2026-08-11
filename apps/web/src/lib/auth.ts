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
