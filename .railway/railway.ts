import { defineRailway, postgres, preserve, project, redis, service, volume } from "railway/iac";

export default defineRailway(() => {
  const Postgres = postgres("Postgres", { region: "sfo" });
  Postgres.networking = { privateNetworkEndpoint: "postgres" };
  const Redis = redis("Redis", { region: "sfo" });
  Redis.deploy = { startCommand: "/bin/sh -c \"rm -rf $RAILWAY_VOLUME_MOUNT_PATH/lost+found/ && exec docker-entrypoint.sh redis-server --requirepass $REDIS_PASSWORD --save 60 1 --dir $RAILWAY_VOLUME_MOUNT_PATH\"" };
  Redis.networking = { privateNetworkEndpoint: "redis" };
  const pythonVolume = volume("python-volume", { alerts: { usage: { "100": {}, "80": {}, "95": {} } }, allowOnlineResize: true, region: "sfo", sizeMB: 500 });
  const postgresVolume = volume("postgres-volume", { alerts: { usage: { "100": {}, "80": {}, "95": {} } }, allowOnlineResize: true, region: "sfo", sizeMB: 500 });
  const redisVolume = volume("redis-volume", { alerts: { usage: { "100": {}, "80": {}, "95": {} } }, allowOnlineResize: true, region: "sfo", sizeMB: 500 });
  const python = service("python", {
    build: { builder: "DOCKERFILE", dockerfilePath: "docker/Dockerfile.python-all" },
    deploy: { restartPolicyType: "ON_FAILURE", restartPolicyMaxRetries: 3 },
    replicas: { "sfo": 1 },
    volumeMounts: { "/data/retrieval": pythonVolume },
    env: { ANTHROPIC_API_KEY: preserve(), GEMINI_API_KEYS: preserve(), NVIDIA_API_KEYS: preserve(), NVIDIA_BASE_URL: preserve(), NVIDIA_CHAT_MODEL: preserve(), NVIDIA_EMBED_MODEL: preserve(), RETRIEVAL_STORAGE_DIR: preserve() },
  });
  const apiWorker = service("api-worker", {
    build: { builder: "DOCKERFILE", dockerfilePath: "docker/Dockerfile.api-worker" },
    deploy: {
      preDeployCommand: ["./packages/database/node_modules/.bin/prisma migrate deploy --schema packages/database/prisma/schema.prisma"],
      healthcheckPath: "/health",
      healthcheckTimeout: 300,
      restartPolicyType: "ON_FAILURE",
      restartPolicyMaxRetries: 3,
    },
    replicas: { "sfo": 1 },
    env: { ANALYSIS_SERVICE_URL: preserve(), API_URL: preserve(), COOKIE_CROSS_SITE: preserve(), DATABASE_URL: preserve(), FRONTEND_URL: preserve(), GENERATION_SERVICE_URL: preserve(), GITHUB_CLIENT_ID: preserve(), GITHUB_CLIENT_SECRET: preserve(), JWT_SECRET: preserve(), MOCK_INTERVIEW_SERVICE_URL: preserve(), NODE_ENV: preserve(), PORT: preserve(), REDIS_URL: preserve(), RETRIEVAL_SERVICE_URL: preserve() },
  });
  const websocket = service("websocket", {
    build: { builder: "DOCKERFILE", dockerfilePath: "apps/websocket/Dockerfile" },
    deploy: { healthcheckPath: "/health", healthcheckTimeout: 300, restartPolicyType: "ON_FAILURE", restartPolicyMaxRetries: 3 },
    replicas: { "sfo": 1 },
    env: { FRONTEND_URL: preserve(), GENERATION_SERVICE_URL: preserve(), JWT_SECRET: preserve(), MOCK_INTERVIEW_SERVICE_URL: preserve(), PORT: preserve(), REDIS_URL: preserve() },
  });

  return project("code-x", {
    resources: [python, Postgres, apiWorker, Redis, websocket, pythonVolume, postgresVolume, redisVolume],
  });
});
