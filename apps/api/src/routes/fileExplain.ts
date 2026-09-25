import { Router } from "express";
import { createArtifact } from "@vibe-coder/database/artifacts";
import { prisma } from "../db";
import type { AuthedRequest } from "../middleware/auth";
import { HttpError, ok } from "../middleware/errors";
import { fileExplainRateLimit } from "../middleware/rateLimit";

const router = Router();

const EXPLAIN_TIMEOUT_MS = 60_000;

interface FileExplanation {
  filePath?: string;
  summary?: string;
  sections?: { heading: string; text: string }[];
  questions?: { question: string; answer: string }[];
  citations?: { filePath: string; startLine: number; endLine: number }[];
  isDemo?: boolean;
}

async function generateFileExplanation(
  repoId: string,
  filePath: string
): Promise<FileExplanation> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EXPLAIN_TIMEOUT_MS);
  try {
    const res = await fetch(
      `${process.env.GENERATION_SERVICE_URL ?? "http://localhost:8300"}/file-explain`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoId, filePath }),
        signal: controller.signal,
      }
    );
    if (!res.ok) {
      throw new HttpError(
        502,
        "GENERATION_FAILED",
        "File explanation generation failed — try again shortly"
      );
    }
    return (await res.json()) as FileExplanation;
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(
      502,
      "GENERATION_UNAVAILABLE",
      "Generation service unavailable — try again shortly"
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * POST /:repoId/files/explain { path }
 * Lazily generates + caches a per-file explanation (PRD-G02). Cache key is the
 * path embedded in artifactType — no migration needed (Artifact.artifactType
 * is a plain string).
 */
router.post(
  "/:repoId/files/explain",
  fileExplainRateLimit(),
  async (req: AuthedRequest, res, next) => {
    try {
      const { path } = req.body as { path?: string };
      if (!path || typeof path !== "string") {
        throw new HttpError(400, "VALIDATION_ERROR", "path is required");
      }

      // Ownership check: the repo must belong to the caller (or be an
      // anonymous placeholder repo reachable via a public analysis).
      const repo = await prisma.repository.findFirst({
        where: { id: req.params.repoId },
        select: { id: true, userId: true },
      });
      if (!repo) throw new HttpError(404, "NOT_FOUND", "Repository does not exist");
      if (repo.userId !== req.userId) {
        // Placeholder repos of anonymous analyses stay explainable only if
        // they carry a publicAnalysis row — otherwise reject.
        const viaPublic = await prisma.publicAnalysis.findFirst({
          where: { repoId: repo.id },
          select: { id: true },
        });
        if (!viaPublic) {
          throw new HttpError(403, "FORBIDDEN", "Not your repository");
        }
      }

      const artifactType = `file-explain:${path}`;
      const cached = await prisma.artifact.findFirst({
        where: { repoId: repo.id, artifactType },
        orderBy: { version: "desc" },
      });
      if (cached) {
        ok(res, { ...(cached.content as FileExplanation), cached: true });
        return;
      }

      const explanation = await generateFileExplanation(repo.id, path);
      await createArtifact(prisma, {
        repoId: repo.id,
        artifactType,
        content: explanation,
      });
      ok(res, { ...explanation, cached: false });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /:repoId/files/explanations — list every cached per-file explanation
 * (lets the frontend show which nodes already have explanations).
 */
router.get("/:repoId/files/explanations", async (req: AuthedRequest, res, next) => {
  try {
    const artifacts = await prisma.artifact.findMany({
      where: {
        repoId: req.params.repoId,
        artifactType: { startsWith: "file-explain:" },
      },
      select: { artifactType: true, generatedAt: true },
    });
    ok(res, artifacts);
  } catch (err) {
    next(err);
  }
});

export default router;
