import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { simpleGit } from "simple-git";
import { PrismaClient } from "@vibe-coder/database";
import { Redis } from "ioredis";

const prisma = new PrismaClient();

const ANALYSIS_URL = process.env.ANALYSIS_SERVICE_URL ?? "http://localhost:8100";
const RETRIEVAL_URL = process.env.RETRIEVAL_SERVICE_URL ?? "http://localhost:8200";
const GENERATION_URL = process.env.GENERATION_SERVICE_URL ?? "http://localhost:8300";

interface AnalyzeRepoData {
  repoId: string;
  jobId: string;
  accessToken: string;
  fullName: string;
  defaultBranch: string;
}

const progressPublisher = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");

async function progress(jobId: string, stage: string, pct: number, message: string) {
  await prisma.analysisJob.update({
    where: { id: jobId },
    data: { stage, progress: pct },
  });
  await progressPublisher.publish(
    "analysis-progress",
    JSON.stringify({ jobId, stage, progress: pct, message })
  );
}

function maskToken(token: string): string {
  if (token.length <= 8) return "****";
  return token.slice(0, 4) + "****" + token.slice(-4);
}

export async function analyzeRepo(data: AnalyzeRepoData) {
  const { repoId, jobId, accessToken, fullName, defaultBranch } = data;
  let dir: string | null = null;

  try {
    await prisma.analysisJob.update({
      where: { id: jobId },
      data: { status: "RUNNING", startedAt: new Date() },
    });
    await prisma.repository.update({
      where: { id: repoId },
      data: { status: "PARSING" },
    });

    // 1. CLONE
    await progress(jobId, "CLONING", 5, "Cloning repository");
    dir = await mkdtemp(join(tmpdir(), "vibecoder-"));
    console.log(`[worker] Cloning ${fullName} to ${dir} (token: ${maskToken(accessToken)})`);
    await simpleGit().clone(
      `https://x-access-token:${accessToken}@github.com/${fullName}.git`,
      dir,
      ["--depth", "1"]
    );

    // 2. PARSE + CHUNK
    await progress(jobId, "PARSING", 20, "Parsing AST");
    const parseRes = await fetch(`${ANALYSIS_URL}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId, repoId, repoPath: dir, language: "auto" }),
    });
    const parsed = (await parseRes.json()) as {
      modules: { name: string; path: string; fileCount: number; lineCount: number }[];
      symbols: unknown[];
      chunks: { text: string; filePath: string; startLine: number; endLine: number }[];
    };
    if (!parseRes.ok) throw new Error("analysis service failed");

    for (const mod of parsed.modules) {
      await prisma.codeModule.upsert({
        where: { repoId_name: { repoId, name: mod.name } },
        update: { path: mod.path, fileCount: mod.fileCount, lineCount: mod.lineCount },
        create: { repoId, jobId, ...mod },
      });
    }

    // 3. INDEX
    await progress(jobId, "CHUNKING", 45, "Indexing code");
    await fetch(`${RETRIEVAL_URL}/index`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId, repoId, chunks: parsed.chunks }),
    });
    await progress(jobId, "EMBEDDING", 60, "Embedding vectors");

    // 4. GENERATE
    await progress(jobId, "GENERATING", 75, "Generating study artifacts");
    const artRes = await fetch(`${GENERATION_URL}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId, repoId, modules: parsed.modules }),
    });
    const artifacts = (await artRes.json()) as {
      type: string;
      content: Record<string, unknown>;
    }[];
    if (!artRes.ok) throw new Error("generation service failed");

    for (const artifact of artifacts) {
      await prisma.artifact.create({
        data: {
          repoId,
          jobId,
          artifactType: artifact.type,
          content: artifact.content as import("@vibe-coder/database").Prisma.InputJsonValue,
        },
      });
    }

    // 5. DONE
    await progress(jobId, "DONE", 100, "Analysis complete");
    await prisma.analysisJob.update({
      where: { id: jobId },
      data: { status: "SUCCEEDED", completedAt: new Date() },
    });
    await prisma.repository.update({
      where: { id: repoId },
      data: { status: "READY", lastAnalyzedAt: new Date() },
    });
  } catch (error) {
    console.error(`[worker] Analysis failed for job ${jobId}:`, error);
    await prisma.analysisJob.update({
      where: { id: jobId },
      data: {
        status: "FAILED",
        errorMessage: (error as Error).message,
        completedAt: new Date(),
      },
    });
    await prisma.repository.update({
      where: { id: repoId },
      data: { status: "FAILED" },
    });
    throw error;
  } finally {
    // Always clean up cloned repo directory
    if (dir) {
      try {
        await rm(dir, { recursive: true, force: true });
        console.log(`[worker] Cleaned up ${dir}`);
      } catch (cleanupErr) {
        console.warn(`[worker] Failed to clean up ${dir}:`, cleanupErr);
      }
    }
  }
}
