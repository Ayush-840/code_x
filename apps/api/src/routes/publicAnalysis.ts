import { Router } from "express";
import { createArtifact } from "@vibe-coder/database/artifacts";
import { Octokit } from "octokit";
import { prisma } from "../db";
import { analysisQueue } from "../redis";
import { HttpError, ok } from "../middleware/errors";
import { notifyProgress } from "../services/analysis";
import { anonymousRateLimit, fileExplainRateLimit } from "../middleware/rateLimit";
import { requireAuth, type AuthedRequest } from "../middleware/auth";
import { assertAnalysisReady } from "../services/readiness";

const router = Router();

function parseRepoUrl(url: string): { owner: string; repo: string } {
  const match = url.match(/github\.com[/:]([^/]+)\/([^.#/?]+)(?:\.git)?/);
  if (!match) {
    throw new HttpError(400, "INVALID_GITHUB_URL", "Provided URL is not a valid GitHub repository URL");
  }
  return { owner: match[1], repo: match[2] };
}

const ANON_USER_ID = "00000000-0000-0000-0000-000000000000";

// Anonymous analyses attach to a sentinel "anonymous" user so the placeholder
// Repository satisfies its non-null userId FK. Created lazily so fresh
// environments (new DBs, preview envs) work without a manual seed step.
async function ensureAnonUser(): Promise<string> {
  try {
    await prisma.user.upsert({
      where: { id: ANON_USER_ID },
      update: {},
      create: { id: ANON_USER_ID, githubId: 0, username: "anonymous" },
    });
  } catch {
    // Unique-violation race with a concurrent request — the row exists either way.
  }
  return ANON_USER_ID;
}

router.post("/analyze", anonymousRateLimit("analyze"), async (req, res, next) => {
  try {
    const { repoUrl } = req.body as { repoUrl?: string };
    if (!repoUrl) {
      throw new HttpError(400, "VALIDATION_ERROR", "repoUrl is required");
    }
    // Refuse work up front when the pipeline is degraded (PRD-I03): a 503
    // that names the offline dependency beats a job that fails minutes later
    // with a message that reads like a bad URL.
    await assertAnalysisReady();
    const { owner, repo } = parseRepoUrl(repoUrl);
    const fullName = `${owner}/${repo}`;
    const requestIp = req.ip ?? "unknown";

    let defaultBranch: string;
    try {
      const gh = await new Octokit().rest.repos.get({ owner, repo });
      if (gh.data.private) {
        throw new HttpError(400, "PRIVATE_REPO", "Only public repositories can be analyzed anonymously");
      }
      defaultBranch = gh.data.default_branch;
    } catch (ghErr: any) {
      const status = ghErr?.status ?? ghErr?.response?.status;
      const msg = String(ghErr?.message ?? "");
      if (status === 404) {
        throw new HttpError(404, "REPO_NOT_FOUND", `Repository ${fullName} not found. Check the URL.`);
      }
      if (status === 403 || /rate limit|quota/i.test(msg)) {
        // GitHub allows only 60 unauthenticated requests/hour per IP.
        throw new HttpError(429, "GITHUB_RATE_LIMITED", "GitHub's public API rate limit was hit — try again in a few minutes, or sign in.");
      }
      if (ghErr instanceof HttpError) throw ghErr;
      throw new HttpError(502, "GITHUB_API_ERROR", `GitHub API error: ${msg || "unknown"}`);
    }

    const recent = await prisma.publicAnalysis.findFirst({
      where: { fullName, status: { in: ["PARSING", "INDEXING", "GENERATING", "READY"] } },
      orderBy: { createdAt: "desc" },
      include: { repo: { include: { modules: true } } },
    });
    if (recent && recent.status === "READY" && (recent.repo?.modules?.length ?? 0) > 0) {
      ok(res, { id: recent.id, status: "READY", cached: true }, 200);
      return;
    }
    if (recent && recent.status === "READY") {
      // Ready but with no modules parsed — stale/empty result from an older
      // pipeline bug; re-run rather than serve or silently reuse it.
      recent.status = "FAILED";
    }
    if (recent && recent.status !== "FAILED") {
      ok(res, { id: recent.id, status: recent.status, cached: false }, 202);
      return;
    }

    // Upsert (not create): a previous failed attempt may have left a placeholder
    // repo for the same (anonymous, fullName) pair — reuse it instead of 500ing
    // on the @@unique([userId, fullName]) constraint.
    const placeholderRepo = await prisma.repository.upsert({
      where: { userId_fullName: { userId: await ensureAnonUser(), fullName } },
      update: { status: "PENDING", defaultBranch },
      create: {
        userId: ANON_USER_ID,
        fullName,
        defaultBranch,
        status: "PENDING",
      },
    });
    // A reused placeholder may carry stale modules/artifacts from a previous
    // failed run — clear them so the new job starts clean (artifact inserts
    // would otherwise violate the (repoId, artifactType, version) unique).
    await prisma.codeModule.deleteMany({ where: { repoId: placeholderRepo.id } });
    await prisma.artifact.deleteMany({ where: { repoId: placeholderRepo.id } });

    const publicAnalysis = await prisma.publicAnalysis.create({
      data: {
        fullName,
        defaultBranch,
        requestIp,
        repoId: placeholderRepo.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    const job = await prisma.analysisJob.create({
      data: { repoId: placeholderRepo.id, status: "QUEUED" },
    });

    await prisma.publicAnalysis.update({
      where: { id: publicAnalysis.id },
      data: { jobId: job.id },
    });

    await notifyProgress(job.id, "QUEUED", 0, "Queued for anonymous analysis");

    await analysisQueue.add("analyze-repo", {
      repoId: placeholderRepo.id,
      jobId: job.id,
      fullName,
      defaultBranch,
      publicAnalysisId: publicAnalysis.id,
    });

    ok(res, { id: publicAnalysis.id, status: "QUEUED", cached: false }, 202);
  } catch (err) {
    next(err);
  }
});

router.get("/:id", anonymousRateLimit("status"), async (req, res, next) => {
  try {
    const pa = await prisma.publicAnalysis.findUnique({
      where: { id: req.params.id },
      include: {
        job: true,
        repo: {
          include: {
            modules: { orderBy: { readingOrderIndex: "asc" } },
            artifacts: true,
          },
        },
      },
    });
    if (!pa) throw new HttpError(404, "NOT_FOUND", "Analysis not found");
    if (pa.expiresAt && pa.expiresAt < new Date()) {
      throw new HttpError(410, "EXPIRED", "This analysis has expired");
    }

    ok(res, {
      id: pa.id,
      fullName: pa.fullName,
      status: pa.status,
      defaultBranch: pa.defaultBranch,
      createdAt: pa.createdAt,
      expiresAt: pa.expiresAt,
      job: pa.job,
      modules: pa.repo?.modules ?? [],
      artifacts: pa.repo?.artifacts ?? [],
    });
  } catch (err) {
    next(err);
  }
});

router.post("/:id/claim", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const pa = await prisma.publicAnalysis.findUnique({ where: { id: req.params.id } });
    if (!pa) throw new HttpError(404, "NOT_FOUND", "Analysis not found");
    if (pa.claimedByUserId) {
      throw new HttpError(409, "ALREADY_CLAIMED", "This analysis has already been claimed");
    }
    if (!pa.repoId) {
      throw new HttpError(400, "NO_REPO", "No repository data to claim");
    }

    // Transfer the placeholder repo to the authenticated user
    await prisma.repository.update({
      where: { id: pa.repoId },
      data: { userId: req.userId! },
    });
    await prisma.publicAnalysis.update({
      where: { id: pa.id },
      data: { claimedByUserId: req.userId! },
    });

    ok(res, { repoId: pa.repoId, claimed: true });
  } catch (err) {
    next(err);
  }
});

const EXPLAIN_TIMEOUT_MS = 60_000;

interface FileExplanation {
  filePath?: string;
  summary?: string;
  sections?: { heading: string; text: string }[];
  questions?: { question: string; answer: string }[];
  citations?: { filePath: string; startLine: number; endLine: number }[];
  isDemo?: boolean;
}

/**
 * POST /:id/files/explain { path } — per-file explanation for anonymous
 * analyses (PRD-G02): cache-first, lazily generated, IP rate-limited against
 * click-spam (each miss triggers an LLM call).
 */
router.post(
  "/:id/files/explain",
  fileExplainRateLimit(),
  anonymousRateLimit("status"),
  async (req, res, next) => {
    try {
      const { path } = req.body as { path?: string };
      if (!path || typeof path !== "string") {
        throw new HttpError(400, "VALIDATION_ERROR", "path is required");
      }

      const pa = await prisma.publicAnalysis.findUnique({
        where: { id: req.params.id },
        select: { id: true, repoId: true, expiresAt: true },
      });
      if (!pa) throw new HttpError(404, "NOT_FOUND", "Analysis not found");
      if (pa.expiresAt && pa.expiresAt < new Date()) {
        throw new HttpError(410, "EXPIRED", "This analysis has expired");
      }
      if (!pa.repoId) {
        throw new HttpError(400, "NO_REPO", "No repository data for this analysis");
      }

      const artifactType = `file-explain:${path}`;
      const cached = await prisma.artifact.findFirst({
        where: { repoId: pa.repoId, artifactType },
        orderBy: { version: "desc" },
      });
      if (cached) {
        ok(res, { ...(cached.content as FileExplanation), cached: true });
        return;
      }

      let explanation: FileExplanation;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), EXPLAIN_TIMEOUT_MS);
      try {
        const genRes = await fetch(
          `${process.env.GENERATION_SERVICE_URL ?? "http://localhost:8300"}/file-explain`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ repoId: pa.repoId, filePath: path }),
            signal: controller.signal,
          }
        );
        if (!genRes.ok) {
          throw new HttpError(
            502,
            "GENERATION_FAILED",
            "File explanation generation failed — try again shortly"
          );
        }
        explanation = (await genRes.json()) as FileExplanation;
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

      await createArtifact(prisma, {
        repoId: pa.repoId,
        artifactType,
        content: explanation,
      });
      ok(res, { ...explanation, cached: false });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
