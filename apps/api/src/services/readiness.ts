import { prisma } from "../db";
import { connection } from "../redis";
import { config } from "../config";
import { HttpError } from "../middleware/errors";

/**
 * Boot/readiness gate for analysis submission (PRD-I03).
 *
 * Submitting an analysis is an *acceptance* of work: the job gets queued, the
 * user watches a progress bar, and every failure downstream shows up minutes
 * later as a generic "analysis failed". If any pipeline dependency is already
 * known-down, the honest move is to refuse the work immediately with a 503
 * that says "our backend is down", never "check your URL".
 */

const HEARTBEAT_KEY = "worker:heartbeat";
// The worker refreshes every 30s with a 60s TTL; 90s tolerates one missed beat.
const HEARTBEAT_MAX_AGE_MS = 90_000;

interface DepHealth {
  name: string;
  ok: boolean;
  detail?: string;
}

async function check(name: string, fn: () => Promise<void>): Promise<DepHealth> {
  try {
    await fn();
    return { name, ok: true };
  } catch (err) {
    return {
      name,
      ok: false,
      detail: String((err as Error)?.message ?? err).slice(0, 120),
    };
  }
}

async function pingService(baseUrl: string): Promise<void> {
  const res = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(1500) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${baseUrl}/health`);
}

export async function getReadiness(): Promise<{ ready: boolean; deps: DepHealth[] }> {
  const [database, redis, analysis, retrieval, generation, worker] = await Promise.all([
    check("database", async () => {
      await prisma.$queryRaw`SELECT 1`;
    }),
    check("redis", async () => {
      await connection.ping();
    }),
    check("analysis", () => pingService(config.analysisServiceUrl)),
    check("retrieval", () => pingService(config.retrievalServiceUrl)),
    check("generation", () => pingService(config.generationServiceUrl)),
    check("worker", async () => {
      const hb = await connection.get(HEARTBEAT_KEY);
      if (!hb) throw new Error("no heartbeat — worker not running");
      const ageMs = Date.now() - new Date(hb).getTime();
      if (ageMs > HEARTBEAT_MAX_AGE_MS) {
        throw new Error(`heartbeat stale by ${Math.round(ageMs / 1000)}s — worker stalled?`);
      }
    }),
  ]);

  const deps = [database, redis, analysis, retrieval, generation, worker];
  return { ready: deps.every((d) => d.ok), deps };
}

export async function assertAnalysisReady(): Promise<void> {
  const { ready, deps } = await getReadiness();
  if (ready) return;
  const down = deps.filter((d) => !d.ok).map((d) => d.name).join(", ");
  throw new HttpError(
    503,
    "ANALYSIS_UNAVAILABLE",
    `The analysis backend isn't fully up right now (offline: ${down}). ` +
      `Your repository URL is fine — please retry in a minute.`
  );
}
