import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { existsSync } from "node:fs";

// Load .env — try CWD first, then walk up to workspace root
const rootEnv = resolve(process.cwd(), ".env");
const workspaceRoot = resolve(process.cwd(), "../../.env");
const paths = [rootEnv, workspaceRoot];
for (const p of paths) {
  if (existsSync(p)) {
    loadEnv({ path: p });
    break;
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`[FATAL] Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

function optionalEnv(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

const isProd = process.env.NODE_ENV === "production";
const cookieCrossSite = process.env.COOKIE_CROSS_SITE === "true";

// FRONTEND_URL is comma-separated in production (every Vercel domain, for
// CORS). Redirect targets (OAuth callback, Stripe) need a single valid origin,
// so they use the first entry — the raw value would emit an unusable
// Location header like `https://a.vercel.app,https://b.vercel.app/login?…`
// and bounce the user to a browser error after a successful sign-in.
const frontendOrigins = optionalEnv("FRONTEND_URL", "http://localhost:3000")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

export const config = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: requireEnv("DATABASE_URL"),
  redisUrl: optionalEnv("REDIS_URL", "redis://localhost:6379"),
  jwtSecret: requireEnv("JWT_SECRET"),
  jwtExpiresIn: optionalEnv("JWT_EXPIRES_IN", "15m"),
  githubClientId: requireEnv("GITHUB_CLIENT_ID"),
  githubClientSecret: requireEnv("GITHUB_CLIENT_SECRET"),
  githubWebhookSecret: optionalEnv("GITHUB_WEBHOOK_SECRET", ""),
  frontendUrl: frontendOrigins[0] ?? "http://localhost:3000",
  apiUrl: optionalEnv("API_URL", "http://localhost:4000"),
  // GitHub OAuth validates redirect_uri against the OAuth App's registered
  // callback. Per the deployment docs, API_URL is the public API origin that
  // MUST match that callback — send it so the authorize step and the token
  // exchange agree on the callback (both places need it). When API_URL is
  // unset, omit it and let GitHub fall back to the registered callback.
  githubRedirectUri: process.env.API_URL
    ? `${process.env.API_URL.trim().replace(/\/+$/, "")}/v1/auth/github/callback`
    : null,
  analysisServiceUrl: optionalEnv("ANALYSIS_SERVICE_URL", "http://localhost:8100"),
  retrievalServiceUrl: optionalEnv("RETRIEVAL_SERVICE_URL", "http://localhost:8200"),
  generationServiceUrl: optionalEnv("GENERATION_SERVICE_URL", "http://localhost:8300"),
  mockInterviewServiceUrl: optionalEnv("MOCK_INTERVIEW_SERVICE_URL", "http://localhost:8400"),
  stripeSecretKey: optionalEnv("STRIPE_SECRET_KEY", ""),
  stripeWebhookSecret: optionalEnv("STRIPE_WEBHOOK_SECRET", ""),
  isProd,
  cookieCrossSite,
  cookieSameSite: cookieCrossSite ? ("none" as const) : ("lax" as const),
  cookieSecure: cookieCrossSite || isProd,
  allowedOrigins: frontendOrigins,
  previewPattern: process.env.FRONTEND_PREVIEW_PATTERN
    ? new RegExp(process.env.FRONTEND_PREVIEW_PATTERN)
    : null,
};
