import { Router, type Response } from "express";
import { prisma } from "../db";
import { config } from "../config";
import { HttpError, ok, accepted } from "../middleware/errors";
import { anonymousRateLimit, fileExplainRateLimit } from "../middleware/rateLimit";
import { requireAuth, type AuthedRequest } from "../middleware/auth";
import { createArtifact } from "@vibe-coder/database/artifacts";
import { analysisQueue } from "../redis";

/**
 * CodeGraph proxy routes (PRD-G03): the only place the frontend reaches the
 * codegraph service through. Read-only — graphs are created by the worker
 * pipeline, so there is no /parse passthrough and no way for a caller to make
 * the service read arbitrary filesystem paths.
 *
 * Both endpoints resolve the repoId (authed: owned repo; anonymous: live
 * public analysis) and forward {repo_id, ...} to the service.
 */

/**
 * Authed router (mounted at /v1/repos, behind the app-level requireAuth):
 * full-graph, explain and chat for repos owned by the signed-in user.
 */
const router = Router();

/**
 * Anonymous router (mounted at /v1/public in app.ts): same three operations
 * for public analyses, no auth. This MUST live on its own router — the
 * anonymous analyze page calls /v1/public/:id/codegraph, and when these
 * handlers only existed on the /v1/repos-mounted router the request fell
 * through to the broad "/v1" requireAuth layer and 401'd every anonymous
 * visitor with "Missing or invalid authentication token".
 */
export const publicRouter = Router();

// PublicAnalysis.id is a Postgres uuid column: querying it with a non-uuid
// makes Prisma throw a cast error that surfaces as a 500. These routes are
// reachable with arbitrary visitor-supplied URLs, so validate the shape
// first and report garbage ids as the 404 they really are.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireValidAnalysisId(id: string): void {
  if (!UUID_RE.test(id)) {
    throw new HttpError(404, "NOT_FOUND", "Analysis not found");
  }
}

const PROXY_TIMEOUT_MS = 60_000;

