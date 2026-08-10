# Corpus RAG — Case Study Deliverable

Semantic search + grounded RAG over a document corpus, with an admin dashboard and an MCP search tool. Built as a TypeScript monorepo.

## What this application does

1. **Ingests** markdown/text documents (chunk → embed → Qdrant)
2. Lets users **ask questions** and get **grounded answers with citations**
3. Lets admins **manage/observe** the corpus, ingestion jobs, index health, and search analytics
4. Exposes the same retrieval as an **MCP `search` tool** for external clients

If the corpus does not contain enough evidence, the system says so instead of inventing facts.

## Features list

### Must-haves
- pnpm monorepo: `apps/web`, `apps/api`, `packages/shared`
- Ingestion pipeline with job status (`pending/running/succeeded/failed`), per-file success/fail, content-hash skip
- Three chunking strategies with separate Qdrant collections:
  - `fixed` (512 / 64 overlap)
  - `recursive` (structure-aware; default for chat)
  - `sliding` (256 / 32)
- Chat page with **SSE streaming** answers (`/api/chat/stream`): passages first, then token deltas, clickable `[n]` citations
- Admin dashboard: documents, ingest trigger, jobs, Qdrant index health, search stats
- Admin **Users** panel: list users, invite (email + initial password), change roles
- MCP stdio server (`search` tool) + connect docs below
- AuthN/Z via Better Auth: roles `user` | `admin`
- `AI_USAGE.md`
- `.env.example` + auto migrate/seed on API boot

### Extras / polish
- Full Docker Compose stack (Postgres, Qdrant, pgAdmin, API, Web)
- Auto-ingest on boot when indexes are empty (all three strategies)
- **Self-updating pipeline**: chokidar watches `CORPUS_PATH`; on add/change/delete runs incremental ingest (content-hash skip + removed-file sync) — no full manual rebuild required
- RFC 9457 `application/problem+json` errors
- Trace IDs (`x-trace-id` / ALS context) + structured pino logs
- Transient retries for OpenAI / Qdrant
- RAGAS faithfulness eval harness under `evals/`
- Register page + role-gated dashboard
- **Dense + BM25 hybrid (α)** + OpenAI rerank: fuse `s = α·densê + (1−α)·BM25̂` (chat UI α slider + formula), then optional rerank to `TOP_K`

### Explicitly out of scope (timebox)
- MCP OIDC
- Live public deployment (guide below on how we would deploy)

## Technology stack

| Layer | Tech |
|-------|------|
| Monorepo | pnpm workspaces |
| Web | Next.js 15, Tailwind CSS 4, shadcn-style UI, sonner |
| API | Express, lite clean architecture (ports & adapters) |
| Auth | Better Auth (email/password, httpOnly session cookies) + `role` on `user` |
| DB | PostgreSQL + Drizzle ORM |
| Vector DB | Qdrant (`@qdrant/js-client-rest`) |
| Models | OpenAI `text-embedding-3-small` + `gpt-4o-mini` |
| MCP | `@modelcontextprotocol/sdk` (stdio) |
| Observability | pino + `x-trace-id` / `x-request-id` |
| Admin UIs | pgAdmin, Qdrant dashboard |

## Design choices (why)

- **Qdrant separate from Postgres** — vectors scale independently; relational data (users, jobs, analytics) stays simple in PG.
- **Per-strategy collections** (`chunks_fixed|recursive|sliding`) — clean A/B without payload filters fighting each other.
- **Recursive default** — corpus is mostly short markdown/sections; structure-aware splits preserve topical coherence.
- **Grounded JSON contract** — LLM returns `{ answer, grounded, citations }`; empty retrieval short-circuits to “not in corpus”.
- **Dense + BM25 hybrid (α)** — candidates from Qdrant dense and in-house Okapi BM25 (payload text); min–max normalize; `s = α·densê + (1−α)·BM25̂`. Chat/MCP pass `useHybrid` / `hybridAlpha`.
- **Dense retrieve → OpenAI rerank** — after hybrid (or dense-only), optional `gpt-4o-mini` rerank; `useRerank` defaults to `RERANK_ENABLED`.
- **Lite DDD / clean architecture** — use cases depend on ports (`VectorStore`, `Embedder`, `Chunker`, `Reranker`, `LexicalSearch`), not frameworks.
- **Session cookies (not custom JWT pair)** — Better Auth session is enough for the web app; `account.refresh_token` exists for OAuth providers.

## Architecture

```text
Browser (:3000) ──► Web (Next)
                 └─► API (:3001) ──► Postgres
                                  ├─► Qdrant (dense + BM25 payloads)
                                  └─► OpenAI (embed + rerank + chat)

MCP client ──stdio──► API MCP entry ──► SemanticSearch (same use case)
```

