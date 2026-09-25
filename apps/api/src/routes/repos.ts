import { Router } from "express";
import { Octokit } from "octokit";
import { prisma } from "../db";
import { analysisQueue } from "../redis";
import type { AuthedRequest } from "../middleware/auth";
import { HttpError, ok } from "../middleware/errors";
import { notifyProgress } from "../services/analysis";
import { assertAnalysisReady } from "../services/readiness";

const router = Router();

function parseRepoUrl(url: string): { owner: string; repo: string } {
  const match = url.match(/github\.com[/:]([^/]+)\/([^.#/?]+)(?:\.git)?/);
  if (!match) {
    throw new HttpError(400, "INVALID_GITHUB_URL", "Provided URL is not a valid GitHub repository");
  }
  return { owner: match[1], repo: match[2] };
}

router.post("/connect", async (req: AuthedRequest, res, next) => {
  try {
    const { repoUrl, accessToken } = req.body as {
      repoUrl?: string;
      accessToken?: string;
    };
    if (!repoUrl || !accessToken) {
      throw new HttpError(400, "VALIDATION_ERROR", "repoUrl and accessToken are required");
    }
    const { owner, repo } = parseRepoUrl(repoUrl);

    // Quota fail-fast (was UI-only): check before any GitHub call so an
    // over-quota user gets an instant 403 instead of a slow GitHub round-trip.
    // The old flow never decremented reposRemaining — and delete never
    // restored it — so the dashboard showed "Repo limit reached" forever
    // while the API happily accepted unlimited connects.
    const quotaMessage = "Repo limit reached for your plan. Delete a repo to free up quota.";
    let subscription = await prisma.subscription.findFirst({
      where: { userId: req.userId! },
    });
    if (!subscription) {
      subscription = await prisma.subscription.create({ data: { userId: req.userId! } });
    }
    if (subscription.reposRemaining <= 0) {
      throw new HttpError(403, "QUOTA_EXCEEDED", quotaMessage);
    }

    const octokit = new Octokit({ auth: accessToken });
    let gh;
    let primaryLang: string | null = null;
    try {
      gh = await octokit.rest.repos.get({ owner, repo });
      // Same try/catch as repos.get: a rate-limited/scope-denied languages
      // call used to escape as a raw 500 instead of a mapped GitHub error.
      const languages = await octokit.rest.repos.listLanguages({ owner, repo });
      primaryLang =
        Object.entries(languages.data).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    } catch (ghErr: any) {
      const status = ghErr?.status ?? ghErr?.response?.status;
      if (status === 401) {
        throw new HttpError(401, "INVALID_TOKEN", "GitHub token is invalid or expired");
      }
      if (status === 404) {
        throw new HttpError(404, "REPO_NOT_FOUND", `Repository ${owner}/${repo} not found. Check the URL and token permissions.`);
      }
      if (status === 403 || status === 429) {
        // 403 from GitHub covers both rate limiting and scope/SAML denials —
        // "Resource not accessible by personal access token" used to surface
        // as a generic 502 that looked like an outage.
        const remaining = ghErr?.response?.headers?.["x-ratelimit-remaining"];
        const rateLimited = status === 429 || remaining === "0" || remaining === 0;
        if (rateLimited) {
          throw new HttpError(429, "GITHUB_RATE_LIMITED", "GitHub rate limit hit — wait a few minutes and try again.");
        }
        throw new HttpError(403, "GITHUB_FORBIDDEN", `GitHub denied access — make sure the token has \`repo\` scope for ${owner}/${repo}.`);
      }
      throw new HttpError(502, "GITHUB_API_ERROR", `GitHub API error: ${ghErr?.message ?? "unknown"}`);
    }

    const fullName = `${owner}/${repo}`;
    const existing = await prisma.repository.findUnique({
      where: { userId_fullName: { userId: req.userId!, fullName } },
    });
    if (existing) {
      throw new HttpError(409, "REPO_ALREADY_CONNECTED", "Repository is already connected to this account");
    }

    // Reserve the quota slot with an atomic conditional decrement — the
    // re-check on reposRemaining closes the race with a concurrent connect.
    const reserved = await prisma.subscription.updateMany({
      where: { id: subscription.id, reposRemaining: { gt: 0 } },
      data: { reposRemaining: { decrement: 1 } },
    });
    if (reserved.count === 0) {
      throw new HttpError(403, "QUOTA_EXCEEDED", quotaMessage);
    }

    let repository;
    try {
      repository = await prisma.repository.create({
        data: {
          userId: req.userId!,
          fullName,
          // Empty repos return "" — store the schema default instead.
          defaultBranch: gh.data.default_branch || "main",
          primaryLanguage: primaryLang,
        },
      });
    } catch (createErr) {
      // Release the reservation on any create failure (e.g. the unique
      // userId_fullName constraint racing a concurrent connect).
      await prisma.subscription.updateMany({
        where: { id: subscription.id },
        data: { reposRemaining: { increment: 1 } },
      });
      if ((createErr as { code?: string })?.code === "P2002") {
        throw new HttpError(409, "REPO_ALREADY_CONNECTED", "Repository is already connected to this account");
      }
      throw createErr;
    }

    ok(res, repository, 201);
  } catch (err) {
    next(err);
  }
});

router.get("/", async (req: AuthedRequest, res, next) => {
  try {
    const repos = await prisma.repository.findMany({
      where: { userId: req.userId },
      orderBy: { createdAt: "desc" },
    });
    ok(res, repos);
  } catch (err) {
    next(err);
  }
});

router.get("/:repoId", async (req: AuthedRequest, res, next) => {
  try {
    const repo = await prisma.repository.findFirst({
      where: { id: req.params.repoId, userId: req.userId },
      include: { analysisJobs: { orderBy: { createdAt: "desc" }, take: 1 } },
    });
    if (!repo) throw new HttpError(404, "NOT_FOUND", "Repository does not exist");
    ok(res, repo);
  } catch (err) {
    next(err);
  }
});

router.get("/:repoId/status", async (req: AuthedRequest, res, next) => {
  try {
    const job = await prisma.analysisJob.findFirst({
      where: { repoId: req.params.repoId },
      orderBy: { createdAt: "desc" },
    });
    if (!job) throw new HttpError(404, "NOT_FOUND", "No analysis job found");
    ok(res, job);
  } catch (err) {
    next(err);
  }
});

router.post("/:repoId/analyze", async (req: AuthedRequest, res, next) => {
  try {
    const { accessToken } = req.body as { accessToken?: string };
    if (!accessToken) {
      throw new HttpError(400, "VALIDATION_ERROR", "accessToken is required");
    }

    // Same readiness gate as the anonymous flow — degrade honestly (503)
    // instead of accepting a job we can't run.
    await assertAnalysisReady();

    const repo = await prisma.repository.findFirst({
      where: { id: req.params.repoId, userId: req.userId },
      include: {
        analysisJobs: { where: { status: { in: ["QUEUED", "RUNNING"] } } },
      },
    });
    if (!repo) throw new HttpError(404, "NOT_FOUND", "Repository does not exist");
    if (repo.analysisJobs.length > 0) {
      throw new HttpError(409, "ANALYSIS_IN_PROGRESS", "An analysis job is already running for this repo");
    }

    const job = await prisma.analysisJob.create({
      data: { repoId: repo.id, status: "QUEUED" },
    });

    await notifyProgress(job.id, "CLONING", 0, "Queued for analysis");

    await analysisQueue.add("analyze-repo", {
      repoId: repo.id,
      jobId: job.id,
      accessToken,
      fullName: repo.fullName,
      defaultBranch: repo.defaultBranch,
    });

    ok(res, { jobId: job.id, repoId: repo.id, status: "QUEUED" }, 202);
  } catch (err) {
    next(err);
  }
});

router.delete("/:repoId", async (req: AuthedRequest, res, next) => {
  try {
    const deleted = await prisma.repository.deleteMany({
      where: { id: req.params.repoId, userId: req.userId },
    });
    if (deleted.count === 0) {
      throw new HttpError(404, "NOT_FOUND", "Repository does not exist");
    }
    // Freeing a repo must free its quota slot (the dashboard promises this);
    // without it, one failed connect locked the account out forever.
    await prisma.subscription.updateMany({
      where: { userId: req.userId },
      data: { reposRemaining: { increment: 1 } },
    });
    ok(res, { deleted: true });
  } catch (err) {
    next(err);
  }
});

export default router;