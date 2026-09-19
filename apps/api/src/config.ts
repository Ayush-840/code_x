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

export const config = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: requireEnv("DATABASE_URL"),
  redisUrl: optionalEnv("REDIS_URL", "redis://localhost:6379"),
  jwtSecret: requireEnv("JWT_SECRET"),
  jwtExpiresIn: optionalEnv("JWT_EXPIRES_IN", "15m"),
  githubClientId: requireEnv("GITHUB_CLIENT_ID"),
  githubClientSecret: requireEnv("GITHUB_CLIENT_SECRET"),
  githubWebhookSecret: optionalEnv("GITHUB_WEBHOOK_SECRET", ""),
  frontendUrl: optionalEnv("FRONTEND_URL", "http://localhost:3000"),
  apiUrl: optionalEnv("API_URL", "http://localhost:4000"),
  analysisServiceUrl: optionalEnv("ANALYSIS_SERVICE_URL", "http://localhost:8100"),
  retrievalServiceUrl: optionalEnv("RETRIEVAL_SERVICE_URL", "http://localhost:8200"),
  generationServiceUrl: optionalEnv("GENERATION_SERVICE_URL", "http://localhost:8300"),
  mockInterviewServiceUrl: optionalEnv("MOCK_INTERVIEW_SERVICE_URL", "http://localhost:8400"),
  stripeSecretKey: optionalEnv("STRIPE_SECRET_KEY", ""),
  stripeWebhookSecret: optionalEnv("STRIPE_WEBHOOK_SECRET", ""),
};
