# Vibe Coder — Product Requirements Document (Review #2)
*Follow-up review after the first hardening pass*

Repo analyzed: `github.com/Ayush-840/code_x` • commit `4937ffb` • September 2026

---

## 1. Purpose of This Document

This supersedes the v1 PRD's requirement list. A first hardening pass was completed against v1 — most of it landed well, some of it introduced new, more severe problems than what it fixed. This document scores every v1 requirement against the current code, then re-prioritizes what's left, led by one urgent finding: **the deployed app is currently non-functional** — no authenticated request can succeed — because of a gap between the auth fix on the backend and the frontend/middleware that talk to it.

## 2. Status of Every v1 Requirement

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| PRD-01 | No code path issues a token without verifying identity | ✅ Fixed | Demo-bypass branch removed entirely from `GET /v1/auth/github`. |
| PRD-02 | App fails to start without required secrets, no hardcoded fallbacks | ⚠️ Regressed at deploy layer | `config.ts` now uses `requireEnv()` correctly — but `docker-compose.yml` supplies `JWT_SECRET: ${JWT_SECRET:-change-me-to-a-random-32-char-string}`, so the container always receives a value and the check never fires when deployed via compose. |
| PRD-03 | Tokens never appear in a URL | ✅ Fixed | Tokens now set as `httpOnly` cookies; OAuth callback redirects to a bare `/login?authenticated=1`. |
| PRD-04 | Logout actually revokes the session | ✅ Fixed | New `RefreshToken` table with `revokedAt`; logout and refresh both check/set it correctly, with rotation on refresh. |
| PRD-05 | Indexed data survives restarts, works across replicas | ❌ Still open | `packages/retrieval` is untouched — chunks still live in a module-level Python dict. |
| PRD-06 | Retrieval is real semantic search, not a placeholder | ❌ Still open | `_LocalDenseEmbedder` (hashed n-grams) is still what `hybrid_search` calls; the real `_openai_dense_search` path is still dead code. |
| PRD-07 | Deployable via the containerization the docs describe | ✅ Structurally fixed, ⚠️ one service broken | Dockerfiles now exist for all 8 services and are wired into `docker-compose.yml` — but the mock-interview container will crash on boot (see TRD N3). |
| PRD-08 | UI clearly flags demo/offline mode | ✅ Fixed | `isDemo` threaded from `generation` service → API → `ChatTab.tsx`, which renders a `DEMO` badge. |
| PRD-09 | Per-job disk/temp resources are cleaned up | ✅ Fixed | `analyzeRepo.ts` now wraps the job in `try/finally` and `rm`s the cloned directory unconditionally. |
| PRD-10 | Critical flows have automated test coverage | ⚠️ Minimal | Only `apps/api` has a test runner (vitest) and exactly 2 trivial tests (health check, 404). Nothing for `apps/web`, `apps/worker`, `apps/websocket`, or any of the 4 Python services. |
| PRD-11 | A committed env file can't reach the repo regardless of name | ✅ Fixed | `.gitignore` now uses `.env*` with a `!.env.example` exception; `apps/web/.env.local` is no longer tracked. |

## 3. Urgent Finding: The App Is Currently Non-Functional

This isn't a new item on the backlog — it blocks everything else and should be read before anything in Section 4.

Fixing PRD-03 (moving tokens out of URLs into `httpOnly` cookies) was done correctly on the OAuth/login side, but two other places that depend on the *old* header-based scheme were never updated to match:

- The REST API's own `requireAuth` middleware still only accepts `Authorization: Bearer <token>` — it never looks at cookies.
- Nothing on the frontend attaches that header anymore (it relies on `credentials: "include"` sending the cookie instead).
- Separately, `apps/web`'s `isAuthenticated()` helper tries to read the `access_token` cookie via `document.cookie` — which is architecturally impossible, since the cookie is (correctly) `httpOnly`.

Net effect: **every single authenticated API call returns 401, and the frontend can never confirm a user is logged in even right after a successful GitHub login.** The WebSocket side, by contrast, was updated correctly (it extracts the token from the cookie header) — so this is an inconsistency between two halves of the same fix, not a design decision.

## 4. Goals for This Phase

