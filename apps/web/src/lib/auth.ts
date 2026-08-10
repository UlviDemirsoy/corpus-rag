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
