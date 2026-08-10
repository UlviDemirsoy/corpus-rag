"""
Generate a ~100-query faithfulness eval set from data/corpus.

Uses the case sample_questions style: grounded factual Qs with expect_sources,
plus a few deliberately ungrounded probes.

Usage (from repo root):
  python evals/generate_dataset.py
"""

from __future__ import annotations

import json
import os
import random
import re
import sys
from pathlib import Path

from dotenv import load_dotenv
from openai import OpenAI

ROOT = Path(__file__).resolve().parents[1]
CORPUS = ROOT / "data" / "corpus"
OUT = Path(__file__).resolve().parent / "dataset_100.yaml"

load_dotenv(ROOT / ".env")

# Seed questions from the case brief (must be present).
SEED = [
    {
        "question": "What is the maximum file size for an AppLovin playable, and how does it ship?",
        "expect_sources": ["network-specs-applovin.md"],
        "expect_ungrounded": False,
    },
    {
        "question": "How do I initialize the current Lumen SDK, and what happened to lumen.track?",
        "expect_sources": ["sdk-notes-v3.md"],
        "expect_ungrounded": False,
        "notes": "sdk-notes-v2.md is deprecated; a good answer says so",
    },
    {
        "question": "Why are sound assets built in a separate pass?",
        "expect_sources": ["build-pipeline.md", "incident-postmortem-2026-03.md"],
        "expect_ungrounded": False,
    },
    {
        "question": "What caused the March 2026 AppLovin rejections and what was fixed?",
        "expect_sources": ["incident-postmortem-2026-03.md"],
        "expect_ungrounded": False,
    },
    {
        "question": "Which languages must every playable ship with, and what is the fallback?",
        "expect_sources": ["localization-guide.md"],
        "expect_ungrounded": False,
    },
]

UNGROUNDED = [
    {
        "question": "What is the company vacation policy and salary bands for playable engineers?",
        "expect_sources": [],
        "expect_ungrounded": True,
    },
    {
        "question": "How many paid parental leave weeks do contractors get at Playable Factory?",
        "expect_sources": [],
        "expect_ungrounded": True,
    },
    {
        "question": "What is the internal stock option strike price for 2024 grants?",
        "expect_sources": [],
        "expect_ungrounded": True,
    },
    {
        "question": "Which coffee brand is stocked in the Istanbul office kitchen?",
        "expect_sources": [],
        "expect_ungrounded": True,
    },
    {
        "question": "What is the CEO's personal mobile phone number?",
        "expect_sources": [],
        "expect_ungrounded": True,
    },
]

PRIORITY_GLOBS = [
    "*.md",
]


def list_docs() -> list[Path]:
    files = [p for p in CORPUS.rglob("*.md") if p.is_file()]
    # Prefer shorter/high-signal docs first, then fill with others.
    def rank(p: Path) -> tuple:
        rel = p.relative_to(CORPUS).as_posix()
        priority = 0
        if any(
            k in rel
            for k in (
                "network-specs",
                "sdk-notes",
                "build-pipeline",
                "incident",
                "localization",
                "company-overview",
                "analytics",
                "changelog",
                "client-briefs",
            )
        ):
            priority = -1
        if rel.startswith("delivery-reports/"):
            priority = 1
        return (priority, len(p.read_text(encoding="utf-8", errors="ignore")), rel)

    files.sort(key=rank)
    return files


def yaml_escape(s: str) -> str:
    if any(c in s for c in [":", "#", "{", "}", "[", "]", ",", "&", "*", "?", "|", "-", "<", ">", "=", "!", "%", "@", "`"]):
        return json.dumps(s, ensure_ascii=False)
    if s.startswith(("*", "&", "?", "-", "'", '"')):
        return json.dumps(s, ensure_ascii=False)
    return json.dumps(s, ensure_ascii=False)


