"""
Simple faithfulness charts from CSV.

One figure: mean faithfulness by setting (+ optional latency twin bars).

Usage:
  python evals/plot_faithfulness.py
"""

from __future__ import annotations

import argparse
import csv
import json
from collections import defaultdict
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

RESULTS = Path(__file__).resolve().parent / "results"
CHARTS = RESULTS / "charts"


def latest_csv(explicit: str | None) -> Path:
    if explicit:
        p = Path(explicit)
        if not p.exists():
            raise SystemExit(f"CSV not found: {p}")
        return p
    candidates = sorted(RESULTS.glob("faithfulness_runs_*.csv"), key=lambda x: x.stat().st_mtime)
    if candidates:
        return candidates[-1]
    latest = RESULTS / "faithfulness_runs.csv"
    if latest.exists():
        return latest
    raise SystemExit("No faithfulness_runs*.csv found")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--csv", default=None)
    args = parser.parse_args()

    path = latest_csv(args.csv)
    rows = list(csv.DictReader(path.open(encoding="utf-8")))
    if not rows:
        raise SystemExit(f"No rows in {path}")

    by: dict[str, list[float]] = defaultdict(list)
    lat: dict[str, list[float]] = defaultdict(list)
    for r in rows:
        by[r["setting"]].append(float(r["faithfulness"]))
        lat[r["setting"]].append(float(r["latency_ms"]))

    settings = sorted(by.keys())
    means = [sum(by[s]) / len(by[s]) for s in settings]
    ns = [len(by[s]) for s in settings]
    lat_means = [sum(lat[s]) / len(lat[s]) for s in settings]
    model = rows[0].get("chat_model", "")
    embed = rows[0].get("embedding_model", "")

    CHARTS.mkdir(parents=True, exist_ok=True)

    fig, ax = plt.subplots(figsize=(7, 4))
    bars = ax.bar(settings, means, color="#0f766e")
    ax.set_ylim(0, 1.05)
    ax.set_ylabel("Faithfulness (mean)")
    ax.set_title(f"RAGAS faithfulness by setting\n{model} · {embed}")
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.grid(axis="y", linestyle=":", alpha=0.45)
    for b, v, n in zip(bars, means, ns):
        ax.text(b.get_x() + b.get_width() / 2, v + 0.02, f"{v:.2f}\nn={n}", ha="center", fontsize=9)
    plt.xticks(rotation=15, ha="right")
    fig.tight_layout()
    out = CHARTS / "faithfulness_by_setting.png"
    fig.savefig(out, dpi=140)
    plt.close(fig)

    summary = {
        "source_csv": str(path),
        "chat_model": model,
        "embedding_model": embed,
        "chart": str(out),
        "rows": [
            {
                "setting": s,
                "n": ns[i],
                "faithfulness_avg": round(means[i], 4),
                "latency_avg_ms": round(lat_means[i], 1),
            }
            for i, s in enumerate(settings)
        ],
    }
    (CHARTS / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(f"source: {path} ({len(rows)} rows)")
    print(f"chart:  {out}")
    for row in summary["rows"]:
        print(f"  {row['setting']}: {row['faithfulness_avg']} (n={row['n']})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
