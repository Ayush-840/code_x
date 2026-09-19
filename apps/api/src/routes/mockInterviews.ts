import { Router } from "express";
import { prisma } from "../db";
import { config } from "../config";
import type { AuthedRequest } from "../middleware/auth";
import { HttpError, ok } from "../middleware/errors";

const router = Router();

const QUESTION_BANK = [
  {
    category: "architecture",
    question: "Walk me through the overall architecture of this project.",
  },
  {
    category: "data-modeling",
    question: "How is data modeled and how do the entities relate?",
  },
  {
    category: "api-design",
    question: "Walk me through the main API surface and its design choices.",
  },
  {
    category: "security",
    question: "How does authentication and authorization work here?",
  },
  {
    category: "performance",
    question: "What performance bottlenecks do you see and how would you fix them?",
  },
  {
    category: "devops",
    question: "How would you debug a production incident in this system?",
  },
];

router.post("/repos/:repoId/mock-interviews", async (req: AuthedRequest, res, next) => {
  try {
    const { persona = "friendly-senior", difficulty = "junior" } = req.body as {
      persona?: string;
      difficulty?: string;
    };
    const repo = await prisma.repository.findFirst({
      where: { id: req.params.repoId, userId: req.userId },
    });
    if (!repo) throw new HttpError(404, "NOT_FOUND", "Repository does not exist");

    const session = await prisma.mockInterviewSession.create({
      data: {
        userId: req.userId!,
        repoId: repo.id,
        persona,
        difficulty,
        status: "IN_PROGRESS",
      },
    });

    const question = QUESTION_BANK[0];
    await prisma.mockInterviewQuestion.create({
      data: {
        sessionId: session.id,
        questionText: question.question,
        citations: [],
      },
    });

    ok(
      res,
      {
        sessionId: session.id,
        persona,
        difficulty,
        totalQuestions: QUESTION_BANK.length,
        currentQuestion: { ...question, questionNumber: 1 },
      },
      201
    );
  } catch (err) {
    next(err);
  }
});

router.get("/mock-interviews", async (req: AuthedRequest, res, next) => {
  try {
    const sessions = await prisma.mockInterviewSession.findMany({
      where: { userId: req.userId },
      include: { _count: { select: { questions: true } } },
      orderBy: { startedAt: "desc" },
    });
    ok(res, sessions);
  } catch (err) {
    next(err);
  }
});

router.get("/mock-interviews/:sessionId", async (req: AuthedRequest, res, next) => {
  try {
    const session = await prisma.mockInterviewSession.findFirst({
      where: { id: req.params.sessionId, userId: req.userId },
      include: { questions: { orderBy: { createdAt: "asc" } } },
    });
    if (!session) throw new HttpError(404, "NOT_FOUND", "Session does not exist");
    ok(res, session);
  } catch (err) {
    next(err);
  }
});

router.post("/mock-interviews/:sessionId/answer", async (req: AuthedRequest, res, next) => {
  try {
    const { questionId, answer, timeSpentSec } = req.body as {
      questionId?: string;
      answer?: string;
      timeSpentSec?: number;
    };
    if (!questionId || !answer) {
      throw new HttpError(400, "VALIDATION_ERROR", "questionId and answer are required");
    }
    const session = await prisma.mockInterviewSession.findFirst({
      where: { id: req.params.sessionId, userId: req.userId },
    });
    if (!session) throw new HttpError(404, "NOT_FOUND", "Session does not exist");

    // Score via the mock-interview engine (demo scoring when it's absent).
    let scores = { overall: 70, clarity: 70, depth: 70, specificity: 70, confidence: 70 };
    let feedback = "Well structured answer.";
    try {
      const resp = await fetch(`${config.mockInterviewServiceUrl}/sessions/${session.id}/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: session.id, questionId, answer, timeSpentSec: timeSpentSec ?? 0 }),
      });
      if (resp.ok) {
        const body = (await resp.json()) as { scores: typeof scores; feedback: string };
        scores = body.scores;
        feedback = body.feedback;
      }
    } catch {
      // keep demo defaults
    }

    const overall = scores.overall;
    const specificity = scores.specificity;
    await prisma.mockInterviewQuestion.update({
      where: { id: questionId },
      data: {
        answerText: answer,
        score: overall,
        feedback,
        timeSpentSec: timeSpentSec ?? 0,
      },
    });
    await prisma.mockInterviewSession.update({
      where: { id: session.id },
      data: {
        scoreOverall: overall,
        scoreClarity: scores.clarity,
        scoreDepth: scores.depth,
        scoreSpecificity: specificity,
      },
    });

    ok(res, { questionId, scores, feedback });
  } catch (err) {
    next(err);
  }
});

router.post("/mock-interviews/:sessionId/next", async (req: AuthedRequest, res, next) => {
  try {
    const session = await prisma.mockInterviewSession.findFirst({
      where: { id: req.params.sessionId, userId: req.userId },
      include: { questions: { orderBy: { createdAt: "asc" } } },
    });
    if (!session) throw new HttpError(404, "NOT_FOUND", "Session does not exist");

    const answered = session.questions.filter((q) => q.answerText);
    const index = answered.length;
    if (index >= QUESTION_BANK.length) {
      ok(res, { done: true, message: "No more questions" });
      return;
    }
    const question = await prisma.mockInterviewQuestion.create({
      data: {
        sessionId: session.id,
        questionText: QUESTION_BANK[index].question,
        citations: [],
      },
    });
    ok(res, {
      questionId: question.id,
      questionText: question.questionText,
      category: QUESTION_BANK[index].category,
      questionNumber: index + 1,
      totalQuestions: QUESTION_BANK.length,
    });
  } catch (err) {
    next(err);
  }
});

router.post("/mock-interviews/:sessionId/complete", async (req: AuthedRequest, res, next) => {
  try {
    const session = await prisma.mockInterviewSession.findFirst({
      where: { id: req.params.sessionId, userId: req.userId },
      include: { questions: true, repo: true },
    });
    if (!session) throw new HttpError(404, "NOT_FOUND", "Session does not exist");

    const answered = session.questions.filter((q) => q.answerText);
    const average =
      answered.length > 0
        ? answered.reduce((acc, q) => acc + (q.score ?? 0), 0) / answered.length
        : 0;

    const completed = await prisma.mockInterviewSession.update({
      where: { id: session.id },
      data: { status: "COMPLETED", completedAt: new Date(), scoreOverall: Math.round(average) },
    });

    ok(res, {
      session: completed,
      report: {
        overallScore: Math.round(average),
        strengths: ["Answer structure", "Technical grounding"],
        gaps: answered.length < 3 ? ["Answer depth", "Specific file references"] : [],
        studySuggestions: [
          `Review ${session.repo.fullName} modules before the real interview`,
        ],
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;