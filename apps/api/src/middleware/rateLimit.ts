import rateLimit from "express-rate-limit";
import type { Request } from "express";

const PLAN_LIMITS: Record<string, number> = {
  FREE: 30,
  STARTER: 120,
  PRO: 300,
  INSTITUTIONAL: 1000,
};

export function planRateLimit(planKey: string) {
  return rateLimit({
    windowMs: 60_000,
    max: (req: Request) =>
      PLAN_LIMITS[(req as unknown as { plan?: string }).plan ?? planKey] ?? 30,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.ip ?? "unknown",
  });
}