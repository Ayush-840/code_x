# Vibe Coder — Technical Requirements Document
## Anonymous Repo Analysis + Deployment Understanding

Repo analyzed: `github.com/Ayush-840/code_x` • commit `d469830` • September 2026

---

## 1. Current Constraints (from code)

- `apps/api/src/app.ts`: `app.use("/v1/repos", requireAuth, repoRoutes)` — every repo route is behind auth, no exceptions.
- `apps/api/src/routes/repos.ts`: `POST /connect` requires `accessToken` in the body; `POST /:repoId/analyze` also requires `accessToken`; both look up/create rows scoped to `req.userId`.
- `packages/database/prisma/schema.prisma`: `Repository.userId` is `String @db.Uuid` (non-null), with `@@unique([userId, fullName])`.
- `apps/worker/src/jobs/analyzeRepo.ts`: `AnalyzeRepoData.accessToken: string` (required); the clone always uses `https://x-access-token:${accessToken}@github.com/${fullName}.git`.
- `apps/api/src/middleware/rateLimit.ts`: a working `planRateLimit(planKey)` factory exists, built on `express-rate-limit`, keyed by `req.ip`, with a `PLAN_LIMITS` map — but it's not imported or applied anywhere in `app.ts` or any route file.
- `packages/database/prisma/schema.prisma`: `Artifact.artifactType` is a plain `String`, `content` is `Json` — no enum constraint, so a new artifact type needs no migration.

## 2. Data Model Changes

### 2.1 New `PublicAnalysis` model (resolves the anonymous-ownership gap)

Rather than making `Repository.userId` nullable (which would complicate the existing `@@unique([userId, fullName])` constraint and every query that assumes an owner), add a separate, deliberately lightweight model for anonymous runs:

```prisma
model PublicAnalysis {
  id             String    @id @default(uuid()) @db.Uuid
  fullName       String
  defaultBranch  String    @default("main")
  status         RepoStatus @default(PENDING)
  stage          String?
  progress       Int       @default(0)
  totalFiles     Int       @default(0)
  totalLines     Int       @default(0)
  requestIp      String
  claimedByUserId String?  @db.Uuid
  claimedBy      User?     @relation(fields: [claimedByUserId], references: [id])
  createdAt      DateTime  @default(now())
  expiresAt      DateTime
  modules        CodeModule[]
  artifacts      Artifact[]

  @@index([fullName])
  @@index([expiresAt])
}
```

`CodeModule` and `Artifact` need an optional `publicAnalysisId` alongside their existing `repoId`, so the same generation pipeline can write to either table depending on which kind of job it's processing. `expiresAt` (e.g. `createdAt + 30 days`) supports a scheduled cleanup job — anonymous data shouldn't accumulate indefinitely with no owner attached.

### 2.2 `claimedByUserId` (resolves PRD-A06)

When a signed-out visitor who just got a `PublicAnalysis` result subsequently logs in, a new endpoint (`POST /v1/public/analyze/:id/claim`, behind `requireAuth`) copies the `PublicAnalysis` row's `fullName`/`defaultBranch`/modules/artifacts into a real `Repository` owned by `req.userId`, and sets `claimedByUserId` for audit purposes. This is a straightforward copy operation, not a live migration — simpler to reason about and roll back if something goes wrong.

## 3. API Changes

### 3.1 `POST /v1/public/analyze` (resolves PRD-A01, PRD-A03)

New route, mounted **outside** `requireAuth`:

