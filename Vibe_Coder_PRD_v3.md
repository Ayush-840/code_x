# Vibe Coder — Product Requirements Document (Review #3)
*Follow-up review after the second hardening pass*

Repo analyzed: `github.com/Ayush-840/code_x` • commit `940a8d8` • September 2026

---

## 1. Purpose of This Document

This supersedes the Review #2 PRD's requirement list. The good news first: the P0 outage from the last review (every authenticated request returning 401) is fully fixed and verified, and the retrieval engine — untouched for two straight reviews — finally got real work. The bad news: an unrelated dependency-management migration quietly broke every Python service's Docker build, which is a more severe blocker than what it replaced.

## 2. Status of Every Review #2 Requirement

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| PRD2-01 | `requireAuth` reads the session from the cookie | ✅ Fixed | `middleware/auth.ts` now reads `req.cookies?.access_token`, matching how tokens are actually issued. |
| PRD2-02 | Frontend can correctly determine auth state | ✅ Fixed | `isAuthenticated()` now calls `GET /v1/auth/me` (new route, backed by `requireAuth`) instead of reading an unreadable `httpOnly` cookie. |
| PRD2-03 | Mock-interview container starts successfully | ✅ Fixed | `Dockerfile.python` CMD now uses `--app-dir packages/<service>/src` with the correct underscored package name for all 4 services. |
| PRD2-04 | No default value for `JWT_SECRET` in compose | ✅ Fixed | `docker-compose.yml` now uses `${JWT_SECRET:?JWT_SECRET must be set in your .env file}`. |
| PRD2-05 | No hardcoded `dev_password_123` in "production" services | ✅ Fixed | `POSTGRES_PASSWORD` is now required (`:?`) and referenced consistently via `${POSTGRES_PASSWORD}` in `DATABASE_URL`. |
| PRD2-06 | Indexed data persists across restarts / shared across replicas | ⚠️ Partial | Chunks now persist to JSON files under `/tmp/vibecoder-retrieval/`, surviving an in-process restart. No volume is mounted for that path, so it does **not** survive container recreation/redeploy, and it's still per-instance, not shared across replicas. |
| PRD2-07 | Real semantic embeddings, not a placeholder | ⚠️ Mostly fixed, new perf/cost issue | A real NVIDIA NIM embedding model with key rotation is now wired in and used whenever keys are configured (falls back to the old hashed n-gram only in demo mode, which is a reasonable, intentional fallback). But see the new finding in Section 3 — embeddings are recomputed on every search, not stored. |
| PRD2-08 | CI can actually fail | ✅ Fixed | `\|\| true` removed from lint, test, and python jobs. |
| PRD2-09 | Test coverage beyond 2 smoke tests | ❌ Still open | Still no `tests/` directory in any of the 4 Python packages; still nothing for `apps/web`, `apps/worker`, `apps/websocket`. |

## 3. New Finding: Every Python Service's Docker Build Is Broken

All four Python packages (`analysis`, `retrieval`, `generation`, `mock-interview`) were migrated to Poetry (`pyproject.toml`) at some point in this round of changes — a reasonable modernization on its own. But two files that were fixed in the *previous* review still assume the old pip/`requirements.txt` layout and were never updated to match:

- `docker/Dockerfile.python` still does `COPY packages/analysis/requirements.txt ...` (and the same for the other three) — none of these files exist anywhere in the repo anymore.
- `.github/workflows/ci.yml`'s `python` job still does `pip install -r packages/analysis/requirements.txt` (and the same for the other three).

