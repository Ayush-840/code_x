# Vibe Coder — Technical Requirements Document (Review #3)
*Engineering spec for the third hardening pass (companion to PRD Review #3)*

Repo analyzed: `github.com/Ayush-840/code_x` • commit `940a8d8` • September 2026

---

## 1. What Changed Since Review #2

Diffed against the previously reviewed commit (`4937ffb`):

- `apps/api/src/middleware/auth.ts` — reads `access_token` from cookies instead of an `Authorization: Bearer` header.
- `apps/api/src/routes/auth.ts` — added `GET /v1/auth/me`.
- `apps/web/src/lib/api.ts`, `apps/web/src/components/auth.ts` — `isAuthenticated()` is now an async call to `/v1/auth/me`; `useAuthRedirect()` awaits it.
- `apps/api/src/config.ts` — `.env` loading now walks up to the workspace root if not found in CWD.
- `docker/Dockerfile.python` — CMD rewritten to use `--app-dir packages/<service>/src` with correct package names for all 4 services (fixes the mock-interview crash from Review #2).
- `docker/docker-compose.yml` — `JWT_SECRET` and `POSTGRES_PASSWORD` switched from `:-default` to `:?required` syntax; `DATABASE_URL` now references `${POSTGRES_PASSWORD}` consistently.
- `.github/workflows/ci.yml` — `\|\| true` removed from lint, test, and python jobs.
- `packages/retrieval/src/retrieval/indexing.py` — full rewrite: chunks now persisted as JSON files under `/tmp/vibecoder-retrieval/{repoId}.json` (was: in-memory dict).
- `packages/retrieval/src/retrieval/search.py` — full rewrite: added `_NvidiaEmbedder` (real embeddings via NVIDIA NIM, OpenAI-compatible) with key rotation, used when keys are configured; `_LocalDenseEmbedder` (hashed n-grams) kept only as the no-key fallback. All OpenSearch references removed.
- `packages/generation/src/generation/llm.py` — switched from raw OpenAI client to the same NVIDIA NIM + key-rotation pattern as retrieval, with a `_demo_complete` fallback on total key exhaustion.
- New: `packages/shared_python/src/shared/key_rotation.py` — a `KeyRotator` class shared by `retrieval` and `generation`, imported via a `sys.path.insert` hack rather than a proper installed dependency.
- `apps/web/src/components/tabs/ArchitectureTab.tsx` — unrelated robustness fix, now handles both string and object shapes for `stack`/`entryPoints`.
- **All four Python packages** (`analysis`, `retrieval`, `generation`, `mock-interview`) — silently migrated from `requirements.txt` to `pyproject.toml` (Poetry). This is the root cause of the new P0 (Section 2).

## 2. Root-Cause Analysis: Why No Python Service Can Be Built

```
packages/analysis/       →  pyproject.toml only, no requirements.txt
packages/retrieval/      →  pyproject.toml only, no requirements.txt
packages/generation/     →  pyproject.toml only, no requirements.txt
packages/mock-interview/ →  pyproject.toml only, no requirements.txt

docker/Dockerfile.python →  COPY packages/analysis/requirements.txt ...       (4x, one per service)
.github/workflows/ci.yml →  pip install -r packages/analysis/requirements.txt (4x, in the `python` job)
```

The Poetry migration and the Dockerfile/CI fixes from Review #2 were evidently done in different work sessions without cross-checking each other. `docker build` fails at the `COPY` instruction with a "file not found" error before any Python code runs; CI's python job fails at the `pip install` step for the same reason. Neither the retrieval rewrite's persistence nor its new embedding model can currently reach a running container.

## 3. Fix Specification (P0)

### 3.1 `docker/Dockerfile.python` (resolves PRD3-01)

Switch to Poetry, matching what the packages actually use now:

```dockerfile
FROM python:3.13-slim AS base
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends build-essential \
    && rm -rf /var/lib/apt/lists/* \
    && pip install --no-cache-dir poetry

COPY packages/analysis/pyproject.toml /tmp/analysis/pyproject.toml
COPY packages/retrieval/pyproject.toml /tmp/retrieval/pyproject.toml
COPY packages/generation/pyproject.toml /tmp/generation/pyproject.toml
COPY packages/mock-interview/pyproject.toml /tmp/mock-interview/pyproject.toml

# Export each service's deps to a combined requirements file so one venv covers all 4
# (keeps the existing single-image-for-4-services design from the last review)
RUN for svc in analysis retrieval generation mock-interview; do \
      cd /tmp/$svc && poetry export -f requirements.txt --without-hashes -o requirements.txt; \
    done
RUN pip install --no-cache-dir \
      -r /tmp/analysis/requirements.txt \
      -r /tmp/retrieval/requirements.txt \
      -r /tmp/generation/requirements.txt \
      -r /tmp/mock-interview/requirements.txt

FROM base AS runner
COPY packages/ ./packages/
# ... CMD block unchanged from Review #2's fix
```

(`poetry export` requires the `poetry-plugin-export` plugin in newer Poetry versions — pin a Poetry version known to include it, or install the plugin explicitly, to avoid trading one broken build for another.)

### 3.2 `.github/workflows/ci.yml` python job (resolves PRD3-02)

Mirror whatever install strategy the Dockerfile ends up using, so a green CI run is a reliable signal that the Docker build will also succeed:

```yaml
  python:
    name: Python Tests
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.13"
      - name: Install Poetry
        run: pip install poetry
      - name: Install dependencies
        run: |
          for svc in analysis retrieval generation mock-interview; do
            (cd packages/$svc && poetry install --no-root)
          done
      - name: Run Python tests
        run: |
          for svc in analysis retrieval generation mock-interview; do
            (cd packages/$svc && poetry run pytest ../../../packages/$svc/tests -v)
          done
```

Note this will still fail (correctly) until PRD3-06/tests exist — that's expected and fine; the point of this fix is that it should fail *because tests are missing*, not because dependency installation is broken.

## 4. Fix Specification (P1 — Retrieval Engine)

### 4.1 Persist embedding vectors, not just text (resolves PRD3-03)

Extend `indexing.py`'s stored record to include the computed vector, and compute it once at index time rather than at every search:

```python
def index_chunks(repo_id: str, chunks: list[dict]) -> int:
    embedder = _get_embedder()  # from search.py
    records = []
    for chunk in chunks:
        ...
        records.append({..., "embedding": embedder.embed(chunk["text"])})
    ...
```

`_dense_search` in `search.py` then becomes a pure lookup + cosine comparison against stored vectors — no embedding calls at search time except for the query itself (one call per search, not one per chunk). This is the single highest-value fix in this phase: it turns an O(chunks) per-search API cost into O(1).

Watch for: re-indexing must re-embed changed chunks (already handled by the upsert-by-`_chunk_id` logic) but should skip re-embedding unchanged ones where possible, since `_chunk_id` is deterministic from `(repo_id, file_path, start_line)` and existing records can be reused if the text hash matches.

### 4.2 Durable storage across container recreation (resolves PRD3-04)

Minimum fix: mount a named volume for the retrieval service's storage dir in `docker-compose.yml`:

```yaml
retrieval:
  volumes:
    - vibecoder-retrieval-data:/tmp/vibecoder-retrieval
  environment:
    RETRIEVAL_STORAGE_DIR: /tmp/vibecoder-retrieval
# and under top-level `volumes:`
  vibecoder-retrieval-data:
```

This closes the immediate gap but still doesn't solve multi-replica sharing (out of scope for a single-instance deployment, but worth a one-line note in the deployment guide that horizontal scaling of this service isn't yet supported). Moving to pgvector on the existing Postgres remains the correct long-term fix if/when multi-replica retrieval is needed, since it was already provisioned for exactly this purpose two reviews ago.

### 4.3 Remove OpenSearch (resolves PRD3-05)

Delete the `opensearch` service block from `docker-compose.yml`, its `vibecoder-osdata` volume, and the `OPENSEARCH_URL` environment line from the `retrieval` service block. Update `VIBE_CODER_DEPLOYMENT_GUIDE.md` if it still references OpenSearch as part of the architecture.

## 5. Fix Specification (P2 — Tests, carried over)

Unchanged from Review #2's TRD Section 6.1 recommendation: add real `pytest` files under `packages/*/tests/` for the pure-function pieces that are cheap to test directly — `rrf.py` (unchanged, still correct), the chunk-id/upsert logic in `indexing.py`, and `_citations_from()` in `llm.py`. These would have caught the Poetry/requirements.txt mismatch immediately if CI had been able to run them.

## 6. Sequencing

| Step | Work | Depends on |
|---|---|---|
| 1 | PRD3-01 + PRD3-02 (Dockerfile + CI install alignment) | None — blocks everything else, ship first and alone. |
| 2 | PRD3-03 (persist embedding vectors) | Step 1, so it can actually be tested in a built container. |
| 3 | PRD3-04 (volume mount) + PRD3-05 (remove OpenSearch) | Independent of each other and of step 2 — can ship in parallel or bundled together as compose-file cleanup. |
| 4 | PRD3-06 / test coverage | Best done alongside step 2, so the persistence rewrite ships with its own tests rather than being retrofitted a third time. |

## 7. Acceptance Criteria

- `docker compose build` completes for all 8 services with no manual steps beyond what's in `VIBE_CODER_DEPLOYMENT_GUIDE.md`.
- CI's python job reaches `pytest` execution (even if it then reports "no tests found" until PRD3-06 lands) rather than failing at dependency installation.
- Indexing a repo, then searching it twice in a row, results in exactly one embedding API call for the query on the second search — not one per chunk.
- `docker compose down && docker compose up` (full container recreation, not just a process restart) preserves a previously indexed repo's search results.
- `docker-compose.yml` contains no reference to `opensearch` or `OPENSEARCH_URL`.
