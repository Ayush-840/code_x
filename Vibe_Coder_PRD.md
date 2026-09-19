# Vibe Coder — Product Requirements Document
*Hardening phase: prototype → production-ready MVP*

Repo analyzed: `github.com/Ayush-840/code_x` • September 2026 • v0.1

---

## 1. Purpose of This Document

This PRD does not restate the product vision — that's already covered in `VIBE_CODER_PLATFORM_DESCRIPTION.md` in the repo. This PRD exists because a direct code review of `code_x` found a meaningful gap between what the documentation describes and what is actually implemented and wired up today. This document defines what "done" looks like for closing that gap, in product terms, so the next build phase has a clear, prioritized target instead of open-ended polishing.

## 2. Current State Summary

The repo contains a real, working monorepo scaffold: a Next.js frontend, an Express REST API, a Socket.IO WebSocket server, a BullMQ worker, and four Python FastAPI microservices (analysis, retrieval, generation, mock-interview), backed by a Prisma/PostgreSQL schema. This is not a documentation-only repo — roughly 6,300 lines of real TypeScript/Python exist across these services.

However, several core claims in the existing spec docs are ahead of the actual implementation: the "hybrid dense+sparse retrieval" currently runs on a hashed n-gram pseudo-embedding rather than real semantic vectors, the index lives only in server RAM, there are no Dockerfiles or CI despite a full deployment guide describing them, and the auth flow has a demo-mode code path that behaves like a bypass if misconfigured. None of this is a criticism of the effort — it's a normal state for a fast-built prototype — but it means the product is not yet safe or reliable to put in front of real users.

## 3. Goals for This Phase

- Make the retrieval and generation pipeline actually do what the docs claim: real semantic embeddings, persisted across restarts, genuinely hybrid.
- Close the auth gap so there is no code path that issues a valid session without verifying a real identity.
- Make the app deployable the way `VIBE_CODER_DEPLOYMENT_GUIDE.md` already promises — containerized services, CI, and a repeatable deploy.
- Establish a baseline of automated test coverage so regressions are caught before a user hits them.
- Ship all of this without changing the product's core feature set — this phase is about making the existing MVP scope trustworthy, not adding new features.

## 4. Non-Goals for This Phase

- New user-facing features (multi-repo support, resume-linking, confidence-score detector, etc. — these stay in the Phase-2 backlog from the earlier research report).
- Billing/Stripe integration hardening — out of scope until the core product is trustworthy.
- Multi-language AST parser coverage beyond what `packages/analysis` already targets.
- Any UI redesign — the existing tabs (Architecture, Modules, Questions, Chat, Mock Interview) stay as-is functionally.

## 5. Requirements (Prioritized)

P0 = blocks any real deployment or user trust; P1 = required before public launch; P2 = should follow shortly after launch.

### 5.1 P0 — Trust & Safety Blockers

| ID | Requirement | Why it's P0 |
|---|---|---|
| PRD-01 | There must be no code path that issues a valid access token without verifying a real GitHub identity. | Current `/v1/auth/github` demo fallback is a live auth-bypass risk if GitHub OAuth env vars are ever missing in a deployed environment. |
| PRD-02 | The app must fail to start in any non-local environment if `JWT_SECRET` or the database credentials are not explicitly provided — no hardcoded fallback values. | A committed, guessable fallback secret in a public repo is a compromise waiting to happen the moment it's ever relied upon. |
| PRD-03 | Session tokens must never appear in a URL (query string or redirect target). | Tokens in URLs land in browser history, proxy logs, and Referer headers — an avoidable leak vector. |
| PRD-04 | A user must be able to log out in a way that actually invalidates their refresh token, not just discards it client-side. | Without revocation, a stolen refresh token stays valid for its full 30-day life with no way to cut it off. |

### 5.2 P1 — Core Product Integrity

| ID | Requirement | Why it matters |
|---|---|---|
| PRD-05 | Indexed repository data must survive a service restart and be shared correctly across multiple running instances of the retrieval service. | Today's in-memory store loses all indexed repos on every restart or redeploy, and silently breaks if the service is ever scaled to 2+ instances. |
| PRD-06 | The "code understanding" shown to a user must be based on real semantic retrieval, not a placeholder n-gram signal, whenever the product is presented as functional (demo or real). | This is the product's entire value proposition — a candidate trusting a wrong or shallow explanation in a real interview is the worst possible failure mode for this product. |
| PRD-07 | Every environment (local, staging, prod) must be deployable from the repo using the containerization already described in `VIBE_CODER_DEPLOYMENT_GUIDE.md`. | The guide currently describes infrastructure that does not exist in the repo yet, so nobody can actually follow it today. |
| PRD-08 | The product must clearly indicate to the user when it is running in demo/offline mode versus using a real LLM, wherever this distinction affects answer quality. | Silently returning templated "[demo answer]" text without any UI signal risks a user trusting a fabricated-looking answer during real interview prep. |
| PRD-09 | Disk and other local resources consumed per analysis job (cloned repos, temp files) must be cleaned up after the job finishes or fails. | Uncapped growth will eventually take down the worker in any environment with sustained usage. |

### 5.3 P2 — Confidence & Maintainability

| ID | Requirement | Why it matters |
|---|---|---|
| PRD-10 | Critical user-facing flows (repo connect → analysis → chat answer, mock-interview session) must have automated test coverage that runs on every change. | Zero automated coverage today means every change is a manual re-verification, which won't scale past one contributor. |
| PRD-11 | A committed `.env.local` (or any working env file) must not be able to reach the repository, regardless of its filename. | The current `.gitignore` pattern only excludes the literal name ".env"; the next real secret dropped into a sibling file will get committed. |

## 6. Success Metrics for This Phase

- Zero P0 items open before any deployment outside a contributor's own machine.
- A fresh clone of the repo can go from `git clone` to a running, containerized local stack using only the commands in `VIBE_CODER_DEPLOYMENT_GUIDE.md`, with no manual steps not already documented.
- Re-running the same repo analysis twice (e.g. after a service restart) produces the same study guide, not an empty one.
- CI runs on every pull request and blocks merge on failing tests.

## 7. Risks & Open Questions

- Swapping in real embeddings (OpenAI or a self-hosted model) has a direct cost-per-analysis implication — needs a decision on which embedding provider and a budget/caching strategy before PRD-06 is built.
- Persisting the retrieval index (PRD-05) means picking a real vector store (pgvector on the existing Postgres vs. actually wiring up the OpenSearch instance that's already provisioned but unused) — this is the single biggest architectural decision in this phase and should be resolved first, since PRD-06 depends on it.
- Revocable refresh tokens (PRD-04) require a server-side session/token record, which is a schema change — should be scoped together with PRD-01 and PRD-02 since all three touch the auth path.
