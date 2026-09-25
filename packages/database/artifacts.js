/**
 * Versioned insert for the Artifact table.
 *
 * The schema enforces @@unique([repoId, artifactType, version]) and every
 * reader (apps/api artifacts.ts / fileExplain.ts / publicAnalysis.ts) fetches
 * `orderBy: { version: "desc" }` and takes the first row. Inserting with the
 * default version=1 therefore crashes any *re-*analysis of the same repo with
 * P2002 ("Unique constraint failed on the fields: (`repoId`,`artifactType`,
 * `version`)") — observed live 2026-09-25. New content must always be
 * appended as max(version)+1 for the (repoId, artifactType) pair, which is
 * what this helper does atomically-enough for single-process workers: the
 * read-then-write window is per (repoId, artifactType) and the unique
 * constraint remains the backstop that surfaces any real race as an error
 * instead of silent data loss.
 *
 * Plain JS at the package root, same as migrations.js, so both tsx (dev) and
 * compiled dist/ (prod) can require it with zero build step.
 */

/**
 * @param {import("./generated/index").PrismaClient} prisma
 * @param {{
 *   repoId: string,
 *   jobId?: string | null,
 *   artifactType: string,
 *   content: unknown,
 * }} input
 * @returns {Promise<{ id: string, version: number }>}
 */
async function createArtifact(prisma, { repoId, jobId, artifactType, content }) {
  const latest = await prisma.artifact.findFirst({
    where: { repoId, artifactType },
    orderBy: { version: "desc" },
    select: { version: true },
  });
  return prisma.artifact.create({
    data: {
      repoId,
      ...(jobId != null ? { jobId } : {}),
      artifactType,
      content,
      version: (latest?.version ?? 0) + 1,
    },
  });
}

module.exports = { createArtifact };
