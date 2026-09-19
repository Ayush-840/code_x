import { Router } from "express";
import { prisma } from "../db";
import type { AuthedRequest } from "../middleware/auth";
import { HttpError, ok } from "../middleware/errors";

const router = Router();

router.get("/summary", async (req: AuthedRequest, res, next) => {
  try {
    const subscription = await prisma.subscription.findFirst({
      where: { userId: req.userId },
    });
    if (!subscription) throw new HttpError(404, "NOT_FOUND", "No subscription found");

    const [repos, messages, mockInterviews] = await Promise.all([
      prisma.repository.count({ where: { userId: req.userId } }),
      prisma.chatMessage.count({
        where: { session: { userId: req.userId } },
      }),
      prisma.mockInterviewSession.count({ where: { userId: req.userId } }),
    ]);

    ok(res, {
      planTier: subscription.planTier,
      reposUsed: repos,
      reposRemaining: subscription.reposRemaining,
      messagesUsed: messages,
      chatsRemaining: subscription.chatsRemaining,
      mockInterviewsUsed: mockInterviews,
      mockInterviewsRemaining: subscription.mockInterviewsRemaining,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/events", async (_req: AuthedRequest, res) => {
  // Full event history is recorded by the analysis pipeline on production;
  // the demo returns an empty list.
  ok(res, []);
});

export default router;