"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { ChatResponse, ChunkStrategy } from "@rag/shared";
import { AppHeader } from "@/components/app-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch, getProblemMessage } from "@/lib/api-client";
import { getMe, type SessionUser } from "@/lib/auth";

export default function ChatPage() {
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [question, setQuestion] = useState(
    "What is the maximum file size for an AppLovin playable, and how does it ship?",
  );
  const [strategy, setStrategy] = useState<ChunkStrategy>("recursive");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ChatResponse | null>(null);

  useEffect(() => {
    getMe().then((u) => {
      if (!u) {
        router.replace("/login");
        return;
      }
      setUser(u);
    });
  }, [router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const data = await apiFetch<ChatResponse>("/api/chat", {
        method: "POST",
        body: JSON.stringify({ question, strategy }),
      });
      setResult(data);
      if (!data.grounded) {
        toast.message("No grounded answer in corpus");
      }
    } catch (err) {
      toast.error(getProblemMessage(err));
    } finally {
      setLoading(false);
    }
  }

  if (!user) {
    return <main className="p-8 text-sm text-slate-600">Loading...</main>;
  }

  return (
    <div className="min-h-screen">
      <AppHeader user={user} />
      <main className="mx-auto grid max-w-6xl gap-6 px-4 py-6 lg:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader>
            <CardTitle>Ask the corpus</CardTitle>
            <CardDescription>
              Answers are grounded in retrieved passages. If evidence is missing, the model says so.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={onSubmit}>
              <div className="space-y-2">
                <Label htmlFor="question">Question</Label>
                <Textarea
                  id="question"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="strategy">Chunk strategy</Label>
                <select
                  id="strategy"
                  className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm"
                  value={strategy}
                  onChange={(e) => setStrategy(e.target.value as ChunkStrategy)}
                >
                  <option value="recursive">recursive</option>
                  <option value="fixed">fixed</option>
                  <option value="sliding">sliding</option>
                </select>
              </div>
              <Button type="submit" disabled={loading}>
                {loading ? "Searching..." : "Ask"}
              </Button>
            </form>

            {result && (
              <div className="mt-6 space-y-3 border-t border-[var(--border)] pt-5">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className={result.grounded ? undefined : "bg-amber-50 text-amber-900 ring-amber-700/20"}>
                    {result.grounded ? "grounded" : "not grounded"}
                  </Badge>
                  <Badge>{result.strategy}</Badge>
                  <span className="text-xs text-slate-500">trace {result.traceId}</span>
                </div>
                <p className="whitespace-pre-wrap text-sm leading-6">{result.answer}</p>
                {result.citations.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {result.citations.map((c) => (
                      <Badge key={`${c.chunkId}-${c.index}`}>
                        [{c.index}] {c.source}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Retrieved passages</CardTitle>
            <CardDescription>Top matching chunks used as context</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {!result && (
              <p className="text-sm text-slate-500">Ask a question to see passages.</p>
            )}
            {result?.passages.map((p, idx) => (
              <div
                key={p.chunkId}
                className="rounded-lg border border-[var(--border)] bg-slate-50 p-3"
              >
                <div className="mb-1 flex items-center justify-between gap-2 text-xs text-slate-500">
                  <span>
                    [{idx + 1}] {p.source}
                  </span>
                  <span>score {p.score.toFixed(3)}</span>
                </div>
                <p className="text-sm leading-6 text-slate-800">{p.text}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
