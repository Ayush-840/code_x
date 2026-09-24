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
| `Vibe_Coder_DEPLOYMENT_Vercel_Railway.md` | Vercel + Railway deployment: topology, per-service env vars, deploy runbook |
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

## Deployment env-var checklist

`NEXT_PUBLIC_*` variables are **inlined at build time** — setting them without triggering a new deploy changes nothing. Full details: [Vibe_Coder_DEPLOYMENT_Vercel_Railway.md](Vibe_Coder_DEPLOYMENT_Vercel_Railway.md).

### Vercel (frontend, `apps/web` project)

- [ ] `NEXT_PUBLIC_API_URL` = `https://<api-worker-service>.up.railway.app`
- [ ] `NEXT_PUBLIC_WS_URL` = `https://<websocket-service>.up.railway.app`
- [ ] Project **Root Directory** = `apps/web` (Settings → Build & Deployment — git deploys fail without it in this monorepo)
- [ ] Redeploy after setting/updating either `NEXT_PUBLIC_*` var (Deployments → Redeploy, or push any commit)

> A production build with `NEXT_PUBLIC_API_URL`/`NEXT_PUBLIC_WS_URL` unset now **fails the build** with an explicit error (guarded in `apps/web/src/lib/publicApi.ts` and `apps/web/src/lib/socket.ts`) instead of silently shipping `localhost` to every visitor.

### Railway — `api-worker` service

- [ ] `FRONTEND_URL` = exact Vercel production URL (e.g. `https://code-x.vercel.app`) — `https://`, no trailing slash; CORS does an exact match
- [ ] `FRONTEND_PREVIEW_PATTERN` = optional regex for Vercel preview URLs
- [ ] `API_URL` = this service's **public** URL — must match the GitHub OAuth App callback exactly
- [ ] `COOKIE_CROSS_SITE` = `true` (required for cross-site cookies from Vercel)
- [ ] `JWT_SECRET` = 32+ random chars, identical to the `websocket` service

### Railway — `websocket` service

- [ ] `FRONTEND_URL` / `FRONTEND_PREVIEW_PATTERN` — same values as `api-worker`
- [ ] `JWT_SECRET` — same value as `api-worker`

### Outside the dashboards

- [ ] GitHub OAuth App callback URL = `https://<api-worker-service>.up.railway.app/v1/auth/github/callback`

### Post-deploy verification

- [ ] `GET https://<api-worker>.up.railway.app/health` → 200 (same for websocket `/health`)
- [ ] Analyze on the deployed site reaches the real Railway domain — DevTools Network tab shows the request, **not** `localhost`
- [ ] Live analysis progress updates arrive over `wss://` (successful WebSocket upgrade in DevTools)
- [ ] Zero CORS errors in the browser console (production + preview origins)
- [ ] Full checklist: [Vibe_Coder_DEPLOYMENT_Vercel_Railway.md](Vibe_Coder_DEPLOYMENT_Vercel_Railway.md) § Verification checklist