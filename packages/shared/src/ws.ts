import type { Citation } from "./domain";

export interface ChatSendEvent {
  sessionId: string;
  content: string;
}

export interface StreamStartEvent {
  messageId: string;
  sessionId: string;
}

export interface StreamChunkEvent {
  messageId: string;
  delta: string;
  citations: Citation[];
}

export interface StreamEndEvent {
  messageId: string;
  totalTokens: number;
  modelUsed: string;
}

export interface AnalysisProgressEvent {
  repoId: string;
  stage: string;
  progress: number;
  message: string;
}

export interface InterviewQuestionEvent {
  questionId: string;
  questionText: string;
  category: string;
  questionNumber: number;
  totalQuestions: number;
}

export interface InterviewScoreEvent {
  questionId: string;
  scores: { clarity: number; depth: number; specificity: number; confidence: number };
  feedback: string;
}