```ts
// apps/api/src/routes/publicAnalyze.ts
router.post("/analyze", publicAnalyzeRateLimit, async (req, res, next) => {
  try {
    const { repoUrl } = req.body as { repoUrl?: string };
    if (!repoUrl) throw new HttpError(400, "VALIDATION_ERROR", "repoUrl is required");
    const { owner, repo } = parseRepoUrl(repoUrl); // reuse existing parser from repos.ts

    // Unauthenticated GitHub lookup — confirms the repo exists and is public
    const octokit = new Octokit(); // no auth token
    let gh;
    try {
      gh = await octokit.rest.repos.get({ owner, repo });
    } catch (ghErr: any) {
      const status = ghErr?.status ?? ghErr?.response?.status;
      if (status === 404) {
        throw new HttpError(404, "REPO_NOT_FOUND_OR_PRIVATE",
          "Repository not found, or it's private — private repos require signing in.");
      }
      if (status === 403) {
        throw new HttpError(429, "GITHUB_RATE_LIMITED",
          "GitHub's public API rate limit was hit — try again in a few minutes.");
      }
      throw new HttpError(502, "GITHUB_API_ERROR", ghErr?.message ?? "unknown");
    }
    if (gh.data.private) {
      throw new HttpError(403, "PRIVATE_REPO", "This repository is private — sign in to analyze it.");
    }
    if (gh.data.size > MAX_ANONYMOUS_REPO_KB) {
      throw new HttpError(413, "REPO_TOO_LARGE", "This repo exceeds the size limit for anonymous analysis — sign in for higher limits.");
    }

    const analysis = await prisma.publicAnalysis.create({
      data: {
        fullName: `${owner}/${repo}`,
        defaultBranch: gh.data.default_branch,
        requestIp: req.ip ?? "unknown",
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });

    await analysisQueue.add("analyze-public-repo", {
      publicAnalysisId: analysis.id,
      fullName: analysis.fullName,
      defaultBranch: analysis.defaultBranch,
      // no accessToken — see worker change below
    });

    ok(res, { analysisId: analysis.id, status: "QUEUED" }, 202);
  } catch (err) {
    next(err);
  }
});

router.get("/analyze/:id", async (req, res, next) => { /* status + results, same shape as the authed status/detail routes */ });
```

Mount in `app.ts` before the `requireAuth`-gated block:

```ts
app.use("/v1/public", publicAnalyzeRoutes); // no requireAuth
```

### 3.2 Rate limiting (resolves PRD-A02)

Extend the existing (currently unused) `rateLimit.ts` rather than writing a new mechanism:

```ts
// middleware/rateLimit.ts
export function anonymousRateLimit() {
  return rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 5,                    // tune based on real usage once launched
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.ip ?? "unknown",
    message: { error: "RATE_LIMITED", message: "Too many anonymous analyses from this IP — try again later or sign in." },
  });
}
```

Apply it as `publicAnalyzeRateLimit` in the route above. Separately, wire the existing `planRateLimit` into the authenticated repo routes too while touching this file — it's already written and tested-looking, just never applied; leaving it unused is its own small piece of debt worth closing in the same PR.

## 4. Worker Changes (resolves the token-required clone path)

### 4.1 `apps/worker/src/jobs/analyzeRepo.ts`

Make `accessToken` optional, and branch the clone URL accordingly:

```ts
interface AnalyzeRepoData {
  repoId?: string;            // set for authenticated jobs
  publicAnalysisId?: string;  // set for anonymous jobs
  jobId: string;
  accessToken?: string;       // absent for public, anonymous analyses
  fullName: string;
  defaultBranch: string;
}

const cloneUrl = data.accessToken
  ? `https://x-access-token:${data.accessToken}@github.com/${fullName}.git`
  : `https://github.com/${fullName}.git`;

console.log(`[worker] Cloning ${fullName} to ${dir}` +
  (data.accessToken ? ` (token: ${maskToken(data.accessToken)})` : " (anonymous, unauthenticated)"));

await simpleGit().clone(cloneUrl, dir, ...);
```

Downstream, everywhere the job currently does `prisma.repository.update(...)` / `prisma.analysisJob.update(...)`, branch on whether `repoId` or `publicAnalysisId` is set, writing to the matching table. This is mechanical but touches several call sites — budget real review time for it, not just the clone-URL change.

## 5. Deployment Detection (resolves PRD-A05)

### 5.1 New analysis pass: `packages/analysis/src/analysis/deployment.py`

A dedicated scan, separate from the existing code-chunking pass, that looks for a fixed set of known deployment-config filenames/patterns in the cloned repo:

```python
DEPLOYMENT_SIGNALS = {
    "Dockerfile": "docker",
    "docker-compose.yml": "docker-compose",
    "vercel.json": "vercel",
    "render.yaml": "render",
    ".railway/railway.ts": "railway-iac",
    "railway.json": "railway",
    "netlify.toml": "netlify",
    "fly.toml": "fly.io",
    "Procfile": "heroku",
    ".github/workflows/": "github-actions",  # directory prefix match
}