def to_yaml(queries: list[dict]) -> str:
    lines = [
        "# Auto-generated faithfulness eval set (~100).",
        "# Style matches data/sample_questions.md — grounded Qs + ungrounded probes.",
        "queries:",
    ]
    for q in queries:
        lines.append(f"  - question: {yaml_escape(q['question'])}")
        srcs = q.get("expect_sources") or []
        if srcs:
            lines.append("    expect_sources:")
            for s in srcs:
                lines.append(f"      - {yaml_escape(s)}")
        else:
            lines.append("    expect_sources: []")
        if q.get("expect_ungrounded"):
            lines.append("    expect_ungrounded: true")
        if q.get("notes"):
            lines.append(f"    notes: {yaml_escape(q['notes'])}")
    return "\n".join(lines) + "\n"


def generate_for_doc(client: OpenAI, rel: str, text: str, n: int = 1) -> list[dict]:
    excerpt = text.strip()
    if len(excerpt) > 6000:
        excerpt = excerpt[:6000] + "\n…"

    prompt = f"""You create evaluation questions for a RAG faithfulness benchmark.
Document path: {rel}

Document:
---
{excerpt}
---

Write {n} natural English question(s) that a user might ask, answerable ONLY from this document.
Rules:
- Specific, factual, not vague.
- Prefer numbers, APIs, limits, processes, dates, product names when present.
- Do NOT ask meta questions about the document itself.
- Return JSON only: {{"questions":[{{"question":"..."}}]}}
"""
    completion = client.chat.completions.create(
        model=os.getenv("CHAT_MODEL", "gpt-4o-mini"),
        temperature=0.4,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": "You generate RAG eval questions. Return valid JSON only."},
            {"role": "user", "content": prompt},
        ],
    )
    raw = completion.choices[0].message.content or "{}"
    data = json.loads(raw)
    out = []
    for item in data.get("questions", []):
        q = (item.get("question") or "").strip()
        if not q:
            continue
        out.append(
            {
                "question": q,
                "expect_sources": [rel],
                "expect_ungrounded": False,
            }
        )
    return out


def main() -> int:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        print("OPENAI_API_KEY missing", file=sys.stderr)
        return 1

    client = OpenAI(api_key=api_key)
    target = int(os.getenv("EVAL_DATASET_SIZE", "100"))
    queries: list[dict] = []
    seen: set[str] = set()

    def add(items: list[dict]) -> None:
        for item in items:
            key = re.sub(r"\s+", " ", item["question"].strip().lower())
            if key in seen:
                continue
            seen.add(key)
            queries.append(item)

    add(SEED)
    add(UNGROUNDED)

    docs = list_docs()
    random.seed(42)
    # Cap how many delivery reports we sample so the set stays diverse.
    delivery = [d for d in docs if "delivery-reports/" in d.relative_to(CORPUS).as_posix()]
    other = [d for d in docs if d not in delivery]
    random.shuffle(delivery)
    docs_ordered = other + delivery[:40]

    print(f"Generating toward {target} queries from {len(docs_ordered)} docs...")
    for path in docs_ordered:
        if len(queries) >= target:
            break
        rel = path.relative_to(CORPUS).as_posix()
        # Skip docs already heavily covered by seed if we already have enough variety.
        text = path.read_text(encoding="utf-8", errors="ignore")
        if len(text.strip()) < 80:
            continue
        need = target - len(queries)
        n = 2 if need > 30 and "delivery-reports/" not in rel else 1
        try:
            generated = generate_for_doc(client, rel, text, n=n)
            add(generated)
            print(f"  +{len(generated)} from {rel} (total {len(queries)})")
        except Exception as exc:
            print(f"  ! skip {rel}: {exc}")

    # Trim or pad
    if len(queries) > target:
        # Keep all seed+ungrounded, trim the rest.
        keep_head = len(SEED) + len(UNGROUNDED)
        rest = queries[keep_head:]
        queries = queries[:keep_head] + rest[: max(0, target - keep_head)]

    OUT.write_text(to_yaml(queries), encoding="utf-8")
    print(f"Wrote {OUT} with {len(queries)} queries")
    grounded = sum(1 for q in queries if not q.get("expect_ungrounded"))
    print(f"  grounded={grounded} ungrounded={len(queries) - grounded}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
