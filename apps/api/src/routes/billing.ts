import { Router } from "express";
import { prisma } from "../db";
import { config } from "../config";
import type { AuthedRequest, AuthedRequest as _AuthedRequest } from "../middleware/auth";
import { HttpError, ok } from "../middleware/errors";

const router = Router();

router.post("/checkout", async (req: AuthedRequest, res, next) => {
  try {
    if (!config.stripeSecretKey) {
      throw new HttpError(400, "VALIDATION_ERROR", "Billing is not configured in this environment");
    }
    const { planTier } = req.body as { planTier?: string };
    const subscription = await prisma.subscription.findFirst({ where: { userId: req.userId } });
    if (!subscription) throw new HttpError(404, "NOT_FOUND", "No subscription found");

    // Stripe Checkout placeholder — wire price IDs from your dashboard here.
    const StripeModule = await import("stripe");
    const stripe = new (StripeModule.default as any)(config.stripeSecretKey);
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: String(planTier ?? "starter"), quantity: 1 }],
      success_url: `${config.frontendUrl}/dashboard?billing=success`,
      cancel_url: `${config.frontendUrl}/dashboard?billing=cancelled`,
      metadata: { userId: req.userId },
    });
    ok(res, { url: session.url });
  } catch (err) {
    next(err);
  }
});

router.post("/webhook", async (_req: _AuthedRequest, res) => {
  // Stripe webhook verification + subscription upsert goes here in production.
  ok(res, { received: true });
});

export default router;