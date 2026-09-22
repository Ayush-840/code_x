# Vibe Coder — Technical Requirements Document
## Incident: Analysis Fails for Every Repository

Repo analyzed: `github.com/Ayush-840/code_x` • commit `ed6d2df` • September 2026

---

## 1. Investigation Summary

Rather than static-reading alone, the `analysis` and `generation` Python services were run directly:

```
POST /analyze  (analysis service) → 200, valid modules/symbols/chunks/fileTree
POST /generate (generation service) → 200, valid architecture/modules/questions artifacts
```

Both healthy against the exact payload shapes `apps/worker/src/jobs/analyzeRepo.ts` sends. This rules out the Python services as the failure source and points at the TypeScript/Node side — specifically, code that runs unconditionally for every job, since the failure is universal across both anonymous and authenticated flows, which only share the worker's `analyzeRepo()` function and the database.

## 2. Root Cause (Leading Hypothesis)

```ts
// analyzeRepo.ts — runs after every module upsert, for every job
const readingOrder = computeReadingOrder(parsed.modules);
for (const [name, idx] of readingOrder) {
  await prisma.codeModule.updateMany({
    where: { repoId, name },
    data: { readingOrderIndex: idx },   // added in migration 20260920185605_add_public_analysis
  });
}
```

If migration `20260920185605_add_public_analysis` (which adds `CodeModule.readingOrderIndex` and the entire `PublicAnalysis` table) was not applied to the database the running API/worker connect to, this line throws a Postgres "column does not exist" error. The worker's `catch` block catches it, sets the job to `FAILED` with `error.message`, and the frontend surfaces the generic fallback string. This is consistent with every symptom reported: universal failure, both flows affected, immediate failure rather than a partial/flaky one.

A related, secondary possibility: the migration was applied, but the Prisma Client running in the API/worker process is stale (generated before the schema change) — same user-visible symptom, different fix step.

## 3. Fix (P0, Operational)

```sh
# From the repo root, or wherever the database package is installed:
pnpm --filter @vibe-coder/database exec prisma migrate status

# If it reports a pending migration:
pnpm --filter @vibe-coder/database exec prisma migrate deploy   # deployed DB (Railway)
# or
pnpm --filter @vibe-coder/database exec prisma migrate dev      # local dev DB

# Regenerate the client regardless, then restart both processes:
pnpm --filter @vibe-coder/database exec prisma generate
```

On Railway specifically: confirm the `preDeployCommand` (set up in the earlier Vercel+Railway deployment work) actually ran for this deploy — check the deploy logs for the `prisma migrate deploy` output. If the service was redeployed by pushing code without Railway treating it as a "new deploy" that triggers the pre-deploy command (e.g. a manual restart rather than a redeploy), the migration would never have run despite being correctly configured.

## 4. Prevention: Boot-Time Schema Guard (resolves PRD-I03)

Add a startup check to both `apps/api` and `apps/worker` that fails fast instead of accepting work against a schema-mismatched database:

```ts
// packages/database — new small helper, exported for both api and worker to call at boot
import { execSync } from "node:child_process";

export function assertMigrationsApplied(): void {
  try {
    const output = execSync("npx prisma migrate status", {
      cwd: __dirname,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (/have not yet been applied/i.test(output) || /drift/i.test(output)) {
      throw new Error(`Pending or drifted migrations detected:\n${output}`);
    }
  } catch (err) {
    console.error("[startup] Migration check failed — refusing to start.", err);
    process.exit(1);
  }
}
```

```ts
// apps/api/src/index.ts and apps/worker/src/index.ts — call before accepting any traffic/jobs
import { assertMigrationsApplied } from "@vibe-coder/database";
assertMigrationsApplied();
```

This turns "every job fails with a confusing error" into "the service refuses to boot, with an explicit log line," at the cost of a few hundred milliseconds of startup time per deploy — a reasonable trade for a container that would otherwise accept and fail every request it receives. In a Railway deploy, a service that exits immediately on boot shows as a failed deploy in the dashboard, which is a far more visible signal than a healthy-looking service quietly failing every job.

## 5. Prevention: Differentiated Error Messages (resolves PRD-I04)

`apps/api/src/middleware/errors.ts`'s `errorHandler` (and the job's `errorMessage` field) should carry an error `category` that the frontend can branch on, rather than the frontend guessing from a raw message string:

```ts
// worker — when catching the job failure
const category = classifyError(error);
await prisma.analysisJob.update({
  where: { id: jobId },
  data: { status: "FAILED", errorMessage: (error as Error).message, errorCategory: category },
});

function classifyError(error: unknown): "NOT_FOUND" | "RATE_LIMITED" | "SYSTEM_ERROR" {
  const msg = String((error as Error)?.message ?? "");
  if (/not found|404/i.test(msg)) return "NOT_FOUND";
  if (/rate limit/i.test(msg)) return "RATE_LIMITED";
  return "SYSTEM_ERROR";
}
```

(`errorCategory` needs a corresponding nullable column on `AnalysisJob` — a small follow-up migration.) Frontend then shows a distinct message per category — "This repo couldn't be found," "GitHub's rate limit was hit, try again shortly," or "Something went wrong on our end — we've been notified" for `SYSTEM_ERROR` — instead of one message covering all three.

## 6. Sequencing

| Step | Work | Depends on |
|---|---|---|
| 1 | Apply the pending migration + regenerate Prisma Client in whatever environment is currently failing | None — do this first, it's very likely the entire fix |
| 2 | Confirm via a real analysis attempt that it now succeeds | Step 1 |
| 3 | Boot-time migration guard (Section 4) | Step 1 confirmed as the actual root cause |
| 4 | Differentiated error categories (Section 5) | Independent — can be built any time |

## 7. Acceptance Criteria

- `prisma migrate status` reports no pending migrations against the environment that was failing.
- A fresh analysis of a real public repo completes successfully end to end (both the anonymous flow and, separately, the logged-in flow).
- Deliberately stopping a local Postgres mid-migration (simulating drift) causes `apps/api` and `apps/worker` to exit at boot with a clear log message, rather than starting and failing jobs individually.
- Submitting a genuinely invalid repo URL and triggering a genuine system error (e.g. temporarily pointing `GENERATION_SERVICE_URL` at a bad host) produce two visibly different error messages in the UI.
