export type SearchLogInput = {
  query: string;
  strategy: string;
  topK: number;
  hitCount: number;
  latencyMs: number;
  userId?: string;
  grounded?: boolean;
  traceId?: string;
};

export type SearchStats = {
  totalSearches: number;
  avgLatencyMs: number;
  avgHitCount: number;
  groundedRate: number | null;
  last24h: number;
};

export interface SearchAnalyticsRepository {
  log(input: SearchLogInput): Promise<void>;
  getStats(): Promise<SearchStats>;
}
