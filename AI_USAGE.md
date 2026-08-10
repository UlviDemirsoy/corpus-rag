# AI usage log

Short record of what AI assisted with vs human decisions, and mistakes caught while building this RAG case.

## What AI helped with

- Monorepo scaffolding (pnpm workspaces: `apps/web`, `apps/api`, `packages/shared`)
- Express clean-architecture layout (domain / application / infrastructure / presentation)
- Drizzle schema drafts (Better Auth tables + documents / jobs / search_logs)
- Qdrant client adapter patterns (collections, upsert, query)
- Chunker stubs (fixed / recursive / sliding)
- Next.js page shells (login, chat, dashboard) and shadcn-style UI primitives
- MCP stdio `search` tool wiring with `@modelcontextprotocol/sdk`
- Dockerfiles / Compose sketches for API + Web
- RAGAS eval script skeleton and early README drafts
- Corpus watcher (chokidar) sketch for the self-updating pipeline bonus

## What I wrote / decided myself

- Stack lock: Express (not Nest), Qdrant (not pgvector), Better Auth sessions (not custom JWT pair), Drizzle, RFC 9457 problem+json
- Lite DDD / ports & adapters without heavy domain ceremony
- Per-strategy Qdrant collections (`chunks_fixed|recursive|sliding`)
- Grounding contract: LLM JSON `{ answer, grounded, citations }` + empty-retrieval short-circuit (“not in corpus”)
- AuthZ: `user` → chat/search; `admin` → dashboard / ingest; register creates `user` only
- Observability: `AsyncLocalStorage` request context + `x-trace-id` / `x-request-id` + pino mixin
- Boot behaviour: auto migrate, seed, empty-index ingest, corpus file watcher
- Full Docker stack for fresh-machine demo; skip MCP OIDC and live deploy for timebox
- Keep session cookies (with Next `/api` rewrite) instead of switching to JWT after login bugs

## Where AI got it wrong (and how it was caught)

1. **Qdrant point IDs** — AI used raw hex hashes; Qdrant requires UUID/uint. Caught at upsert; fixed to deterministic UUID-shaped IDs from SHA-256.
2. **Better Auth + `express.json()`** — AI mounted auth after JSON parser; body broke. Caught on sign-in failures; moved `toNodeHandler` before JSON middleware.
3. **Recursive chunker merge** — first draft double-joined fragments. Caught by reading chunk output; simplified merge.
4. **Nest / HttpContext bias** — AI pushed Nest for request context. Rejected; used Express + `AsyncLocalStorage`.
5. **“One ORM for PG + Qdrant”** — clarified there is no shared ORM; Drizzle for PG, official Qdrant client behind a port.
6. **Cross-origin auth cookies** — AI called API at `:3001` from web `:3000` with `SameSite=Lax`, then Docker `Secure` cookies on HTTP. Caught when chat always redirected to login; fixed with Next same-origin `/api` rewrite + `Secure` only when `BETTER_AUTH_URL` is HTTPS.
7. **Qdrant JS `search` API** — newer client uses `query`; caught by TypeScript / runtime. Switched to `query`.

## Mapping to case surfaces (sanity check)

| Requirement | Where it lives |
|-------------|----------------|
| Ingestion (chunk → embed → store, observable) | `IngestCorpus`, `ingestion_jobs`, dashboard jobs/docs |
| Semantic search + grounded RAG + citations | `SemanticSearch`, `RagAnswer`, Chat page |
| Chat page | `apps/web` `/chat` |
| Dashboard (admin) | `apps/web` `/dashboard` |
| AI usage log | this file (`AI_USAGE.md`) |

## Interview walkthrough cues

- Happy path: question → embed → Qdrant → grounded JSON → citations on Chat
- Refuse path: empty / irrelevant hits → `grounded: false`, no invented citations
- Ingest observability: job status + per-file fail without killing the whole run
- Self-update: watch add/change/delete → incremental ingest (hash skip + removal sync)
- Auth: cookie session via proxied `/api`; admin-only dashboard guards
