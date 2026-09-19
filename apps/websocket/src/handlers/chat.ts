import type { Server, Socket } from "socket.io";
import { randomUUID } from "node:crypto";

const GENERATION_URL = process.env.GENERATION_SERVICE_URL ?? "http://localhost:8300";

interface ChatSendPayload {
  sessionId: string;
  content: string;
}

/**
 * Handles `chat:send`. In production this enqueues a BullMQ chat job which
 * streams tokens from the generation service. Here we call the generation
 * service synchronously and re-emit its answer as stream chunks so the UI
 * behavior is identical without an LLM key.
 */
export async function handleChatSend(
  io: Server,
  socket: Socket,
  _userId: string,
  payload: ChatSendPayload
): Promise<void> {
  const { sessionId, content } = payload;
  const messageId = randomUUID();

  io.to(socket.id).emit("chat:stream:start", { messageId, sessionId });

  let answer = "";
  let isDemo = false;
  try {
    const resp = await fetch(`${GENERATION_URL}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repoId: sessionId.split(":")[0] ?? "", query: content }),
    });
    if (resp.ok) {
      const body = (await resp.json()) as {
        message: string;
        citations: typeof EMPTY_CITATIONS;
        isDemo: boolean;
      };
      answer = body.message;
      isDemo = body.isDemo;
    } else {
      answer = "The generation service is unavailable right now. Please try again.";
    }
  } catch {
    answer = "The generation service is unavailable right now. Please try again.";
  }

  const citations = extractCitations(answer);

  const CHUNK = 40;
  for (let i = 0; i < answer.length; i += CHUNK) {
    const delta = answer.slice(i, i + CHUNK);
    io.to(socket.id).emit("chat:stream:chunk", { messageId, delta, citations });
    await new Promise((r) => setTimeout(r, 10));
  }

  io.to(socket.id).emit("chat:stream:end", {
    messageId,
    totalTokens: Math.ceil(answer.length / 4),
    modelUsed: isDemo ? "demo" : "gpt-4o",
    isDemo,
  });
}

const EMPTY_CITATIONS: { filePath: string; startLine: number; endLine: number; snippet: string }[] = [];

function extractCitations(
  answer: string
): { filePath: string; startLine: number; endLine: number; snippet: string }[] {
  // The demo generation service embeds citation lines like [cite:file.py:1-12].
  // Surface them so interview prep sees grounded references even offline.
  const citations: { filePath: string; startLine: number; endLine: number; snippet: string }[] = [];
  const re = /\[cite:([^\]]+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(answer)) !== null) {
    const [filePath, range] = m[1].split(":");
    const [startLine, endLine] = (range ?? "1-1").split("-").map((n) => Number(n) || 1);
    citations.push({ filePath, startLine, endLine, snippet: "" });
  }
  return citations;
}