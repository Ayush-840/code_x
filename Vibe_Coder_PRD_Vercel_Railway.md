# Vibe Coder — Product Requirements Document
## Deployment Track: Vercel (frontend) + Railway (backend)

Repo analyzed: `github.com/Ayush-840/code_x` • commit `b9f9bcd` • September 2026

---

## 1. Purpose of This Document

The repo already has working local Docker Compose deployment and a Render-targeted `render.yaml` + `vercel.json`. This PRD does not repeat that work — it defines what's needed to actually run this on **Vercel for the frontend and Railway for everything else**, which is a different topology than what's currently configured (Render, not Railway) and introduces problems that never show up in local dev, where frontend and backend share a domain.

## 2. Current State

The application is functional in local Docker Compose (auth works end-to-end, Python services build correctly via Poetry, CI runs real tests and migrations). A `render.yaml` exists describing a 4-service Render deployment (api, websocket, python-all, worker) plus managed Postgres/Redis, and a minimal `vercel.json` exists for the frontend build. Neither of these was written with Railway in mind, and neither addresses the specific failure modes that only appear once frontend and backend are on two different public domains.

## 3. Target Topology

- **Vercel** — `apps/web` (Next.js), built via the existing `vercel.json`.
- **Railway** — `apps/api`, `apps/worker`, `apps/websocket`, the combined Python service (`docker/Dockerfile.python-all`), a Railway Postgres plugin, and a Railway Redis plugin.
- Vercel and Railway assign their own public domains (`*.vercel.app`, `*.up.railway.app`, or custom domains later) — this is a genuinely cross-origin deployment, and every requirement below follows from that one fact.

## 4. Goals for This Phase

- A user can complete GitHub login on the Vercel-hosted frontend and stay authenticated against the Railway-hosted API — the core thing that's silently broken by default in this topology.
- A fresh Railway Postgres instance ends up with the correct schema without a manual `psql` session.
- Repository indexes survive a Railway redeploy, not just an in-process restart.
- The deployment is documented well enough that redeploying after a code change is a `git push`, not a manual multi-step runbook.

## 5. Non-Goals for This Phase

- Migrating away from Railway/Vercel to any other host.
- Custom domains / DNS setup (the plan below works on default `*.vercel.app` / `*.up.railway.app` domains; custom domains are a nice-to-have follow-up, not a blocker).
- Any product feature work — this is purely a deployment-hardening pass.

## 6. Requirements

### 6.1 P0 — Without These, Login Doesn't Work At All

| ID | Requirement | Why it's P0 |
|---|---|---|
| PRD-D01 | Session cookies must be sent and accepted on cross-site requests between the Vercel frontend and the Railway API. | `sameSite: "lax"` cookies are not attached to cross-site `fetch` calls; as configured today, no authenticated request from the deployed frontend will ever carry a session cookie. |
| PRD-D02 | The API and WebSocket server must accept requests from the actual Vercel origin(s) in use, including preview deployments, not just a hardcoded literal string. | The `cors` package matches `origin` as an exact string; `"https://*.vercel.app"` (the value already in `render.yaml`) will never match a real request origin, so CORS will reject every request regardless of the cookie fix above. |
| PRD-D03 | The production database schema must exist before the API's first real request, on a freshly provisioned Railway Postgres instance. | Nothing outside CI currently runs `prisma migrate deploy`; a fresh database has no tables and every query fails. |

### 6.2 P1 — Required Before This Is a Reliable Deployment

| ID | Requirement | Why it matters |
|---|---|---|
| PRD-D04 | Indexed repository data must survive a Railway redeploy of the retrieval service, not just a process restart. | The retrieval service's storage path defaults to `/tmp`, which Railway does not persist across deploys without an explicitly attached Volume. |
| PRD-D05 | The API, worker, and websocket services must reach the combined Python service's 4 ports using Railway's actual internal networking convention. | The existing `render.yaml` uses Render-style plain hostnames (`http://vibecoder-python:8100`); Railway's private network uses a different convention (`<service>.railway.internal:<port>`) and these env vars need to be written for Railway specifically, not copied from the Render config. |
| PRD-D06 | There must be exactly one canonical set of Dockerfiles used for the Railway deployment, with no unused or ambiguous alternates left in the repo. | `docker/Dockerfile.api-worker` is currently built by nothing and referenced by no deployment config — anyone reading the repo can't tell if it's meant to be used or is dead code. |

### 6.3 P2 — Documentation & Operability

| ID | Requirement | Why it matters |
|---|---|---|
| PRD-D07 | The exact list of environment variables required per Railway service, and per Vercel project setting, must be written down in one place. | Right now this knowledge only exists implicitly across `render.yaml`, `docker-compose.yml`, and various `config.ts`/`main.py` files — someone setting this up on Railway for the first time has to reverse-engineer it. |
| PRD-D08 | It must be possible to tell, from the repo alone, which Dockerfile/config is the source of truth for local dev vs. the hosted deployment. | Two different Python Dockerfiles (`Dockerfile.python`, per-service; `Dockerfile.python-all`, combined) already exist for different environments — this is fine, but needs a one-line comment or doc pointer so it doesn't read as inconsistency. |

## 7. Success Metrics for This Phase

- A user visiting the Vercel URL can log in via GitHub and land on an authenticated dashboard, with zero CORS or 401 errors in the browser console.
- Deploying a fresh Railway project from this repo (empty Postgres, empty Redis) results in a working app with no manual database setup step.
- Redeploying the retrieval service (a normal `git push` to Railway) does not empty out previously indexed repos.
- A new contributor can read one document and know exactly which env vars to set in Vercel vs. each Railway service, without reading source code.

## 8. Risks & Open Questions

- Running 4 separate Railway services (api, worker, websocket, python-all) plus Postgres and Redis plugins has a real monthly cost implication on Railway's usage-based pricing — worth deciding up front whether `Dockerfile.api-worker` (combining api+worker into one service) should actually be adopted to cut this to 3 services, rather than left as an orphaned, half-finished idea.
- `sameSite: "none"` cookies require `Secure` (HTTPS) on both ends, which both Vercel and Railway provide by default — but this should be toggled by environment (keep `lax` for local Docker Compose, where frontend and API already share an origin via the dev proxy) rather than hardcoded globally, so local dev doesn't regress.
- Preview deployments on Vercel get a new subdomain per branch/PR — the CORS allowlist needs to handle this pattern (e.g. `*.vercel.app` matched properly via a regex, or restricting previews to a fixed pattern like `code-x-git-*-ayush840.vercel.app`) rather than only whitelisting the production domain.
