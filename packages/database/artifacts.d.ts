import type { PrismaClient } from "./generated/index";

export interface CreateArtifactInput {
  repoId: string;
  /** Omit or pass null for artifacts not tied to a specific analysis job. */
  jobId?: string | null;
  artifactType: string;
  /**
   * JSON-serializable content. Typed as `unknown` at the boundary — callers
   * are responsible for passing JSON-safe values, the runtime insert casts to
   * Prisma's InputJsonValue.
   */
  content: unknown;
}

/**
 * Appends a new version (max(existing) + 1) of `artifactType` for `repoId`.
 * Never inserts with version=1 blindly — that collides with existing rows on
 * any re-analysis (P2002) because the schema uniquely indexes
 * (repoId, artifactType, version).
 */
export function createArtifact(
  prisma: PrismaClient,
  input: CreateArtifactInput
): Promise<{ id: string; version: number }>;
