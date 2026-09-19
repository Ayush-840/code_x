# code_x

Source-of-truth documentation for the **Vibe Coder** platform — a GitHub-connected AI system that turns any repository into an interview-ready study guide.

## Documentation

| Document | Purpose |
|---|---|
| **[BUILDING.md](BUILDING.md)** | **Complete build instructions for the whole site — frontend + backend, from zero to running.** Monorepo scaffolding, Prisma/PostgreSQL schema, Express REST API, Socket.IO WebSocket server, BullMQ worker, Python AST parser, hybrid retrieval engine (RRF), LLM generation with citations, mock-interview engine, Next.js frontend (all pages + chat + interview UIs), Docker orchestration, env vars, seeding, and testing. |
| `VIBE_CODER_PLATFORM_DESCRIPTION.md` | Product overview, features, architecture summary |
| `VIBE_CODER_TECHNICAL_SPEC.md` | Database schema, TypeScript interfaces, API design, retrieval engine internals |
| `VIBE_CODER_API_SPEC.md` | Every REST + WebSocket contract, envelopes, error codes, rate limits |
| `VIBE_CODER_DEPLOYMENT_GUIDE.md` | Dockerfiles, AWS ECS/Terraform infrastructure, CI/CD, production rollout |
| `VIBE_CODER_QA_TEST_PLAN.md` | Manual test matrix across all feature suites |
| `VIBE_CODER_EVALUATION_FRAMEWORK.md` | How generated answers are measured and graded |
| `VIBE_CODER_ONCALL_RUNBOOK.md` | Incident response procedures |

## Quick start

```
docker compose -f docker/docker-compose.yml up -d
pnpm install && pnpm db:generate && pnpm db:migrate && pnpm db:seed
pnpm dev
```

Follow **[BUILDING.md](BUILDING.md)** for the step-by-step build of every frontend and backend service.