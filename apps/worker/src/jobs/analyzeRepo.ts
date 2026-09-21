import { mkdtemp, rm, readdir, readFile } from "node:fs/promises";
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
  accessToken?: string;
  fullName: string;
  defaultBranch: string;
  publicAnalysisId?: string;
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

function computeReadingOrder(
  modules: { name: string; path: string; fileCount: number; lineCount: number }[]
): Map<string, number> {
  const sorted = [...modules].sort((a, b) => {
    const depthA = a.path.split("/").length;
    const depthB = b.path.split("/").length;
    if (depthA !== depthB) return depthA - depthB;
    return a.name.localeCompare(b.name);
  });
  const order = new Map<string, number>();
  sorted.forEach((mod, i) => order.set(mod.name, i));
  return order;
}

const DEPLOY_FILES = [
  "Dockerfile", "docker-compose.yml", "docker-compose.yaml",
  "vercel.json", "netlify.toml", "railway.toml", "render.yaml",
  "fly.toml", "app.json", "Procfile", "Makefile",
  ".github/workflows", "k8s", "kubernetes",
  "terraform", "main.tf", "variables.tf",
  "serverless.yml", "serverless.yaml",
];

async function detectDeployment(repoPath: string): Promise<Record<string, unknown> | null> {
  const detected: Record<string, unknown> = {};

  async function walk(dir: string, prefix: string) {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        // Match either a bare name ("k8s") or a repo-relative path (".github/workflows").
        if (DEPLOY_FILES.includes(entry.name) || DEPLOY_FILES.includes(rel)) {
          detected[rel] = { type: "directory" };
        }
        // Recurse into dot-directories too: .github/workflows, .platform,
        // .railway and friends are deployment config and belong in the scan.
        if (entry.name !== "node_modules" && entry.name !== "__pycache__" && entry.name !== ".git") {
          await walk(join(dir, entry.name), rel);
        }
      } else {
        if (DEPLOY_FILES.includes(entry.name)) {
          try {
            const content = await readFile(join(dir, entry.name), "utf-8");
            detected[rel] = { type: "file", preview: content.slice(0, 500) };
          } catch {
            detected[rel] = { type: "file" };
          }
        }
      }
    }
  }

  await walk(repoPath, "");
  return Object.keys(detected).length > 0 ? detected : null;
}

const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".ico", ".webp", ".svg", ".bmp", ".tiff",
  ".pdf", ".zip", ".gz", ".tgz", ".tar", ".bz2", ".7z", ".rar",
  ".mp3", ".mp4", ".mov", ".avi", ".webm", ".wav", ".ogg",
  ".woff", ".woff2", ".ttf", ".otf", ".eot",
  ".exe", ".dll", ".so", ".dylib", ".bin", ".wasm",
  ".db", ".sqlite", ".sqlite3", ".pyc", ".class", ".jar",
]);

const MAX_FILE_BYTES = 512 * 1024; // 512 KB per file
const MAX_TOTAL_FILES = 5000;

async function collectSourceFiles(repoPath: string): Promise<{ path: string; content: string }[]> {
  const out: { path: string; content: string }[] = [];

  async function walk(dir: string, prefix: string) {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (out.length >= MAX_TOTAL_FILES) return;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === "__pycache__" || entry.name === ".git") continue;
        await walk(join(dir, entry.name), rel);
      } else if (entry.isFile()) {
        if (entry.name.startsWith(".")) {
          // Keep dotfiles that are meaningful config; skip others (e.g. .DS_Store).
          const kept = [".env.example", ".dockerignore", ".editorconfig", ".gitlab-ci.yml"];
          if (!kept.includes(entry.name) && !DEPLOY_FILES.includes(entry.name)) continue;
        }
        const ext = entry.name.slice(entry.name.lastIndexOf(".")).toLowerCase();
        if (BINARY_EXTENSIONS.has(ext)) continue;
        try {
          const stat = await import("node:fs/promises").then((m) => m.stat(join(dir, entry.name)));
          if (stat.size > MAX_FILE_BYTES) continue;
          const content = await readFile(join(dir, entry.name), "utf-8");
          // Heuristic binary sniff: NUL byte in the first 1 KB → not source.
          if (content.slice(0, 1024).includes("\u0000")) continue;
          out.push({ path: rel, content });
        } catch {
          // unreadable file — skip
        }
      }
    }
  }

  await walk(repoPath, "");
  return out;
}

export async function analyzeRepo(data: AnalyzeRepoData) {
  const { repoId, jobId, accessToken, fullName, defaultBranch, publicAnalysisId } = data;
  let dir: string | null = null;

  try {
    await prisma.analysisJob.update({
      where: { id: jobId },
      data: { status: "RUNNING", startedAt: new Date() },
    });

    // For public analyses, the API creates a placeholder Repository;
    // we just update its status here. For authed analyses, update the
    // existing repo.
    if (publicAnalysisId) {
      await prisma.repository.update({
        where: { id: repoId },
        data: { status: "PARSING" },
      });
      await prisma.publicAnalysis.update({
        where: { id: publicAnalysisId },
        data: { status: "PARSING" },
      });
    } else {
      await prisma.repository.update({
        where: { id: repoId },
        data: { status: "PARSING" },
      });
    }

    // 1. CLONE
    await progress(jobId, "CLONING", 5, "Cloning repository");
    dir = await mkdtemp(join(tmpdir(), "vibecoder-"));

    const cloneUrl = accessToken
      ? `https://x-access-token:${accessToken}@github.com/${fullName}.git`
      : `https://github.com/${fullName}.git`;

    console.log(`[worker] Cloning ${fullName} to ${dir} (token: ${accessToken ? maskToken(accessToken) : "none"})`);
    await simpleGit().clone(cloneUrl, dir, ["--depth", "1"]);

    // 1b. DEPLOYMENT DETECTION (PRD-A05)
    const deploymentInfo = await detectDeployment(dir);

    // Collect file contents for the analysis service: it runs in a different
    // container on Railway, so a local path is invisible to it. Only ship
    // text-ish source files, skipping binaries and oversized files.
    const files = await collectSourceFiles(dir);

    // 2. PARSE + CHUNK
    await progress(jobId, "PARSING", 20, "Parsing AST");
    const parseRes = await fetch(`${ANALYSIS_URL}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId, repoId, files, language: "auto" }),
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

    // 2b. READING ORDER (PRD-A04)
    const readingOrder = computeReadingOrder(parsed.modules);
    for (const [name, idx] of readingOrder) {
      await prisma.codeModule.updateMany({
        where: { repoId, name },
        data: { readingOrderIndex: idx },
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
      body: JSON.stringify({ jobId, repoId: repoId, modules: parsed.modules }),
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

    // 4b. SAVE DEPLOYMENT ARTIFACT (PRD-A05) — always written: an empty map
    // is the explicit "no deployment config found" state (rendered as an
    // honest empty state in the tab), never a hallucinated guess.
    await prisma.artifact.create({
      data: {
        repoId,
        jobId,
        artifactType: "deployment",
        content: (deploymentInfo ?? {}) as import("@vibe-coder/database").Prisma.InputJsonValue,
      },
    });

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
    if (publicAnalysisId) {
      await prisma.publicAnalysis.update({
        where: { id: publicAnalysisId },
        data: { status: "READY" },
      });
    }
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
    if (publicAnalysisId) {
      await prisma.publicAnalysis.update({
        where: { id: publicAnalysisId },
        data: { status: "FAILED" },
      });
    } else {
      await prisma.repository.update({
        where: { id: repoId },
        data: { status: "FAILED" },
      });
    }
    throw error;
  } finally {
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