async function fetchGraph<T>(repoId: string, path: string, body: unknown): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS);
  // The graph read is GET-with-query on the Python side (@app.get("/graph"));
  // explain/chat are JSON POSTs. Proxying /graph as POST made FastAPI answer
  // 405 {"detail":"Method Not Allowed"} — surfacing in the tab as
  // "CodeGraph service error". Match the method to the upstream route.
  const isGet = path.startsWith("/graph");
  try {
    const res = await fetch(`${config.codegraphServiceUrl}${path}`, {
      method: isGet ? "GET" : "POST",
      headers: isGet ? undefined : { "Content-Type": "application/json" },
      body: isGet ? undefined : JSON.stringify({ repo_id: repoId, ...(body as object) }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      if (res.status === 400) {
        // The service 400s when no graph exists for the repo. The route layer
        // catches this and lazily schedules a rebuild where possible.
        throw new HttpError(404, "NO_GRAPH", "No code graph for this repository yet.");
      }
      if (res.status === 404) {
        throw new HttpError(404, "NODE_NOT_FOUND", "Node not found in this graph");
      }
      throw new HttpError(502, "CODEGRAPH_FAILED", `CodeGraph service error: ${detail.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(502, "CODEGRAPH_UNAVAILABLE", "CodeGraph service unavailable — try again shortly");
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Lazy graph rebuild (the "re-run the analysis" dead end, fixed): analyses
 * created before the codegraph pipeline step shipped have no graph and no
 * artifact, and re-running the whole analysis is both expensive and blocked
 * by result caching. Instead, when the graph is missing we enqueue a cheap
 * clone+parse-only worker job and tell the tab to poll.
 *
 * In-flight dedup is a time-windowed `codegraph-rebuild` marker artifact: it
 * survives Redis restarts (unlike BullMQ jobId dedup on a failed job) and
 * self-expires, so a failed rebuild is retried on the visitor's next tab open
 * — bounded to one enqueue per window, not one per request.
 */
const REBUILD_WINDOW_MS = 10 * 60 * 1000;

async function maybeScheduleGraphRebuild(
  repoId: string,
  fullName: string
): Promise<{ generating: boolean }> {
  const artifacts = await prisma.artifact.findMany({
    where: { repoId, artifactType: { in: ["codegraph", "codegraph-rebuild"] } },
    select: { artifactType: true, generatedAt: true, content: true },
    orderBy: { generatedAt: "desc" },
  });
  // A codegraph artifact means a rebuild ran to completion: if the graph is
  // STILL missing, the repo genuinely has nothing the parser understands
  // (e.g. zero Python files) — an honest 404, not "try again".
  if (artifacts.some((a) => a.artifactType === "codegraph")) {
    return { generating: false };
  }
  const marker = artifacts.find((a) => a.artifactType === "codegraph-rebuild");
  if (marker && Date.now() - marker.generatedAt.getTime() < REBUILD_WINDOW_MS) {
    return { generating: true };
  }
  await createArtifact(prisma, {
    repoId,
    artifactType: "codegraph-rebuild",
    content: { requestedAt: new Date().toISOString() },
  });
  // Unique jobId per enqueue: BullMQ silently DROPS an add whose jobId matches
  // a job still in the completed/failed sets (kept by removeOnComplete/Fail),
  // so the fixed `rebuild-graph:${repoId}` id meant one failed rebuild blocked
  // every retry forever while the API kept answering 202 "generating". Dedup
  // is already the marker artifact's job (one enqueue per window), so the id
  // only needs uniqueness.
  await analysisQueue.add(
    "rebuild-graph",
    { repoId, fullName },
    { jobId: `rebuild-graph:${repoId}:${Date.now()}` }
  );
  return { generating: true };
}

/**
 * Shared post-404 behavior for the graph-read routes: either report a rebuild
 * in flight (202) or a genuinely graph-less repo (404). Responds directly via
 * `accepted` — a thrown HttpError(202) reaches errorHandler after res.status
 * has run, and Express downgrades it to 500. Throwing is reserved for the
 * genuine-404 case, which flows through next(err) normally.
 */
async function graphMissingResponse(
  res: Response,
  repoId: string,
  fullName: string
): Promise<void> {
  const { generating } = await maybeScheduleGraphRebuild(repoId, fullName);
  if (generating) {
    accepted(res, "GRAPH_GENERATING", "Code graph is being generated — check back in a moment.");
  } else {
    throw new HttpError(
      404,
      "NO_GRAPH",
      "No code graph for this repository — it has no parseable Python code."
    );
  }
  // Unreachable (both branches throw or respond) — satisfies the never type.
  throw new HttpError(404, "NO_GRAPH", "No code graph for this repository.");
}

interface GraphNode {
  id: string;
  type: string;
  file: string;
  name: string;
  line_start: number;
  line_end: number;
  docstring?: string | null;
  signature?: string | null;
}

interface GraphEdge {
  from_id: string;
  to_id: string;
  type: string;
}

/**
 * Shared resolution for the authed + anonymous flows: the repoId must be a
 * real Repository, and anonymous repos are only reachable through a live
 * (unexpired) public analysis — same ownership shape as fileExplain.ts.
 * Returns the fullName too: the lazy graph rebuild clones from it.
 */
async function resolveRepoId(
  repoId: string,
  userId: string | null
): Promise<{ repoId: string; fullName: string }> {
  const repo = await prisma.repository.findFirst({
    where: { id: repoId },
    select: { id: true, userId: true, fullName: true },
  });
  if (!repo) throw new HttpError(404, "NOT_FOUND", "Repository does not exist");
  if (repo.userId !== userId) {
    const viaPublic = await prisma.publicAnalysis.findFirst({
      where: { repoId: repo.id, expiresAt: { gt: new Date() } },
      select: { id: true },
    });
    if (!viaPublic) {
      throw new HttpError(403, "FORBIDDEN", "Not your repository");
    }
  }
  return { repoId: repo.id, fullName: repo.fullName };
}

/**
 * Load a public analysis (unexpired) and resolve its repo. Shared by the
 * three anonymous routes; also the ownership gate for them.
 */
async function resolvePublicAnalysis(analysisId: string) {
  requireValidAnalysisId(analysisId);
  const pa = await prisma.publicAnalysis.findUnique({
    where: { id: analysisId },
    select: {
      id: true,
      repoId: true,
      expiresAt: true,
      repo: { select: { id: true, fullName: true } },
    },
  });
  if (!pa) throw new HttpError(404, "NOT_FOUND", "Analysis not found");
  if (pa.expiresAt && pa.expiresAt < new Date()) {
    throw new HttpError(410, "EXPIRED", "This analysis has expired");
  }
  if (!pa.repoId || !pa.repo) {
    throw new HttpError(400, "NO_REPO", "No repository data for this analysis");
  }
  return { repoId: pa.repoId, fullName: pa.repo.fullName };
}

/** GET /:repoId/graph — full nodes/edges for the force-graph view. */
router.get("/:repoId/graph", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const { repoId, fullName } = await resolveRepoId(req.params.repoId, req.userId!);
    try {
      const data = await fetchGraph<{ nodes: GraphNode[]; edges: GraphEdge[] }>(
        repoId,
        `/graph?repo_id=${encodeURIComponent(repoId)}`,
        {}
      );
      ok(res, data);
    } catch (err) {
      if (err instanceof HttpError && err.code === "NO_GRAPH") {
        await graphMissingResponse(res, repoId, fullName);
        return;
      }
      throw err;
    }
  } catch (err) {
    next(err);
  }
});

/** POST /:repoId/explain { node_id } — LLM explanation of one node. */
router.post(
  "/:repoId/explain",
  fileExplainRateLimit(),
  async (req: AuthedRequest, res, next) => {
    try {
      const { node_id } = req.body as { node_id?: string };
      if (!node_id || typeof node_id !== "string") {
        throw new HttpError(400, "VALIDATION_ERROR", "node_id is required");
      }
      const { repoId } = await resolveRepoId(req.params.repoId, req.userId!);
      const data = await fetchGraph<{ explanation: string; neighbors: string[] }>(
        repoId,
        "/explain",
        { node_id }
      );
      ok(res, data);
    } catch (err) {
      next(err);
    }
  }
);

/** POST /:repoId/chat { question } — graph-grounded answer + cited nodes. */
router.post(
  "/:repoId/chat",
  fileExplainRateLimit(),
  async (req: AuthedRequest, res, next) => {
    try {
      const { question } = req.body as { question?: string };
      if (!question || typeof question !== "string") {
        throw new HttpError(400, "VALIDATION_ERROR", "question is required");
      }
      const { repoId } = await resolveRepoId(req.params.repoId, req.userId!);
      const data = await fetchGraph<{ answer: string; cited_nodes: string[] }>(
        repoId,
        "/chat",
        { question }
      );
      ok(res, data);
    } catch (err) {
      next(err);
    }
  }
);

// --- Anonymous flow (public analyses) --------------------------------------

/** GET /:id/codegraph — graph for an anonymous analysis. */
publicRouter.get("/:id/codegraph", anonymousRateLimit("status"), async (req, res, next) => {
  try {
    const { repoId, fullName } = await resolvePublicAnalysis(req.params.id);
    try {
      const data = await fetchGraph<{ nodes: GraphNode[]; edges: GraphEdge[] }>(
        repoId,
        `/graph?repo_id=${encodeURIComponent(repoId)}`,
        {}
      );
      ok(res, data);
    } catch (err) {
      if (err instanceof HttpError && err.code === "NO_GRAPH") {
        await graphMissingResponse(res, repoId, fullName);
        return;
      }
      throw err;
    }
  } catch (err) {
    next(err);
  }
});

/** POST /:id/codegraph/explain { node_id } — anonymous node explanation. */
publicRouter.post(
  "/:id/codegraph/explain",
  fileExplainRateLimit(),
  anonymousRateLimit("status"),
  async (req, res, next) => {
    try {
      const { node_id } = req.body as { node_id?: string };
      if (!node_id || typeof node_id !== "string") {
        throw new HttpError(400, "VALIDATION_ERROR", "node_id is required");
      }
      requireValidAnalysisId(req.params.id);
      const { repoId } = await resolvePublicAnalysis(req.params.id);
      const data = await fetchGraph<{ explanation: string; neighbors: string[] }>(
        repoId,
        "/explain",
        { node_id }
      );
      ok(res, data);
    } catch (err) {
      next(err);
    }
  }
);

/** POST /:id/codegraph/chat { question } — anonymous graph-grounded chat. */
publicRouter.post(
  "/:id/codegraph/chat",
  fileExplainRateLimit(),
  anonymousRateLimit("status"),
  async (req, res, next) => {
    try {
      const { question } = req.body as { question?: string };
      if (!question || typeof question !== "string") {
        throw new HttpError(400, "VALIDATION_ERROR", "question is required");
      }
      requireValidAnalysisId(req.params.id);
      const { repoId } = await resolvePublicAnalysis(req.params.id);
      const data = await fetchGraph<{ answer: string; cited_nodes: string[] }>(
        repoId,
        "/chat",
        { question }
      );
      ok(res, data);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
