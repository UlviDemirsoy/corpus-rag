"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { ChunkStrategy } from "@rag/shared";
import { AppHeader } from "@/components/app-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { apiFetch, getProblemMessage } from "@/lib/api-client";
import { getMe, type SessionUser } from "@/lib/auth";

type DashboardData = {
  documents: Array<{
    id: string;
    path: string;
    title: string;
    status: string;
    chunkCount: number;
    strategy: string | null;
    errorMessage: string | null;
    indexedAt: string | null;
  }>;
  latestJob: {
    id: string;
    status: string;
    strategy: string;
    totalFiles: number;
    processedFiles: number;
    failedFiles: number;
    errorMessage: string | null;
  } | null;
  recentJobs: Array<{
    id: string;
    status: string;
    strategy: string;
    processedFiles: number;
    failedFiles: number;
    createdAt: string;
  }>;
  searchStats: {
    totalSearches: number;
    avgLatencyMs: number;
    avgHitCount: number;
    groundedRate: number | null;
    last24h: number;
  };
  indexHealth: Array<{
    collection: string;
    strategy: string;
    pointsCount: number;
    status: string;
  }>;
  defaultStrategy: ChunkStrategy;
  selfUpdatingPipeline?: {
    enabled: boolean;
    corpusPath: string;
    debounceMs: number;
    watchAllStrategies: boolean;
    behavior: string;
  };
};

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [data, setData] = useState<DashboardData | null>(null);
  const [strategy, setStrategy] = useState<ChunkStrategy>("recursive");
  const [ingesting, setIngesting] = useState(false);

  async function load() {
    const dashboard = await apiFetch<DashboardData>("/api/admin/dashboard");
    setData(dashboard);
    setStrategy(dashboard.defaultStrategy);
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
        await load();
      })
      .catch((err) => toast.error(getProblemMessage(err)));
  }, [router]);

  async function runIngest() {
    setIngesting(true);
    try {
      await apiFetch("/api/admin/ingest", {
        method: "POST",
        body: JSON.stringify({ strategy }),
      });
      toast.success("Ingestion finished");
      await load();
    } catch (err) {
      toast.error(getProblemMessage(err));
    } finally {
      setIngesting(false);
    }
  }

  if (!user || !data) {
    return <main className="p-8 text-sm text-slate-600">Loading dashboard...</main>;
  }

  return (
    <div className="min-h-screen">
      <AppHeader user={user} />
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6">
        <div className="grid gap-4 md:grid-cols-4">
          <Stat title="Searches" value={String(data.searchStats.totalSearches)} />
          <Stat title="Last 24h" value={String(data.searchStats.last24h)} />
          <Stat title="Avg latency" value={`${data.searchStats.avgLatencyMs} ms`} />
          <Stat
            title="Grounded rate"
            value={
              data.searchStats.groundedRate === null
                ? "n/a"
                : `${Math.round(data.searchStats.groundedRate * 100)}%`
            }
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Ingestion</CardTitle>
            <CardDescription>
              Pointed at CORPUS_PATH. Latest job:{" "}
              {data.latestJob
                ? `${data.latestJob.status} (${data.latestJob.processedFiles}/${data.latestJob.totalFiles})`
                : "none"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {data.selfUpdatingPipeline && (
              <div className="rounded-lg border border-[var(--border)] bg-slate-50 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge>
                    self-update {data.selfUpdatingPipeline.enabled ? "on" : "off"}
                  </Badge>
                  <span className="text-slate-600">
                    debounce {data.selfUpdatingPipeline.debounceMs}ms
                  </span>
                </div>
                <p className="mt-2 text-slate-600">{data.selfUpdatingPipeline.behavior}</p>
              </div>
            )}
            <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-2">
              <Label htmlFor="strategy">Strategy</Label>
              <select
                id="strategy"
                className="h-10 rounded-md border border-[var(--border)] bg-white px-3 text-sm"
                value={strategy}
                onChange={(e) => setStrategy(e.target.value as ChunkStrategy)}
              >
                <option value="recursive">recursive</option>
                <option value="fixed">fixed</option>
                <option value="sliding">sliding</option>
              </select>
            </div>
            <Button onClick={runIngest} disabled={ingesting}>
              {ingesting ? "Ingesting..." : "Run ingest"}
            </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Index health (Qdrant)</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3">
            {data.indexHealth.map((h) => (
              <div key={h.collection} className="rounded-lg border border-[var(--border)] p-3">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{h.strategy}</span>
                  <Badge>{h.status}</Badge>
                </div>
                <p className="mt-2 text-sm text-slate-600">{h.collection}</p>
                <p className="text-sm text-slate-600">{h.pointsCount} points</p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Documents</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-b border-[var(--border)] text-slate-500">
                <tr>
                  <th className="py-2 pr-3 font-medium">Path</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 pr-3 font-medium">Chunks</th>
                  <th className="py-2 pr-3 font-medium">Strategy</th>
                  <th className="py-2 font-medium">Error</th>
                </tr>
              </thead>
              <tbody>
                {data.documents.map((d) => (
                  <tr key={d.id} className="border-b border-[var(--border)]/70">
                    <td className="py-2 pr-3">{d.path}</td>
                    <td className="py-2 pr-3">
                      <Badge>{d.status}</Badge>
                    </td>
                    <td className="py-2 pr-3">{d.chunkCount}</td>
                    <td className="py-2 pr-3">{d.strategy ?? "-"}</td>
                    <td className="py-2 text-slate-500">{d.errorMessage ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent jobs</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.recentJobs.map((j) => (
              <div
                key={j.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
              >
                <span>
                  {j.strategy} · {j.status} · {j.processedFiles} ok / {j.failedFiles} fail
                </span>
                <span className="text-xs text-slate-500">{j.id.slice(0, 8)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

function Stat({ title, value }: { title: string; value: string }) {
  return (
    <Card>
      <CardContent className="pt-5">
        <p className="text-xs uppercase tracking-wide text-slate-500">{title}</p>
        <p className="mt-1 text-2xl font-semibold">{value}</p>
      </CardContent>
    </Card>
  );
}
