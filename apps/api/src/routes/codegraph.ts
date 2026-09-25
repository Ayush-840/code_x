import { Router } from "express";
import { prisma } from "../db";
import { config } from "../config";
import { HttpError, ok } from "../middleware/errors";
import { anonymousRateLimit, fileExplainRateLimit } from "../middleware/rateLimit";
import { requireAuth, type AuthedRequest } from "../middleware/auth";

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
  try {
    const res = await fetch(`${config.codegraphServiceUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repo_id: repoId, ...(body as object) }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      if (res.status === 400) {
        // The service 400s when no graph exists for the repo.
        throw new HttpError(
          404,
          "NO_GRAPH",
          "No code graph for this repository yet — re-run the analysis to generate one."
        );
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
 */
async function resolveRepoId(
  repoId: string,
  userId: string | null
): Promise<string> {
  const repo = await prisma.repository.findFirst({
    where: { id: repoId },
    select: { id: true, userId: true },
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
  return repo.id;
}

/** GET /:repoId/graph — full nodes/edges for the force-graph view. */
router.get("/:repoId/graph", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const repoId = await resolveRepoId(req.params.repoId, req.userId!);
    const data = await fetchGraph<{ nodes: GraphNode[]; edges: GraphEdge[] }>(
      repoId,
      `/graph?repo_id=${encodeURIComponent(repoId)}`,
      {}
    );
    ok(res, data);
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
      const repoId = await resolveRepoId(req.params.repoId, req.userId!);
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
      const repoId = await resolveRepoId(req.params.repoId, req.userId!);
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
    requireValidAnalysisId(req.params.id);
    const pa = await prisma.publicAnalysis.findUnique({
      where: { id: req.params.id },
      select: { id: true, repoId: true, expiresAt: true },
    });
    if (!pa) throw new HttpError(404, "NOT_FOUND", "Analysis not found");
    if (pa.expiresAt && pa.expiresAt < new Date()) {
      throw new HttpError(410, "EXPIRED", "This analysis has expired");
    }
    if (!pa.repoId) throw new HttpError(400, "NO_REPO", "No repository data for this analysis");
    const data = await fetchGraph<{ nodes: GraphNode[]; edges: GraphEdge[] }>(
      pa.repoId,
      `/graph?repo_id=${encodeURIComponent(pa.repoId)}`,
      {}
    );
    ok(res, data);
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
      const pa = await prisma.publicAnalysis.findUnique({
        where: { id: req.params.id },
        select: { id: true, repoId: true, expiresAt: true },
      });
      if (!pa) throw new HttpError(404, "NOT_FOUND", "Analysis not found");
      if (pa.expiresAt && pa.expiresAt < new Date()) {
        throw new HttpError(410, "EXPIRED", "This analysis has expired");
      }
      if (!pa.repoId) throw new HttpError(400, "NO_REPO", "No repository data for this analysis");
      const data = await fetchGraph<{ explanation: string; neighbors: string[] }>(
        pa.repoId,
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
      const pa = await prisma.publicAnalysis.findUnique({
        where: { id: req.params.id },
        select: { id: true, repoId: true, expiresAt: true },
      });
      if (!pa) throw new HttpError(404, "NOT_FOUND", "Analysis not found");
      if (pa.expiresAt && pa.expiresAt < new Date()) {
        throw new HttpError(410, "EXPIRED", "This analysis has expired");
      }
      if (!pa.repoId) throw new HttpError(400, "NO_REPO", "No repository data for this analysis");
      const data = await fetchGraph<{ answer: string; cited_nodes: string[] }>(
        pa.repoId,
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
