"""
Faithfulness charts aggregated by approach (not by question).

Usage:
  python evals/plot_faithfulness.py
  python evals/plot_faithfulness.py --csv evals/results/faithfulness_runs.csv
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
import numpy as np

RESULTS = Path(__file__).resolve().parent / "results"
CHARTS = RESULTS / "charts"

STRATEGIES = ("fixed", "recursive", "sliding")
COMBO_ORDER = (
    ("False", "False"),  # dense, no rerank
    ("False", "True"),  # dense, rerank
    ("True", "False"),  # hybrid, no rerank
    ("True", "True"),  # hybrid, rerank
)
COMBO_LABELS = {
    ("False", "False"): "dense\nno-rr",
    ("False", "True"): "dense\nrerank",
    ("True", "False"): "hybrid\nno-rr",
    ("True", "True"): "hybrid\nrerank",
}


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


def approach_sort_key(setting: str, meta: dict) -> tuple:
    strat = meta.get("strategy", "")
    hyb = str(meta.get("use_hybrid"))
    rr = str(meta.get("use_rerank"))
    si = STRATEGIES.index(strat) if strat in STRATEGIES else 99
    hi = 0 if hyb in ("False", "false", "0") else 1
    ri = 0 if rr in ("False", "false", "0") else 1
    return (si, hi, ri, setting)


def short_label(setting: str, meta: dict) -> str:
    if setting.startswith("hybrid_a"):
        return f"α={setting.replace('hybrid_a', '')}"
    strat = meta.get("strategy", "?")
    hyb = "hyb" if str(meta.get("use_hybrid")).lower() in ("true", "1") else "dense"
    rr = "rr" if str(meta.get("use_rerank")).lower() in ("true", "1") else "no-rr"
    return f"{strat}\n{hyb}/{rr}"


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
    meta: dict[str, dict] = {}
    for r in rows:
        s = r["setting"]
        by[s].append(float(r["faithfulness"]))
        lat[s].append(float(r["latency_ms"]))
        meta[s] = {
            "strategy": r.get("strategy", ""),
            "use_hybrid": r.get("use_hybrid", ""),
            "use_rerank": r.get("use_rerank", ""),
            "hybrid_alpha": r.get("hybrid_alpha", ""),
        }

    settings = sorted(by.keys(), key=lambda s: approach_sort_key(s, meta[s]))
    means = [sum(by[s]) / len(by[s]) for s in settings]
    stds = [
        float(np.std(by[s], ddof=1)) if len(by[s]) > 1 else 0.0 for s in settings
    ]
    ns = [len(by[s]) for s in settings]
    lat_means = [sum(lat[s]) / len(lat[s]) for s in settings]
    model = rows[0].get("chat_model", "")
    embed = rows[0].get("embedding_model", "")
    n_questions = max(ns) if ns else 0
    n_approaches = len(settings)

    CHARTS.mkdir(parents=True, exist_ok=True)

    # --- Bar chart: one bar per approach ---
    fig_w = max(10, 1.1 * n_approaches + 2)
    fig, ax = plt.subplots(figsize=(fig_w, 5.5))
    xs = list(range(len(settings)))
    colors = []
    palette = {
        "fixed": "#0f766e",
        "recursive": "#1d4ed8",
        "sliding": "#b45309",
    }
    for s in settings:
        colors.append(palette.get(meta[s].get("strategy", ""), "#334155"))

    bars = ax.bar(
        xs,
        means,
        yerr=stds,
        width=0.7,
        color=colors,
        align="center",
        capsize=3,
        error_kw={"elinewidth": 1, "capthick": 1},
    )
    ax.set_xlim(-0.7, len(settings) - 0.3)
    ax.set_ylim(0, 1.22)
    ax.set_ylabel("Faithfulness (mean ± std over questions)")
    ax.set_title(
        f"Faithfulness by approach\n"
        f"{n_approaches} approaches · {n_questions} questions each · {model} · {embed}"
    )
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.grid(axis="y", linestyle=":", alpha=0.45)

    tick_labels = [short_label(s, meta[s]) for s in settings]
    ax.set_xticks(xs)
    ax.set_xticklabels(tick_labels, fontsize=8)
    ax.tick_params(axis="x", length=0, pad=8)

    for b, v in zip(bars, means):
        ax.text(
            b.get_x() + b.get_width() / 2,
            min(v + 0.05, 1.16),
            f"{v:.2f}",
            ha="center",
            va="bottom",
            fontsize=8,
            fontweight="bold",
        )

    fig.subplots_adjust(bottom=0.22, top=0.86, left=0.08, right=0.98)
    out_bar = CHARTS / "faithfulness_by_setting.png"
    fig.savefig(out_bar, dpi=140, bbox_inches="tight", pad_inches=0.25)
    plt.close(fig)

    # --- Heatmap: strategy × (hybrid/rerank combo) when grid present ---
    out_heat = CHARTS / "faithfulness_by_approach_heatmap.png"
    has_grid = all(
        meta[s].get("strategy") in STRATEGIES for s in settings
    ) and any(not s.startswith("hybrid_a") for s in settings)

    if has_grid:
        grid = np.full((len(STRATEGIES), len(COMBO_ORDER)), np.nan)
        for s in settings:
            strat = meta[s]["strategy"]
            hyb = "True" if str(meta[s]["use_hybrid"]).lower() in ("true", "1") else "False"
            rr = "True" if str(meta[s]["use_rerank"]).lower() in ("true", "1") else "False"
            if strat not in STRATEGIES or (hyb, rr) not in COMBO_ORDER:
                continue
            i = STRATEGIES.index(strat)
            j = COMBO_ORDER.index((hyb, rr))
            grid[i, j] = sum(by[s]) / len(by[s])

        fig2, ax2 = plt.subplots(figsize=(8.5, 4.2))
        im = ax2.imshow(grid, cmap="YlGn", vmin=0.7, vmax=1.0, aspect="auto")
        ax2.set_xticks(range(len(COMBO_ORDER)))
        ax2.set_xticklabels([COMBO_LABELS[c] for c in COMBO_ORDER], fontsize=9)
        ax2.set_yticks(range(len(STRATEGIES)))
        ax2.set_yticklabels(list(STRATEGIES), fontsize=10)
        ax2.set_title(
            f"Approach heatmap (mean faithfulness)\n"
            f"{n_questions} questions · hybrid α=0.5 when hybrid on"
        )
        for i in range(grid.shape[0]):
            for j in range(grid.shape[1]):
                val = grid[i, j]
                if np.isnan(val):
                    continue
                ax2.text(
                    j,
                    i,
                    f"{val:.2f}",
                    ha="center",
                    va="center",
                    fontsize=11,
                    fontweight="bold",
                    color="#0f172a" if val > 0.85 else "#f8fafc",
                )
        fig2.colorbar(im, ax=ax2, fraction=0.046, pad=0.04, label="faithfulness")
        fig2.tight_layout()
        fig2.savefig(out_heat, dpi=140, bbox_inches="tight", pad_inches=0.2)
        plt.close(fig2)
    else:
        out_heat = None

    summary = {
        "source_csv": str(path),
        "unit": "approach",
        "chat_model": model,
        "embedding_model": embed,
        "n_approaches": n_approaches,
        "n_questions_per_approach": n_questions,
        "chart": str(out_bar),
        "heatmap": str(out_heat) if out_heat else None,
        "rows": [
            {
                "setting": s,
                "strategy": meta[s].get("strategy"),
                "use_hybrid": meta[s].get("use_hybrid"),
                "use_rerank": meta[s].get("use_rerank"),
                "n": ns[i],
                "faithfulness_avg": round(means[i], 4),
                "faithfulness_std": round(stds[i], 4),
                "latency_avg_ms": round(lat_means[i], 1),
            }
            for i, s in enumerate(settings)
        ],
    }
    (CHARTS / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(f"source: {path} ({len(rows)} rows)")
    print(f"chart:  {out_bar}")
    if out_heat:
        print(f"heat:   {out_heat}")
    print(f"approaches={n_approaches} questions~={n_questions}")
    for row in summary["rows"]:
        print(
            f"  {row['setting']}: {row['faithfulness_avg']:.4f} "
            f"± {row['faithfulness_std']:.4f} (n={row['n']})"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
