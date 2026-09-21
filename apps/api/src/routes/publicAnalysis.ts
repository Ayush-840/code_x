import { Router } from "express";
import { Octokit } from "octokit";
import { prisma } from "../db";
import { analysisQueue } from "../redis";
import { HttpError, ok } from "../middleware/errors";
import { notifyProgress } from "../services/analysis";
import { anonymousRateLimit } from "../middleware/rateLimit";
import { requireAuth, type AuthedRequest } from "../middleware/auth";

const router = Router();

function parseRepoUrl(url: string): { owner: string; repo: string } {
  const match = url.match(/github\.com[/:]([^/]+)\/([^.#/?]+)(?:\.git)?/);
  if (!match) {
    throw new HttpError(400, "INVALID_GITHUB_URL", "Provided URL is not a valid GitHub repository URL");
  }
  return { owner: match[1], repo: match[2] };
}

const ANON_USER_ID = "00000000-0000-0000-0000-000000000000";

router.post("/analyze", anonymousRateLimit("analyze"), async (req, res, next) => {
  try {
    const { repoUrl } = req.body as { repoUrl?: string };
    if (!repoUrl) {
      throw new HttpError(400, "VALIDATION_ERROR", "repoUrl is required");
    }
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
      if (status === 404) {
        throw new HttpError(404, "REPO_NOT_FOUND", `Repository ${fullName} not found. Check the URL.`);
      }
      if (ghErr instanceof HttpError) throw ghErr;
      throw new HttpError(502, "GITHUB_API_ERROR", `GitHub API error: ${ghErr?.message ?? "unknown"}`);
    }

    const recent = await prisma.publicAnalysis.findFirst({
      where: { fullName, status: { in: ["PARSING", "INDEXING", "GENERATING", "READY"] } },
      orderBy: { createdAt: "desc" },
    });
    if (recent && recent.status === "READY") {
      ok(res, { id: recent.id, status: "READY", cached: true }, 200);
      return;
    }
    if (recent && recent.status !== "FAILED") {
      ok(res, { id: recent.id, status: recent.status, cached: false }, 202);
      return;
    }

    const placeholderRepo = await prisma.repository.create({
      data: {
        userId: ANON_USER_ID,
        fullName,
        defaultBranch,
        status: "PENDING",
      },
    });

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

export default router;
