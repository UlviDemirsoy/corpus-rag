"use client";

import Link from "next/link";
import { FormEvent, Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GoogleSignInButton } from "@/components/google-sign-in-button";
import { getProblemMessage } from "@/lib/api-client";
import { mcpAuthorizeContinuePath, signInEmailContinue } from "@/lib/auth";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const oauthContinue = mcpAuthorizeContinuePath(searchParams.toString());
  const [email, setEmail] = useState("user@demo.com");
  const [password, setPassword] = useState("user1234");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const { redirected } = await signInEmailContinue(email, password);
      if (redirected) return;
      if (oauthContinue) {
        window.location.href = oauthContinue;
        return;
      }
      toast.success("Signed in");
      router.push("/chat");
      router.refresh();
    } catch (err) {
      toast.error(getProblemMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md items-center px-4 py-10">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>{oauthContinue ? "Sign in for MCP" : "Sign in"}</CardTitle>
          <CardDescription>
            {oauthContinue
              ? "Sign in with Google or email to authorize Cursor MCP access."
              : "Demo: user@demo.com / user1234 (chat) · admin@demo.com / admin1234 (dashboard)"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={onSubmit}>
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
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <Button className="w-full" disabled={loading} type="submit">
              {loading ? "Signing in..." : "Sign in"}
            </Button>
          </form>
          <div className="mt-4">
            <GoogleSignInButton
              callbackPath={oauthContinue ?? "/chat"}
            />
          </div>
          <p className="mt-4 text-center text-sm text-slate-600">
            No account?{" "}
            <Link className="font-medium text-teal-800 underline" href="/register">
              Register
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<main className="mx-auto min-h-screen max-w-md px-4 py-10" />}>
      <LoginForm />
    </Suspense>
  );
}
