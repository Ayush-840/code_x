import { PrismaClient } from "@vibe-coder/database";

const prisma = new PrismaClient();

/**
 * Regenerates the architecture / modules artifacts on demand (re-analysis
 * triggered by the user or a push webhook).
 */
export async function generateArtifacts(
  jobId: string,
  repoId: string,
  modules: unknown[]
): Promise<void> {
  const GENERATION_URL = process.env.GENERATION_SERVICE_URL ?? "http://localhost:8300";
  const resp = await fetch(`${GENERATION_URL}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobId, repoId, modules }),
  });
  if (!resp.ok) {
    throw new Error("generation failed");
  }
  const artifacts = (await resp.json()) as { type: string; content: Record<string, unknown> }[];
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
  await prisma.$disconnect();
}