Retrieval path: embed + (optional) BM25 → α-fusion → optional OpenAI rerank → slice to `TOP_K` → (chat) grounded answer.

Formula: `s = α · densê + (1 − α) · BM25̂` (scores min–max normalized over the candidate pool).

API layers: `domain` → `application` → `infrastructure` → `presentation` (HTTP + MCP).

## Prerequisites

- Docker Desktop
- OpenAI API key with available credits
- (Optional local dev) Node 20+, pnpm 9+

## Installation / run (recommended: full Docker)

```bash
cd playablefactory
cp .env.example .env
# set OPENAI_API_KEY and BETTER_AUTH_SECRET (>=32 chars)

# build + start everything
pnpm docker:up
# or: docker compose -f docker/docker-compose.yml up -d --build
```

On API boot:
1. Applies Drizzle migrations if needed
2. Seeds demo users (`SEED_ON_BOOT=true`)
3. If Qdrant collections are empty, auto-ingests **fixed + recursive + sliding** in the background

### URLs

| Service | URL |
|---------|-----|
| Web / Chat / Login | http://localhost:3000 |
| API | http://localhost:3001 |
| pgAdmin | http://localhost:5050 (`admin@demo.com` / `admin1234`) |
| Qdrant dashboard | http://localhost:6333/dashboard |

Postgres credentials (pgAdmin server host inside Docker: `postgres`):
`rag` / `rag` / db `rag` / port `5432`

### Demo credentials

| Role | Email | Password | Access |
|------|-------|----------|--------|
| user | user@demo.com | user1234 | Chat + search |
| admin | admin@demo.com | admin1234 | Chat + **Dashboard** |

Or open http://localhost:3000/register to create a new **user** account (default role).

## Local (non-Docker) development

```bash
pnpm docker:up          # still need PG + Qdrant (+ optional pgAdmin)
# stop api/web containers if ports clash, or run infra-only profile later

pnpm install
pnpm dev:api            # migrate + seed + optional auto-ingest
pnpm dev:web
```

Manual ingest:

```bash
pnpm ingest -- --strategy=recursive
pnpm ingest:all         # all three strategies
```

## API documentation

Base: `http://localhost:3001`  
Auth: cookie session (`credentials: include`). Responses may include `x-trace-id`.  
Errors: `Content-Type: application/problem+json` (RFC 9457).

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| ALL | `/api/auth/*` | — | Better Auth |
| GET | `/api/health` | — | Liveness |
| GET | `/api/me` | session | Current user + role |
| POST | `/api/search` | user/admin | Semantic search |
| POST | `/api/chat` | user/admin | RAG answer + citations |
| POST | `/api/chat/stream` | user/admin | SSE stream: meta → passages → delta* → done |
| GET | `/api/admin/dashboard` | admin | Docs, jobs, stats, index health |
| POST | `/api/admin/ingest` | admin | Trigger ingest (`strategy` optional) |
| GET | `/api/admin/jobs` | admin | Recent jobs |
| GET | `/api/admin/documents` | admin | Document list |
| GET | `/api/admin/users` | admin | List users |
| POST | `/api/admin/users` | admin | Invite user (`email`, `name`, `password`, `role`) |
| PATCH | `/api/admin/users/:id/role` | admin | Update role (`user` \| `admin`) |

### Example: sign-in + chat

```bash
curl -c cookies.txt -X POST http://localhost:3001/api/auth/sign-in/email \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@demo.com","password":"admin1234"}'

curl -b cookies.txt -X POST http://localhost:3001/api/chat \
  -H "Content-Type: application/json" \
  -H "x-trace-id: demo-1" \
  -d '{"question":"What is the maximum file size for an AppLovin playable, and how does it ship?","strategy":"recursive"}'
```

## MCP server (search)

```bash
# local
pnpm mcp

# or from Docker host using the same codebase/env pointing at published ports
```

Cursor `mcp.json` example:

```json
{
  "mcpServers": {
    "corpus-search": {
      "command": "pnpm",
      "args": ["--dir", "C:/Users/Ulvi/Desktop/playablefactory", "mcp"],
      "env": {
        "DATABASE_URL": "postgresql://rag:rag@localhost:5432/rag",
        "QDRANT_URL": "http://localhost:6333",
        "OPENAI_API_KEY": "sk-...",
        "BETTER_AUTH_SECRET": "same-as-dotenv",
        "BETTER_AUTH_URL": "http://localhost:3001",
        "CHUNK_STRATEGY": "recursive"
      }
    }
  }
}
```

