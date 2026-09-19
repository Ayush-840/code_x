import type { Server, Socket } from "socket.io";
import { randomUUID } from "node:crypto";

const MOCK_INTERVIEW_URL =
  process.env.MOCK_INTERVIEW_SERVICE_URL ?? "http://localhost:8400";

const QUESTION_BANK = [
  {
    category: "architecture",
    question: "Walk me through the overall architecture of this project.",
  },
  {
    category: "data-modeling",
    question: "How is data modeled and how do the entities relate?",
  },
  {
    category: "api-design",
    question: "Walk me through the main API surface and its design choices.",
  },
  {
    category: "security",
    question: "How does authentication and authorization work here?",
  },
  {
    category: "performance",
    question: "What performance bottlenecks do you see and how would you fix them?",
  },
  {
    category: "devops",
    question: "How would you debug a production incident in this system?",
  },
];

interface SessionState {
  sessionId: string;
  repoId: string;
  persona: string;
  difficulty: string;
  questionNumber: number;
  answers: { questionId: string; answer: string; scores?: unknown; feedback?: string }[];
}

const sessions = new Map<string, SessionState>();

export async function handleInterviewStart(
  io: Server,
  socket: Socket,
  payload: { repoId?: string; persona?: string; difficulty?: string }
): Promise<void> {
  const sessionId = randomUUID();
  const persona = payload.persona ?? "friendly-senior";
  const difficulty = payload.difficulty ?? "junior";
  const state: SessionState = {
    sessionId,
    repoId: payload.repoId ?? "unknown",
    persona,
    difficulty,
    questionNumber: 1,
    answers: [],
  };
  sessions.set(sessionId, state);

  console.log(`[mock-interview] started ${sessionId} (${persona}/${difficulty})`);

  socket.emit("mock-interview:question", {
    sessionId,
    questionId: randomUUID(),
    questionText: QUESTION_BANK[0].question,
    category: QUESTION_BANK[0].category,
    questionNumber: 1,
    totalQuestions: QUESTION_BANK.length,
  });
  void io;
}

export async function handleInterviewAnswer(
  _io: Server,
  socket: Socket,
  payload: { sessionId?: string; answer?: string }
): Promise<void> {
  if (!payload.sessionId || !payload.answer) return;
  const session = sessions.get(payload.sessionId);
  if (!session) {
    socket.emit("mock-interview:score", {
      questionId: "unknown",
      scores: { clarity: 0, depth: 0, specificity: 0, confidence: 0 },
      feedback: "Unknown session",
    } as never);
    return;
  }

  let scores = { overall: 70, clarity: 70, depth: 70, specificity: 70, confidence: 70 };
  let feedback =
    "Decent clarity. Ground your claims with specific file names and trade-offs.";
  try {
    const resp = await fetch(
      `${MOCK_INTERVIEW_URL}/score`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer: payload.answer }),
      }
    );
    if (resp.ok) {
      const body = (await resp.json()) as {
        scores: typeof scores;
        feedback: string;
      };
      scores = body.scores;
      feedback = body.feedback;
    }
  } catch {
    // fall back to demo defaults
  }

  session.answers.push({
    questionId: (session.questionNumber - 1).toString(),
    answer: payload.answer,
    scores,
    feedback,
  });

  socket.emit("mock-interview:score", {
    questionId: (session.questionNumber - 1).toString(),
    scores: {
      clarity: scores.clarity,
      depth: scores.depth,
      specificity: scores.specificity,
      confidence: scores.confidence,
    },
    feedback,
  });
}

export async function handleInterviewNext(
  _io: Server,
  socket: Socket,
  payload: { sessionId?: string }
): Promise<void> {
  if (!payload.sessionId) return;
  const session = sessions.get(payload.sessionId);
  if (!session) return;

  session.questionNumber += 1;
  const index = session.questionNumber - 1;
  if (index >= QUESTION_BANK.length) {
    const scores = session.answers.map((a) => {
      const s = a.scores as { overall?: number };
      return s?.overall ?? 70;
    });
    const overall = scores.length
      ? Math.round(scores.reduce((acc, n) => acc + n, 0) / scores.length)
      : 0;
    socket.emit("mock-interview:complete", {
      sessionId: session.sessionId,
      report: {
        overallScore: overall,
        strengths: ["Answer structure", "Technical grounding"],
        gaps: session.answers.length < 3 ? ["Answer depth", "File-specific references"] : [],
        studySuggestions: ["Re-read the architecture artifact before your phone screen"],
      },
    });
    return;
  }

  socket.emit("mock-interview:question", {
    sessionId: session.sessionId,
    questionId: randomUUID(),
    questionText: QUESTION_BANK[index].question,
    category: QUESTION_BANK[index].category,
    questionNumber: session.questionNumber,
    totalQuestions: QUESTION_BANK.length,
  });
}

export async function handleInterviewComplete(
  _io: Server,
  socket: Socket,
  payload: { sessionId?: string }
): Promise<void> {
  if (!payload.sessionId) return;
  const session = sessions.get(payload.sessionId);
  if (!session) return;
  const scores = session.answers.map((a) => {
    const s = a.scores as { overall?: number };
    return s?.overall ?? 70;
  });
  const overall = scores.length
    ? Math.round(scores.reduce((acc, n) => acc + n, 0) / scores.length)
    : 0;
  socket.emit("mock-interview:complete", {
    sessionId: session.sessionId,
    report: {
      overallScore: overall,
      strengths: ["Answer structure", "Technical grounding"],
      gaps: session.answers.length < 3 ? ["Answer depth", "File-specific references"] : [],
      studySuggestions: ["Re-read the architecture artifact before your phone screen"],
    },
  });
}