import { Router } from "express";
import { prisma } from "../db";
import { config } from "../config";
import type { AuthedRequest } from "../middleware/auth";
import { HttpError, ok } from "../middleware/errors";

const router = Router();

router.post("/repos/:repoId/chat/sessions", async (req: AuthedRequest, res, next) => {
  try {
    const { title } = req.body as { title?: string };
    const repo = await prisma.repository.findFirst({
      where: { id: req.params.repoId, userId: req.userId },
    });
    if (!repo) throw new HttpError(404, "NOT_FOUND", "Repository does not exist");
    const session = await prisma.chatSession.create({
      data: {
        userId: req.userId!,
        repoId: repo.id,
        title: title ?? `Chat about ${repo.fullName}`,
      },
    });
    ok(res, session, 201);
  } catch (err) {
    next(err);
  }
});

router.get("/repos/:repoId/chat/sessions", async (req: AuthedRequest, res, next) => {
  try {
    const sessions = await prisma.chatSession.findMany({
      where: { repoId: req.params.repoId, userId: req.userId },
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { messages: true } } },
    });
    ok(res, sessions);
  } catch (err) {
    next(err);
  }
});

router.get("/sessions/:sessionId", async (req: AuthedRequest, res, next) => {
  try {
    const session = await prisma.chatSession.findFirst({
      where: { id: req.params.sessionId, userId: req.userId },
    });
    if (!session) throw new HttpError(404, "NOT_FOUND", "Session does not exist");
    ok(res, session);
  } catch (err) {
    next(err);
  }
});

router.get("/sessions/:sessionId/messages", async (req: AuthedRequest, res, next) => {
  try {
    const session = await prisma.chatSession.findFirst({
      where: { id: req.params.sessionId, userId: req.userId },
    });
    if (!session) throw new HttpError(404, "NOT_FOUND", "Session does not exist");
    const messages = await prisma.chatMessage.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: "asc" },
    });
    ok(res, messages);
  } catch (err) {
    next(err);
  }
});

router.post("/sessions/:sessionId/messages", async (req: AuthedRequest, res, next) => {
  try {
    const { content } = req.body as { content?: string };
    if (!content?.trim()) {
      throw new HttpError(400, "VALIDATION_ERROR", "content is required");
    }
    const session = await prisma.chatSession.findFirst({
      where: { id: req.params.sessionId, userId: req.userId },
    });
    if (!session) throw new HttpError(404, "NOT_FOUND", "Session does not exist");

    const userMessage = await prisma.chatMessage.create({
      data: { sessionId: session.id, role: "user", content },
    });

    const genRes = await fetch(`${config.generationServiceUrl}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repoId: session.repoId, query: content }),
    });
    let answer: string;
    let citations: unknown[] = [];
    if (genRes.ok) {
      const body = (await genRes.json()) as { message: string; citations: unknown[] };
      answer = body.message;
      citations = body.citations;
    } else {
      answer = "The generation service is unavailable right now. Please try again.";
    }

    const assistantMessage = await prisma.chatMessage.create({
      data: {
        sessionId: session.id,
        role: "assistant",
        content: answer,
        citations: citations as import("@vibe-coder/database").Prisma.InputJsonValue,
      },
    });

    ok(res, { user: userMessage, assistant: assistantMessage }, 201);
  } catch (err) {
    next(err);
  }
});

export default router;