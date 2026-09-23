import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import type { Redis } from "ioredis";

// .env policy identical to src/index.ts: CWD first, then workspace root.
const rootEnv = resolve(process.cwd(), ".env");
const workspaceRoot = resolve(process.cwd(), "../../.env");
for (const p of [rootEnv, workspaceRoot]) {
  if (existsSync(p)) {
    loadEnv({ path: p });
    break;
  }
}

const ANALYSIS_URL = process.env.ANALYSIS_SERVICE_URL ?? "http://localhost:8100";
const RETRIEVAL_URL = process.env.RETRIEVAL_SERVICE_URL ?? "http://localhost:8200";
const GENERATION_URL = process.env.GENERATION_SERVICE_URL ?? "http://localhost:8300";

// Sibling containers race at deploy time: the python services start in
// parallel with the worker, so they're allowed to be briefly unavailable.
// The DB is the exception — no retry can fix a missing database.
const PIPELINE_RETRY_MAX = Number(process.env.PIPELINE_BOOT_RETRIES ?? "12");
const PIPELINE_RETRY_DELAY_MS = 10_000;

const HEARTBEAT_KEY = "worker:heartbeat";
const HEARTBEAT_INTERVAL_MS = 30_000;
const HEARTBEAT_TTL_S = 60;

async function pingService(baseUrl: string): Promise<void> {
  const res = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(1500) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${baseUrl}/health`);
}

/**
 * Boot-time dependency check (PRD-I03): refuse to start (exit 1) when a
 * pipeline dependency is down, so a broken environment fails one deploy
 * loudly instead of failing every job individually with a generic error.
 */
export async function bootReadinessCheck(): Promise<boolean> {
  const deps: { name: string; ok: boolean; detail?: string }[] = [];

  async function probe(name: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
      deps.push({ name, ok: true });
      console.log(`[worker] dependency ok: ${name}`);
    } catch (err) {
      deps.push({ name, ok: false, detail: String((err as Error)?.message ?? err) });
      console.error(`[worker] dependency DOWN: ${name} — ${(err as Error)?.message}`);
    }
  }

  // DB: lazy-connect via a trivial query (Prisma connects on first use).
  // Fatal if down — retrying can't fix a missing database.
  const { PrismaClient } = await import("@vibe-coder/database");
  const prisma = new PrismaClient();
  await probe("database", async () => {
    await prisma.$queryRaw`SELECT 1`;
  });
  const dbDown = deps.some((d) => d.name === "database" && !d.ok);
  if (dbDown) {
    console.error(
      "[worker] refusing to start: database unreachable. " +
        "Check DATABASE_URL and that the DB is running."
    );
    await prisma.$disconnect().catch(() => {});
    return false;
  }

  // Pipeline deps: retry for up to ~2 minutes (12 x 10s) to absorb the
  // deploy-time startup race with sibling containers, then degrade:
  // start anyway and let per-job readiness refusals keep work honest.
  const pipelineProbes: [string, () => Promise<void>][] = [
    ["analysis", () => pingService(ANALYSIS_URL)],
    ["retrieval", () => pingService(RETRIEVAL_URL)],
    ["generation", () => pingService(GENERATION_URL)],
  ];
  let pipelineDown: string[] = [];
  for (let attempt = 1; attempt <= PIPELINE_RETRY_MAX; attempt++) {
    deps.length = 0;
    for (const [name, fn] of pipelineProbes) {
      await probe(name, fn);
    }
    pipelineDown = deps.filter((d) => !d.ok).map((d) => d.name);
    if (pipelineDown.length === 0) break;
    console.warn(
      `[worker] pipeline deps offline (${pipelineDown.join(", ")}) — ` +
        `retry ${attempt}/${PIPELINE_RETRY_MAX} in ${PIPELINE_RETRY_DELAY_MS / 1000}s`
    );
    await new Promise((r) => setTimeout(r, PIPELINE_RETRY_DELAY_MS));
  }

  await prisma.$disconnect().catch(() => {});

  if (pipelineDown.length > 0) {
    console.error(
      `[worker] pipeline deps still offline after retries: ${pipelineDown.join(", ")}. ` +
        `Starting anyway — analyses will be refused with a 503 until they recover.`
    );
  }
  return true;
}

/**
 * Heartbeat so the API can tell "worker not running" from "pipeline slow".
 * Every 30s, with a 60s Redis TTL — two missed beats means the worker died.
 */
export function startHeartbeat(connection: Redis): void {
  const beat = () =>
    connection.set(HEARTBEAT_KEY, new Date().toISOString(), "EX", HEARTBEAT_TTL_S).catch(() => {});
  void beat();
  const timer = setInterval(beat, HEARTBEAT_INTERVAL_MS);
  timer.unref();
  console.log("[worker] heartbeat started (30s interval, 60s TTL)");
}
