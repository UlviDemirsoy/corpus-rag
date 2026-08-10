"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { ChatResponse, ChunkStrategy } from "@rag/shared";
import { AppHeader } from "@/components/app-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { getProblemMessage, streamChat } from "@/lib/api-client";
import { getMe, type SessionUser } from "@/lib/auth";
import { cn } from "@/lib/utils";

/** Pull [n] markers from answer text as a fallback citation set. */
function citationIndexesFromAnswer(answer: string): number[] {
  const found = new Set<number>();
  for (const match of answer.matchAll(/\[(\d+)\]/g)) {
    const n = Number(match[1]);
    if (Number.isInteger(n) && n > 0) found.add(n);
  }
  return [...found].sort((a, b) => a - b);
}

function CitedAnswer({
  answer,
  activeIndex,
  onCiteClick,
}: {
  answer: string;
  activeIndex: number | null;
  onCiteClick: (index: number) => void;
}) {
  const parts = useMemo(() => {
    const nodes: Array<string | { index: number }> = [];
    const re = /\[(\d+)\]/g;
    let last = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(answer)) !== null) {
      if (match.index > last) nodes.push(answer.slice(last, match.index));
      nodes.push({ index: Number(match[1]) });
      last = match.index + match[0].length;
    }
    if (last < answer.length) nodes.push(answer.slice(last));
    return nodes;
  }, [answer]);

  return (
    <p className="whitespace-pre-wrap text-sm leading-6">
      {parts.map((part, i) =>
        typeof part === "string" ? (
          <span key={i}>{part}</span>
        ) : (
          <button
            key={i}
            type="button"
            onClick={() => onCiteClick(part.index)}
            className={cn(
              "mx-0.5 inline-flex translate-y-[-1px] items-center rounded px-1 py-0.5 font-mono text-[11px] font-semibold ring-1 transition",
              activeIndex === part.index
                ? "bg-teal-700 text-white ring-teal-800"
                : "bg-teal-50 text-teal-900 ring-teal-700/20 hover:bg-teal-100",
            )}
            aria-label={`Jump to citation ${part.index}`}
          >
            [{part.index}]
          </button>
        ),
      )}
    </p>
  );
}

