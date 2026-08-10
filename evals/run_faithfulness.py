"""
RAGAS faithfulness evaluation harness.

Prereqs:
  - API running and corpus ingested
  - DEMO admin or user session cookie OR set EVAL_EMAIL / EVAL_PASSWORD
  - pip install -r evals/requirements.txt

Usage:
  python evals/run_faithfulness.py
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import httpx
import yaml

ROOT = Path(__file__).resolve().parents[1]
RESULTS = Path(__file__).resolve().parent / "results"
RESULTS.mkdir(exist_ok=True)

API_URL = os.getenv("API_URL", "http://localhost:3001")
EMAIL = os.getenv("EVAL_EMAIL", "admin@demo.com")
PASSWORD = os.getenv("EVAL_PASSWORD", "admin1234")
STRATEGIES = os.getenv("EVAL_STRATEGIES", "fixed,recursive,sliding").split(",")


def sign_in(client: httpx.Client) -> None:
    res = client.post(
        f"{API_URL}/api/auth/sign-in/email",
        json={"email": EMAIL, "password": PASSWORD},
    )
    res.raise_for_status()


def chat(client: httpx.Client, question: str, strategy: str) -> dict:
    res = client.post(
        f"{API_URL}/api/chat",
        json={"question": question, "strategy": strategy},
        headers={"x-trace-id": f"eval-{strategy}"},
    )
    res.raise_for_status()
    return res.json()


def simple_faithfulness(answer: str, contexts: list[str], grounded: bool) -> float:
    """
    Lightweight stand-in when ragas is unavailable.
    Prefer RAGAS metric below when installed.
    """
    if not grounded:
        return 1.0 if any(
            x in answer.lower()
            for x in ["could not find", "don't know", "do not", "not in the", "insufficient"]
        ) else 0.0
    if not contexts:
        return 0.0
    ctx = " ".join(contexts).lower()
    tokens = [t for t in answer.lower().replace(",", " ").replace(".", " ").split() if len(t) > 4]
    if not tokens:
        return 1.0
    hits = sum(1 for t in tokens if t in ctx)
    return hits / len(tokens)


def ragas_faithfulness(answer: str, contexts: list[str], question: str) -> float | None:
    try:
        from datasets import Dataset
        from ragas import evaluate
        from ragas.metrics import faithfulness
    except Exception:
        return None

    ds = Dataset.from_dict(
        {
            "question": [question],
            "answer": [answer],
            "contexts": [contexts],
        }
    )
    result = evaluate(ds, metrics=[faithfulness])
    # ragas versions differ in return type
    try:
        return float(result["faithfulness"])
    except Exception:
        return float(list(result.scores)[0].get("faithfulness", 0))


def main() -> int:
    dataset_path = Path(__file__).parent / "dataset.yaml"
    data = yaml.safe_load(dataset_path.read_text(encoding="utf-8"))
    queries = data["queries"]

    summary: dict[str, list[float]] = {s.strip(): [] for s in STRATEGIES}

    with httpx.Client(timeout=120.0, follow_redirects=True) as client:
        sign_in(client)
        for strategy in summary:
            for item in queries:
                q = item["question"]
                payload = chat(client, q, strategy)
                contexts = [p["text"] for p in payload.get("passages", [])]
                answer = payload.get("answer", "")
                grounded = bool(payload.get("grounded", False))
                score = ragas_faithfulness(answer, contexts, q)
                if score is None:
                    score = simple_faithfulness(answer, contexts, grounded)
                summary[strategy].append(score)
                print(f"[{strategy}] {q[:60]}... -> {score:.3f}")

    table_rows = []
    for strategy, scores in summary.items():
        avg = sum(scores) / len(scores) if scores else 0.0
        table_rows.append({"strategy": strategy, "faithfulness": round(avg, 3), "n": len(scores)})

    out = {
        "metric": "faithfulness",
        "api": API_URL,
        "rows": table_rows,
        "note": "Uses RAGAS when installed; otherwise lexical overlap proxy.",
    }
    out_path = RESULTS / "faithfulness.json"
    out_path.write_text(json.dumps(out, indent=2), encoding="utf-8")
    print("\nSummary:")
    for row in table_rows:
        print(f"  {row['strategy']}: {row['faithfulness']} (n={row['n']})")
    print(f"Wrote {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
