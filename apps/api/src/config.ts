import "dotenv/config";

export const config = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: process.env.DATABASE_URL ?? "postgresql://vibecoder:dev_password_123@localhost:5433/vibecoder_dev",
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  jwtSecret: process.env.JWT_SECRET ?? "local-dev-jwt-secret-min-32-chars-long!!",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "15m",
  githubClientId: process.env.GITHUB_CLIENT_ID ?? "",
  githubClientSecret: process.env.GITHUB_CLIENT_SECRET ?? "",
  githubWebhookSecret: process.env.GITHUB_WEBHOOK_SECRET ?? "",
  frontendUrl: process.env.FRONTEND_URL ?? "http://localhost:3000",
  apiUrl: process.env.API_URL ?? "http://localhost:4000",
  analysisServiceUrl: process.env.ANALYSIS_SERVICE_URL ?? "http://localhost:8100",
  retrievalServiceUrl: process.env.RETRIEVAL_SERVICE_URL ?? "http://localhost:8200",
  generationServiceUrl: process.env.GENERATION_SERVICE_URL ?? "http://localhost:8300",
  mockInterviewServiceUrl: process.env.MOCK_INTERVIEW_SERVICE_URL ?? "http://localhost:8400",
  stripeSecretKey: process.env.STRIPE_SECRET_KEY ?? "",
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "",
};