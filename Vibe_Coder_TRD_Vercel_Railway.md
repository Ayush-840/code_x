# Vibe Coder — Technical Requirements Document
## Deployment Track: Vercel (frontend) + Railway (backend)

Repo analyzed: `github.com/Ayush-840/code_x` • commit `b9f9bcd` • September 2026

---

## 1. Current Deployment Artifacts (as found)

| Artifact | Targets | Status |
|---|---|---|
| `vercel.json` | Vercel, `apps/web` build | Correct and sufficient as-is — no changes needed. |
| `render.yaml` | Render — api, websocket, python-all, worker + managed Postgres/Redis | Wrong provider for this task; useful as a reference for *which* env vars each service needs, but hostnames/networking syntax don't transfer to Railway. |
| `docker/Dockerfile.python-all` + `start-python-services.sh` | Combined 4-service Python container, used by `render.yaml` and `.github/workflows/docker.yml` | Correct, reusable for Railway as-is. |
| `docker/Dockerfile.python` | Per-service Python container (build arg `SERVICE`), used by local `docker-compose.yml` | Correct for local dev; not used by any hosted deployment path — this is fine, just needs a comment saying so. |
| `docker/Dockerfile.api-worker` + `start-api-worker.sh` | Combined api+worker container | Built by nothing, deployed by nothing — orphaned. |
| `apps/api/Dockerfile`, `apps/worker/Dockerfile`, `apps/websocket/Dockerfile` | Standalone per-service containers, used by `.github/workflows/docker.yml` and `render.yaml` | Correct, reusable for Railway as-is. |
| `.github/workflows/docker.yml` | Builds+pushes 4 images to `ghcr.io/ayush-840/code_x-*` | Correct, reusable — Railway can deploy directly from these GHCR images. |
| `.github/workflows/ci.yml` | Runs `prisma migrate deploy` against a CI-only test database | Correct for CI; does not touch any real deployment database. |

## 2. Recommended Railway Topology

Four Railway services, using the existing GHCR images built by `docker.yml`:

| Railway Service | Image | Public networking | Internal port(s) |
|---|---|---|---|
| `api` | `ghcr.io/ayush-840/code_x-api:latest` | Yes (public domain) | 4000 |
| `websocket` | `ghcr.io/ayush-840/code_x-websocket:latest` | Yes (public domain) | 4001 |
| `worker` | `ghcr.io/ayush-840/code_x-worker:latest` | No (background only) | — |
| `python` | `ghcr.io/ayush-840/code_x-python:latest` (built from `Dockerfile.python-all`) | No (internal only) | 8100, 8200, 8300, 8400 |
| `postgres` | Railway's Postgres plugin | No | 5432 |
| `redis` | Railway's Redis plugin | No | 6379 |

Railway's private network gives every service in a project a hostname of the form `<service-name>.railway.internal`, reachable from any other service in the same project on any port — public networking (a `*.up.railway.app` domain) only needs to be enabled for `api` and `websocket`, since those are the only two the Vercel frontend talks to directly.

## 3. Fix Specification (P0)

### 3.1 Cross-site cookies (resolves PRD-D01)

`apps/api/src/routes/auth.ts` currently hardcodes `sameSite: "lax"`. Make it environment-driven so local Docker Compose (same-origin via a dev proxy) is unaffected:

```ts
// config.ts
export const config = {
  ...
  cookieSameSite: (process.env.COOKIE_CROSS_SITE === "true" ? "none" : "lax") as "none" | "lax",
};

// auth.ts
const baseOpts = {
  httpOnly: true,
  secure: isProd,               // already true in prod; required when sameSite is "none"
  sameSite: config.cookieSameSite,
  path: "/",
};
```

Set `COOKIE_CROSS_SITE=true` only on the Railway `api` service's environment variables. Apply the same change everywhere `sameSite: "lax"` appears (the `oauth_state` cookie too, for consistency, though it's short-lived and same-site-safe during the OAuth redirect itself).

