import { Redis } from "ioredis";
import { Queue } from "bullmq";
import { config } from "./config";

export const connection = new Redis(config.redisUrl, {
  maxRetriesPerRequest: null,
});

export const analysisQueue = new Queue("analysis", {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5_000 },
    removeOnComplete: 100,
    removeOnFail: 500,
  },
});