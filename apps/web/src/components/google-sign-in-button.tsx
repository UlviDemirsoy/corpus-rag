"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getProblemMessage } from "@/lib/api-client";
import { getAuthOptions, signInWithGoogle } from "@/lib/auth";

type Props = {
  /** Path (or absolute path+query) to return to after Google OAuth. */
  callbackPath?: string;
};

export function GoogleSignInButton({ callbackPath = "/chat" }: Props) {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getAuthOptions().then((opts) => {
      if (!cancelled) setEnabled(opts.google);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!enabled) return null;

  async function onClick() {
    setLoading(true);
    try {
      await signInWithGoogle(callbackPath);
    } catch (err) {
      toast.error(getProblemMessage(err));
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="relative py-1">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t border-slate-200" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-white px-2 text-slate-500">or</span>
        </div>
      </div>
      <Button
        type="button"
        variant="outline"
        className="w-full"
        disabled={loading}
        onClick={onClick}
      >
        {loading ? "Redirecting..." : "Continue with Google"}
      </Button>
    </div>
  );
}