### 3.2 CORS allowlist (resolves PRD-D02)

Replace the literal-string `origin` in both `apps/api/src/app.ts` and `apps/websocket/src/index.ts` with a function that matches the production domain and Vercel preview subdomains:

```ts
const allowedOrigins = (process.env.FRONTEND_URL ?? "http://localhost:3000").split(",");
const previewPattern = process.env.FRONTEND_PREVIEW_PATTERN
  ? new RegExp(process.env.FRONTEND_PREVIEW_PATTERN)
  : null;

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true); // same-origin / server-to-server
      if (allowedOrigins.includes(origin)) return callback(null, true);
      if (previewPattern && previewPattern.test(origin)) return callback(null, true);
      callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);
```

Set `FRONTEND_URL=https://code-x.vercel.app` (the real production domain) and, if preview-deployment testing is needed, `FRONTEND_PREVIEW_PATTERN=^https://code-x-git-.*-ayush840\.vercel\.app$` (adjust to the actual Vercel project's preview URL pattern). Apply the identical change to `apps/websocket/src/index.ts`'s Socket.IO `cors` block — it takes the same shape of options.

### 3.3 Production migrations (resolves PRD-D03)

Add a Railway **Deploy Command** (or, if unavailable on the plan in use, wrap it into the API's start command) that runs before the API starts serving traffic:

```
pnpm --filter @vibe-coder/database exec prisma migrate deploy
```

If using Railway's "Pre-Deploy Command" feature, point it at this exact command against the `api` service (it needs `DATABASE_URL`, which the service already has). If that feature isn't available, wrap it into the API container's entrypoint instead — modify `apps/api/Dockerfile`'s CMD to run migrations before starting the server:

```dockerfile
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy --schema packages/database/prisma/schema.prisma && node apps/api/dist/index.js"]
```

(Prefer the platform-level pre-deploy command if Railway's plan supports it — it keeps migrations from re-running on every container restart, only on actual deploys.)

## 4. Fix Specification (P1)

### 4.1 Persistent retrieval storage (resolves PRD-D04)

Attach a Railway Volume to the `python` service, mounted at the path `RETRIEVAL_STORAGE_DIR` already reads from:

- Railway dashboard: `python` service → Volumes → mount at `/data/retrieval`.
- Set `RETRIEVAL_STORAGE_DIR=/data/retrieval` in the `python` service's environment variables (the code already respects this env var — `indexing.py`'s `_STORAGE_DIR = Path(os.getenv("RETRIEVAL_STORAGE_DIR", "/tmp/vibecoder-retrieval"))` needs no code change, just the env var and the volume).

### 4.2 Internal service URLs for Railway (resolves PRD-D05)

Set on `api` and `worker`'s Railway environment variables, using Railway's internal DNS convention instead of the Render-style hostnames in `render.yaml`:

```
ANALYSIS_SERVICE_URL=http://python.railway.internal:8100
RETRIEVAL_SERVICE_URL=http://python.railway.internal:8200
GENERATION_SERVICE_URL=http://python.railway.internal:8300
MOCK_INTERVIEW_SERVICE_URL=http://python.railway.internal:8400
```

(Assuming the Python service is named `python` in the Railway project — adjust the hostname prefix to whatever service name is actually used.) No code changes needed; these services already read these URLs from env vars.

### 4.3 Resolve the orphaned Dockerfile (resolves PRD-D06)

Pick one:
- **Keep it and wire it in** — if the goal is to cut Railway's service count from 4 to 3 for cost reasons, add a `build-api-worker` job to `.github/workflows/docker.yml` (mirroring the existing jobs, pointing at `docker/Dockerfile.api-worker`), and deploy a single combined `api-worker` Railway service instead of separate `api` and `worker` services. Note this changes the health-check story: Railway can only health-check the one exposed port (4000, the API's), so a worker crash inside the combined container wouldn't be caught by a simple HTTP health check the way a standalone worker service failing to start would be.
- **Remove it** — if standalone `api` and `worker` services are preferred (simpler failure isolation, the recommendation in Section 2), delete `docker/Dockerfile.api-worker` and `docker/start-api-worker.sh` so the repo doesn't carry a second, unused deployment path.

Either is reasonable; the requirement is just to make an explicit choice rather than leaving both states half-built.

## 5. Environment Variable Reference

### Vercel (`apps/web` project settings)

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_API_URL` | `https://<api-service>.up.railway.app` |
| `NEXT_PUBLIC_WS_URL` | `https://<websocket-service>.up.railway.app` |

(Both are `NEXT_PUBLIC_*`, so they're inlined at build time — set them in Vercel's project settings before triggering a deploy, not just in a local `.env`.)

### Railway — `api` service

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | `4000` |
| `DATABASE_URL` | from Railway Postgres plugin |
| `REDIS_URL` | from Railway Redis plugin |
| `JWT_SECRET` | generated 32+ char secret |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | from the GitHub OAuth App |
| `FRONTEND_URL` | `https://code-x.vercel.app` |
| `FRONTEND_PREVIEW_PATTERN` | regex for Vercel preview URLs (optional) |
| `COOKIE_CROSS_SITE` | `true` |
| `ANALYSIS_SERVICE_URL` / `RETRIEVAL_SERVICE_URL` / `GENERATION_SERVICE_URL` / `MOCK_INTERVIEW_SERVICE_URL` | `http://python.railway.internal:81/82/83/8400` |

### Railway — `websocket` service

Same `FRONTEND_URL`, `FRONTEND_PREVIEW_PATTERN`, `REDIS_URL`, `JWT_SECRET` (must match the `api` service's value), plus `MOCK_INTERVIEW_SERVICE_URL`.

### Railway — `worker` service

Same `DATABASE_URL`, `REDIS_URL`, and the four `*_SERVICE_URL` variables as `api`.

### Railway — `python` service

| Variable | Value |
|---|---|
| `RETRIEVAL_STORAGE_DIR` | `/data/retrieval` (matches the mounted Volume path) |
| `NVIDIA_API_KEYS` / `GEMINI_API_KEYS` / `ANTHROPIC_API_KEY` | provider keys for real embeddings/generation |

## 6. Sequencing

| Step | Work | Depends on |
|---|---|---|
| 1 | PRD-D01 + PRD-D02 (cookie + CORS fixes) | None — ship first, together, since login is broken without both. |
| 2 | PRD-D03 (migration step) | None — independent, but must land before the first real Railway deploy. |
| 3 | Provision Railway services + env vars (Section 5) | Steps 1–2 merged. |
| 4 | PRD-D04 (attach Volume) + PRD-D05 (internal URLs) | Step 3 (services must exist to attach a volume / reference their hostnames). |
| 5 | PRD-D06 (resolve orphaned Dockerfile) | Can happen any time, independent of the rest. |
| 6 | PRD-D07 + PRD-D08 (documentation) | Last — document what was actually decided in steps 1–5, not what was planned. |

## 7. Acceptance Criteria

- From the deployed Vercel URL, GitHub login completes and `GET /v1/auth/me` (via the browser, cookie-authenticated) returns 200 — verified in the browser network tab, not just via a same-origin curl test.
- A brand-new Railway project, deployed from a completely empty Postgres, has the full schema present after the first deploy with no manual `psql` step.
- Triggering a redeploy of the `python` Railway service does not empty a previously indexed repo's search results.
- `api`, `worker`, and `websocket` all successfully reach the `python` service's 4 ports using `*.railway.internal` hostnames, verified via each service's own health/readiness check.
- The repo contains exactly one Python Dockerfile per use case (local vs. hosted), each with a one-line comment stating which deployment path uses it, and `docker/Dockerfile.api-worker` is either wired into CI + Railway or removed.
