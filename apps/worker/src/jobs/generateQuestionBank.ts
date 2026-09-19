import { Redis } from "ioredis";

/**
 * Regenerates the question bank artifact for a repo.
 */
export async function generateQuestionBank(jobId: string, repoId: string, modules: unknown[]): Promise<void> {
  const GENERATION_URL = process.env.GENERATION_SERVICE_URL ?? "http://localhost:8300";
  const resp = await fetch(`${GENERATION_URL}/questions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobId, repoId, modules }),
  });
  if (!resp.ok) {
    throw new Error("question generation failed");
  }
  await new Redis(process.env.REDIS_URL ?? "redis://localhost:6379").publish(
    "analysis-progress",
    JSON.stringify({ jobId, repoId, stage: "GENERATING", progress: 90, message: "Preparing question bank" })
  );
}