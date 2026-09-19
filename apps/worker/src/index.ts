import { Worker } from "bullmq";
import { Redis } from "ioredis";
import "dotenv/config";

import { analyzeRepo } from "./jobs/analyzeRepo";

const connection = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  maxRetriesPerRequest: null,
});

export const worker = new Worker(
  "analysis",
  async (job) => {
    if (job.name === "analyze-repo") {
      await analyzeRepo(job.data);
    }
  },
  { connection, concurrency: 2 }
);

worker.on("failed", (job, err) => {
  console.error(`[worker] job ${job?.id} failed:`, err.message);
});

console.log("[worker] Worker started, waiting for jobs...");