def detect_deployment_config(repo_path: Path) -> list[DeploymentSignal]:
    """Walk the repo root (and one level of common subdirs) for known
    deployment-config files. Returns file path + matched platform + raw
    content, for the generation service to summarize — this function does
    NOT itself interpret or guess; it only collects evidence."""
```

### 5.2 Generation: new artifact type

`packages/generation` gets a new prompt path — given the collected `DEPLOYMENT_SIGNALS` matches (file paths + contents), generate a structured summary: detected platforms, service topology if inferable (e.g. from `docker-compose.yml`'s service list), and required env vars if visible in config. Store as:

```python
artifact = {
    "artifactType": "deployment",
    "content": {
        "detected": bool,
        "platforms": [...],       # e.g. ["Vercel", "Railway"]
        "summary": "...",         # generated narrative
        "sourceFiles": [...],     # which files this was grounded in, for citation
    },
}
```

If `detect_deployment_config` finds nothing, skip the LLM call entirely and write `{"detected": False}` directly — this is the mechanism that satisfies PRD-A05's "explicit not-found state instead of guessing."

### 5.3 Frontend: new tab

`apps/web/src/components/tabs/DeploymentTab.tsx`, following the existing tab pattern (`ArchitectureTab.tsx` et al.) — reads the `"deployment"` artifact, renders the platform list + narrative, or an empty state ("No deployment configuration was found in this repository") when `detected: false`.

## 6. Reading Order (resolves PRD-A04)

`packages/analysis` already parses imports per `parser.py`. Extend this into a simple topological ordering:

```python
def reading_order(modules: list[Module], import_graph: dict[str, set[str]]) -> list[Module]:
    """Order modules so that files with no internal dependents (leaf utils)
    sort last, and files that are imported by many others but import few
    (likely entry points / core modules) sort first. A simple heuristic —
    in-degree vs out-degree within the repo's own import graph — is enough;
    this doesn't need to be a perfect build-order topological sort, just a
    reasonable "start here" ordering for a human reader."""
```

Store the computed order as a field on each `CodeModule` row (`readingOrderIndex: Int`) rather than recomputing it on every page load; the Modules tab sorts by this field instead of alphabetically.

## 7. Sequencing

| Step | Work | Depends on |
|---|---|---|
| 1 | `PublicAnalysis` model + migration | None |
| 2 | Worker: optional `accessToken`, dual-table writes | Step 1 |
| 3 | `POST /v1/public/analyze` + anonymous rate limit | Steps 1–2 |
| 4 | Frontend: public landing/results routes | Step 3 |
| 5 | Deployment detection pass + artifact + tab | Independent — can be built in parallel with 1–4 |
| 6 | Reading-order computation + Modules tab sort | Independent — can be built in parallel with 1–4 |
| 7 | Claim flow (`POST /v1/public/analyze/:id/claim`) | Steps 1–4 |

## 8. Acceptance Criteria

- Pasting a public repo URL with no login produces a completed analysis, end to end, with no `accessToken` in any request.
- Submitting a private repo URL anonymously returns a clear `403 PRIVATE_REPO` (or `404`, matching GitHub's own ambiguity for repos the caller can't see) — not a generic failure.
- A 6th anonymous request from the same IP within an hour is rejected with `429`, not silently queued.
- A repo with a `Dockerfile` and a GitHub Actions workflow produces a populated Deployment tab citing both files; a repo with neither shows the explicit "not found" state.
- The Modules tab for a repo with a clear entry point (e.g. `src/index.ts`) visibly lists that file before its downstream dependencies, not alphabetically.
- Signing in after an anonymous analysis and claiming it results in that analysis appearing in the user's own repo list.
