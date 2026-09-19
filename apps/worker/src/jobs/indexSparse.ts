import { Redis } from "ioredis";
import { PrismaClient } from "@vibe-coder/database";

const prisma = new PrismaClient();

/**
 * Standalone sparse (BM25) indexing job against OpenSearch.
 */
export async function indexSparse(jobId: string, repoId: string, chunks: unknown[]): Promise<void> {
  const RETRIEVAL_URL = process.env.RETRIEVAL_SERVICE_URL ?? "http://localhost:8200";
  const resp = await fetch(`${RETRIEVAL_URL}/index-sparse`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobId, repoId, chunks }),
  });
  await new Redis(process.env.REDIS_URL ?? "redis://localhost:6379").publish(
    "analysis-progress",
    JSON.stringify({ jobId, repoId, stage: "SPARSE", progress: 70, message: "Building sparse index" })
  );
  if (!resp.ok) {
    throw new Error("sparse index failed");
  }
  await prisma.$disconnect();
}