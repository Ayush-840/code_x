import { Router } from "express";
import { prisma } from "../db";
import type { AuthedRequest } from "../middleware/auth";
import { HttpError, ok } from "../middleware/errors";

const router = Router();

router.get("/:repoId/artifacts", async (req: AuthedRequest, res, next) => {
  try {
    const artifacts = await prisma.artifact.findMany({
      where: { repoId: req.params.repoId },
      orderBy: { version: "desc" },
    });
    ok(res, artifacts);
  } catch (err) {
    next(err);
  }
});

router.get(
  "/:repoId/:artifactType(architecture|modules|questions|dependency-graph)",
  async (req: AuthedRequest, res, next) => {
    try {
      const artifact = await prisma.artifact.findFirst({
        where: { repoId: req.params.repoId, artifactType: req.params.artifactType },
        orderBy: { version: "desc" },
      });
      if (!artifact) {
        throw new HttpError(404, "NOT_FOUND", `No ${req.params.artifactType} artifact yet`);
      }
      ok(res, artifact);
    } catch (err) {
      next(err);
    }
  }
);

router.get("/:repoId/modules", async (req: AuthedRequest, res, next) => {
  try {
    const modules = await prisma.codeModule.findMany({
      where: { repoId: req.params.repoId },
      orderBy: { name: "asc" },
    });
    ok(res, modules);
  } catch (err) {
    next(err);
  }
});

router.get("/:repoId/modules/:moduleId", async (req: AuthedRequest, res, next) => {
  try {
    const mod = await prisma.codeModule.findFirst({
      where: { id: req.params.moduleId, repoId: req.params.repoId },
      include: { symbols: true },
    });
    if (!mod) throw new HttpError(404, "NOT_FOUND", "Module does not exist");
    ok(res, mod);
  } catch (err) {
    next(err);
  }
});

router.get("/:repoId/questions", async (req: AuthedRequest, res, next) => {
  try {
    const artifact = await prisma.artifact.findFirst({
      where: { repoId: req.params.repoId, artifactType: "questions" },
      orderBy: { version: "desc" },
    });
    if (!artifact) throw new HttpError(404, "NOT_FOUND", "No question bank yet");
    ok(res, artifact.content);
  } catch (err) {
    next(err);
  }
});

export default router;