Both fail immediately, before any application code even runs. This is a step backward from the last review: previously the Python services could at least be built and started (they just weren't fully correct); right now none of them can be built at all. Any of the good work from PRD2-06/07 (persistence, real embeddings) currently can't reach a deployed environment until this is fixed.

## 4. New Finding: Embeddings Recomputed on Every Search

`indexing.py`'s new persistence layer stores each chunk's raw text to disk, but never its computed embedding vector. `search.py`'s `_dense_search` then re-embeds every stored chunk, on every single search call, before it can compare against the query. With the real NVIDIA embedder now wired in, this means one chat message triggers `(number of chunks) + 1` synchronous embedding API calls — slow for the user and needlessly costly, and it scales worse as a repo's index grows, which is exactly backwards for a feature meant to make search fast and cheap once a repo is indexed.

## 5. New Finding: OpenSearch Is Now Fully Dead Infrastructure

The retrieval rewrite dropped every reference to OpenSearch from the actual code (previously it was at least half-used, as a write-only mirror). `docker-compose.yml`, however, still provisions the OpenSearch container and still injects `OPENSEARCH_URL` into the retrieval service — a heavyweight, memory-hungry service that nothing reads from or writes to anymore. It should be removed from the compose file now that the design has moved on.

## 6. Requirements (Re-Prioritized)

### 6.1 P0 — Nothing Can Deploy Without This

| ID | Requirement | Why it's P0 |
|---|---|---|
| PRD3-01 | Every Python service's Docker image must build successfully from the current `pyproject.toml`-based packages. | Right now, zero of the 4 Python containers can be built — this blocks all deployment, not just retrieval. |
| PRD3-02 | CI's python job must install dependencies the same way the Docker build does, so a green CI run means the Docker build will also succeed. | Keeping these two install paths in sync is what prevents this exact class of regression from recurring. |

### 6.2 P1 — Finish the Retrieval Engine

| ID | Requirement | Why it matters |
|---|---|---|
| PRD3-03 | Computed embedding vectors must be persisted alongside each chunk, not recomputed on every search. | The current design pays the full embedding cost (latency + API cost) on every chat message, which won't hold up past a handful of users or a repo of any real size. |
| PRD3-04 | The retrieval service's persisted index must survive container recreation, not just an in-process restart. | `/tmp` inside a container is wiped on recreation; this needs an actual mounted volume (or a move to a real datastore) to meet the original PRD-05/PRD2-06 bar. |
| PRD3-05 | Remove OpenSearch from `docker-compose.yml` and any remaining env wiring, now that no code reads from it. | Running an unused, memory-hungry service in every local/deployed environment is pure waste and misleads anyone reading the compose file about the actual architecture. |

### 6.3 P2 — Still Carried Over

| ID | Requirement | Why it matters |
|---|---|---|
| PRD3-06 (= PRD2-09) | Automated test coverage beyond `apps/api`'s 2 smoke tests, especially for the newly-rewritten retrieval and generation services. | This is now three reviews running with the same gap — and it's exactly the kind of change (a dependency migration that broke two unrelated files) that a basic CI-run smoke test per service would have caught immediately. |

## 7. Non-Goals for This Phase

(Unchanged.) New user-facing features, billing hardening, multi-language parser coverage, and UI redesign remain out of scope until the Python build is fixed and retrieval is fully closed out.

## 8. Success Metrics for This Phase

- `docker compose build` succeeds for all 8 services with zero manual intervention.
- CI's python job installs successfully and reaches the point of actually collecting (even if still empty) test results, rather than failing at `pip install`.
- Indexing a repo, restarting the retrieval container (not just the process), and searching again returns the same results without re-hitting the embedding API for chunks that haven't changed.
- `docker compose config` (or a manual read of the compose file) shows no reference to OpenSearch.

## 9. Risks & Open Questions

- PRD3-01/02 should ship together and first, as a single small PR — pick one path (Poetry everywhere, including in the Dockerfile and CI) rather than trying to keep both requirements.txt and pyproject.toml working in parallel.
- PRD3-03 (persisting embedding vectors) and PRD3-04 (surviving container recreation) are closely related and are natural to design together: once vectors are being persisted, the storage format decision (JSON file with an embedded vector, SQLite, or finally moving to pgvector as originally discussed two reviews ago) should be made once, not twice.
- The pgvector-vs-OpenSearch decision flagged as open in both prior reviews has now effectively been decided by omission — OpenSearch has been dropped from the code — so PRD3-05 is really just catching the compose file up to a decision that's already been made in practice.
