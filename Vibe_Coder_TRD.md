# Vibe Coder — Technical Requirements Document
*Engineering spec for the hardening phase (companion to the PRD)*

Repo analyzed: `github.com/Ayush-840/code_x` • September 2026 • v0.1

---

## 1. As-Built Architecture (from code review)

This reflects what is actually running today, not what the spec docs describe:

- **apps/web** — Next.js frontend (dashboard, repo detail page with Architecture/Modules/Questions/Chat/Mock-Interview tabs).
- **apps/api** — Express REST API; routes for auth, users, repos, artifacts, chat, mock interviews, usage, billing; JWT bearer auth via `requireAuth` middleware.
- **apps/websocket** — Socket.IO server for analysis-progress, chat, and mock-interview streaming.
- **apps/worker** — BullMQ worker; `analyzeRepo` job orchestrates clone → parse → index → generate by calling the three Python services over HTTP.
- **packages/analysis** (Python/FastAPI) — AST parsing + chunking of the cloned repo.
- **packages/retrieval** (Python/FastAPI) — indexing + hybrid search; RRF fusion in `rrf.py`.
- **packages/generation** (Python/FastAPI) — architecture/module/question generation via LLM, with a demo fallback when `OPENAI_API_KEY` is unset.
- **packages/mock-interview** (Python/FastAPI) — interview session, persona, and scoring logic.
- **packages/database** — Prisma schema + migrations against PostgreSQL (User, Repository, AnalysisJob, CodeModule, Artifact, ChatSession, MockInterviewSession, Subscription, etc.).
- **docker/docker-compose.yml** — provisions Postgres, Redis, and OpenSearch only; no service containers.

## 2. Defect Log (traced to exact files)

| # | File | Defect |
|---|---|---|
| D1 | `apps/api/src/routes/auth.ts` (`GET /github`) | When `githubClientId`/`Secret` are unset, mints a valid signed JWT for the seeded demo user (or an unused subject) with no identity check — functions as an auth bypass if hit in a misconfigured deployment. |
| D2 | `apps/api/src/config.ts` | `jwtSecret` and `databaseUrl` both fall back to hardcoded literal values when the corresponding env vars are unset, committed in plaintext. |
| D3 | `apps/api/src/routes/auth.ts` (`github/callback`, `refresh`) | Access + refresh tokens are appended as `?token=&refresh=` on a 302 redirect URL — exposed via browser history, access logs, Referer headers. |
| D4 | `apps/api/src/routes/auth.ts` (`DELETE /logout`) | No-op; refresh tokens have no server-side record, so none can be revoked before natural 30-day expiry. |
| D5 | `packages/retrieval/src/retrieval/indexing.py` | `_CHUNKS` is a module-level in-process dict — index is lost on restart and not shared across horizontally scaled instances. |
| D6 | `packages/retrieval/src/retrieval/search.py` | `_LocalDenseEmbedder` is a hashed character n-gram bag-of-words vector, not a semantic embedding; `_openai_dense_search` exists but is never called from `hybrid_search` — dead code. |
| D7 | `packages/retrieval/src/retrieval/indexing.py` (`_mirror_to_opensearch`) | Chunks are written to OpenSearch "best-effort" but `search.py` never reads from OpenSearch — the service in docker-compose is provisioned but functionally unused. |
| D8 | `apps/worker/src/jobs/analyzeRepo.ts` | `mkdtemp` working directory (cloned repo) is never removed after the job succeeds or fails — unbounded disk growth on the worker. |
| D9 | `apps/worker/src/jobs/analyzeRepo.ts` (`simpleGit().clone`) | GitHub access token is interpolated directly into the clone URL string passed to a subprocess — risk of exposure via process listing or verbose git logging. |
| D10 | `docker/` (whole directory) | No Dockerfile exists for any of the 8 app/service packages; docker-compose.yml only starts infra (Postgres/Redis/OpenSearch), contradicting `VIBE_CODER_DEPLOYMENT_GUIDE.md`. |
| D11 | repo root | No `.github/workflows` directory — no CI — and no test files anywhere in the codebase despite `VIBE_CODER_QA_TEST_PLAN.md` describing a full manual matrix. |
| D12 | `.gitignore` | Excludes only the literal ".env", not ".env*"; `apps/web/.env.local` is currently committed (contents harmless today, but the pattern is unsafe going forward). |
| D13 | `packages/generation/src/generation/llm.py` | When `OPENAI_API_KEY` is unset, `complete()` silently returns templated "[demo answer]" text with no flag surfaced to the API response or frontend to distinguish it from a real answer. |

## 3. Target Technical Design

### 3.1 Auth (resolves D1–D4)

