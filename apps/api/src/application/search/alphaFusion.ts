import type { ScoredChunk } from "../../domain/models.js";

/** Min-max normalize scores to [0, 1] keyed by chunkId. */
export function minMaxNormalize(scored: ScoredChunk[]): Map<string, number> {
  const out = new Map<string, number>();
  if (scored.length === 0) return out;
  let min = Infinity;
  let max = -Infinity;
  for (const s of scored) {
    min = Math.min(min, s.score);
    max = Math.max(max, s.score);
  }
  const range = max - min;
  for (const s of scored) {
    out.set(s.chunkId, range === 0 ? 1 : (s.score - min) / range);
  }
  return out;
}

/**
 * Weighted hybrid fusion:
 *   s = α · densê + (1 − α) · bm25̂
 * Missing side contributes 0 after normalize lookup.
 */
export function alphaFuse(input: {
  dense: ScoredChunk[];
  bm25: ScoredChunk[];
  alpha: number;
  limit: number;
}): ScoredChunk[] {
  const alpha = Math.min(1, Math.max(0, input.alpha));
  const denseNorm = minMaxNormalize(input.dense);
  const bm25Norm = minMaxNormalize(input.bm25);

  const byId = new Map<string, ScoredChunk>();
  for (const c of input.dense) byId.set(c.chunkId, c);
  for (const c of input.bm25) {
    if (!byId.has(c.chunkId)) byId.set(c.chunkId, c);
  }

  const fused: ScoredChunk[] = [];
  for (const [chunkId, base] of byId) {
    const d = denseNorm.get(chunkId) ?? 0;
    const b = bm25Norm.get(chunkId) ?? 0;
    fused.push({
      ...base,
      score: alpha * d + (1 - alpha) * b,
    });
  }

  fused.sort((a, b) => b.score - a.score);
  return fused.slice(0, input.limit);
}
