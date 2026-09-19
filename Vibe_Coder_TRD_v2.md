# Vibe Coder — Technical Requirements Document (Review #2)
*Engineering spec for the follow-up hardening pass (companion to PRD Review #2)*

Repo analyzed: `github.com/Ayush-840/code_x` • commit `4937ffb` • September 2026

---

## 1. What Changed Since the Last Review

Diffed against the previously reviewed commit (`98cf53a`). Real, substantive changes landed:

- `apps/api/src/config.ts` — added `requireEnv()`/`optionalEnv()`; hardcoded secret fallbacks removed.
- `apps/api/src/routes/auth.ts` — full rewrite: demo-bypass branch removed, cookie-based tokens, opaque+hashed refresh tokens, rotation on refresh, real revocation on logout.
- `packages/database/prisma/schema.prisma` + new migration `20260919094132_add_refresh_tokens` — added a `RefreshToken` model.
- `apps/worker/src/jobs/analyzeRepo.ts` — `try/finally` with `rm(dir, ...)`; token masking added to the clone log line.
- `packages/generation/src/generation/llm.py` + `main.py` — `complete()` now returns `(text, citations, isDemo)`; threaded through `/chat`.
- `apps/api/src/routes/chat.ts` — forwards `isDemo` in the message-send response.
- `apps/web/src/components/tabs/ChatTab.tsx` — renders a `DEMO` badge when `isDemo` is true.
- New: `apps/api/Dockerfile`, `apps/web/Dockerfile`, `apps/websocket/Dockerfile`, `apps/worker/Dockerfile`, `docker/Dockerfile.python`.
- `docker/docker-compose.yml` — extended with all 8 application services alongside the existing infra.
- New: `.github/workflows/ci.yml` (typecheck, lint, test, python jobs).
- New: `apps/api/tests/health.test.ts` (2 tests), vitest added to `apps/api/package.json`.
- `.gitignore` — `.env` → `.env*` with `!.env.example`; `apps/web/.env.local` removed from tracking; new `.env.example` added.
- `apps/websocket/src/auth.ts` — added `extractTokenFromCookie()`, correctly reads the new cookie.
- `apps/web/src/lib/socket.ts` — switched to `withCredentials: true` for the WebSocket connection.

**Untouched:** everything under `packages/retrieval/` — byte-for-byte identical to the last review.

## 2. Root-Cause Analysis: Why the App Is Currently Down

The auth rework touched three consumers of the token (REST middleware, frontend HTTP client, WebSocket server) but only fully updated one of them correctly (WebSocket) and one partially (the frontend sends cookies but has no way to read auth state back). The REST middleware wasn't touched at all.

```
apps/api/src/middleware/auth.ts   →  still: req.headers.authorization?.startsWith("Bearer ")
apps/web/src/lib/api.ts           →  sends: credentials: "include"  (cookie, no header)
apps/websocket/src/auth.ts        →  correctly: extractTokenFromCookie(cookieHeader)
```

Because the cookie is never converted into a header anywhere, `requireAuth` throws `401 UNAUTHORIZED` on literally every request to every route mounted behind it — which is all of `/v1/users`, `/v1/repos`, `/v1/chat`, mock interviews, and usage. Only `/v1/auth/*` and `GET /health` still work.

## 3. Fix Specification (P0)

### 3.1 `apps/api/src/middleware/auth.ts` (resolves PRD2-01)

Replace the Bearer-only check with a cookie read, matching what `apps/websocket/src/auth.ts` already does correctly:

```ts
export function requireAuth(req: AuthedRequest, _res: Response, next: NextFunction): void {
  const token = req.cookies?.access_token;
  if (!token) {
    throw new HttpError(401, "UNAUTHORIZED", "Missing or invalid authentication token");
  }
  try {
    const payload = jwt.verify(token, config.jwtSecret) as { sub: string; githubId: number };
    req.userId = payload.sub;
    req.githubId = payload.githubId;
    next();
  } catch (e) {
    if (e instanceof jwt.TokenExpiredError) {
      throw new HttpError(401, "TOKEN_EXPIRED", "JWT has expired; refresh required");
    }
    throw new HttpError(401, "UNAUTHORIZED", "Missing or invalid authentication token");
  }
}
```

`app.ts` already calls `app.use(cookieParser())` before the routes, so `req.cookies` is available — no new middleware needed.

### 3.2 `apps/web/src/lib/api.ts` (resolves PRD2-02)

Delete the `document.cookie` check entirely (it can never see an `httpOnly` cookie). Add a real endpoint and check:

- Backend: `GET /v1/auth/me` behind `requireAuth`, returning the current user (trivial — `requireAuth` already resolves `req.userId`).
- Frontend: `isAuthenticated()` becomes an async call to `/v1/auth/me`; `useAuthRedirect()` in `components/auth.ts` awaits it instead of a synchronous cookie string check.

### 3.3 `docker/Dockerfile.python` (resolves PRD2-03)

The mock-interview branch of the CMD is:

```
elif [ "$SERVICE" = "mock-interview" ]; then \
  uvicorn packages.mock_interview.src.mock_interview.main:app --host 0.0.0.0 --port 8400; \
```

`packages.mock_interview` (underscore) does not exist — the directory on disk is `packages/mock-interview` (hyphen), which also can't appear in a dotted Python import path at all. Fix:

```
elif [ "$SERVICE" = "mock-interview" ]; then \
  uvicorn mock_interview.main:app --host 0.0.0.0 --app-dir packages/mock-interview/src --port 8400; \
```

(`--app-dir` points uvicorn at the package's actual `src/` directory, where `mock_interview/` — underscore, the real Python package name — lives. This mirrors how the package is presumably already installed/run locally via its `pyproject.toml`; worth double-checking the other three branches use the same `--app-dir` pattern for consistency rather than relying on implicit namespace packages from the repo root.)

## 4. Fix Specification (P1 — Secret Handling)

### 4.1 `docker-compose.yml` (resolves PRD2-04)

Remove the fallback default:

```yaml
# before
JWT_SECRET: ${JWT_SECRET:-change-me-to-a-random-32-char-string}
# after
JWT_SECRET: ${JWT_SECRET:?JWT_SECRET must be set in your .env file}
```

The `:?` syntax makes `docker compose up` fail immediately with a clear message if the variable isn't set in the host `.env`, instead of silently supplying a known value.

### 4.2 `docker-compose.yml` DB credentials (resolves PRD2-05)

Parameterize instead of hardcoding, consistent with how `JWT_SECRET` should work:

```yaml
postgres:
  environment:
    POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set}
# and reference the same var in api/worker's DATABASE_URL
```

## 5. Fix Specification (P1 — Retrieval Engine, carried over)

No change from the v1 TRD's Section 3.2 — it remains the target design, since `packages/retrieval` hasn't moved:

- Pick one vector store (pgvector on the existing Postgres is still the recommendation, to avoid running Postgres + OpenSearch as two sources of truth) and persist chunk embeddings there instead of the in-memory `_CHUNKS` dict.
- Replace `_LocalDenseEmbedder` with a real embedding call (the already-written `_openai_dense_search` is a reasonable starting point) and wire its output into the persisted store.
- Rewrite `hybrid_search` to read both legs from that store; `rrf.py` needs no changes.
- If pgvector is chosen, remove the OpenSearch service and its mirroring code rather than leaving it running unused.

## 6. Fix Specification (P2 — CI)

### 6.1 `.github/workflows/ci.yml` (resolves PRD2-08)

Remove `|| true` from the lint, test, and python jobs:

```yaml
# lint job
- run: pnpm -r lint          # was: pnpm -r lint || true
# test job
- run: pnpm -r test          # was: pnpm -r test || true
# python job
- run: python -m pytest packages/*/tests/ -v   # was: ... || true
```

Note: removing `|| true` from the python job will fail immediately since no `packages/*/tests/` directories exist yet — that's correct behavior (CI should fail until PRD2-09 adds real tests), but land it in the same PR as at least one real pytest file per Python service so the pipeline goes red-then-green rather than staying red on `main`.

## 7. Sequencing

| Step | Work | Depends on |
|---|---|---|
| 1 | PRD2-01 + PRD2-02 (auth middleware + frontend auth check) | None — this is the outage fix, ship alone, ship first. |
| 2 | PRD2-03 (mock-interview Dockerfile path) | None — independent, safe to bundle with step 1's PR or ship separately. |
| 3 | PRD2-04 + PRD2-05 (remove compose-level secret fallbacks) | None — independent, low risk. |
| 4 | PRD2-06 + PRD2-07 (persistent store + real embeddings) | Should follow step 1, since testing retrieval changes requires a working, loggable-into app. |
| 5 | PRD2-08 + PRD2-09 (CI gating + real test coverage) | Best done alongside step 4, so the new retrieval code ships with tests from day one rather than being retrofitted. |

## 8. Acceptance Criteria

- A fresh login completes and a subsequent `GET /v1/repos` (or any authenticated route) returns 200, not 401.
- `isAuthenticated()` correctly reflects real session state on both a logged-in and logged-out browser, verified without reading `document.cookie`.
- `docker compose up` reports all 8 application containers healthy, including `vibecoder-mock-interview`.
- `docker compose up` with no `.env` file present fails fast with a clear "JWT_SECRET must be set" error rather than starting with a default secret.
- Deliberately introducing a lint error or a failing test on a branch causes the corresponding CI job to go red.
- Restarting the retrieval service between two search requests for the same repo returns identical results.
