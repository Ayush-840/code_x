export type PlanTier = "FREE" | "STARTER" | "PRO" | "INSTITUTIONAL";

export interface User {
  id: string;
  githubId: number;
  email: string | null;
  username: string;
  avatarUrl: string | null;
  planTier: PlanTier;
  createdAt: string;
  updatedAt: string;
}

export interface Repository {
  id: string;
  userId: string;
  fullName: string;
  defaultBranch: string;
  primaryLanguage: string | null;
  totalFiles: number;
  totalLines: number;
  status: "PENDING" | "PARSING" | "INDEXING" | "GENERATING" | "READY" | "FAILED";
  lastAnalyzedAt: string | null;
  createdAt: string;
}

export type AnalysisStage =
  | "CLONING"
  | "PARSING"
  | "CHUNKING"
  | "EMBEDDING"
  | "SPARSE"
  | "GENERATING"
  | "DONE";

export interface AnalysisJob {
  id: string;
  repoId: string;
  status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED";
  stage: AnalysisStage | null;
  progress: number;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface CodeModule {
  id: string;
  repoId: string;
  name: string;
  path: string;
  purposeSummary: string | null;
  complexityScore: number | null;
  fileCount: number;
  lineCount: number;
}

export interface CodeSymbol {
  id: string;
  moduleId: string;
  symbolType: "function" | "class" | "method" | "type" | "enum" | "interface" | "macro";
  name: string;
  signature: string;
  filePath: string;
  startLine: number;
  endLine: number;
  complexity: number | null;
  dependencies: string[];
  docstring: string | null;
}

export interface Citation {
  filePath: string;
  startLine: number;
  endLine: number;
  snippet: string;
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  citations: Citation[];
  tokensUsed: number | null;
  createdAt: string;
}

export type ArtifactType = "architecture" | "modules" | "questions" | "dependency-graph";

export interface Artifact {
  id: string;
  repoId: string;
  artifactType: ArtifactType;
  content: Record<string, unknown> | string;
  version: number;
  generatedAt: string;
}