- Remove the no-OAuth-configured fallback branch in `GET /v1/auth/github` entirely. In local/dev, require a real (even if sandbox) GitHub OAuth app — document this as a setup step, don't code around it.
- On boot, validate that `JWT_SECRET`, `DATABASE_URL`, and (outside local dev) `GITHUB_CLIENT_ID`/`SECRET` are present; throw and refuse to start otherwise. Delete the hardcoded fallback literals from `config.ts`.
- Change the OAuth callback to set the access and refresh tokens as `httpOnly`, `Secure`, `SameSite=Lax` cookies and redirect to a bare `/login?authenticated=1`, instead of embedding tokens in the URL.
- Add a `RefreshToken` table (`userId`, `tokenHash`, `expiresAt`, `revokedAt`) in Prisma. Issue refresh tokens as opaque IDs mapped to hashed records, not bare JWTs. `POST /v1/auth/refresh` checks `revokedAt IS NULL`; `DELETE /v1/auth/logout` sets `revokedAt = now()`.

### 3.2 Retrieval Engine (resolves D5–D7)

- Decide the vector store: recommended — enable the `pgvector` extension on the existing Postgres instance and store embeddings in a new `CodeChunkEmbedding` table (`repoId`, `chunkId`, `vector`, `filePath`, `startLine`, `endLine`), keeping infra to one datastore. Alternative: keep the already-provisioned OpenSearch and actually wire `search.py` to query its k-NN plugin — either is acceptable, but pick one; don't run both.
- Replace `_LocalDenseEmbedder` with a call to a real embedding model (OpenAI `text-embedding-3-small`, already referenced in `_openai_dense_search`, or a self-hosted `sentence-transformers` model to avoid per-call cost) and persist the resulting vectors to the chosen store instead of the in-memory dict.
- Rewrite `hybrid_search` to query the persistent store for both the dense and sparse legs (Postgres full-text or BM25 over the same table works for the sparse leg), then fuse with the existing `rrf.py` — that module needs no changes, it already implements RRF correctly.
- If OpenSearch is dropped in favor of pgvector, remove it from `docker-compose.yml` and the deployment guide rather than leaving unused infra.

### 3.3 Worker & Job Hygiene (resolves D8–D9)

- Wrap the `analyzeRepo` job body in try/finally and `rm` the `mkdtemp` directory (`fs.rm(dir, {recursive:true, force:true})`) in the finally block so it's cleaned up on both success and failure.
- Pass the access token to `simple-git` via a short-lived credential helper or an Authorization header equivalent instead of string-interpolating it into the clone URL; at minimum, ensure `simple-git`'s logging is set to a level that never echoes the full remote URL.

### 3.4 Containerization & CI (resolves D10–D11)

- Add a Dockerfile per deployable unit: `apps/api`, `apps/web`, `apps/websocket`, `apps/worker` (Node 20-alpine multi-stage), and one shared Python base image reused by `packages/analysis`, `retrieval`, `generation`, `mock-interview` (each just changes the FastAPI entrypoint module).
- Extend `docker-compose.yml` with these 8 services alongside the existing Postgres/Redis(/OpenSearch) so `docker compose up` brings up the entire stack, matching what `README.md`'s Quick Start already implies.
- Add `.github/workflows/ci.yml`: on every PR, run `pnpm install`, `pnpm typecheck`, `pnpm lint`, `pnpm -r build` for the TS side, and `pytest` for each Python package; block merge on failure.
- Add a minimal test suite as the CI's actual content, not just its plumbing: supertest-based route tests for `apps/api`'s auth/repos/chat routes, and pytest unit tests for `rrf.py`, `indexing.py`, and `search.py` (these are pure functions today and are cheap to test directly).

### 3.5 Housekeeping (resolves D12–D13)

- Change `.gitignore`'s env line from `.env` to `.env*`, and run `git rm --cached apps/web/.env.local` (keeping the working copy) so future edits to it are never tracked.
- Have `complete()` in `llm.py` return a `(text, citations, isDemo)` tuple; thread `isDemo` through the API response and render a small "Demo mode — connect an API key for real answers" badge in the Chat and Mock-Interview tabs whenever it's true.

## 4. Sequencing

| Step | Work | Depends on |
|---|---|---|
| 1 | Auth hardening (3.1) — D1–D4 | None — do first, it's the highest-risk item and touches the least other code. |
| 2 | Vector store decision + persistence (3.2) — D5–D7 | None, but should be decided before any further retrieval work is built on top of it. |
| 3 | Worker cleanup + token handling (3.3) — D8–D9 | None — can run in parallel with steps 1–2. |
| 4 | Dockerfiles + compose + CI skeleton (3.4, infra half) — D10 | Steps 1–3 ideally merged first, so CI has something meaningful to check. |
| 5 | Test suite + CI gating (3.4, tests half) — D11 | Step 4. |
| 6 | `.gitignore` fix + demo-mode flag (3.5) — D12–D13 | None — can be done anytime, low risk, good first PR. |

## 5. Acceptance Criteria

- Starting the API with `GITHUB_CLIENT_ID`/`SECRET` unset causes a startup failure, not a working demo-auth redirect.
- Restarting the retrieval service mid-session does not lose a previously indexed repo's search results.
- A fresh `git clone` can run `docker compose up` (all 8 services + infra) and reach a working `localhost:3000` without any manual step outside `docker-compose.yml` and a documented `.env` file.
- CI is green on `main` and fails a PR that breaks typecheck, lint, build, or any test.
- `git log -p apps/web/.env.local` shows no history after the housekeeping PR merges, and a newly created `apps/web/.env.local` is not picked up by `git status`.