Tool: `search({ query, topK?, strategy? })` → ranked passages JSON (includes `traceId`).  
MCP OIDC was skipped on purpose for the timebox.

## Chunking strategies

| Strategy | Collection | Intent |
|----------|------------|--------|
| fixed | `chunks_fixed` | Baseline windows |
| recursive | `chunks_recursive` | Default; markdown/sections |
| sliding | `chunks_sliding` | Shorter windows for factoids |

Chat/dashboard can pick strategy. Boot auto-ingest fills all three when empty (`AUTO_INGEST_ALL_STRATEGIES=true`).

## Evaluation

RAGAS **faithfulness** alpha play on a 20-question slice of `evals/dataset_100.yaml` (recursive, no rerank).

Models: `gpt-4o-mini` + `text-embedding-3-small`, `TOP_K=5`.

Fusion: `s = α · densê + (1 − α) · BM25̂`

| Setting | α | Meaning | Faithfulness (mean) | n |
|---------|---|---------|---------------------|---|
| hybrid_a0.0 | 0.0 | BM25 only | 0.867 | 20 |
| hybrid_a0.5 | 0.5 | balanced | 0.965 | 20 |
| **hybrid_a1.0** (winner) | 1.0 | dense only | **1.00** | 20 |

![RAGAS faithfulness by hybrid alpha](evals/results/charts/faithfulness_by_setting.png)

On this slice, raising α (more dense) improved faithfulness; pure BM25 (`α=0`) was weakest.

```bash
pip install -r evals/requirements.txt
python evals/run_faithfulness.py --limit 20
python evals/plot_faithfulness.py
```

Outputs: `evals/results/faithfulness_runs.csv`, `faithfulness_summary.csv`, `faithfulness.json`, chart above.

## Environment variables

See `.env.example`. Important:

| Var | Purpose |
|-----|---------|
| `OPENAI_API_KEY` | Embeddings + chat + rerank |
| `DATABASE_URL` | Postgres |
| `QDRANT_URL` | Vector store |
| `BETTER_AUTH_SECRET` | Auth signing (≥32 chars) |
| `CORPUS_PATH` | Documents root |
| `CHUNK_STRATEGY` | Default strategy |
| `TOP_K` | Final passages returned to chat/search |
| `RERANK_ENABLED` | OpenAI rerank after retrieve / hybrid |
| `RERANK_CANDIDATES` | Over-fetch size before rerank / fusion |
| `HYBRID_ENABLED` | Default dense+BM25 α fusion |
| `HYBRID_ALPHA` | Default α in `s = α·densê + (1−α)·BM25̂` |
| `AUTO_INGEST` | Boot ingest if empty |
| `AUTO_INGEST_ALL_STRATEGIES` | Ingest fixed+recursive+sliding |
| `SEED_ON_BOOT` | Create demo users on boot |
| `CORPUS_WATCH` | Self-updating pipeline (file watcher) |
| `CORPUS_WATCH_DEBOUNCE_MS` | Coalesce bursty FS events |
| `CORPUS_WATCH_ALL_STRATEGIES` | Watcher re-indexes all strategies (costlier) |

## Deployment guide

Not live-deployed in this deliverable. Suggested:

- **Web:** Vercel (`apps/web`) with `NEXT_PUBLIC_API_URL`
- **API + Postgres + Qdrant:** Railway / Fly / Render from this Compose file (or managed Postgres + Qdrant Cloud)
- Strong secrets, HTTPS cookies, lock `WEB_ORIGIN`

Alternatively keep the full Compose stack behind a reverse proxy (Caddy/Traefik).

## Project layout

```text
apps/api            Express clean API + MCP + ingest CLI
apps/web            Next.js chat + dashboard
packages/shared     Zod schemas / Problem / DTOs
docker/             Compose + Dockerfiles + pgAdmin config
data/corpus         Case sample dataset
data/sample_questions.md
evals/              RAGAS faithfulness harness
AI_USAGE.md         AI usage log
```

## Useful commands

```bash
pnpm docker:up       # build + start full stack
pnpm docker:logs     # api/web logs (watch ingest)
pnpm docker:down     # stop
pnpm docker:reset    # wipe volumes + rebuild (re-seed + re-ingest)
pnpm ingest:all      # local re-index all strategies
pnpm mcp             # MCP stdio server
```

## Sample questions (from the case)

See `data/sample_questions.md` — e.g. AppLovin max size, Lumen SDK init, sound build pass, March 2026 rejections, localization fallback, plus one ungrounded question (salaries/vacation) to verify refusal behavior.
