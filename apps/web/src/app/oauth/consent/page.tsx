"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getProblemMessage } from "@/lib/api-client";

function ConsentForm() {
  const searchParams = useSearchParams();
  const consentCode = searchParams.get("consent_code") ?? "";
  const clientId = searchParams.get("client_id") ?? "MCP client";
  const scope = searchParams.get("scope") ?? "openid profile email";
  const [loading, setLoading] = useState<"accept" | "deny" | null>(null);

  async function decide(accept: boolean) {
    setLoading(accept ? "accept" : "deny");
    try {
      const res = await fetch("/api/auth/oauth2/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        redirect: "manual",
        body: JSON.stringify({
          accept,
          consent_code: consentCode || undefined,
        }),
      });

      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("Location");
        if (loc) {
          window.location.href = loc;
          return;
        }
      }

      if (!res.ok) {
        throw new Error(`Consent failed (HTTP ${res.status})`);
      }

      const data = (await res.json()) as { redirectURI?: string };
      if (data.redirectURI) {
        window.location.href = data.redirectURI;
        return;
      }
      toast.error("No redirect from consent endpoint");
    } catch (err) {
      toast.error(getProblemMessage(err));
    } finally {
      setLoading(null);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md items-center px-4 py-10">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Authorize MCP access</CardTitle>
          <CardDescription>
            <span className="font-medium text-slate-800">{clientId}</span> wants
            access to corpus search via MCP.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-slate-600">
            Scopes: <code className="text-xs">{scope}</code>
          </p>
          <div className="flex gap-3">
            <Button
              className="flex-1"
              disabled={loading !== null || !consentCode}
              onClick={() => void decide(true)}
            >
              {loading === "accept" ? "Allowing..." : "Allow"}
            </Button>
            <Button
              className="flex-1"
              variant="outline"
              disabled={loading !== null || !consentCode}
              onClick={() => void decide(false)}
            >
              {loading === "deny" ? "Denying..." : "Deny"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}

export default function OAuthConsentPage() {
  return (
    <Suspense fallback={<main className="mx-auto min-h-screen max-w-md px-4 py-10" />}>
      <ConsentForm />
    </Suspense>
  );
}
