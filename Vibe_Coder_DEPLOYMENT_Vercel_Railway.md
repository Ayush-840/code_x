# Vibe Coder — Deployment Guide: Vercel (frontend) + Railway (backend)

Single source of truth for deploying Vibe Coder to Vercel (frontend) and Railway
(api, websocket, combined Python services, Postgres, Redis). Implements
`Vibe_Coder_PRD_Vercel_Railway.md` and `Vibe_Coder_TRD_Vercel_Railway.md`.

## Decisions recorded (PRD-D06, PRD-D08)

| Choice | Decision |
|---|---|
| api + worker topology | **Combined** into one service via `docker/Dockerfile.api-worker` (3 backend services instead of 4, lower Railway cost). Trade-off accepted: a worker crash inside the container is not caught by the HTTP health check. |
| Dockerfile: `apps/api/Dockerfile` | Standalone API image. Built by CI (GHCR); alternate to the combined image. |
| Dockerfile: `docker/Dockerfile.api-worker` | **Chosen hosted topology.** Combined api+worker image, CI job `build-api-worker` → `ghcr.io/ayush-840/code_x-api-worker`. |
| Dockerfile: `apps/websocket/Dockerfile` | Standalone websocket image, deployed as its own Railway service. |
| Dockerfile: `docker/Dockerfile.python-all` | **Chosen hosted topology.** All 4 Python services in one container, CI job `build-python` → `ghcr.io/ayush-840/code_x-python`. |
| Dockerfile: `docker/Dockerfile.python` | **Local dev only** (docker-compose), selected via the `SERVICE` build arg. Never deployed. |
| Migrations | Run via Railway `preDeployCommand` (`railway/api-worker.json`), so they run on deploys, not container restarts. |
| Railway deploy source | Services build from this repo on Railway (auto-deploy on `git push`). GHCR images from `.github/workflows/docker.yml` remain the artifact record. |
| `vercel.json` | **Removed.** With the Vercel Root Directory set, its `outputDirectory: apps/web/.next` resolved relative to `apps/web` and broke git deploys (`.../apps/web/apps/web/.next not found`). Vercel auto-detects Next.js — no config file needed. |
| `@vibe-coder/shared` build | Emits to `dist/` (`main`/`types` point there). `apps/web/package.json` runs a `prebuild` hook that compiles it before `next build`; the api/worker/websocket Dockerfiles build it explicitly before consuming apps. |

## Topology

```
Vercel (apps/web, Next.js)  ──HTTPS──▶  Railway public domains
   *.vercel.app                          ├── api-worker  (public, :4000, health /health)
                                         ├── websocket   (public, :4001, health /health)
                                         └── python      (internal only, 8100/8200/8300/8400)
Railway private network (*.railway.internal) + plugins:
    postgres :5432   redis :6379   volume → python:/data/retrieval
```

Service → service URLs use Railway private DNS: `http://python.railway.internal:<port>`.

## Environment variables — Vercel (`apps/web` project settings)

Set these **before** the first build (both are `NEXT_PUBLIC_*`, inlined at build time).

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_API_URL` | `https://<api-worker-service>.up.railway.app` |
| `NEXT_PUBLIC_WS_URL` | `https://<websocket-service>.up.railway.app` |

## Vercel project settings — required for git deploys

The pnpm monorepo needs **Root Directory = `apps/web`** on the Vercel project
(dashboard → Settings → Build & Deployment → Root Directory; there is no CLI
flag). Without it, git-integration builds run at the repo root, `next` is not
resolvable there, and the deploy fails with "No Next.js version detected".

| Setting | Value |
|---|---|
| Root Directory | `apps/web` |
| Framework Preset | Next.js (auto-detected) |
| Build / Install / Output commands | leave empty |

Do **not** add a root `vercel.json` (see decisions table). With the Root
Directory set, pnpm walks up to the workspace root, so the `prebuild` hook in
`apps/web/package.json` still compiles `@vibe-coder/shared` first.

## Environment variables — Railway `api-worker` service

