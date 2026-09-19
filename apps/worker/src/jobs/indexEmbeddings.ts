import { Redis } from "ioredis";
import { PrismaClient } from "@vibe-coder/database";

const prisma = new PrismaClient();
const publisher = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");

/**
 * Standalone dense-embedding job. Enqueued as a follow-up when a repo is large
 * enough to warrant splitting indexing from the main analyze-repo job.
 */
export async function indexEmbeddings(jobId: string, repoId: string, chunks: unknown[]): Promise<void> {
  const RETRIEVAL_URL = process.env.RETRIEVAL_SERVICE_URL ?? "http://localhost:8200";
  const resp = await fetch(`${RETRIEVAL_URL}/index-dense`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobId, repoId, chunks }),
  });
  await publisher.publish(
    "analysis-progress",
    JSON.stringify({ jobId, repoId, stage: "EMBEDDING", progress: 60, message: "Embedding vectors" })
  );
  if (!resp.ok) {
    throw new Error("dense index failed");
  }
  await prisma.$disconnect();
}