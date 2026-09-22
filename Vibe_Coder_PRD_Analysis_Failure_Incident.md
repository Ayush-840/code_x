# Vibe Coder — Product Requirements Document
## Incident: Analysis Fails for Every Repository

Repo analyzed: `github.com/Ayush-840/code_x` • commit `ed6d2df` • September 2026

---

## 1. Purpose of This Document

Every analysis attempt — anonymous and logged-in, any repo — currently fails with a generic "Analysis failed" message. This PRD covers the immediate fix and, more importantly, why this class of failure was invisible until a real user hit it: nothing in the system today distinguishes "the code has a bug" from "the database schema and the application code have drifted apart." Both currently produce the same unhelpful message.

## 2. Current State (Confirmed)

- The `analysis` and `generation` Python services were tested directly (live requests, not just code review) with the exact payload shapes the worker sends, and both return correct, healthy responses. **The failure is not in these services.**
- The worker's shared analysis job — used by both the anonymous and authenticated flows — unconditionally writes to a `readingOrderIndex` column and a `PublicAnalysis` table added in a recent migration (`20260920185605_add_public_analysis`).
- The leading hypothesis is that this migration was never applied to whatever database the running API/worker are actually pointed at, and/or the Prisma Client wasn't regenerated after the schema change — a classic "works in the repo, not in the running environment" gap.
- The user-facing error for this is currently indistinguishable from any other failure: `"Analysis failed. Check the URL and try again."` — the same message a genuinely invalid repo URL would produce.

## 3. Goals

- Restore working analysis immediately (operational fix, not a code change, if the hypothesis is confirmed).
- Make this specific class of failure — schema/database drift — impossible to ship silently again.
- Give whoever is debugging a failed analysis (you, or a future contributor) enough signal to diagnose it in minutes, not by re-deriving it from source like this investigation did.

## 4. Non-Goals

- A general-purpose error-monitoring/observability platform (Sentry, etc.) — worth considering later, out of scope for this specific fix.
- Automatic migration rollback or self-healing — the goal here is fast, clear failure, not automatic recovery.

## 5. Requirements

### 5.1 P0 — Immediate Fix (operational, not code)

| ID | Requirement | Why it's P0 |
|---|---|---|
| PRD-I01 | The actual running database (wherever the failing environment points) must have every migration in `packages/database/prisma/migrations` applied. | This is very likely the entire fix — nothing works until this is true. |
| PRD-I02 | The Prisma Client used by the running API and worker must be regenerated against the current schema. | A stale generated client can silently not know about new fields/models even after the migration is applied to the database. |

### 5.2 P0 — Fail Loudly, Not Per-Job

| ID | Requirement | Why it's P0 |
|---|---|---|
| PRD-I03 | If the database schema and the application's expected schema are out of sync, the API and worker must refuse to accept new work at startup, with a clear log message — not accept every request and fail each one individually with a generic error. | The current failure mode burns a job, a worker cycle, and a confusing user-facing error for every single attempt, when the actual problem is a one-time environment issue that a boot-time check could catch instantly. |

### 5.3 P1 — Better Diagnosis Next Time

| ID | Requirement | Why it matters |
|---|---|---|
| PRD-I04 | User-facing analysis failure messages must distinguish at least: invalid/not-found repo, GitHub rate limit, and internal system error. | "Check the URL and try again" is actively misleading when the URL was never the problem — it sends the user (and whoever they ask for help) down the wrong path. |
| PRD-I05 | The worker's internal error log for a failed job should be easy to correlate with the job/analysis ID shown in the UI. | Confirmed already partially true (`[worker] Analysis failed for job <id>:` includes the ID) — worth explicitly preserving as changes continue to land in this file. |

## 6. Success Metrics

- A fresh analysis attempt against a known-good public repo succeeds end to end.
- Deliberately reverting a migration in a test environment causes the API/worker to refuse to start (or to refuse new jobs) with an explicit error, rather than accepting requests that will fail downstream.
- A non-existent repo URL produces a visibly different error message than a system-level failure.

## 7. Risks & Open Questions

- If applying the pending migration doesn't fix the issue, the next most likely area is environment configuration (a service URL pointing at the wrong host, Redis unreachable) — worth checking in that order rather than assuming the migration hypothesis is certainly correct without confirming via the worker's own error log first.
- PRD-I03 (boot-time schema check) needs to be careful not to become its own false-positive source — it should check for pending migrations specifically (`prisma migrate status`), not attempt a broader, fuzzier "does the schema look right" heuristic.