| Variable | Value |
|---|---|
| `RAILWAY_CONFIG_FILE` | `railway/api-worker.json` (picks up Dockerfile, preDeploy migrations, healthcheck) |
| `NODE_ENV` | `production` |
| `PORT` | `4000` |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (reference to the Postgres plugin) |
| `REDIS_URL` | `${{Redis.REDIS_URL}}` |
| `JWT_SECRET` | 32+ random chars — must match the websocket service |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | From the GitHub OAuth App |
| `FRONTEND_URL` | Vercel production URL, e.g. `https://code-x.vercel.app` (comma-separate extra origins) |
| `FRONTEND_PREVIEW_PATTERN` | Optional regex for Vercel preview URLs, e.g. `^https://code-x-git-.*-ayush840\.vercel\.app$` |
| `API_URL` | **Public** URL of this service, e.g. `https://<api-worker>.up.railway.app` — used as the GitHub OAuth `redirect_uri`; must match the OAuth App callback exactly |
| `COOKIE_CROSS_SITE` | `true` (session cookies become `SameSite=None; Secure` so cross-site requests from Vercel carry them) |
| `ANALYSIS_SERVICE_URL` | `http://python.railway.internal:8100` |
| `RETRIEVAL_SERVICE_URL` | `http://python.railway.internal:8200` |
| `GENERATION_SERVICE_URL` | `http://python.railway.internal:8300` |
| `MOCK_INTERVIEW_SERVICE_URL` | `http://python.railway.internal:8400` |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Optional; billing disabled when unset |

## Environment variables — Railway `websocket` service

| Variable | Value |
|---|---|
| `RAILWAY_CONFIG_FILE` | `railway/websocket.json` |
| `PORT` | `4001` |
| `REDIS_URL` | `${{Redis.REDIS_URL}}` (Socket.IO redis adapter) |
| `JWT_SECRET` | **Same value as api-worker** (token verification) |
| `FRONTEND_URL` / `FRONTEND_PREVIEW_PATTERN` | Same as api-worker |
| `GENERATION_SERVICE_URL` | `http://python.railway.internal:8300` (chat handler) |
| `MOCK_INTERVIEW_SERVICE_URL` | `http://python.railway.internal:8400` |

## Environment variables — Railway `python` service

| Variable | Value |
|---|---|
| `RAILWAY_CONFIG_FILE` | `railway/python.json` |
| `RETRIEVAL_STORAGE_DIR` | `/data/retrieval` (already the image default; must match the attached Volume mount path) |
| `NVIDIA_API_KEYS` / `GEMINI_API_KEYS` / `ANTHROPIC_API_KEY` | Provider keys for embeddings/generation |

Volume: attach to `python`, mount path `/data/retrieval` (PRD-D04 — indexes survive redeploys).

## Deploy runbook (CLI)

```bash
railway login
railway init --name code-x                      # creates the project
railway add --plugin postgresql                 # → service "Postgres"
railway add --plugin redis                      # → service "Redis"

# Create the 3 app services, set RAILWAY_CONFIG_FILE + vars per service, then:
railway up --service api-worker
railway up --service websocket
railway up --service python

railway domain --service api-worker             # public *.up.railway.app
railway domain --service websocket
railway volume add --service python --mount-path /data/retrieval
```

Vercel:

```bash
vercel login
vercel link --project code_x --yes   # project name on Vercel is `code_x`
# Dashboard → code_x → Settings → Build & Deployment → Root Directory = apps/web
# (required; git deploys fail without it in this monorepo)
echo "https://<api-worker>.up.railway.app" | vercel env add NEXT_PUBLIC_API_URL production
echo "https://<websocket>.up.railway.app" | vercel env add NEXT_PUBLIC_WS_URL production
vercel --prod                        # fallback; pushes to main auto-deploy
```

## Redeploying after a code change

`git push` → Railway (repo-connected services) rebuilds changed services automatically.
Vercel (`code_x`) is repo-connected: pushes to `main` auto-deploy. Fallback: `vercel --prod`.

## One manual step outside this repo

The GitHub OAuth App callback URL must be set to
`https://<api-worker-service>.up.railway.app/v1/auth/github/callback`
(github.com → Settings → Developer settings → OAuth Apps).

## Verification checklist (TRD §7 acceptance criteria)

- [ ] `GET https://<api-worker>.up.railway.app/health` → 200; same for websocket `/health`
- [ ] Vercel project Root Directory = `apps/web`; latest git deploy is ● Ready and `/` returns 200
- [ ] GitHub login from the Vercel URL lands on the dashboard; `GET /v1/auth/me` returns 200 with cookies (browser network tab)
- [ ] Fresh empty Postgres: full schema exists after first deploy (preDeployCommand ran) — no manual `psql`
- [ ] Redeploy `python` → previously indexed repo search results still return hits (volume persisted)
- [ ] api-worker / websocket reach `python.railway.internal` on 8100–8400 (health/readiness in logs)
- [ ] Zero CORS errors in the browser console (production + preview origins)