- Restore basic functionality first — nothing else in this document matters until an authenticated user can load their dashboard.
- Finish what PRD-05/PRD-06 started: turn the retrieval engine from a single-process demo into the real, persistent, semantically-grounded search the product is supposed to be built on.
- Close the two secret-handling regressions (PRD-02's compose fallback, the mock-interview Dockerfile path) before this is deployed anywhere shared.
- Make CI actually able to fail. A pipeline that always passes is worse than no pipeline, because it looks like a safety net.

## 5. Requirements (Re-Prioritized)

### 5.1 P0 — Restore Basic Functionality (blocks all use of the app)

| ID | Requirement | Why it's P0 |
|---|---|---|
| PRD2-01 | `requireAuth` must accept the session from the `access_token` cookie (matching how it's actually issued), not only a Bearer header. | Without this, no authenticated route in the entire API works — this is a full outage, not a degradation. |
| PRD2-02 | The frontend must be able to correctly determine whether the current user is authenticated. | `isAuthenticated()` currently can't read an `httpOnly` cookie by design; it needs a real signal (e.g. a lightweight `/v1/auth/me` check) instead of inspecting `document.cookie`. |
| PRD2-03 | The mock-interview container must actually start. | `Dockerfile.python`'s SERVICE=mock-interview branch points at a nonexistent module path and will crash immediately in any deployed environment. |

### 5.2 P1 — Close the Reintroduced Secret-Handling Gaps

| ID | Requirement | Why it matters |
|---|---|---|
| PRD2-04 | `docker-compose.yml` must not supply a default value for `JWT_SECRET` (or any other required secret). | A compose-level fallback silently defeats the `requireEnv()` check that PRD-02 already implemented at the code level — the fix only works if nothing upstream masks it. |
| PRD2-05 | Services marked `NODE_ENV: production` in `docker-compose.yml` must not use the literal `dev_password_123` database password. | Labeling a service "production" while hardcoding a known dev credential is a contradiction that will get copy-pasted into a real deployment. |

### 5.3 P1 — Finish the Retrieval Engine (carried over from v1, unchanged priority)

| ID | Requirement | Why it matters |
|---|---|---|
| PRD2-06 | Indexed repository data must persist across restarts and be shared across replicas. | Same as v1 PRD-05 — still fully open, zero progress since the last review. |
| PRD2-07 | Retrieval must use real semantic embeddings, not a hashed n-gram placeholder. | Same as v1 PRD-06 — this is still the product's core value proposition and it's still not real. |

### 5.4 P2 — Make CI Meaningful

| ID | Requirement | Why it matters |
|---|---|---|
| PRD2-08 | CI's lint, test, and Python-test jobs must be able to fail the pipeline. | All three currently end in `\|\| true`, so a broken build, a failing test, or a lint error is silently swallowed — CI exists but protects nothing. |
| PRD2-09 | Test coverage must extend past `apps/api`'s two smoke tests to the other services, especially the retrieval engine once PRD2-06/07 land. | Right now a change to `apps/web`, `apps/worker`, `apps/websocket`, or any Python service has zero automated safety net. |

## 6. Non-Goals for This Phase

(Unchanged from v1.) New user-facing features, billing hardening, multi-language parser coverage, and UI redesign all remain out of scope until the app is functional and the retrieval engine is real.

## 7. Success Metrics for This Phase

- A user can complete GitHub login → land on the dashboard → open a repo, with zero 401s, in a fresh deployment.
- `docker compose up` brings up all 8 services and every one reports healthy — including mock-interview.
- Re-running an analysis after a retrieval-service restart returns the same results, not an empty index.
- A deliberately broken test or lint error fails the corresponding CI job (verify by temporarily breaking one on a branch).

## 8. Risks & Open Questions

- PRD2-01/02 are a small, mechanical fix (align middleware and frontend with the cookie scheme already chosen) — low risk, should ship first and alone, without bundling in retrieval work, so the "app is down" state ends as fast as possible.
- PRD2-06/07 still carry the same open question from v1: pgvector on the existing Postgres vs. wiring up the already-provisioned OpenSearch. This has now gone two review cycles without a decision — it should be made explicitly before the next work cycle starts, not left implicit again.
- Worth asking directly: was the auth regression caught by any manual testing before this round was considered "done"? Given PRD2-09's coverage gap, it's unsurprising it wasn't — this is itself an argument for landing PRD2-01/02 and PRD2-08/09 close together.
