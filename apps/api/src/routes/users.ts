import { Router } from "express";
import { prisma } from "../db";
import type { AuthedRequest } from "../middleware/auth";
import { HttpError, ok } from "../middleware/errors";

const router = Router();

router.get("/me", async (req: AuthedRequest, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
    });
    if (!user) throw new HttpError(404, "NOT_FOUND", "User does not exist");
    ok(res, user);
  } catch (err) {
    next(err);
  }
});

router.patch("/me", async (req: AuthedRequest, res, next) => {
  try {
    const { username, email, avatarUrl } = req.body as {
      username?: string;
      email?: string;
      avatarUrl?: string;
    };
    const user = await prisma.user.update({
      where: { id: req.userId },
      data: {
        ...(username ? { username } : {}),
        ...(typeof email === "string" ? { email } : {}),
        ...(avatarUrl ? { avatarUrl } : {}),
      },
    });
    ok(res, user);
  } catch (err) {
    next(err);
  }
});

router.get("/me/subscription", async (req: AuthedRequest, res, next) => {
  try {
    const subscription = await prisma.subscription.findFirst({
      where: { userId: req.userId },
    });
    if (!subscription) {
      throw new HttpError(404, "NOT_FOUND", "No subscription found");
    }
    ok(res, subscription);
  } catch (err) {
    next(err);
  }
});

export default router;