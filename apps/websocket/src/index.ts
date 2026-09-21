import { createServer } from "node:http";
import { Server, type Socket } from "socket.io";
import { Redis } from "ioredis";
import { createAdapter } from "@socket.io/redis-adapter";
import "dotenv/config";

import { verifyToken, extractTokenFromCookie } from "./auth";
import { handleChatSend } from "./handlers/chat";
import {
  handleInterviewStart,
  handleInterviewAnswer,
  handleInterviewNext,
  handleInterviewComplete,
} from "./handlers/mockInterview";

const PORT = Number(process.env.PORT ?? 4001);
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const FRONTEND_URL = process.env.FRONTEND_URL ?? "http://localhost:3000";
const PREVIEW_PATTERN = process.env.FRONTEND_PREVIEW_PATTERN
  ? new RegExp(process.env.FRONTEND_PREVIEW_PATTERN)
  : null;

const allowedOrigins = FRONTEND_URL.split(",");

const pubClient = new Redis(REDIS_URL);
const subClient = pubClient.duplicate();

// Dedicated connection for the app-level "analysis-progress" subscription.
// pubClient is used by the Socket.IO adapter to publish; once a Redis
// connection subscribes it can only run subscriber commands, so reusing it
// here would crash on the first publish ("Connection in subscriber mode").
const appSubClient = pubClient.duplicate();

const httpServer = createServer();

// Plain HTTP health endpoint for platform health checks (e.g. Railway).
// Must be registered before Socket.IO attaches: Socket.IO preserves existing
// "request" listeners and forwards non-Socket.IO requests to them.
httpServer.on("request", (req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, service: "websocket" }));
    return;
  }
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: false, error: "Not found" }));
});

const io = new Server(httpServer, {
  cors: {
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      if (PREVIEW_PATTERN && PREVIEW_PATTERN.test(origin)) return callback(null, true);
      callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  },
  adapter: createAdapter(pubClient, subClient),
});

// Subscribe to analysis pipeline progress published by api/worker.
appSubClient.subscribe("analysis-progress");
appSubClient.on("message", (_channel, message) => {
  try {
    const { jobId, repoId, stage, progress, message: text } = JSON.parse(message) as {
      jobId: string;
      repoId?: string;
      stage: string;
      progress: number;
      message: string;
    };
    io.to(`job:${jobId}`).emit("analysis:progress", {
      repoId: repoId ?? jobId,
      stage,
      progress,
      message: text,
    });
  } catch {
    // ignore malformed progress messages
  }
});

io.use((socket: Socket, next) => {
  try {
    // Try cookie first, then auth header, then auth object
    const cookieToken = extractTokenFromCookie(socket.handshake.headers?.cookie);
    const token =
      cookieToken ??
      (socket.handshake.auth?.token as string | undefined) ??
      (socket.handshake.headers.authorization?.replace(/^Bearer /, "") as string | undefined);
    const payload = verifyToken(token);
    (socket.data as { userId: string }).userId = payload.userId;
    next();
  } catch {
    next(new Error("UNAUTHORIZED"));
  }
});

const REPO_ROOM = (userId: string, repoId: string) => `${userId}:repo:${repoId}`;

io.on("connection", (socket) => {
  const userId = (socket.data as { userId: string }).userId;

  socket.on("repo:join", ({ repoId, jobId }: { repoId?: string; jobId?: string }) => {
    if (repoId) socket.join(REPO_ROOM(userId, repoId));
    if (jobId) socket.join(`job:${jobId}`);
  });

  socket.on("chat:send", async ({ sessionId, content }) => {
    await handleChatSend(io, socket, userId, { sessionId, content });
  });

  socket.on("mock-interview:start", async ({ repoId, persona, difficulty }) => {
    await handleInterviewStart(io, socket, { repoId, persona, difficulty });
  });

  socket.on("mock-interview:answer", async ({ sessionId, answer }) => {
    await handleInterviewAnswer(io, socket, { sessionId, answer });
  });

  socket.on("mock-interview:next", async ({ sessionId }) => {
    await handleInterviewNext(io, socket, { sessionId });
  });

  socket.on("mock-interview:complete", async ({ sessionId }) => {
    await handleInterviewComplete(io, socket, { sessionId });
  });
});

export { io, REPO_ROOM };

httpServer.listen(PORT, () => {
  console.log(`[websocket] listening on :${PORT}`);
});