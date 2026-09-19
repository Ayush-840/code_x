import { Redis } from "ioredis";
import { config } from "../config";

let publisher: Redis | null = null;

function getPublisher(): Redis {
  if (!publisher) {
    publisher = new Redis(config.redisUrl);
  }
  return publisher;
}

/**
 * Publishes pipeline progress to Redis. The WebSocket server subscribes to
 * this channel and rebroadcasts to the user's Socket.IO room as
 * `analysis:progress` (Technical Spec §5.2).
 */
export async function notifyProgress(
  jobId: string,
  stage: string,
  progress: number,
  message: string
): Promise<void> {
  try {
    await getPublisher().publish(
      "analysis-progress",
      JSON.stringify({ jobId, stage, progress, message })
    );
  } catch (err) {
    console.error("[analysis] progress publish failed:", err);
  }
}

export async function getJobProgress(jobId: string): Promise<number | null> {
  try {
    const raw = await getPublisher().get(`job-progress:${jobId}`);
    return raw ? Number(raw) : null;
  } catch {
    return null;
  }
}