export default function ChatPage() {
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [question, setQuestion] = useState(
    "What is the maximum file size for an AppLovin playable, and how does it ship?",
  );
  const [strategy, setStrategy] = useState<ChunkStrategy>("recursive");
  const [useHybrid, setUseHybrid] = useState(true);
  const [hybridAlpha, setHybridAlpha] = useState(0.5);
  const [useRerank, setUseRerank] = useState(true);
  const [loading, setLoading] = useState(false);
  const [streamStatus, setStreamStatus] = useState<string | null>(null);
  const [result, setResult] = useState<ChatResponse | null>(null);
  const [activeCite, setActiveCite] = useState<number | null>(null);

  useEffect(() => {
    getMe().then((u) => {
      if (!u) {
        router.replace("/login");
        return;
      }
      setUser(u);
    });
  }, [router]);

  const citedIndexes = useMemo(() => {
    if (!result) return new Set<number>();
    const fromApi = result.citations.map((c) => c.index);
    const fromText = citationIndexesFromAnswer(result.answer);
    return new Set([...fromApi, ...fromText]);
  }, [result]);

  function focusCitation(index: number) {
    setActiveCite(index);
    const el = document.getElementById(`passage-${index}`);
    el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setActiveCite(null);
    setResult(null);
    setStreamStatus("Retrieving passages...");
    try {
      await streamChat(
        {
          question,
          strategy,
          useHybrid,
          hybridAlpha: useHybrid ? hybridAlpha : undefined,
          useRerank,
        },
        (event) => {
          if (event.type === "meta") {
            setStreamStatus("Passages ready — generating answer...");
            setResult({
              question: event.question,
              answer: "",
              grounded: true,
              passages: [],
              citations: [],
              strategy: event.strategy,
              hybrid: event.hybrid,
              hybridAlpha: event.hybridAlpha,
              reranked: event.reranked,
              traceId: event.traceId,
            });
            return;
          }
          if (event.type === "passages") {
            setResult((prev) =>
              prev
                ? { ...prev, passages: event.passages }
                : prev,
            );
            setStreamStatus("Writing answer...");
            return;
          }
          if (event.type === "delta") {
            setResult((prev) =>
              prev ? { ...prev, answer: prev.answer + event.text } : prev,
            );
            return;
          }
          if (event.type === "done") {
            setResult(event.result);
            setStreamStatus(null);
            if (!event.result.grounded) {
              toast.message("No grounded answer in corpus");
            }
            return;
          }
          if (event.type === "error") {
            toast.error(event.message);
          }
        },
      );
    } catch (err) {
      toast.error(getProblemMessage(err));
      setStreamStatus(null);
    } finally {
      setLoading(false);
      setStreamStatus(null);
    }
  }

  if (!user) {
    return <main className="p-8 text-sm text-slate-600">Loading...</main>;
  }

  const alphaLabel = hybridAlpha.toFixed(2);

  return (
    <div className="min-h-screen">
      <AppHeader user={user} />
      <main className="mx-auto grid max-w-6xl gap-6 px-4 py-6 lg:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader>
            <CardTitle>Ask the corpus</CardTitle>
            <CardDescription>
              Answers are grounded in retrieved passages. Click a [n] citation to jump to its source.
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

              <label
                htmlFor="useHybrid"
                className="flex cursor-pointer items-center gap-2 text-sm text-slate-700"
              >
                <input
                  id="useHybrid"
                  type="checkbox"
                  className="size-4 rounded border-[var(--border)]"
                  checked={useHybrid}
                  onChange={(e) => setUseHybrid(e.target.checked)}
                />
                Use hybrid (dense embeddings + Okapi BM25)
              </label>

              {useHybrid && (
                <div className="space-y-3 rounded-lg border border-[var(--border)] bg-slate-50 p-3">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <Label htmlFor="hybridAlpha">α (dense weight)</Label>
                      <span className="font-mono text-xs text-slate-600">{alphaLabel}</span>
                    </div>
                    <input
                      id="hybridAlpha"
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={hybridAlpha}
                      onChange={(e) => setHybridAlpha(Number(e.target.value))}
                      className="w-full accent-teal-700"
                    />
                    <div className="flex justify-between text-[11px] text-slate-500">
                      <span>α=0 → BM25 only</span>
                      <span>α=1 → dense only</span>
                    </div>
                  </div>
                  <div className="space-y-1 text-xs leading-5 text-slate-700">
                    <p className="font-medium text-slate-900">Fusion formula</p>
                    <p className="font-mono text-[12px]">
                      s = α · densê + (1 − α) · BM25̂
                    </p>
                    <p>
                      Scores are min–max normalized to [0, 1] over the candidate pool, then mixed
                      with α. Current mix:{" "}
                      <span className="font-mono">
                        {alphaLabel}·dense + {(1 - hybridAlpha).toFixed(2)}·BM25
                      </span>
                      .
                    </p>
                  </div>
                </div>
              )}

              <label
                htmlFor="useRerank"
                className="flex cursor-pointer items-center gap-2 text-sm text-slate-700"
              >
                <input
                  id="useRerank"
                  type="checkbox"
                  className="size-4 rounded border-[var(--border)]"
                  checked={useRerank}
                  onChange={(e) => setUseRerank(e.target.checked)}
                />
                Use reranker (over-fetch → OpenAI relevance scores)
              </label>
              <Button type="submit" disabled={loading}>
                {loading ? "Streaming..." : "Ask"}
              </Button>
              {streamStatus ? (
                <p className="text-xs text-slate-500">{streamStatus}</p>
              ) : null}
            </form>

            {result && (
              <div className="mt-6 space-y-3 border-t border-[var(--border)] pt-5">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className={result.grounded ? undefined : "bg-amber-50 text-amber-900 ring-amber-700/20"}>
                    {loading ? "streaming" : result.grounded ? "grounded" : "not grounded"}
                  </Badge>
                  <Badge>{result.strategy}</Badge>
                  <Badge
                    className={
                      result.hybrid
                        ? undefined
                        : "bg-slate-100 text-slate-700 ring-slate-600/10"
                    }
                  >
                    {result.hybrid
                      ? `hybrid α=${(result.hybridAlpha ?? 0).toFixed(2)}`
                      : "dense only"}
                  </Badge>
                  <Badge
                    className={
                      result.reranked
                        ? undefined
                        : "bg-slate-100 text-slate-700 ring-slate-600/10"
                    }
                  >
                    {result.reranked ? "reranked" : "no rerank"}
                  </Badge>
                  <span className="text-xs text-slate-500">trace {result.traceId}</span>
                </div>
                <CitedAnswer
                  answer={result.answer}
                  activeIndex={activeCite}
                  onCiteClick={focusCitation}
                />
                {loading && result.answer ? (
                  <span className="inline-block h-4 w-1 animate-pulse bg-teal-700 align-middle" />
                ) : null}
                {result.citations.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {result.citations.map((c) => (
                      <button
                        key={`${c.chunkId}-${c.index}`}
                        type="button"
                        onClick={() => focusCitation(c.index)}
                      >
                        <Badge
                          className={cn(
                            "cursor-pointer transition",
                            activeCite === c.index && "bg-teal-700 text-white ring-teal-800",
                          )}
                        >
                          [{c.index}] {c.source}
                        </Badge>
                      </button>
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
            <CardDescription>
              Top matching chunks used as context. Cited ones are highlighted.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {!result && (
              <p className="text-sm text-slate-500">Ask a question to see passages.</p>
            )}
            {result?.passages.map((p, idx) => {
              const index = idx + 1;
              const isCited = citedIndexes.has(index);
              const isActive = activeCite === index;
              return (
                <div
                  key={p.chunkId}
                  id={`passage-${index}`}
                  className={cn(
                    "rounded-lg border p-3 transition",
                    isActive
                      ? "border-teal-600 bg-teal-50 ring-2 ring-teal-600/30"
                      : isCited
                        ? "border-teal-300 bg-teal-50/60"
                        : "border-[var(--border)] bg-slate-50",
                  )}
                >
                  <div className="mb-1 flex items-center justify-between gap-2 text-xs text-slate-500">
                    <span className="flex items-center gap-2">
                      <span>
                        [{index}] {p.source}
                      </span>
                      {isCited ? (
                        <Badge className="bg-teal-700 text-white ring-teal-800">cited</Badge>
                      ) : null}
                    </span>
                    <span>score {p.score.toFixed(3)}</span>
                  </div>
                  <p className="text-sm leading-6 text-slate-800">{p.text}</p>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
