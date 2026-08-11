"""
RAGAS faithfulness evaluation across retrieval approaches.

Approaches are the unit of comparison (questions are the sample).
Default grid: 3 strategies × hybrid on/off × rerank on/off = 12 approaches × N questions.

Writes:
  - evals/results/faithfulness_runs.csv   (one row per question × approach)
  - evals/results/faithfulness_summary.csv  (one row per approach)
  - evals/results/faithfulness.json

Usage:
  python evals/run_faithfulness.py --limit 20
  python evals/run_faithfulness.py --preset approach --limit 20
  python evals/run_faithfulness.py --preset alpha --limit 20
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx
import yaml
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")
RESULTS = Path(__file__).resolve().parent / "results"
RESULTS.mkdir(exist_ok=True)

API_URL = os.getenv("API_URL", "http://localhost:3001")
EMAIL = os.getenv("EVAL_EMAIL", "admin@demo.com")
PASSWORD = os.getenv("EVAL_PASSWORD", "admin1234")
CHAT_MODEL = os.getenv("CHAT_MODEL", "gpt-4o-mini")
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "text-embedding-3-small")
TOP_K = int(os.getenv("TOP_K", "5"))
SKIP_RAGAS = os.getenv("EVAL_SKIP_RAGAS", "false").lower() == "true"
DEFAULT_HYBRID_ALPHA = float(os.getenv("EVAL_HYBRID_ALPHA", "0.5"))

STRATEGIES = ("fixed", "recursive", "sliding")


def build_approach_grid(hybrid_alpha: float = DEFAULT_HYBRID_ALPHA) -> list[dict]:
    """3 strategies × hybrid × rerank → 12 approaches."""
    settings: list[dict] = []
    for strategy in STRATEGIES:
        for use_hybrid in (False, True):
            for use_rerank in (False, True):
                hyb = "hyb1" if use_hybrid else "hyb0"
                rr = "rr1" if use_rerank else "rr0"
                name = f"{strategy}_{hyb}_{rr}"
                settings.append(
                    {
                        "name": name,
                        "strategy": strategy,
                        "useHybrid": use_hybrid,
                        "useRerank": use_rerank,
                        "hybridAlpha": hybrid_alpha if use_hybrid else None,
                    }
                )
    return settings


# Legacy alpha sweep (recursive only) — keep for A/B against older charts.
ALPHA_SETTINGS = [
    {
        "name": "hybrid_a0.0",
        "strategy": "recursive",
        "useHybrid": True,
        "useRerank": False,
        "hybridAlpha": 0.0,
    },
    {
        "name": "hybrid_a0.5",
        "strategy": "recursive",
        "useHybrid": True,
        "useRerank": False,
        "hybridAlpha": 0.5,
    },
    {
        "name": "hybrid_a1.0",
        "strategy": "recursive",
        "useHybrid": True,
        "useRerank": False,
        "hybridAlpha": 1.0,
    },
]

DEFAULT_SETTINGS = build_approach_grid()

RUN_CSV_FIELDS = [
    "run_id",
    "timestamp",
    "chat_model",
    "embedding_model",
    "top_k",
    "setting",
    "strategy",
    "use_hybrid",
    "hybrid_alpha",
    "use_rerank",
    "question_idx",
    "question",
    "expect_ungrounded",
    "expect_sources",
    "answer",
    "grounded",
    "citations",
    "passage_sources",
    "passage_count",
    "contexts_preview",
    "faithfulness",
    "score_method",
    "latency_ms",
    "response_hybrid",
    "response_hybrid_alpha",
    "response_reranked",
    "trace_id",
]


def sign_in(client: httpx.Client) -> None:
    res = client.post(
        f"{API_URL}/api/auth/sign-in/email",
        json={"email": EMAIL, "password": PASSWORD},
    )
    res.raise_for_status()


def chat(client: httpx.Client, question: str, setting: dict) -> dict:
    body = {
        "question": question,
        "strategy": setting["strategy"],
        "useHybrid": bool(setting.get("useHybrid")),
        "useRerank": bool(setting.get("useRerank")),
    }
    if setting.get("hybridAlpha") is not None:
        body["hybridAlpha"] = setting["hybridAlpha"]
    res = client.post(
        f"{API_URL}/api/chat",
        json=body,
        headers={"x-trace-id": f"eval-{setting['name']}"},
        timeout=180.0,
    )
    res.raise_for_status()
    return res.json()


def simple_faithfulness(
    answer: str, contexts: list[str], grounded: bool, expect_ungrounded: bool
) -> float:
    lower = answer.lower()
    refusal = any(
        x in lower
        for x in [
            "could not find",
            "cannot find",
            "don't know",
            "do not",
            "not in the",
            "insufficient",
            "does not cover",
            "don't contain",
            "do not contain",
        ]
    )
    if expect_ungrounded:
        return 1.0 if (not grounded or refusal) else 0.0
    if not grounded:
        return 1.0 if refusal else 0.0
    if not contexts:
        return 0.0
    ctx = " ".join(contexts).lower()
    tokens = [
        t
        for t in answer.lower().replace(",", " ").replace(".", " ").split()
        if len(t) > 4
    ]
    if not tokens:
        return 1.0
    hits = sum(1 for t in tokens if t in ctx)
    return hits / len(tokens)


def ragas_faithfulness(answer: str, contexts: list[str], question: str) -> float | None:
    if SKIP_RAGAS:
        return None
    try:
        from datasets import Dataset
        from ragas import evaluate
        from ragas.metrics import Faithfulness
    except Exception as exc:
        print(f"  ragas unavailable: {exc}", flush=True)
        return None

    if not contexts:
        contexts = [""]

    ds = Dataset.from_dict(
        {
            "question": [question],
            "answer": [answer],
            "contexts": [contexts],
        }
    )
    try:
        result = evaluate(ds, metrics=[Faithfulness()])
    except Exception as exc:
        print(f"  ragas evaluate failed: {exc}", flush=True)
        return None

    try:
        if isinstance(result, dict) and "faithfulness" in result:
            return float(result["faithfulness"])
    except Exception:
        pass
    try:
        return float(result["faithfulness"])  # type: ignore[index]
    except Exception:
        pass
    try:
        df = result.to_pandas()  # type: ignore[attr-defined]
        return float(df["faithfulness"].iloc[0])
    except Exception:
        pass
    try:
        return float(list(result.scores)[0].get("faithfulness", 0))  # type: ignore[attr-defined]
    except Exception:
        return None


def load_settings(preset: str) -> list[dict]:
    raw = os.getenv("EVAL_SETTINGS_JSON")
    if raw:
        return json.loads(raw)
    if preset == "alpha":
        return ALPHA_SETTINGS
    if preset == "approach":
        return build_approach_grid()
    raise SystemExit(f"Unknown preset: {preset}")


def mean_std(scores: list[float]) -> tuple[float, float]:
    if not scores:
        return 0.0, 0.0
    avg = sum(scores) / len(scores)
    if len(scores) == 1:
        return avg, 0.0
    var = sum((x - avg) ** 2 for x in scores) / (len(scores) - 1)
    return avg, math.sqrt(var)


def write_summary_csv(path: Path, rows: list[dict]) -> None:
    fields = [
        "run_id",
        "chat_model",
        "embedding_model",
        "top_k",
        "setting",
        "strategy",
        "use_hybrid",
        "hybrid_alpha",
        "use_rerank",
        "faithfulness_avg",
        "faithfulness_std",
        "n",
        "used_ragas",
    ]
    with path.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for row in rows:
            w.writerow(row)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=0, help="Cap queries (0 = all)")
    parser.add_argument(
        "--preset",
        choices=("approach", "alpha"),
        default=os.getenv("EVAL_PRESET", "approach"),
        help="approach = 12 settings (strategy×hybrid×rerank); alpha = recursive α sweep",
    )
    parser.add_argument(
        "--dataset",
        default=os.getenv("EVAL_DATASET", str(Path(__file__).parent / "dataset_100.yaml")),
    )
    args = parser.parse_args()

    dataset_path = Path(args.dataset)
    if not dataset_path.exists():
        fallback = Path(__file__).parent / "dataset.yaml"
        print(f"Missing {dataset_path}, falling back to {fallback}", flush=True)
        dataset_path = fallback

    data = yaml.safe_load(dataset_path.read_text(encoding="utf-8"))
    queries = data["queries"]
    if args.limit and args.limit > 0:
        queries = queries[: args.limit]

    settings = load_settings(args.preset)
    run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    runs_path = RESULTS / f"faithfulness_runs_{run_id}.csv"
    latest_runs = RESULTS / "faithfulness_runs.csv"
    summary_path = RESULTS / "faithfulness_summary.csv"
    json_path = RESULTS / "faithfulness.json"

    details: list[dict] = []
    summary_scores: dict[str, list[float]] = {s["name"]: [] for s in settings}
    used_ragas = False
    total = len(settings) * len(queries)

    print(
        f"run_id={run_id} preset={args.preset} models chat={CHAT_MODEL} "
        f"embed={EMBEDDING_MODEL} top_k={TOP_K}",
        flush=True,
    )
    print(
        f"approaches={len(settings)} questions={len(queries)} "
        f"total_runs={total} -> {runs_path}",
        flush=True,
    )
    print(
        "Aggregation unit = approach (mean faithfulness over questions).",
        flush=True,
    )

    with runs_path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=RUN_CSV_FIELDS)
        writer.writeheader()

        with httpx.Client(timeout=180.0, follow_redirects=True) as client:
            sign_in(client)
            done = 0
            for setting in settings:
                name = setting["name"]
                print(f"\n=== approach: {name} ===", flush=True)
                for i, item in enumerate(queries, start=1):
                    q = item["question"]
                    expect_ungrounded = bool(item.get("expect_ungrounded"))
                    expect_sources = item.get("expect_sources") or []
                    t0 = time.time()
                    payload = chat(client, q, setting)
                    latency_ms = int((time.time() - t0) * 1000)

                    passages = payload.get("passages") or []
                    contexts = [p.get("text", "") for p in passages]
                    answer = payload.get("answer", "")
                    grounded = bool(payload.get("grounded", False))
                    citations = payload.get("citations") or []
                    passage_sources = [p.get("source", "") for p in passages]

                    score = ragas_faithfulness(answer, contexts, q)
                    if score is None:
                        score = simple_faithfulness(
                            answer, contexts, grounded, expect_ungrounded
                        )
                        method = "proxy"
                    else:
                        used_ragas = True
                        method = "ragas"
                        if expect_ungrounded:
                            score = simple_faithfulness(
                                answer, contexts, grounded, True
                            )
                            method = "refusal_proxy"

                    summary_scores[name].append(score)
                    row = {
                        "run_id": run_id,
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                        "chat_model": CHAT_MODEL,
                        "embedding_model": EMBEDDING_MODEL,
                        "top_k": TOP_K,
                        "setting": name,
                        "strategy": setting["strategy"],
                        "use_hybrid": bool(setting.get("useHybrid")),
                        "hybrid_alpha": setting.get("hybridAlpha"),
                        "use_rerank": bool(setting.get("useRerank")),
                        "question_idx": i,
                        "question": q,
                        "expect_ungrounded": expect_ungrounded,
                        "expect_sources": " | ".join(expect_sources),
                        "answer": answer,
                        "grounded": grounded,
                        "citations": " | ".join(
                            f"[{c.get('index')}] {c.get('source')}" for c in citations
                        ),
                        "passage_sources": " | ".join(passage_sources),
                        "passage_count": len(passages),
                        "contexts_preview": " || ".join(
                            (c[:240] + ("…" if len(c) > 240 else "")) for c in contexts[:3]
                        ),
                        "faithfulness": round(score, 4),
                        "score_method": method,
                        "latency_ms": latency_ms,
                        "response_hybrid": payload.get("hybrid"),
                        "response_hybrid_alpha": payload.get("hybridAlpha"),
                        "response_reranked": payload.get("reranked"),
                        "trace_id": payload.get("traceId"),
                    }
                    details.append(row)
                    writer.writerow(row)
                    f.flush()
                    done += 1
                    print(
                        f"[{done}/{total} {name} q{i}/{len(queries)}] "
                        f"{score:.3f} {method} ({latency_ms}ms) {q[:60]}",
                        flush=True,
                    )

    summary_rows = []
    for setting in settings:
        name = setting["name"]
        scores = summary_scores[name]
        avg, std = mean_std(scores)
        summary_rows.append(
            {
                "run_id": run_id,
                "chat_model": CHAT_MODEL,
                "embedding_model": EMBEDDING_MODEL,
                "top_k": TOP_K,
                "setting": name,
                "strategy": setting["strategy"],
                "use_hybrid": bool(setting.get("useHybrid")),
                "hybrid_alpha": setting.get("hybridAlpha"),
                "use_rerank": bool(setting.get("useRerank")),
                "faithfulness_avg": round(avg, 4),
                "faithfulness_std": round(std, 4),
                "n": len(scores),
                "used_ragas": used_ragas,
            }
        )

    # Stable approach order for reading
    summary_rows.sort(
        key=lambda r: (
            STRATEGIES.index(r["strategy"]) if r["strategy"] in STRATEGIES else 99,
            0 if not r["use_hybrid"] else 1,
            0 if not r["use_rerank"] else 1,
        )
    )

    write_summary_csv(summary_path, summary_rows)
    latest_runs.write_text(runs_path.read_text(encoding="utf-8"), encoding="utf-8")

    out = {
        "metric": "faithfulness",
        "unit": "approach",
        "preset": args.preset,
        "run_id": run_id,
        "api": API_URL,
        "dataset": str(dataset_path),
        "chat_model": CHAT_MODEL,
        "embedding_model": EMBEDDING_MODEL,
        "top_k": TOP_K,
        "used_ragas": used_ragas,
        "n_approaches": len(settings),
        "n_questions": len(queries),
        "n_runs": total,
        "rows": summary_rows,
        "csv_runs": str(runs_path),
        "csv_summary": str(summary_path),
        "note": (
            "Scores aggregated by approach (mean over questions). "
            "Per-question rows stay in the runs CSV for debugging."
        ),
    }
    json_path.write_text(json.dumps(out, indent=2), encoding="utf-8")

    print("\nApproach summary (mean ± std over questions):", flush=True)
    for row in summary_rows:
        print(
            f"  {row['setting']}: {row['faithfulness_avg']:.4f} "
            f"± {row['faithfulness_std']:.4f} (n={row['n']}) "
            f"hybrid={row['use_hybrid']} rerank={row['use_rerank']}",
            flush=True,
        )
    print(f"Wrote {runs_path}", flush=True)
    print(f"Wrote {summary_path}", flush=True)
    print(f"Wrote {json_path}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
