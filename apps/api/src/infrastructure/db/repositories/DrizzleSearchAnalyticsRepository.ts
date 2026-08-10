import { gte, sql } from "drizzle-orm";
import type {
  SearchAnalyticsRepository,
  SearchLogInput,
  SearchStats,
} from "../../../domain/search/SearchAnalyticsRepository.js";
import type { ChunkStrategy } from "@rag/shared";
import type { Db } from "../client.js";
import { searchLogs } from "../schema.js";

export class DrizzleSearchAnalyticsRepository implements SearchAnalyticsRepository {
  constructor(private readonly db: Db) {}

  async log(input: SearchLogInput): Promise<void> {
    await this.db.insert(searchLogs).values({
      query: input.query,
      strategy: input.strategy as ChunkStrategy,
      topK: input.topK,
      hitCount: input.hitCount,
      latencyMs: input.latencyMs,
      userId: input.userId,
      grounded: input.grounded,
      traceId: input.traceId,
    });
  }

  async getStats(): Promise<SearchStats> {
    const [agg] = await this.db
      .select({
        totalSearches: sql<number>`count(*)::int`,
        avgLatencyMs: sql<number>`coalesce(avg(${searchLogs.latencyMs}), 0)::float`,
        avgHitCount: sql<number>`coalesce(avg(${searchLogs.hitCount}), 0)::float`,
        groundedRate: sql<number | null>`avg(case when ${searchLogs.grounded} is null then null when ${searchLogs.grounded} then 1 else 0 end)::float`,
      })
      .from(searchLogs);

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [last] = await this.db
      .select({
        last24h: sql<number>`count(*)::int`,
      })
      .from(searchLogs)
      .where(gte(searchLogs.createdAt, since));

    return {
      totalSearches: agg?.totalSearches ?? 0,
      avgLatencyMs: Math.round(agg?.avgLatencyMs ?? 0),
      avgHitCount: Number((agg?.avgHitCount ?? 0).toFixed(2)),
      groundedRate:
        agg?.groundedRate === null || agg?.groundedRate === undefined
          ? null
          : Number(agg.groundedRate.toFixed(3)),
      last24h: last?.last24h ?? 0,
    };
  }
}
