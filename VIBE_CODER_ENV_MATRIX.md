# Production Environment Matrix — Vercel + Railway

The single source of truth for every env var in the deployed topology. When
sign-in, CORS, or live updates break after a deploy, start here — then run the
verification commands at the bottom (they take ~30 seconds and pinpoint the
broken variable).

Topology: **Vercel** hosts the Next.js frontend (`apps/web`). **Railway** hosts
`api-worker` (Express API + BullMQ worker), `websocket` (Socket.IO), and
`python` (analysis/retrieval/generation/mock-interview/codegraph), plus managed
Postgres and Redis.

---

## 1. The four variables that break production when wrong

These caused every production incident so far. Get them right first.

| Variable | Service(s) | Value | Breaks what if wrong |
|---|---|---|---|
| `FRONTEND_URL` | `api-worker`, `websocket` | **Every** visitor-facing Vercel domain, comma-separated, exact (`https://`, no trailing slash). Live: `https://codex-ayush-840s-projects.vercel.app,https://codex-tau-rust.vercel.app` | CORS silently blocks any unlisted origin — "Could not reach the API" in the browser |
| `FRONTEND_PREVIEW_PATTERN` | `api-worker`, `websocket` | Regex matching Vercel preview URLs **and** per-deploy production URLs. Live: `^https://(code\|codex)-.*-ayush-840s-projects\.vercel\.app$` | Opening the app via a `code-<hash>-…vercel.app` deployment URL gets silently CORS-blocked |
| `COOKIE_CROSS_SITE` | `api-worker` | `true` | Auth cookies come back `SameSite=Lax`; the browser drops them after the GitHub redirect → "signed in then immediately signed out" |
| `NEXT_PUBLIC_API_URL` / `NEXT_PUBLIC_WS_URL` | **Vercel project** (build-time!) | `https://<api-worker>.up.railway.app` / `https://<websocket>.up.railway.app` | Inlined into the JS bundle at **build** time — setting them without redeploying changes nothing. Unset, the build now fails loudly (guarded) instead of shipping `localhost` |

## 2. Railway — `api-worker`

| Variable | Value / rule |
|---|---|
| `DATABASE_URL` | From Railway Postgres plugin (reference `${{Postgres.DATABASE_URL}}`) |
| `REDIS_URL` | From Railway Redis plugin |
| `JWT_SECRET` | 32+ random chars — **must equal** the `websocket` service's value (refresh/WebSocket auth breaks otherwise) |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | From the **production** GitHub App (§4) |
| `GITHUB_WEBHOOK_SECRET` | Optional — push-triggered re-analysis |
| `FRONTEND_URL` | See §1 |
| `FRONTEND_PREVIEW_PATTERN` | See §1 |
| `API_URL` | This service's **public** URL (`https://api-worker-production-a6ab.up.railway.app`). Sent as the GitHub OAuth `redirect_uri`; must match the GitHub App callback byte-for-byte |
| `GITHUB_REDIRECT_URI` | Optional pin overriding the `API_URL` derivation — only when the registered callback genuinely differs (e.g. stale Railway domain) |
| `COOKIE_CROSS_SITE` | `true` (see §1) |
| `NODE_ENV` | `production` |
| `PORT` | Railway default (`$PORT`) |
| `ANALYSIS_SERVICE_URL` … `CODEGRAPH_SERVICE_URL` | Internal Python endpoints (Railway private networking) |
| `NVIDIA_API_KEYS`, `OPENROUTER_API_KEY` | Optional LLM keys (demo mode when empty) |

## 3. Railway — `websocket`

| Variable | Value / rule |
|---|---|
| `JWT_SECRET` | **Identical** to `api-worker` |
| `FRONTEND_URL` / `FRONTEND_PREVIEW_PATTERN` | **Identical** to `api-worker` — the socket connection does its own CORS check |
| `REDIS_URL` | Same Redis instance (Socket.IO adapter + queues) |
| `MOCK_INTERVIEW_SERVICE_URL`, `GENERATION_SERVICE_URL` | Internal Python endpoints |
| `NODE_ENV`, `PORT` | `production`, `$PORT` |

## 4. Outside the dashboards — GitHub App + Vercel build

| Setting | Where | Value |
|---|---|---|
| GitHub App callback URL(s) | github.com → Settings → Developer settings → GitHub Apps | `https://<api-worker>.up.railway.app/v1/auth/github/callback`. **Add** `http://localhost:4000/v1/auth/github/callback` as a second callback for dev (GitHub Apps allow multiple; classic OAuth Apps don't). Never repoint the production callback at localhost. |
| `NEXT_PUBLIC_API_URL` | Vercel project env | `https://<api-worker>.up.railway.app` — then **redeploy** |
| `NEXT_PUBLIC_WS_URL` | Vercel project env | `https://<websocket>.up.railway.app` — then **redeploy** |
| Root Directory | Vercel Settings → Build & Deployment | `apps/web` — git deploys fail without it in this monorepo |

> **Stale Railway domain trap:** the GitHub App callback is saved by hand and
> never follows a Railway domain change. When `api-worker`'s public domain is
> regenerated, update the callback (or set `GITHUB_REDIRECT_URI`) or every
> sign-in fails with *"The redirect_uri is not associated with this
> application"*. Detail: README.md "Stale Railway domain trap" + BUILDING.md §C2.1.

## 5. Verification commands (run after every deploy)

```bash
# A. OAuth redirect_uri vs registered callback (5 checks)
pnpm check:oauth https://<api-worker>.up.railway.app \
  --callback "<callback copied from the GitHub App settings>"

# B. CORS + cookie flags (origins, credentials, disallowed-origin rejection,
#    SameSite/Secure flags). Pass every visitor-facing origin:
pnpm check:prod https://<api-worker>.up.railway.app \
  --origin https://<live-vercel-domain>.vercel.app \
  --origin https://code-<hash>-<team>.vercel.app \
  --ws https://<websocket>.up.railway.app
```

Both exit `0` only when everything passes — wire them into the post-deploy
checklist (or CI) so drift is caught before users hit it.

Manual fallbacks when the scripts are unavailable:

```bash
# CORS preflight (expect access-control-allow-origin echoing your origin)
curl -s -o /dev/null -D - -X OPTIONS https://<api>.railway.app/v1/repos \
  -H "Origin: https://<your-vercel-domain>" \
  -H "Access-Control-Request-Method: GET" | grep -i access-control

# Cookie flags (expect SameSite=None on a deployed API)
curl -s -o /dev/null -D - https://<api>.railway.app/v1/auth/github \
  | grep -i set-cookie

# WebSocket upgrade (expect 101 in DevTools, not CORS errors)
```

## 6. Post-deploy checklist

- [ ] `GET https://<api-worker>.railway.app/health` → 200 (same for websocket)
- [ ] `pnpm check:oauth` — all checks pass
- [ ] `pnpm check:prod` — all checks pass (with the real Vercel origins)
- [ ] Full sign-in flow works on the **live Vercel domain** (not just the API)
- [ ] Analysis progress updates arrive over `wss://` (DevTools shows the upgrade)
- [ ] Zero CORS errors in the browser console (production + preview origins)

## 7. Reference-only configs

- `render.yaml` — Render topology, **not** the active target. Kept as an
  env-var reference (see its header comment). Values are placeholders.
- `docker/docker-compose.yml` — local dev topology; intentionally uses
  `localhost` origins and `SameSite=Lax` cookies. `NEXT_PUBLIC_*` there must be
  browser-reachable (`localhost`), never internal Docker hostnames.
