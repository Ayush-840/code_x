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

const ANON_LIMITS: Record<string, number> = {
  analyze: 5,
  status: 30,
};

export function anonymousRateLimit(action: "analyze" | "status") {
  return rateLimit({
    windowMs: 60_000,
    max: ANON_LIMITS[action],
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.ip ?? "unknown",
  });
}

// File explanations are generated lazily per click (PRD-G02), so each request
// can trigger an LLM call. Separate, tighter limit than the whole-analysis
// limits — guards against click-spam forcing many generations (PRD Risks).
const FILE_EXPLAIN_WINDOW_MS = 5 * 60_000;
const FILE_EXPLAIN_MAX = 30;

export function fileExplainRateLimit() {
  return rateLimit({
    windowMs: FILE_EXPLAIN_WINDOW_MS,
    max: FILE_EXPLAIN_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    // req.userId is set by requireAuth; anonymous requests fall back to IP.
    keyGenerator: (req) =>
      (req as unknown as { userId?: string }).userId ?? req.ip ?? "unknown",
  });
}