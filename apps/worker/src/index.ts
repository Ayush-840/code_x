import { Worker } from "bullmq";
import { Redis } from "ioredis";
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { existsSync } from "node:fs";

import { analyzeRepo } from "./jobs/analyzeRepo";
import { assertMigrationsApplied } from "@vibe-coder/database/migrations";
import { bootReadinessCheck, startHeartbeat } from "./readiness";

// Load .env — try CWD first, then walk up to workspace root (same policy as
// apps/api/src/config.ts; the worker previously relied on bare dotenv/config).
const rootEnv = resolve(process.cwd(), ".env");
const workspaceRoot = resolve(process.cwd(), "../../.env");
for (const p of [rootEnv, workspaceRoot]) {
  if (existsSync(p)) {
    loadEnv({ path: p });
    break;
  }
}

// Fail fast on schema drift (PRD-I03): a worker that accepts jobs against a
// schema-mismatched database burns a clone + a job per attempt. Better to die
// loudly at boot — in Railway that shows as a failed deploy.
assertMigrationsApplied();

const connection = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  maxRetriesPerRequest: null,
});

// Boot gate (PRD-I03): a worker that can't reach the DB or a Python service
// would burn a clone + a job per attempt. Diagnose and exit loudly instead.
void (async () => {
  const ready = await bootReadinessCheck();
  if (!ready) {
    process.exit(1);
  }
  startHeartbeat(connection);
})();

export const worker = new Worker(
  "analysis",
  async (job) => {
    if (job.name === "analyze-repo") {
      await analyzeRepo(job.data);
    }
  },
  { connection, concurrency: 2 }
);

worker.on("failed", (job, err) => {
  console.error(`[worker] job ${job?.id} failed:`, err.message);
});

console.log("[worker] Worker started, waiting for jobs...");
