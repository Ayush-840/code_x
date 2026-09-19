# Building Vibe Coder — Complete Build Guide

## Frontend + Backend, From Zero to Running

This guide explains exactly how to build the Vibe Coder platform from an empty directory. It covers **every service**: the Next.js frontend, the REST API, the WebSocket server, the analysis worker, the AST parser, the retrieval engine, the generation service, the mock-interview engine, the PostgreSQL database, and full local orchestration with Docker.

Reference docs already in this repo:

| Doc | Purpose |
|---|---|
| `VIBE_CODER_TECHNICAL_SPEC.md` | DB schema, TypeScript interfaces, API contracts, retrieval design |
| `VIBE_CODER_API_SPEC.md` | Full request/response contracts and error codes |
| `VIBE_CODER_DEPLOYMENT_GUIDE.md` | Dockerfiles, AWS/Terraform, CI/CD, production rollout |
| `VIBE_CODER_PLATFORM_DESCRIPTION.md` | Product + architecture overview |
| `VIBE_CODER_EVALUATION_FRAMEWORK.md` | How the platform's answers are measured/graded |
| `VIBE_CODER_ONCALL_RUNBOOK.md` | Incident response |
| `VIBE_CODER_QA_TEST_PLAN.md` | Manual test matrix |

---

## Table of Contents

1. [What You Are Building](#1-what-you-are-building)
2. [Prerequisites](#2-prerequisites)
3. [Project Layout](#3-project-layout)
4. [Part A — Backend](#part-a--backend)
   - [A1. Monorepo + Shared Types](#a1-monorepo--shared-types)
   - [A2. PostgreSQL Database (Prisma)](#a2-postgresql-database-prisma)
   - [A3. REST API Service](#a3-rest-api-service)
   - [A4. WebSocket Server](#a4-websocket-server)
   - [A5. Analysis Worker (BullMQ)](#a5-analysis-worker-bullmq)
   - [A6. AST Parser Service](#a6-ast-parser-service)
   - [A7. Retrieval Engine (Hybrid Search)](#a7-retrieval-engine-hybrid-search)
   - [A8. Generation Service (LLM + Citations)](#a8-generation-service-llm--citations)
   - [A9. Mock-Interview Engine](#a9-mock-interview-engine)
5. [Part B — Frontend (Next.js)](#part-b--frontend-nextjs)
   - [B1. App Setup](#b1-app-setup)
   - [B2. API Client + Auth](#b2-api-client--auth)
   - [B3. Pages & Features](#b3-pages--features)
   - [B4. Chat UI with Streaming](#b4-chat-ui-with-streaming)
   - [B5. Mock-Interview UI](#b5-mock-interview-ui)
6. [Part C — Run Everything Locally](#part-c--run-everything-locally)
7. [Environment Variables Reference](#7-environment-variables-reference)
8. [Seed Data](#8-seed-data)
9. [Testing & Verification](#9-testing--verification)
10. [Build Order / Milestones](#10-build-order--milestones)

---

## 1. What You Are Building

Vibe Coder is a GitHub-connected AI platform that turns any student's repository into an interview-ready study guide. The flow:

```
User connects a GitHub repo
   → Worker clones it, AST-parses it (functions, classes, deps)
   → Analyzer chunks the code and sends chunks to the retrieval engine
   → Retrieval engine indexes dense embeddings + sparse BM25
   → Generation service produces architecture docs, module explainers,
     question banks (citation-grounded in the user's own code)
   → Frontend shows the repo dashboard, chat, and mock-interview simulator
   → Chat + mock interview stream answers over Socket.IO
```

Services you will build:

| Service | Language / Stack | Port (dev) | Job |
|---|---|---|---|
| `apps/web` | Next.js 14 App Router | 3000 | The product UI |
| `apps/api` | Node 20 + Express + Prisma + Octokit | 4000 | Auth, repos, artifacts, usage, billing |
| `apps/websocket` | Node 20 + Socket.IO + Redis adapter | 4001 | Chat + mock-interview streaming |
| `apps/worker` | Node 20 + BullMQ | — | Analysis pipeline orchestration |
| `packages/analysis` | Python 3.11 + FastAPI | 8100 | AST parsing + chunking |
| `packages/retrieval` | Python 3.11 + FastAPI | 8200 | Hybrid search (dense + BM25 + RRF) |
| `packages/generation` | Python 3.11 + FastAPI | 8300 | LLM calls, citation grounding |
| `packages/mock-interview` | Python 3.11 + FastAPI | 8400 | Persona simulation, scoring, reports |

Shared infrastructure: **PostgreSQL 16** (source of truth), **Redis 7** (BullMQ queues + Socket.IO adapter), **OpenSearch 2.x** (sparse BM25 index). Dense embeddings go to **Pinecone** (or `pgvector` as a free local fallback).

---

## 2. Prerequisites

Install these first. Versions matter.

| Tool | Version | Why |
|---|---|---|
| Node.js | 20.x LTS | All TypeScript services |
| pnpm | 8.x | Monorepo package manager |
| Python | 3.11+ | Retrieval / analysis / generation / mock-interview |
| Poetry | 1.7+ | Python dependency management |
| Docker Desktop | 4.24+ | Postgres, Redis, OpenSearch, local `docker compose` |
| GitHub account + read-only PAT | — | Cloning public repos locally during dev |
| GitHub **OAuth App** | — | Login flow (client id + client secret) |
| OpenAI API key (optional in dev) | — | LLM calls. A stub works for offline development. |
| Pinecone account / index (optional) | — | Dense vectors. `pgvector` works as a free fallback. |

Verify your toolchain:

```bash
node -v            # v20.x
pnpm -v            # 8.x
python3 --version  # 3.11+
poetry --version   # 1.7+
docker --version
docker compose version
```

---

## 3. Project Layout

Create the directory structure (all paths below live inside `vibe-coder/`):

```bash
mkdir -p vibe-coder/{apps/{web,api,websocket,worker},packages/{shared,database,retrieval,analysis,generation,mock-interview},docker}
cd vibe-coder
```

Final layout:

```
vibe-coder/
├── pnpm-workspace.yaml
├── package.json
├── tsconfig.base.json
├── .env
├── .gitignore
├── Makefile
├── apps/
│   ├── web/                      # Next.js 14 (App Router) frontend
│   │   ├── package.json
│   │   ├── next.config.ts
│   │   ├── tailwind.config.ts
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── app/
│   │       │   ├── layout.tsx
│   │       │   ├── page.tsx                  # landing
│   │       │   ├── login/page.tsx
│   │       │   ├── dashboard/page.tsx        # repo list
│   │       │   ├── repos/[repoId]/page.tsx   # repo overview + artifact nav
│   │       │   ├── repos/[repoId]/architecture/page.tsx
│   │       │   ├── repos/[repoId]/modules/page.tsx
│   │       │   ├── repos/[repoId]/modules/[moduleId]/page.tsx
│   │       │   ├── repos/[repoId]/questions/page.tsx
│   │       │   ├── repos/[repoId]/chat/page.tsx
│   │       │   ├── repos/[repoId]/interview/page.tsx
│   │       │   └── api/auth/[...nextauth]/route.ts
│   │       ├── components/       # ChatStream, InterviewSession, RepoConnect,
│   │       │                     # ArtifactViewer, DependencyGraph, AppShell…
│   │       ├── lib/
│   │       │   ├── api.ts        # typed API client
│   │       │   ├── sockets.ts    # Socket.IO client wrapper
│   │       │   └── auth.ts       # next-auth config
│   │       └── types/            # re-exports from @vibe-coder/shared
│   ├── api/                      # Express REST API
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── app.ts
│   │       ├── config.ts
│   │       ├── db.ts             # Prisma client
│   │       ├── redis.ts          # Redis + BullMQ queue exports
│   │       ├── middleware/{auth.ts,rateLimit.ts,errors.ts}
│   │       ├── routes/{auth.ts,users.ts,repos.ts,artifacts.ts,
│   │       │          chat.ts,mockInterviews.ts,usage.ts,billing.ts,
│   │       │          githubWebhook.ts}
│   │       └── services/{analysis.ts,github.ts}
│   ├── websocket/                # Socket.IO server
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── auth.ts
│   │       └── handlers/{chat.ts,mockInterview.ts,analysisProgress.ts}
│   └── worker/                   # BullMQ worker
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── index.ts
│           ├── queue.ts
│           └── jobs/{analyzeRepo.ts,indexEmbeddings.ts,indexSparse.ts,
│                     generateArtifacts.ts,generateQuestionBank.ts}
├── packages/
│   ├── shared/                   # shared TypeScript types
│   │   ├── package.json
│   │   └── src/{index.ts,domain.ts,api.ts,ws.ts}
│   ├── database/
│   │   ├── package.json
│   │   └── prisma/{schema.prisma,seed.ts}
│   ├── analysis/                 # Python AST parse + chunk pipeline
│   │   ├── pyproject.toml
│   │   └── src/analysis/{main.py,parser.py,languages.py,chunker.py}
│   ├── retrieval/                # Python hybrid-search engine
│   │   ├── pyproject.toml
│   │   └── src/retrieval/{main.py,indexing.py,search.py,rrf.py,client.py}
│   ├── generation/               # Python LLM + citations
│   │   ├── pyproject.toml
│   │   └── src/generation/{main.py,prompts.py,llm.py,citations.py,
│   │                       architecture.py,modules.py,questions.py}
│   └── mock-interview/           # Python mock-interview engine
│       ├── pyproject.toml
│       └── src/mock_interview/{main.py,personas.py,scoring.py,
│                               sessions.py,report.py}
└── docker/
    ├── docker-compose.yml        # full local stack
    └── .env.example
```

---

# Part A — Backend

## A1. Monorepo + Shared Types

### A1.1 Root workspace files

`pnpm-workspace.yaml`:

```yaml
packages:
  - "apps/*"
  - "packages/shared"
  - "packages/database"
```

`package.json` (root):

```json
{
  "name": "vibe-coder",
  "private": true,
  "packageManager": "pnpm@8.15.0",
  "engines": { "node": ">=20" },
  "scripts": {
    "dev": "pnpm -r --parallel --filter './apps/*' --filter './packages/*' dev",
    "build": "pnpm -r build",
    "lint": "pnpm -r lint",
    "typecheck": "pnpm -r typecheck",
    "db:generate": "pnpm --filter @vibe-coder/database prisma generate",
    "db:migrate": "pnpm --filter @vibe-coder/database prisma migrate dev",
    "db:seed": "pnpm --filter @vibe-coder/database prisma db seed"
  }
}
```

`tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "CommonJS",
    "moduleResolution": "Node",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": true,
    "baseUrl": ".",
    "paths": {
      "@vibe-coder/shared": ["packages/shared/src"]
    }
  }
}
```

`.gitignore`:

```
node_modules/
dist/
.env
*.log
.DS_Store
coverage/
.vercel/
next-env.d.ts
```

### A1.2 Shared types package

`packages/shared/package.json`:

```json
{
  "name": "@vibe-coder/shared",
  "version": "0.1.0",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": { "typecheck": "tsc --noEmit" },
  "devDependencies": { "typescript": "^5.4.0" }
}
```

`packages/shared/src/domain.ts` — domain models (mirror the DB schema in Technical Spec §2):

```ts
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
  fullName: string;          // "owner/repo"
  defaultBranch: string;
  primaryLanguage: string | null;
  totalFiles: number;
  totalLines: number;
  status: "PENDING" | "PARSING" | "INDEXING" | "GENERATING" | "READY" | "FAILED";
  lastAnalyzedAt: string | null;
  createdAt: string;
}

export type AnalysisStage =
  | "CLONING" | "PARSING" | "CHUNKING" | "EMBEDDING" | "SPARSE"
  | "GENERATING" | "DONE";

export interface AnalysisJob {
  id: string;
  repoId: string;
  status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED";
  stage: AnalysisStage | null;
  progress: number;          // 0-100
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
```

`packages/shared/src/ws.ts` — WebSocket contracts from Technical Spec §5.2:

```ts
import type { Citation } from "./domain";

export interface ChatSendEvent { sessionId: string; content: string; }
export interface StreamStartEvent { messageId: string; sessionId: string; }
export interface StreamChunkEvent { messageId: string; delta: string; citations: Citation[]; }
export interface StreamEndEvent { messageId: string; totalTokens: number; modelUsed: string; }

export interface AnalysisProgressEvent {
  repoId: string; stage: string; progress: number; message: string;
}

export interface InterviewQuestionEvent {
  questionId: string; questionText: string; category: string;
  questionNumber: number; totalQuestions: number;
}

export interface InterviewScoreEvent {
  questionId: string;
  scores: { clarity: number; depth: number; specificity: number; confidence: number };
  feedback: string;
}
```

`packages/shared/src/api.ts` — REST envelope from API Spec §1.3:

```ts
export interface ApiEnvelope<T> {
  ok: true;
  data: T;
  meta: { requestId: string; timestamp: string };
}

export interface ApiError {
  ok: false;
  error: { code: string; message: string; details?: unknown[] };
  meta: { requestId: string; timestamp: string };
}

export type ApiResponse<T> = ApiEnvelope<T> | ApiError;
```

`packages/shared/src/index.ts`:

```ts
export * from "./domain";
export * from "./api";
export * from "./ws";
```

---

## A2. PostgreSQL Database (Prisma)

The full schema is specified in `VIBE_CODER_TECHNICAL_SPEC.md` §2. Use Prisma so migrations, generated types, and seeds are one system.

`packages/database/package.json`:

```json
{
  "name": "@vibe-coder/database",
  "version": "0.1.0",
  "scripts": {
    "prisma": "prisma",
    "generate": "prisma generate",
    "migrate": "prisma migrate dev --name init",
    "deploy": "prisma migrate deploy",
    "seed": "ts-node prisma/seed.ts"
  },
  "prisma": { "seed": "ts-node prisma/seed.ts" },
  "dependencies": {
    "@prisma/client": "^5.14.0",
    "prisma": "^5.14.0",
    "ts-node": "^10.9.2",
    "typescript": "^5.4.0"
  }
}
```

`packages/database/prisma/schema.prisma` (abbreviated — the full column list is in Technical Spec §2.2):

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum PlanTier { FREE STARTER PRO INSTITUTIONAL }
enum RepoStatus { PENDING PARSING INDEXING GENERATING READY FAILED }
enum JobStatus { QUEUED RUNNING SUCCEEDED FAILED }

enum SymbolType {
  function
  class
  method
  type
  enum
  interface
  macro
}

model User {
  id                    String                 @id @default(uuid()) @db.Uuid
  githubId              Int                    @unique
  email                 String?                @unique
  username              String                 @unique
  avatarUrl             String?
  planTier              PlanTier               @default(FREE)
  repositories          Repository[]
  subscriptions         Subscription[]
  chatSessions          ChatSession[]
  mockInterviewSessions MockInterviewSession[]
  createdAt             DateTime               @default(now())
  updatedAt             DateTime               @updatedAt
}

model Repository {
  id                     String                   @id @default(uuid()) @db.Uuid
  userId                 String                   @db.Uuid
  user                   User                     @relation(fields: [userId], references: [id])
  fullName               String
  defaultBranch          String                   @default("main")
  primaryLanguage        String?
  totalFiles             Int                      @default(0)
  totalLines             Int                      @default(0)
  status                 RepoStatus               @default(PENDING)
  lastAnalyzedAt         DateTime?
  analysisJobs           AnalysisJob[]
  modules                CodeModule[]
  artifacts              Artifact[]
  chatSessions           ChatSession[]
  mockInterviewSessions  MockInterviewSession[]
  createdAt              DateTime                 @default(now())

  @@unique([userId, fullName])
  @@index([userId])
}

model AnalysisJob {
  id            String      @id @default(uuid()) @db.Uuid
  repoId        String      @db.Uuid
  repo          Repository  @relation(fields: [repoId], references: [id])
  status        JobStatus   @default(QUEUED)
  stage         String?
  progress      Int         @default(0)
  errorMessage  String?
  startedAt     DateTime?
  completedAt   DateTime?
  modules       CodeModule[]
  artifacts     Artifact[]
  createdAt     DateTime    @default(now())

  @@index([repoId])
}

model CodeModule {
  id               String         @id @default(uuid()) @db.Uuid
  repoId           String         @db.Uuid
  repo             Repository     @relation(fields: [repoId], references: [id])
  jobId            String?        @db.Uuid
  job              AnalysisJob?   @relation(fields: [jobId], references: [id])
  name             String
  path             String
  purposeSummary   String?
  complexityScore  Float?
  fileCount        Int            @default(0)
  lineCount        Int            @default(0)
  symbols          CodeSymbol[]
  createdAt        DateTime       @default(now())

  @@unique([repoId, name])
  @@index([repoId])
}

model CodeSymbol {
  id           String     @id @default(uuid()) @db.Uuid
  moduleId     String     @db.Uuid
  module       CodeModule @relation(fields: [moduleId], references: [id])
  symbolType   SymbolType
  name         String
  signature    String
  filePath     String
  startLine    Int
  endLine      Int
  complexity   Float?
  dependencies String[]   @default([])
  docstring    String?
  createdAt    DateTime   @default(now())

  @@index([moduleId])
  @@index([filePath])
}

model Artifact {
  id           String      @id @default(uuid()) @db.Uuid
  repoId       String      @db.Uuid
  repo         Repository  @relation(fields: [repoId], references: [id])
  jobId        String?     @db.Uuid
  job          AnalysisJob? @relation(fields: [jobId], references: [id])
  artifactType String      // architecture | modules | questions | dependency-graph
  content      Json
  version      Int         @default(1)
  generatedAt  DateTime    @default(now())

  @@unique([repoId, artifactType, version])
  @@index([repoId])
}

model ChatSession {
  id        String        @id @default(uuid()) @db.Uuid
  userId    String        @db.Uuid
  user      User          @relation(fields: [userId], references: [id])
  repoId    String        @db.Uuid
  repo      Repository    @relation(fields: [repoId], references: [id])
  title     String
  messages  ChatMessage[]
  createdAt DateTime      @default(now())
}

model ChatMessage {
  id         String      @id @default(uuid()) @db.Uuid
  sessionId  String      @db.Uuid
  session    ChatSession @relation(fields: [sessionId], references: [id])
  role       String      // user | assistant
  content    String
  citations  Json        @default("[]")
  tokensUsed Int?
  createdAt  DateTime    @default(now())

  @@index([sessionId])
}

model MockInterviewSession {
  id                  String                   @id @default(uuid()) @db.Uuid
  userId              String                   @db.Uuid
  user                User                     @relation(fields: [userId], references: [id])
  repoId              String                   @db.Uuid
  repo                Repository               @relation(fields: [repoId], references: [id])
  persona             String
  difficulty          String
  status              String                   @default("IN_PROGRESS")
  scoreOverall        Float?
  scoreClarity        Float?
  scoreDepth          Float?
  scoreSpecificity    Float?
  questions           MockInterviewQuestion[]
  startedAt           DateTime                 @default(now())
  completedAt         DateTime?
}

model MockInterviewQuestion {
  id           String               @id @default(uuid()) @db.Uuid
  sessionId    String               @db.Uuid
  session      MockInterviewSession @relation(fields: [sessionId], references: [id])
  questionText String
  answerText   String?
  citations    Json                 @default("[]")
  score        Float?
  feedback     String?
  timeSpentSec Int?
  createdAt    DateTime             @default(now())
}

model Subscription {
  id                        String    @id @default(uuid()) @db.Uuid
  userId                    String    @db.Uuid
  user                      User      @relation(fields: [userId], references: [id])
  planTier                  PlanTier  @default(FREE)
  reposRemaining            Int       @default(1)
  chatsRemaining            Int       @default(20)
  mockInterviewsRemaining   Int       @default(1)
  billingCycle              String    @default("monthly")
  createdAt                 DateTime  @default(now())
  expiresAt                 DateTime?
}
```

Generate the client and run the initial migration (Start the `postgres` container from [Part C](#part-c--run-everything-locally) first):

```bash
docker compose -f docker/docker-compose.yml up -d postgres redis opensearch

cd packages/database
pnpm prisma generate
pnpm prisma migrate dev --name init
pnpm seed
cd ../..
```

---

## A3. REST API Service

Express server on **port 4000**. It owns identity, repositories, artifacts, chat REST fallbacks, usage, and billing. It never calls the LLM directly — it enqueues jobs for the worker and proxies streaming through the WebSocket server.

`apps/api/package.json`:

```json
{
  "name": "@vibe-coder/api",
  "version": "0.1.0",
  "private": true,
  "main": "dist/index.js",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@vibe-coder/shared": "workspace:*",
    "@bull-board/api": "^5.0.0",
    "@bull-board/express": "^5.0.0",
    "@octokit/rest": "^20.0.0",
    "@prisma/client": "^5.14.0",
    "bcryptjs": "^2.4.3",
    "bullmq": "^5.0.0",
    "cors": "^2.8.5",
    "dotenv": "^16.4.0",
    "express": "^4.19.0",
    "express-rate-limit": "^7.0.0",
    "helmet": "^7.1.0",
    "ioredis": "^5.4.0",
    "jsonwebtoken": "^9.0.0",
    "octokit": "^3.1.0",
    "pino": "^9.0.0",
    "pino-http": "^10.0.0",
    "stripe": "^15.0.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/cors": "^2.8.17",
    "@types/express": "^4.17.21",
    "@types/jsonwebtoken": "^9.0.6",
    "tsx": "^4.7.0",
    "typescript": "^5.4.0"
  }
}
```

### A3.1 Configuration and wiring

`apps/api/src/config.ts`:

```ts
import "dotenv/config";

export const config = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: process.env.DATABASE_URL!,
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
```

`apps/api/src/db.ts`:

```ts
import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();
```

`apps/api/src/redis.ts` — Redis connection + the analysis job queue:

```ts
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
```

### A3.2 Standard envelope & error handling

`apps/api/src/middleware/errors.ts` — imports the shared envelope types:

```ts
import type { NextFunction, Request, Response } from "express";
import type { ApiResponse } from "@vibe-coder/shared";
import { randomUUID } from "node:crypto";

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

function ok<T>(res: Response, data: T): void {
  const envelope: ApiResponse<T> = {
    ok: true,
    data,
    meta: { requestId: randomUUID(), timestamp: new Date().toISOString() },
  };
  res.json(envelope);
}

function fail(res: Response, status: number, code: string, message: string, details?: unknown[]): void {
  const envelope: ApiResponse<never> = {
    ok: false,
    error: { code, message, ...(details ? { details } : {}) },
    meta: { requestId: randomUUID(), timestamp: new Date().toISOString() },
  };
  res.status(status).json(envelope);
}

export function notFound(_req: Request, res: Response): void {
  fail(res, 404, "NOT_FOUND", "Resource does not exist");
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof HttpError) {
    fail(res, err.status, err.code, err.message);
    return;
  }
  console.error(err);
  fail(res, 500, "INTERNAL_ERROR", "Unexpected server error");
}

export { ok, fail };
```

### A3.3 Auth middleware

`apps/api/src/middleware/auth.ts` — stateless JWT verification per Technical Spec §8.1:

```ts
import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config";
import { HttpError } from "./errors";

export interface AuthedRequest extends Request {
  userId?: string;
  githubId?: number;
}

export function requireAuth(req: AuthedRequest, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    throw new HttpError(401, "UNAUTHORIZED", "Missing or invalid authentication token");
  }
  try {
    const payload = jwt.verify(header.slice(7), config.jwtSecret) as {
      sub: string;
      githubId: number;
    };
    req.userId = payload.sub;
    req.githubId = payload.githubId;
    next();
  } catch (e) {
    if (e instanceof jwt.TokenExpiredError) {
      throw new HttpError(401, "TOKEN_EXPIRED", "JWT has expired; refresh required");
    }
    throw new HttpError(401, "UNAUTHORIZED", "Missing or invalid authentication token");
  }
}
```

### A3.4 Rate limiting

`apps/api/src/middleware/rateLimit.ts` — use the plan limits from API Spec §1.6:

```ts
import rateLimit from "express-rate-limit";
import type { Request } from "express";

const PLAN_LIMITS = {
  FREE: 30,
  STARTER: 120,
  PRO: 300,
  INSTITUTIONAL: 1000,
} as const;

export function planRateLimit(planKey: string) {
  return rateLimit({
    windowMs: 60_000,
    max: (req: Request) => PLAN_LIMITS[(req as unknown as { plan: keyof typeof PLAN_LIMITS }).plan] ?? 30,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.ip ?? "unknown",
  });
}
```

### A3.5 Auth routes (GitHub OAuth)

Messages to the API Spec auth flow (`/auth/github` → `/auth/github/callback`):

`apps/api/src/routes/auth.ts`:

```ts
import { Router } from "express";
import { randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";
import { Octokit } from "octokit";
import { prisma } from "../db";
import { config } from "../config";
import { HttpError, ok } from "../middleware/errors";

const router = Router();

// Browser GET is friendlier here, API spec lists POST — keep both.
router.get("/github", (_req, res) => {
  const state = randomBytes(16).toString("hex");
  res.cookie("oauth_state", state, { httpOnly: true, sameSite: "lax" });
  const params = new URLSearchParams({
    client_id: config.githubClientId,
    redirect_uri: `${config.apiUrl}/v1/auth/github/callback`,
    scope: "repo,user:email",
    state,
  });
  res.redirect(`https://github.com/login/oauth/authorize?${params}`);
});

router.get("/github/callback", async (req, res, next) => {
  try {
    const { code, state } = req.query as { code?: string; state?: string };
    if (!code || state !== req.cookies.oauth_state) {
      throw new HttpError(400, "VALIDATION_ERROR", "OAuth state mismatch");
    }

    const tokenResp = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        client_id: config.githubClientId,
        client_secret: config.githubClientSecret,
        code,
        redirect_uri: `${config.apiUrl}/v1/auth/github/callback`,
      }),
    });
    const { access_token } = (await tokenResp.json()) as { access_token?: string };
    if (!access_token) throw new HttpError(401, "UNAUTHORIZED", "GitHub did not return a token");

    const octokit = new Octokit({ auth: access_token });
    const { data: ghUser } = await octokit.rest.users.getAuthenticated();

    const user = await prisma.user.upsert({
      where: { githubId: ghUser.id },
      update: { username: ghUser.login, email: ghUser.email ?? null, avatarUrl: ghUser.avatar_url ?? null },
      create: {
        githubId: ghUser.id,
        username: ghUser.login,
        email: ghUser.email ?? null,
        avatarUrl: ghUser.avatar_url ?? null,
        subscription: { create: {} },
      },
    });

    const token = jwt.sign({ sub: user.id, githubId: user.githubId }, config.jwtSecret, {
      expiresIn: config.jwtExpiresIn,
    });
    const refresh = jwt.sign({ sub: user.id, typ: "refresh" }, config.jwtSecret, { expiresIn: "30d" });

    // Hand the tokens to our own frontend:
    res.redirect(
      `${config.frontendUrl}/login?token=${token}&refresh=${refresh}`
    );
  } catch (err) {
    next(err);
  }
});

router.post("/refresh", async (req, res, next) => {
  try {
    const { refreshToken } = req.body as { refreshToken?: string };
    if (!refreshToken) throw new HttpError(401, "UNAUTHORIZED", "Missing refresh token");
    const payload = jwt.verify(refreshToken, config.jwtSecret) as { sub: string; typ?: string };
    if (payload.typ !== "refresh") throw new HttpError(401, "UNAUTHORIZED", "Invalid token type");
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) throw new HttpError(404, "NOT_FOUND", "User does not exist");
    const token = jwt.sign({ sub: user.id, githubId: user.githubId }, config.jwtSecret, {
      expiresIn: config.jwtExpiresIn,
    });
    ok(res, { accessToken: token });
  } catch (err) {
    next(err);
  }
});

router.delete("/logout", (_req, _res) => {
  // Client discards its tokens; no server session to invalidate (stateless JWTs).
});

export default router;
```

### A3.6 Repositories routes

`apps/api/src/routes/repos.ts` — connect a repo, list repos, trigger analysis. Dispatch happens through the BullMQ queue defined in `services/analysis.ts`.

```ts
import { Router } from "express";
import { Octokit } from "octokit";
import { prisma } from "../db";
import { analysisQueue } from "../redis";
import type { AuthedRequest } from "../middleware/auth";
import { HttpError, ok } from "../middleware/errors";

const router = Router();

function parseRepoUrl(url: string): { owner: string; repo: string } {
  const match = url.match(/github\.com[/:]([^/]+)\/([^.#/?]+)(?:\.git)?/);
  if (!match) throw new HttpError(400, "INVALID_GITHUB_URL", "Provided URL is not a valid GitHub repository");
  return { owner: match[1], repo: match[2] };
}

router.post("/connect", async (req: AuthedRequest, res, next) => {
  try {
    const { repoUrl, accessToken } = req.body as { repoUrl?: string; accessToken?: string };
    if (!repoUrl || !accessToken) throw new HttpError(400, "VALIDATION_ERROR", "repoUrl and accessToken are required");
    const { owner, repo } = parseRepoUrl(repoUrl);

    const octokit = new Octokit({ auth: accessToken });
    const gh = await octokit.rest.repos.get({ owner, repo });
    const languages = await octokit.rest.repos.listLanguages({ owner, repo });
    const primaryLang = Object.entries(languages.data).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

    const fullName = `${owner}/${repo}`;
    const existing = await prisma.repository.findUnique({
      where: { userId_fullName: { userId: req.userId!, fullName } },
    });
    if (existing) throw new HttpError(409, "REPO_ALREADY_CONNECTED", "Repository is already connected to this account");

    const repository = await prisma.repository.create({
      data: {
        userId: req.userId!,
        fullName,
        defaultBranch: gh.data.default_branch,
        primaryLanguage: primaryLang,
      },
    });

    ok(res, repository, 201);
  } catch (err) {
    next(err);
  }
});

router.get("/", async (req: AuthedRequest, res, next) => {
  try {
    const repos = await prisma.repository.findMany({ where: { userId: req.userId } , orderBy: { createdAt: "desc" }});
    ok(res, repos);
  } catch (err) {
    next(err);
  }
});

router.get("/:repoId", async (req: AuthedRequest, res, next) => {
  try {
    const repo = await prisma.repository.findFirst({
      where: { id: req.params.repoId, userId: req.userId },
      include: { analysisJobs: { orderBy: { createdAt: "desc" }, take: 1 } },
    });
    if (!repo) throw new HttpError(404, "NOT_FOUND", "Repository does not exist");
    ok(res, repo);
  } catch (err) {
    next(err);
  }
});

router.post("/:repoId/analyze", async (req: AuthedRequest, res, next) => {
  try {
    const { accessToken } = req.body as { accessToken?: string };
    if (!accessToken) throw new HttpError(400, "VALIDATION_ERROR", "accessToken is required");

    const repo = await prisma.repository.findFirst({
      where: { id: req.params.repoId, userId: req.userId },
      include: { analysisJobs: { where: { status: { in: ["QUEUED", "RUNNING"] } } } },
    });
    if (!repo) throw new HttpError(404, "NOT_FOUND", "Repository does not exist");
    if (repo.analysisJobs.length > 0) throw new HttpError(409, "ANALYSIS_IN_PROGRESS", "An analysis job is already running for this repo");

    const job = await prisma.analysisJob.create({
      data: { repoId: repo.id, status: "QUEUED" },
    });
    await analysisQueue.add("analyze-repo", {
      repoId: repo.id,
      jobId: job.id,
      accessToken,
      fullName: repo.fullName,
      defaultBranch: repo.defaultBranch,
    });

    ok(res, { jobId: job.id, repoId: repo.id, status: "QUEUED" }, 202);
  } catch (err) {
    next(err);
  }
});

router.delete("/:repoId", async (req: AuthedRequest, res, next) => {
  try {
    const deleted = await prisma.repository.deleteMany({ where: { id: req.params.repoId, userId: req.userId } });
    if (deleted.count === 0) throw new HttpError(404, "NOT_FOUND", "Repository does not exist");
    ok(res, { deleted: true });
  } catch (err) {
    next(err);
  }
});

export default router;
```

> `ok(res, data, status)` — update `ok` in `middleware/errors.ts` to accept an optional third status argument: `ok(res, data, status = 200)`.

### A3.7 Artifacts routes

`apps/api/src/routes/artifacts.ts`:

```ts
import { Router } from "express";
import { prisma } from "../db";
import type { AuthedRequest } from "../middleware/auth";
import { HttpError, ok } from "../middleware/errors";

const router = Router();

router.get("/:repoId/artifacts", async (req: AuthedRequest, res, next) => {
  try {
    const artifacts = await prisma.artifact.findMany({ where: { repoId: req.params.repoId } });
    ok(res, artifacts);
  } catch (err) {
    next(err);
  }
});

router.get("/:repoId/:artifactType(architecture|modules|questions|dependency-graph)", async (req: AuthedRequest, res, next) => {
  try {
    const artifact = await prisma.artifact.findFirst({
      where: { repoId: req.params.repoId, artifactType: req.params.artifactType },
      orderBy: { version: "desc" },
    });
    if (!artifact) throw new HttpError(404, "NOT_FOUND", `No ${req.params.artifactType} artifact yet`);
    ok(res, artifact);
  } catch (err) {
    next(err);
  }
});

// Convenience aliases used by the frontend (module list, question bank).
// They read from CodeModule / Artifact rows; add real handlers here per
// routes in VIBE_CODER_API_SPEC.md §4.
router.get("/:repoId/modules", async (req: AuthedRequest, res, next) => {
  try {
    const modules = await prisma.codeModule.findMany({ where: { repoId: req.params.repoId } });
    ok(res, modules);
  } catch (err) {
    next(err);
  }
});

router.get("/:repoId/questions", async (req: AuthedRequest, res, next) => {
  try {
    const artifact = await prisma.artifact.findFirst({
      where: { repoId: req.params.repoId, artifactType: "questions" },
      orderBy: { version: "desc" },
    });
    if (!artifact) throw new HttpError(404, "NOT_FOUND", "No question bank yet");
    ok(res, artifact.content);
  } catch (err) {
    next(err);
  }
});

export default router;
```

### A3.8 Analysis dispatch service

`apps/api/src/services/analysis.ts` — a tiny client for the analysis worker's REST surface (progress polling fallback) plus the queue helper the routes already use. The worker pushes `analysis:progress` events over Redis→Socket.IO.

### A3.9 App factory & server entry

`apps/api/src/app.ts`:

```ts
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import type { AuthedRequest } from "./middleware/auth";
import { requireAuth } from "./middleware/auth";
import { errorHandler, notFound } from "./middleware/errors";

import authRoutes from "./routes/auth";
import userRoutes from "./routes/users";
import repoRoutes from "./routes/repos";
import artifactRoutes from "./routes/artifacts";
import chatRoutes from "./routes/chat";
import mockInterviewRoutes from "./routes/mockInterviews";
import usageRoutes from "./routes/usage";
import billingRoutes from "./routes/billing";

export function createApp() {
  const app = express();
  app.use(helmet());
  app.use(cors({ origin: process.env.FRONTEND_URL ?? "http://localhost:3000", credentials: true }));
  app.use(express.json({ limit: "5mb" }));
  app.use(pinoHttp());

  app.get("/health", (_req, res) => res.json({ ok: true, service: "api" }));

  app.use("/v1/auth", authRoutes);
  app.use("/v1/users", requireAuth, userRoutes);
  app.use("/v1/repos", requireAuth, repoRoutes);
  app.use("/v1/repos", requireAuth, artifactRoutes);
  app.use("/v1/chat", requireAuth, chatRoutes);
  app.use("/v1", requireAuth, mockInterviewRoutes);
  app.use("/v1/usage", requireAuth, usageRoutes);
  app.use("/v1/billing", billingRoutes);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
```

`apps/api/src/index.ts`:

```ts
import { createApp } from "./app";
import { config } from "./config";

createApp().listen(config.port, () => {
  console.log(`[api] listening on :${config.port}`);
});
```

Routes `users.ts` (`GET/PATCH /users/me`, `GET /users/me/subscription`), `chat.ts`, `mockInterviews.ts`, `usage.ts`, and `billing.ts` follow the same pattern — see the full route contracts in `VIBE_CODER_API_SPEC.md` §2–7.

Before moving on, verify it builds and boots:

```bash
cd apps/api
pnpm dev        # http://localhost:4000/health
```

---

## A4. WebSocket Server

Socket.IO server on **port 4001** with the Redis adapter so the Socket.IO clients (both chat and mock interview) are real-time even across multiple replicas.

`apps/websocket/package.json`:

```json
{
  "name": "@vibe-coder/websocket",
  "version": "0.1.0",
  "private": true,
  "main": "dist/index.js",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@vibe-coder/shared": "workspace:*",
    "@socket.io/redis-adapter": "^8.3.0",
    "bullmq": "^5.0.0",
    "dotenv": "^16.4.0",
    "ioredis": "^5.4.0",
    "jsonwebtoken": "^9.0.0",
    "socket.io": "^4.7.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "tsx": "^4.7.0",
    "typescript": "^5.4.0"
  }
}
```

`apps/websocket/src/index.ts`:

```ts
import { createServer } from "node:http";
import { Server, type Socket } from "socket.io";
import { Redis } from "ioredis";
import { createAdapter } from "@socket.io/redis-adapter";
import { Worker } from "bullmq";
import jwt from "jsonwebtoken";
import "dotenv/config";

const PORT = Number(process.env.PORT ?? 4001);
const JWT_SECRET = process.env.JWT_SECRET ?? "local-dev-jwt-secret-min-32-chars-long!!";
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

const pubClient = new Redis(REDIS_URL);
const subClient = pubClient.duplicate();

const httpServer = createServer();
const io = new Server(httpServer, {
  cors: { origin: process.env.FRONTEND_URL ?? "http://localhost:3000", credentials: true },
  adapter: createAdapter(pubClient, subClient),
});

// JWT auth handshake
io.use((socket: Socket, next) => {
  const token = socket.handshake.auth?.token as string | undefined;
  if (!token) return next(new Error("UNAUTHORIZED"));
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { sub: string; githubId: number };
    (socket.data as { userId: string }).userId = payload.sub;
    next();
  } catch {
    next(new Error("UNAUTHORIZED"));
  }
});

const REPO_ROOM = (userId: string, repoId: string) => `${userId}:repo:${repoId}`;

io.on("connection", (socket) => {
  const userId = (socket.data as { userId: string }).userId;

  socket.on("repo:join", ({ repoId }: { repoId: string }) => {
    socket.join(REPO_ROOM(userId, repoId));
  });

  socket.on("chat:send", ({ sessionId, content }) => {
    // Forward to the BullMQ chat worker → generation service → stream chunks back.
    // Implemented in handlers/chat.ts (see below).
  });

  socket.on("mock-interview:answer", ({ sessionId, answer }) => {
    // Forward to mock-interview engine; results come back as score events.
  });
});

export { io, REPO_ROOM };
```

`apps/websocket/src/handlers/chat.ts` — the streaming bridge. The BullMQ chat worker calls the Python generation service, then emits the `chat:stream:*`, `analysis:progress` events defined in Technical Spec §5.2:

```ts
import { io, REPO_ROOM } from "../index";

interface ChunkPayload {
  repoId: string;
  sessionId: string;
  messageId: string;
  delta: string;
  citations: { filePath: string; startLine: number; endLine: number; snippet: string }[];
}

export function broadcastChatChunk(userId: string, repoId: string, payload: ChunkPayload): void {
  io.to(REPO_ROOM(userId, repoId)).emit("chat:stream:chunk", payload);
}

export function broadcastAnalysisProgress(userId: string, repoId: string, stage: string, progress: number, message: string): void {
  io.to(REPO_ROOM(userId, repoId)).emit("analysis:progress", { repoId, stage, progress, message });
}
```

Redis pub/sub is how the worker and the Socket.IO server share updates: the worker publishes on the channel `job:{jobId}`, and `chat.ts` (running inside the Socket.IO process) subscribes and rebroadcasts to the room. With the Redis adapter, all Socket.IO replicas receive it.

---

## A5. Analysis Worker (BullMQ)

Consumes jobs from the `analysis` queue. Orchestrates the funnel: **clone → AST parse → chunk → index (dense + sparse) → generate artifacts**. Each step calls the appropriate Python service and updates the `AnalysisJob` row.

`apps/worker/package.json`:

```json
{
  "name": "@vibe-coder/worker",
  "version": "0.1.0",
  "private": true,
  "main": "dist/index.js",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@vibe-coder/shared": "workspace:*",
    "@prisma/client": "^5.14.0",
    "bullmq": "^5.0.0",
    "dotenv": "^16.4.0",
    "ioredis": "^5.4.0",
    "simple-git": "^3.24.0"
  },
  "devDependencies": { "tsx": "^4.7.0", "typescript": "^5.4.0" }
}
```

`apps/worker/src/index.ts`:

```ts
import "dotenv/config";
import { Worker } from "bullmq";
import { Redis } from "ioredis";
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
```

`apps/worker/src/jobs/analyzeRepo.ts` — the pipeline conductor. It calls the analysis, retrieval, and generation services over HTTP in sequence. Full pipeline details live in `VIBE_CODER_TECHNICAL_SPEC.md` §4.1 (stages: CLONING, PARSING, CHUNKING, EMBEDDING, SPARSE, GENERATING, DONE).

```ts
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { simpleGit } from "simple-git";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const ANALYSIS_URL = process.env.ANALYSIS_SERVICE_URL ?? "http://localhost:8100";
const RETRIEVAL_URL = process.env.RETRIEVAL_SERVICE_URL ?? "http://localhost:8200";
const GENERATION_URL = process.env.GENERATION_SERVICE_URL ?? "http://localhost:8300";

interface AnalyzeRepoData {
  repoId: string;
  jobId: string;
  accessToken: string;
  fullName: string;
  defaultBranch: string;
}

async function progress(jobId: string, stage: string, pct: number, message: string) {
  await prisma.analysisJob.update({
    where: { id: jobId },
    data: { stage, progress: pct },
  });
  // publish to Redis so the Socket.IO server rebroadcasts analysis:progress
  await progressPublisher.publish(
    "analysis-progress",
    JSON.stringify({ jobId, stage, progress: pct, message })
  );
}

const progressPublisher = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");

export async function analyzeRepo(data: AnalyzeRepoData) {
  const { repoId, jobId, accessToken, fullName, defaultBranch } = data;

  try {
    await prisma.analysisJob.update({ where: { id: jobId }, data: { status: "RUNNING", startedAt: new Date() } });
    await prisma.repository.update({ where: { id: repoId }, data: { status: "PARSING" } });

    // 1. CLONE (using the user's token so private repos work)
    await progress(jobId, "CLONING", 5, "Cloning repository");
    const dir = await mkdtemp(join(tmpdir(), "vibecoder-"));
    await simpleGit().clone(`https://x-access-token:${accessToken}@github.com/${fullName}.git`, dir, ["--depth", "1"]);

    // 2. PARSE + CHUNK → analysis service (Python, port 8100)
    await progress(jobId, "PARSING", 20, "Parsing AST");
    const parseRes = await fetch(`${ANALYSIS_URL}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId, repoId, repoPath: dir, language: "auto" }),
    });
    const parsed = (await parseRes.json()) as {
      modules: { name: string; path: string; fileCount: number; lineCount: number }[];
      symbols: unknown[];
      chunks: { text: string; filePath: string; startLine: number; endLine: number }[];
    };
    if (!parseRes.ok) throw new Error("analysis service failed");

    // Persist modules + symbols via Prisma (bulk create)
    for (const mod of parsed.modules) {
      await prisma.codeModule.upsert({
        where: { repoId_name: { repoId, name: mod.name } },
        update: { path: mod.path, fileCount: mod.fileCount, lineCount: mod.lineCount },
        create: { repoId, jobId, ...mod },
      });
    }

    // 3. INDEX (dense embeddings + sparse BM25) → retrieval service (port 8200)
    await progress(jobId, "CHUNKING", 45, "Indexing code");
    await fetch(`${RETRIEVAL_URL}/index`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId, repoId, chunks: parsed.chunks }),
    });
    await progress(jobId, "EMBEDDING", 60, "Embedding vectors");

    // 4. GENERATE artifacts (architecture, modules, questions) → generation service (port 8300)
    await progress(jobId, "GENERATING", 75, "Generating study artifacts");
    const artRes = await fetch(`${GENERATION_URL}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId, repoId, modules: parsed.modules }),
    });
    const artifacts = (await artRes.json()) as {
      type: string; content: Record<string, unknown>;
    }[];
    if (!artRes.ok) throw new Error("generation service failed");

    for (const artifact of artifacts) {
      await prisma.artifact.create({ data: { repoId, jobId, artifactType: artifact.type, content: artifact.content } });
    }

    // 5. DONE
    await prisma.repository.update({ where: { id: repoId }, data: { status: "READY", lastAnalyzedAt: new Date() } });
    await prisma.analysisJob.update({ where: { id: jobId }, data: { status: "SUCCEEDED", progress: 100, completedAt: new Date() } });
    await progress(jobId, "DONE", 100, "Analysis complete");
  } catch (err) {
    await prisma.repository.update({ where: { id: repoId }, data: { status: "FAILED" } }).catch(() => {});
    await prisma.analysisJob.update({
      where: { id: jobId },
      data: { status: "FAILED", errorMessage: (err as Error).message },
    }).catch(() => {});
    throw err;
  }
}
```

Keep `indexEmbeddings.ts`, `indexSparse.ts`, `generateQuestionBank.ts` as focused jobs called from `analyzeRepo` (or split into sub-queues later — the deployment guide shows how to scale each worker independently).

---

## A6. AST Parser Service (Python)

FastAPI on **port 8100**. Clones are already on disk when the worker calls it. It finds project entry files, parses structure (tree-sitter), extracts symbols, and emits line-precise chunks for indexing.

`packages/analysis/pyproject.toml`:

```toml
[tool.poetry]
name = "vibecoder-analysis"
version = "0.1.0"
description = "AST parsing and chunking for Vibe Coder"

[tool.poetry.dependencies]
python = "^3.11"
fastapi = "^0.111.0"
uvicorn = { extras = ["standard"], version = "^0.30.0" }
tree-sitter = "^0.21.0"
tree-sitter-languages = "^1.10.0"
pydantic = "^2.7.0"
pygments = "^2.17.0"

[tool.poetry.group.dev.dependencies]
pytest = "^8.2.0"
ruff = "^0.4.0"

[build-system]
requires = ["poetry-core"]
build-backend = "poetry.core.masonry.api"
```

`packages/analysis/src/analysis/main.py`:

```python
from fastapi import FastAPI
from pydantic import BaseModel

from .parser import parse_repo
from .chunker import chunk_source

app = FastAPI(title="Vibe Coder Analysis Service")


class AnalyzeRequest(BaseModel):
    jobId: str
    repoId: str
    repoPath: str
    language: str = "auto"


@app.get("/health")
def health() -> dict:
    return {"ok": True, "service": "analysis"}


@app.post("/analyze")
def analyze(req: AnalyzeRequest) -> dict:
    # 1. Walk the repo, filter to supported languages (see languages.py)
    # 2. tree-sitter parse each file -> symbols (name, signature, lines, deps)
    # 3. Group files into logical modules (by directory / package boundary)
    modules, symbols = parse_repo(req.repoPath)
    chunks: list[dict] = []
    for mod in modules:
        for path in mod["files"]:
            chunks.extend(chunk_source(path))
    return {"modules": modules, "symbols": symbols, "chunks": chunks}
```

`packages/analysis/src/analysis/chunker.py` — line-boundary chunking shared by all indexers:

```python
from pathlib import Path


def chunk_source(path: Path, max_lines: int = 120) -> list[dict]:
    """Chunk a source file into ~120-line windows."""
    text = Path(path).read_text(errors="replace").splitlines()
    if not text:
        return []
    chunks = []
    start = 0
    while start < len(text):
        end = min(start + max_lines, len(text))
        chunks.append(
            {
                "text": "\n".join(text[start:end]),
                "filePath": str(path),
                "startLine": start + 1,
                "endLine": end,
            }
        )
        start = end
    return chunks


def is_source_file(name: str) -> bool:
    return name.endswith((".py", ".ts", ".tsx", ".js", ".jsx", ".go", ".rs"))
```

`packages/analysis/src/analysis/parser.py` — module/symbol extraction and design-pattern detection from structural signatures (Platform Description §2, Phase 1):

```python
import os
from pathlib import Path

from .chunker import is_source_file


def parse_repo(repo_path: str) -> tuple[list[dict], list[dict]]:
    repo_path = Path(repo_path)
    modules: list[dict] = []
    symbols: list[dict] = []
    SKIP = {"node_modules", ".git", "dist", "build", "venv", "__pycache__"}

    for root, dirs, files in os.walk(repo_path):
        dirs[:] = [d for d in dirs if d not in SKIP]
        rel = Path(root).relative_to(repo_path)
        if rel.parts and rel.parts[0] in SKIP:
            continue
        src = [Path(root) / f for f in files if is_source_file(f)]
        if not src:
            continue
        name = str(rel).replace(os.sep, ":") or "root"
        line_count = sum(len(p.read_text(errors="replace").splitlines()) for p in src)
        modules.append({
            "name": name,
            "path": str(rel) if str(rel) else ".",
            "fileCount": len(src),
            "lineCount": line_count,
            "files": [str(p.relative_to(repo_path)) for p in src],
        })
        for p in src:
            symbols.extend(_parse_symbols(p))
    return modules, symbols


def _parse_symbols(path: Path) -> list[dict]:
    """Best-effort symbol extraction. Swap with real tree-sitter queries per
    language to get exact signatures, line ranges, and dependency edges."""
    out = []
    for i, line in enumerate(path.read_text(errors="replace").splitlines(), 1):
        stripped = line.lstrip()
        if stripped.startswith(("def ", "class ", "async def ", "export function", "export class", "function ")):
            out.append({
                "name": _first_identifier(stripped),
                "signature": stripped.rstrip(":"),
                "filePath": str(path),
                "startLine": i,
                "endLine": i,
                "symbolType": "class" if "class " in stripped[:12] else "function",
                "dependencies": [],
                "docstring": None,
            })
    return out


def _first_identifier(line: str) -> str:
    import re
    m = re.search(r"[\w$]+", line.split("(", 1)[0].replace("def ", "").replace("class ", "").replace("function ", ""))
    return m.group(0) if m else line
```

> In production, replace `_parse_symbols` with proper **tree-sitter** parsing so signatures, line ranges, and dependency edges are exact (the Technical Spec's `code_symbols` table). The chunking and service shape stay identical.

Run it:

```bash
cd packages/analysis
poetry install
poetry run uvicorn analysis.main:app --port 8100 --reload
```

---

## A7. Retrieval Engine (Hybrid Search)

FastAPI on **port 8200**. Implements the hybrid pipeline from Technical Spec §6: **dense embeddings** fused with **sparse BM25** via **Reciprocal Rank Fusion (RRF)**.

`packages/retrieval/pyproject.toml` — same header as `analysis`, plus:

```toml
openai = "^1.30.0"        # dense embeddings
pinecone-client = "^3.1.0"  # vector DB (or pgvector)
opensearch-py = "^2.4.0"    # sparse BM25 index
rank-bm25 = "^0.2.2"        # local BM25 fallback (unit tests / tiny repos)
httpx = "^0.27.0"
```

`packages/retrieval/src/retrieval/main.py`:

```python
from fastapi import FastAPI
from pydantic import BaseModel

from .indexing import index_dense, index_sparse
from .search import hybrid_search

app = FastAPI(title="Vibe Coder Retrieval Service")


class IndexReq(BaseModel):
    jobId: str
    repoId: str
    chunks: list[dict]


class SearchReq(BaseModel):
    repoId: str
    query: str
    top_k: int = 8


@app.post("/index")
def index_chunks(req: IndexReq) -> dict:
    index_dense(req.repoId, req.chunks)   # Pinecone (or pgvector) upserts
    index_sparse(req.repoId, req.chunks)  # OpenSearch BM25 index
    return {"indexed": len(req.chunks)}


@app.post("/search")
def search(req: SearchReq) -> dict:
    return hybrid_search(req.repoId, req.query, req.top_k)
```

`packages/retrieval/src/retrieval/rrf.py` — the fusion formula (Technical Spec §6.2):

```python
def reciprocal_rank_fusion(ranked_lists: list[list[dict]], k: int = 60) -> list[dict]:
    """Each input list is [{'id': ..., ...}, ...]. Fuses by reciprocal rank."""
    scores: dict[str, float] = {}
    meta: dict[str, dict] = {}
    for ranked in ranked_lists:
        for rank, item in enumerate(ranked):
            scores[item["id"]] = scores.get(item["id"], 0.0) + 1.0 / (k + rank + 1)
            meta.setdefault(item["id"], item)
    fused = sorted(scores.items(), key=lambda kv: kv[1], reverse=True)
    return [{**meta[i], "rrf_score": s} for i, s in fused]
```

`packages/retrieval/src/retrieval/search.py`:

```python
def hybrid_search(repo_id: str, query: str, top_k: int) -> dict:
    # 1. Dense: embed `query`, query Pinecone namespaced by repo_id
    dense = _query_dense(repo_id, query, top_k)
    # 2. Sparse: BM25 query against the OpenSearch index for this repo
    sparse = _query_sparse(repo_id, query, top_k)
    # 3. RRF fusion (+ optional cross-encoder rerank)
    fused = reciprocal_rank_fusion([dense, sparse])
    return {"hits": fused[:top_k], "fused": True}
```

`packages/retrieval/src/retrieval/indexing.py`:
- `index_dense(repo_id, chunks)`: embed each chunk with `openai.embeddings.create(model="text-embedding-3-small", ...)`, upsert into Pinecone under `namespace=repo_id` (or a `pgvector` table).
- `index_sparse(repo_id, chunks)`: bulk-index into OpenSearch `code_chunks` index with fields `id, repo_id, filePath, startLine, endLine, text`.

Each chunk needs a deterministic `id` (hash of `repo_id + filePath + startLine`) so re-analysis upserts instead of duplicating.

Run it:

```bash
cd packages/retrieval
poetry install
poetry run uvicorn retrieval.main:app --port 8200 --reload
```

---

## A8. Generation Service (LLM + Citations)

FastAPI on **port 8300**. Produces the citation-grounded artifacts and chat answers. Every claim pairs with a `Citation {filePath, startLine, endLine, snippet}` recovered from retrieval — the anti-hallucination guarantee from Platform Description §2, Phase 3.

`packages/generation/src/generation/main.py`:

```python
from fastapi import FastAPI
from pydantic import BaseModel

from .llm import complete

app = FastAPI(title="Vibe Coder Generation Service")


class GenerateReq(BaseModel):
    jobId: str
    repoId: str
    modules: list[dict]


class ChatReq(BaseModel):
    repoId: str
    query: str


@app.post("/generate")
def generate_artifacts(req: GenerateReq) -> list[dict]:
    from .architecture import build_architecture
    from .modules import build_module_explanations
    from .questions import build_question_bank

    return [
        {"type": "architecture", "content": build_architecture(req.repoId, req.modules)},
        {"type": "modules", "content": build_module_explanations(req.repoId, req.modules)},
        {"type": "questions", "content": build_question_bank(req.repoId, req.modules)},
        {"type": "dependency-graph", "content": build_dependency_graph(req.modules)},
    ]


@app.post("/chat")
def chat(req: ChatReq) -> dict:
    """RAG call: retrieve relevant chunks, then answer with inline citations."""
    hits = _retrieve(req.repoId, req.query)
    answer, citations = complete(req.query, hits)
    return {"message": answer, "citations": citations, "modelUsed": "demo"}
```

`packages/generation/src/generation/llm.py` — an offline demo stub that keeps the whole pipeline runnable without any LLM key; swap in real OpenAI/LangChain calls when `OPENAI_API_KEY` is set:

```python
import os


def complete(query: str, hits: list[dict]) -> tuple[str, list[dict]]:
    if not os.getenv("OPENAI_API_KEY"):
        h = hits[0]
        return (
            f"[demo answer] Based on {h['filePath']} ({h['startLine']}-{h['endLine']}):\n"
            + h["text"][:400],
            [_as_citation(h)],
        )
    return _openai_complete(query, hits)


def _as_citation(h: dict) -> dict:
    return {
        "filePath": h["filePath"],
        "startLine": h["startLine"],
        "endLine": h["endLine"],
        "snippet": h["text"][:200],
    }


def _openai_complete(query: str, hits: list[dict]) -> tuple[str, list[dict]]:
    from openai import OpenAI

    client = OpenAI()
    context = "\n\n".join(
        f"--- {h['filePath']}:{h['startLine']}-{h['endLine']} ---\n{h['text']}"
        for h in hits
    )
    resp = client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {
                "role": "system",
                "content": (
                    "You are a senior engineer preparing a candidate to explain "
                    "their own codebase in an interview. Answer precisely, reference "
                    "real file paths and line ranges, never invent APIs."
                ),
            },
            {"role": "user", "content": f"Relevant code:\n{context}\n\nQuestion: {query}"},
        ],
    )
    return resp.choices[0].message.content or "", [_as_citation(h) for h in hits]
```

The remaining modules map 1:1 to product features (Platform Description §3):
- `architecture.py` → `build_architecture`: system diagram, dependency graph, entry points, tech stack fingerprint.
- `modules.py` → `build_module_explanations`: purpose, key abstractions, internal walkthrough, failure modes, interview talking points.
- `questions.py` → `build_question_bank`: questions organized by category, difficulty, type (exploratory / adversarial / debugging / trade-off) with model answers.
- `citations.py` → normalizes raw hits to the `Citation` shape.

Run it:

```bash
cd packages/generation
poetry install
poetry run uvicorn generation.main:app --port 8300 --reload
```

---

## A9. Mock-Interview Engine

FastAPI on **port 8400**. Owns persona selection, sequential question delivery, real-time scoring, and the post-session report (Platform Description §3.4).

`packages/mock-interview/src/mock_interview/main.py`:

```python
from fastapi import FastAPI
from pydantic import BaseModel

from .personas import persona_for
from .scoring import score_answer
from .sessions import create_session, save_answer, next_question_for

app = FastAPI(title="Vibe Coder Mock-Interview Service")


class StartReq(BaseModel):
    repoId: str
    persona: str = "friendly-senior"
    difficulty: str = "junior"


class AnswerReq(BaseModel):
    sessionId: str
    questionId: str
    answer: str
    timeSpentSec: int


class NextReq(BaseModel):
    sessionId: str


@app.post("/sessions")
def start_session(req: StartReq) -> dict:
    session = create_session(req.repoId, persona_for(req.persona), req.difficulty)
    return session


@app.post("/sessions/{session_id}/answer")
def submit_answer(session_id: str, req: AnswerReq) -> dict:
    scores, feedback = score_answer(req.answer)
    save_answer(session_id, req.questionId, req.answer, req.timeSpentSec, scores, feedback)
    return {"questionId": req.questionId, "scores": scores, "feedback": feedback}


@app.post("/sessions/{session_id}/next")
def next_question(session_id: str, req: NextReq) -> dict:
    return next_question_for(session_id)
```

`scoring.py` — rubric scoring on clarity / depth / specificity / confidence (0-100 each), aligned to the evaluation framework in `VIBE_CODER_EVALUATION_FRAMEWORK.md`:

```python
def score_answer(answer: str) -> tuple[dict, str]:
    indicators = {
        "clarity": ["first", "then", "because", "for example"],
        "depth": ["trade-off", "edge case", "complexity", "constraint"],
        "specificity": ["file", "function", "module", "endpoint"],
        "confidence": ["i would", "we chose", "compared to"],
    }
    text = answer.lower()
    scores = {
        key: min(100, sum(1 for w in words if w in text) * 20)
        for key, words in indicators.items()
    }
    overall = round(sum(scores.values()) / len(scores))
    feedback = (
        "Strong structure — ground your claims with specific file names."
        if scores["specificity"] < 60
        else "Good specific references; add the trade-offs you considered."
    )
    return {"overall": overall, **scores}, feedback
```

`personas.py` defines the personas (friendly senior, rigorous hiring manager, system-design specialist, random shuffle). `sessions.py` holds session state and pulls the next question from the repo's `questions` artifact. `report.py` aggregates question scores into the final debrief report.

Run it:

```bash
cd packages/mock-interview
poetry install
poetry run uvicorn mock_interview.main:app --port 8400 --reload
```

---

# Part B — Frontend (Next.js)

## B1. App Setup

`apps/web/package.json`:

```json
{
  "name": "@vibe-coder/web",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev -p 3000",
    "build": "next build",
    "start": "next start -p 3000",
    "lint": "next lint",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@vibe-coder/shared": "workspace:*",
    "clsx": "^2.1.0",
    "lucide-react": "^0.358.0",
    "next": "^14.2.0",
    "next-auth": "^4.24.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "socket.io-client": "^4.7.0",
    "tailwind-merge": "^2.2.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "autoprefixer": "^10.4.0",
    "postcss": "^8.4.0",
    "tailwindcss": "^3.4.0",
    "typescript": "^5.4.0"
  }
}
```

`apps/web/next.config.ts`:

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@vibe-coder/shared"],
  async rewrites() {
    return [
      { source: "/api/v1/:path*", destination: `${process.env.API_URL ?? "http://localhost:4000"}/v1/:path*` },
    ];
  },
};

export default nextConfig;
```

The rewrite means the browser only talks to `localhost:3000`; the API prefix routes to the Express server without CORS headaches in development.

`apps/web/tailwind.config.ts`:

```ts
import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: { 50: "#eef2ff", 500: "#6366f1", 600: "#4f46e5", 900: "#312e81" },
      },
    },
  },
  plugins: [],
};
export default config;
```

`apps/web/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "preserve",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "noEmit": true,
    "allowJs": true,
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./src/*"],
      "@vibe-coder/shared": ["../../packages/shared/src"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

Install all workspace dependencies once from the root:

```bash
cd ../..
pnpm install
pnpm db:generate
```

## B2. API Client + Auth

`apps/web/src/lib/api.ts` — typed client speaking the shared envelope from API Spec §1.3:

```ts
import type { ApiResponse } from "@vibe-coder/shared";

const API = "/api/v1";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = localStorage.getItem("vc_token");
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const body = (await res.json()) as ApiResponse<T>;
  if (!body.ok || res.status >= 400) {
    const code = "error" in body ? body.error.code : "UNKNOWN";
    const message = "error" in body ? body.error.message : "Request failed";
    throw Object.assign(new Error(message), { code, status: res.status });
  }
  return body.data;
}

// Auth
export const authApi = {
  githubLogin: () => (window.location.href = `${API}/auth/github`),
  refresh: (refreshToken: string) =>
    request<{ accessToken: string }>("/auth/refresh", { method: "POST", body: JSON.stringify({ refreshToken }) }),
};

// Users
export const usersApi = {
  me: () => request<import("@vibe-coder/shared").User>("/users/me"),
  subscription: () => request<Record<string, unknown>>("/users/me/subscription"),
};

// Repositories
export const reposApi = {
  connect: (repoUrl: string, accessToken: string) =>
    request<import("@vibe-coder/shared").Repository>("/repos/connect", {
      method: "POST",
      body: JSON.stringify({ repoUrl, accessToken }),
    }),
  list: () => request<import("@vibe-coder/shared").Repository[]>("/repos"),
  get: (repoId: string) => request<import("@vibe-coder/shared").Repository>(`/repos/${repoId}`),
  analyze: (repoId: string, accessToken: string) =>
    request<{ jobId: string }>(`/repos/${repoId}/analyze`, { method: "POST", body: JSON.stringify({ accessToken }) }),
  disconnect: (repoId: string) => request<{ deleted: boolean }>(`/repos/${repoId}`, { method: "DELETE" }),
};

// Artifacts
export const artifactsApi = {
  list: (repoId: string) => request<unknown[]>(`/repos/${repoId}/artifacts`),
  get: <T>(repoId: string, type: "architecture" | "modules" | "questions" | "dependency-graph") =>
    request<T>(`/repos/${repoId}/${type}`),
};
```

`apps/web/src/lib/auth.ts` — next-auth config. The `/login` page reads `token` and `refresh` from the query string that the API's OAuth callback appends, then stores them and swaps to a session cookie for server components:

```ts
import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Vibe Coder JWT",
      credentials: { token: { label: "Token", type: "text" } },
      async authorize(credentials) {
        if (!credentials?.token) return null;
        return { id: credentials.token, name: "vc-user" } as never;
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.vcToken = (user as { id: string }).id;
      }
      return token;
    },
    async session({ session, token }) {
      (session as Record<string, unknown>).vcToken = token.vcToken;
      return session;
    },
  },
  pages: { signIn: "/login" },
  session: { strategy: "jwt" },
};

// Client-side helpers
export function setTokens(access: string, refresh: string) {
  localStorage.setItem("vc_token", access);
  localStorage.setItem("vc_refresh", refresh);
}

export function getToken() {
  return (
    localStorage.getItem("vc_token") ??
    // server components read the next-auth session token instead
    ""
  );
}
```

`apps/web/src/app/api/auth/[...nextauth]/route.ts`:

```ts
import NextAuth from "next-auth";
import { authOptions } from "@/lib/auth";

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
```

## B3. Pages & Features

All pages are serverside components that read the session, then delegate interactive parts to client components.

### B3.1 Root layout

`apps/web/src/app/layout.tsx`:

```tsx
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "@/app/globals.css";
import { AppShell } from "@/components/AppShell";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Vibe Coder — Master Your Own Code",
  description: "Turn any GitHub repo into an interview-ready study guide.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
```

Create `src/app/globals.css` with a Tailwind `@tailwind base; @tailwind components; @tailwind utilities;` and `postcss.config.js` wiring `tailwindcss` + `autoprefixer`.

### B3.2 Landing page

`apps/web/src/app/page.tsx`:

```tsx
export default function LandingPage() {
  return (
    <main className="mx-auto max-w-4xl px-6 py-20 text-center">
      <h1 className="text-5xl font-extrabold text-brand-900">
        You built it. <span className="text-brand-600">Can you explain it?</span>
      </h1>
      <p className="mt-6 text-lg text-gray-600">
        Connect any GitHub repository and Vibe Coder builds an interview-ready
        study guide from your actual code — architecture, module walkthroughs,
        a question bank, and a live mock-interview simulator.
      </p>
      <a
        href="/login"
        className="mt-8 inline-block rounded-lg bg-brand-600 px-6 py-3 font-semibold text-white hover:bg-brand-500"
      >
        Get started — connect a repo
      </a>
    </main>
  );
}
```

### B3.3 Login

`apps/web/src/app/login/page.tsx`:

```tsx
"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { setTokens } from "@/lib/auth";

export default function LoginPage() {
  const router = useRouter();
  const params = useSearchParams();

  useEffect(() => {
    const token = params.get("token");
    const refresh = params.get("refresh");
    if (token && refresh) {
      setTokens(token, refresh);
      signIn("credentials", { token, redirect: false }).then(() => {
        router.push("/dashboard");
      });
    }
  }, [params, router]);

  return (
    <main className="mx-auto max-w-md px-6 py-24 text-center">
      <h1 className="text-3xl font-bold text-brand-900">Welcome to Vibe Coder</h1>
      <p className="mt-2 text-gray-600">Sign in with GitHub to analyze your own repositories.</p>
      <a
        href="/api/v1/auth/github"
        className="mt-8 inline-block rounded-lg bg-gray-900 px-6 py-3 font-semibold text-white hover:bg-gray-700"
      >
        Continue with GitHub
      </a>
    </main>
  );
}
```

### B3.4 Dashboard (repo list + connect)

`apps/web/src/app/dashboard/page.tsx`:

```tsx
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { RepoConnect } from "@/components/RepoConnect";
import { RepoList } from "@/components/RepoList";

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="text-3xl font-bold text-gray-900">Your repositories</h1>
      <RepoConnect className="mt-6" />
      <RepoList className="mt-8" />
    </main>
  );
}
```

`apps/web/src/components/RepoConnect.tsx` — takes a repo URL + the user's GitHub PAT (or the OAuth `repo` scope token saved by auth) and calls `reposApi.connect`, then `reposApi.analyze`:

```tsx
"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { reposApi } from "@/lib/api";
import { getToken } from "@/lib/auth";

export function RepoConnect({ className }: { className?: string }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const pat = useRef("");

  const handleConnect = async () => {
    setBusy(true);
    try {
      const repo = await reposApi.connect(url, pat.current || getToken());
      await reposApi.analyze(repo.id, pat.current || getToken());
      router.push(`/repos/${repo.id}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={className}>
      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://github.com/owner/repo"
        className="w-full rounded-lg border border-gray-300 px-4 py-2"
      />
      <button
        onClick={handleConnect}
        disabled={busy || !url}
        className="mt-3 rounded-lg bg-brand-600 px-4 py-2 font-semibold text-white disabled:opacity-50"
      >
        {busy ? "Analyzing…" : "Analyze my code"}
      </button>
    </div>
  );
}
```

### B3.5 Repo overview + analysis progress

`apps/web/src/app/repos/[repoId]/page.tsx` — the hub that shows analysis status live via `AnalysisProgress` (socket events) and the artifact nav tabs.

```tsx
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { artifactsApi } from "@/lib/api";
import { RepoTabs } from "@/components/RepoTabs";
import { AnalysisProgress } from "@/components/AnalysisProgress";

export default async function RepoPage({ params }: { params: { repoId: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  const repo = await artifactsApi
    .list(params.repoId)
    .then(() => ({ repoId: params.repoId }));
  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <AnalysisProgress repoId={params.repoId} />
      <RepoTabs repoId={params.repoId} />
    </main>
  );
}
```

`apps/web/src/components/RepoTabs.tsx` — nav links to the four packed features:

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "clsx";

const tabs = [
  { href: "architecture", label: "Architecture" },
  { href: "modules", label: "Modules" },
  { href: "questions", label: "Question Bank" },
  { href: "chat", label: "Ask about my code" },
  { href: "interview", label: "Mock Interview" },
];

export function RepoTabs({ repoId }: { repoId: string }) {
  const pathname = usePathname();
  return (
    <nav className="mt-6 flex gap-2 border-b border-gray-200">
      {tabs.map((tab) => {
        const href = `/repos/${repoId}/${tab.href}`;
        const active = pathname === href;
        return (
          <Link
            key={tab.href}
            href={href}
            className={cx(
              "rounded-t-lg px-4 py-2 text-sm font-medium",
              active ? "border-b-2 border-brand-600 text-brand-600" : "text-gray-500 hover:text-gray-800"
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
```

### B3.6 Artifact pages

`apps/web/src/app/repos/[repoId]/architecture/page.tsx`:

```tsx
import { artifactsApi } from "@/lib/api";
import { ArtifactViewer } from "@/components/ArtifactViewer";

export default async function ArchitecturePage({ params }: { params: { repoId: string } }) {
  const artifact = await artifactsApi.get<Record<string, unknown>>(params.repoId, "architecture");
  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="text-2xl font-bold text-gray-900">Architecture Overview</h1>
      <ArtifactViewer content={artifact.content} />
    </main>
  );
}
```

`ArtifactViewer` renders the JSON artifact (system diagram, dependency graph, entry points, stack fingerprint) as cards and tree views. Mirror pages: `modules/page.tsx` (module cards; each links to `/repos/[repoId]/modules/[moduleId]` for the purpose/abstractions/failure-modes/talking-points breakdown) and `questions/page.tsx` (filterable question bank grouped by category and difficulty).

### B3.7 Dependency graph

Render the `dependency-graph` artifact with a lightweight SVG/D3 force layout. Keep it simple: nodes = modules, edges = imports, sized by coupling intensity from the spec.

## B4. Chat UI with Streaming

### B4.1 Socket client

`apps/web/src/lib/sockets.ts`:

```ts
"use client";

import { io, type Socket } from "socket.io-client";

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io(process.env.NEXT_PUBLIC_WS_URL ?? "http://localhost:4001", {
      auth: { token: localStorage.getItem("vc_token") },
    });
  }
  return socket;
}
```

`NEXT_PUBLIC_WS_URL=http://localhost:4001` goes in `apps/web/.env.local`.

### B4.2 Chat page + stream handler

`apps/web/src/app/repos/[repoId]/chat/page.tsx`:

```tsx
"use client";

import { use, useEffect, useRef, useState } from "react";
import { getSocket } from "@/lib/sockets";
import type { Citation, StreamChunkEvent } from "@vibe-coder/shared";

interface Msg { role: "user" | "assistant"; content: string; citations: Citation[]; }

export default function ChatPage({ params }: { params: { repoId: string } }) {
  const repoId = params.repoId; // client component params
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const socket = getSocket();

  useEffect(() => {
    socket.emit("repo:join", { repoId });
    socket.on("chat:stream:chunk", (ev: StreamChunkEvent) => {
      setMessages((prev) => {
        const last = prev[prev.length - 1] ?? { role: "assistant" as const, content: "", citations: [] };
        if (last.role !== "assistant") return [...prev];
        return [...prev.slice(0, -1), { role: "assistant", content: last.content + ev.delta, citations: ev.citations }];
      });
    });
    return () => {
      socket.off("chat:stream:chunk");
    };
  }, [repoId, socket]);

  const sendMessage = () => {
    if (!input.trim()) return;
    setMessages((prev) => [...prev, { role: "user", content: input, citations: [] }]);
    socket.emit("chat:send", { sessionId: "demo-session", content: input });
    setInput("");
  };

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="text-2xl font-bold text-gray-900">Ask about your code</h1>
      <div className="mt-6 space-y-4">
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "text-right" : "text-left"}>
            <div className={`inline-block rounded-lg px-4 py-2 ${m.role === "user" ? "bg-brand-600 text-white" : "bg-gray-100 text-gray-900"}`}>
              {m.content}
            </div>
            {m.citations.length > 0 && (
              <div className="mt-1 text-xs text-gray-500">
                {m.citations.map((c, j) => (
                  <span key={j}>{c.filePath}:{c.startLine}-{c.endLine}</span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="mt-6 flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && sendMessage()}
          className="flex-1 rounded-lg border border-gray-300 px-4 py-2"
          placeholder="How does authentication work in this project?"
        />
        <button onClick={sendMessage} className="rounded-lg bg-brand-600 px-4 py-2 font-semibold text-white">
          Send
        </button>
      </div>
    </main>
  );
}
```

> The WebSocket consumer on the backend runs the retrieval → generation flow and emits `chat:stream:start` / `chat:stream:chunk` / `chat:stream:end` per Technical Spec §5.2. In the demo stub the generation service returns a single bounded chunk, so streaming behaves the same without an LLM key.

## B5. Mock-Interview UI

`apps/web/src/app/repos/[repoId]/interview/page.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { getSocket } from "@/lib/sockets";
import type { InterviewQuestionEvent, InterviewScoreEvent } from "@vibe-coder/shared";

type Question = InterviewQuestionEvent & { answer?: string; scores?: InterviewScoreEvent["scores"]; feedback?: string };

export default function InterviewPage({ params }: { params: { repoId: string } }) {
  const repoId = params.repoId;
  const socket = getSocket();
  const [persona, setPersona] = useState("friendly-senior");
  const [question, setQuestion] = useState<Question | null>(null);
  const [answer, setAnswer] = useState("");
  const [log, setLog] = useState<Question[]>([]);

  useEffect(() => {
    socket.emit("repo:join", { repoId });
    socket.on("mock-interview:question", (q: InterviewQuestionEvent) => setQuestion(q as Question));
    socket.on("mock-interview:score", (s: InterviewScoreEvent & { questionId: string }) => {
      setLog((prev) => {
        const last = prev[prev.length - 1];
        return [...prev.slice(0, -1), { ...last, scores: s.scores, feedback: s.feedback }];
      });
    });
    socket.on("mock-interview:complete", (report: unknown) => {
      alert("Interview complete! Open the report panel for your debrief.");
      setQuestion(null);
    });
    return () => {
      socket.off("mock-interview:question");
      socket.off("mock-interview:score");
      socket.off("mock-interview:complete");
    };
  }, [repoId, socket]);

  const start = () => socket.emit("mock-interview:start", { repoId, persona });
  const submit = () => {
    if (!question) return;
    socket.emit("mock-interview:answer", { sessionId: "demo", answer });
    socket.emit("mock-interview:next", { sessionId: "demo" });
    setAnswer("");
  };

  if (!question) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-8 text-center">
        <h1 className="text-2xl font-bold text-gray-900">Mock Interview</h1>
        <p className="mt-2 text-gray-600">Rehearse explaining this repo under real interview pressure.</p>
        <select value={persona} onChange={(e) => setPersona(e.target.value)} className="mt-6 rounded-lg border border-gray-300 px-3 py-2">
          <option value="friendly-senior">Friendly senior deep-dive</option>
          <option value="hiring-manager">Rigorous hiring manager</option>
          <option value="random">Randomized persona</option>
        </select>
        <button onClick={start} className="mx-auto mt-4 block rounded-lg bg-brand-600 px-6 py-3 font-semibold text-white">
          Start interview
        </button>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Question {question.questionNumber}/{question.totalQuestions}</h1>
        <span className="text-sm text-gray-500">{question.category}</span>
      </div>
      <p className="mt-4 text-lg text-gray-900">{question.questionText}</p>
      <textarea
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        className="mt-6 min-h-40 w-full rounded-lg border border-gray-300 p-4"
        placeholder="Think aloud. Reference files, functions, and trade-offs…"
      />
      <button onClick={submit} className="mt-4 rounded-lg bg-brand-600 px-6 py-2 font-semibold text-white">
        Submit answer
      </button>
      {log.length > 0 && (
        <div className="mt-8 space-y-3">
          {log.map((l, i) => (
            <div key={i} className="rounded-lg border border-gray-200 p-4">
              <p className="font-medium">{l.questionText}</p>
              {l.scores && (
                <p className="mt-2 text-sm text-gray-600">
                  clarity {l.scores.clarity} · depth {l.scores.depth} · specificity {l.scores.specificity} · confidence {l.scores.confidence}
                </p>
              )}
              {l.feedback && <p className="mt-1 text-sm italic text-gray-500">{l.feedback}</p>}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
```

Finish the frontend by adding `AppShell.tsx` (top nav with logo, repo tabs, and a session-aware login/logout) and small empty-state components so the app boots cleanly before any backend data exists.

---

# Part C — Run Everything Locally

## C1. Infrastructure containers

`docker/docker-compose.yml` — Postgres, Redis, and OpenSearch are the three hard dependencies every service needs:

```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: vibecoder
      POSTGRES_PASSWORD: dev_password_123
      POSTGRES_DB: vibecoder_dev
    ports: ["5432:5432"]
    volumes: [pgdata:/var/lib/postgresql/data]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U vibecoder"]
      interval: 5s
      timeout: 3s
      retries: 10

  redis:
    image: redis:7
    ports: ["6379:6379"]
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 10

  opensearch:
    image: opensearchproject/opensearch:2.14.0
    environment:
      discovery.type: single-node
      OPENSEARCH_INITIAL_ADMIN_PASSWORD: Vibecoder123!
      plugins.security.disabled: "true"
    ports: ["9200:9200"]
    volumes: [osdata:/usr/share/opensearch/data]

volumes:
  pgdata:
  osdata:
```

Start them:

```bash
docker compose -f docker/docker-compose.yml up -d
docker compose -f docker/docker-compose.yml ps
```

If you run OpenSearch locally and have issues with the security plugin on 2.14+, use `opensearchproject/opensearch:2.11.1` which allows disabling the plugin cleanly in single-node dev mode.

## C2. Environment variables

Reference `.env` at the repo root (also used by each app via `dotenv`/`next`):

```bash
# Postgres / Redis
DATABASE_URL="postgresql://vibecoder:dev_password_123@localhost:5432/vibecoder_dev"
REDIS_URL="redis://localhost:6379"

# Auth
JWT_SECRET="local-dev-jwt-secret-min-32-chars-long!!"
JWT_EXPIRES_IN="15m"
GITHUB_CLIENT_ID=""          # from your GitHub OAuth App
GITHUB_CLIENT_SECRET=""      # from your GitHub OAuth App
GITHUB_WEBHOOK_SECRET=""
FRONTEND_URL="http://localhost:3000"
API_URL="http://localhost:4000"

# Python services
ANALYSIS_SERVICE_URL="http://localhost:8100"
RETRIEVAL_SERVICE_URL="http://localhost:8200"
GENERATION_SERVICE_URL="http://localhost:8300"
MOCK_INTERVIEW_SERVICE_URL="http://localhost:8400"

# Optional in dev (demo stubs kick in when unset)
OPENAI_API_KEY=""
PINECONE_API_KEY=""
PINECONE_INDEX="vibecoder-dev"
OPENSEARCH_URL="http://localhost:9200"

# Billing (optional in dev)
STRIPE_SECRET_KEY=""
STRIPE_WEBHOOK_SECRET=""
```

`apps/web/.env.local`:

```bash
NEXT_PUBLIC_WS_URL="http://localhost:4001"
API_URL="http://localhost:4000"
```

## C3. Boot order

```bash
# 1. Infrastructure
docker compose -f docker/docker-compose.yml up -d

# 2. Database schema + seed
pnpm db:generate
pnpm db:migrate
pnpm db:seed

# 3. Python services (four terminals)
poetry run uvicorn analysis.main:app                      --port 8100 --reload --app-dir packages/analysis/src
poetry run uvicorn retrieval.main:app                     --port 8200 --reload --app-dir packages/retrieval/src
poetry run uvicorn generation.main:app                    --port 8300 --reload --app-dir packages/generation/src
poetry run uvicorn mock_interview.main:app                --port 8400 --reload --app-dir packages/mock-interview/src

# 4. Node services (parallel)
pnpm --filter @vibe-coder/api dev        # :4000
pnpm --filter @vibe-coder/websocket dev  # :4001
pnpm --filter @vibe-coder/worker dev
pnpm --filter @vibe-coder/web dev        # :3000
```

Smoke-test the whole stack:

```bash
curl http://localhost:3000/health
curl http://localhost:4000/health
curl http://localhost:8100/health
curl http://localhost:8200/health
curl http://localhost:8300/health
curl http://localhost:8400/health
```

---

## 7. Environment Variables Reference

| Variable | Used by | Required locally | Notes |
|---|---|---|---|
| `DATABASE_URL` | api, worker, database | yes | Prisma connection string |
| `REDIS_URL` | api, websocket, worker | yes | Queues + Socket.IO adapter |
| `JWT_SECRET` | api, websocket | yes (default in code) | Min 32 chars in prod |
| `JWT_EXPIRES_IN` | api | no | Default `15m` |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | api | for OAuth login | From a GitHub OAuth App |
| `GITHUB_WEBHOOK_SECRET` | api | no (dev) | Push-triggered re-analysis |
| `ANALYSIS_SERVICE_URL` | api, worker | no | Default `:8100` |
| `RETRIEVAL_SERVICE_URL` | api, worker, generation | no | Default `:8200` |
| `GENERATION_SERVICE_URL` | api, worker | no | Default `:8300` |
| `MOCK_INTERVIEW_SERVICE_URL` | api, websocket | no | Default `:8400` |
| `OPENAI_API_KEY` | generation, retrieval | no | Demo stub when unset |
| `PINECONE_API_KEY` / `PINECONE_INDEX` | retrieval | no | `pgvector` fallback otherwise |
| `OPENSEARCH_URL` | retrieval | yes (indexing) | Default `http://localhost:9200` |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | api | no | Skip in dev |
| `FRONTEND_URL` / `API_URL` | api (OAuth redirect) | no | Dev defaults |

---

## 8. Seed Data

`packages/database/prisma/seed.ts` — creates a demo user, a connected demo repo, and one fake analysis so the UI has something to render before you do a real analysis:

```ts
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.upsert({
    where: { githubId: 12345678 },
    update: {},
    create: {
      githubId: 12345678,
      username: "demo-user",
      email: "demo@vibecoder.local",
      avatarUrl: "https://avatars.githubusercontent.com/u/12345678",
      planTier: "PRO",
      subscription: { create: { planTier: "PRO", reposRemaining: 20, chatsRemaining: 500, mockInterviewsRemaining: 20 } },
    },
  });

  const repo = await prisma.repository.upsert({
    where: { userId_fullName: { userId: user.id, fullName: "demo/repo" } },
    update: {},
    create: { userId: user.id, fullName: "demo/repo", primaryLanguage: "TypeScript", status: "READY" },
  });

  const existing = await prisma.artifact.findFirst({ where: { repoId: repo.id } });
  if (!existing) {
    await prisma.artifact.createMany({
      data: [
        {
          repoId: repo.id,
          artifactType: "architecture",
          content: {
            components: [
              { name: "API Gateway", role: "REST + auth", dependsOn: ["AUTH", "DB"] },
              { name: "Chat Worker", role: "RAG pipeline", dependsOn: ["RETRIEVAL", "LLM"] },
            ],
            entryPoints: ["src/index.ts"],
            stack: ["Next.js", "Express", "PostgreSQL", "Redis"],
          },
        },
        {
          repoId: repo.id,
          artifactType: "modules",
          content: {
            modules: [
              {
                name: "auth",
                purpose: "Issues JWTs after GitHub OAuth",
                abstractions: ["requireAuth", "refresh"],
                failureModes: ["expired token → 401"],
                talkingPoints: ["stateless JWT", "OAuth state == CSRF"],
              },
            ],
          },
        },
        {
          repoId: repo.id,
          artifactType: "questions",
          content: {
            categories: ["architecture", "security"],
            questions: [
              {
                category: "architecture",
                difficulty: "junior",
                type: "exploratory",
                question: "Walk me through the request lifecycle.",
                modelAnswer: "OAuth → JWT → repo routes → BullMQ job → Python workers …",
              },
            ],
          },
        },
      ],
    });
  }

  console.log("Seeded demo user, repo, and artifacts");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
```

---

## 9. Testing & Verification

### 9.1 TypeScript checks

```bash
pnpm typecheck               # every workspace
pnpm --filter @vibe-coder/api typecheck
pnpm --filter @vibe-coder/web typecheck
```

### 9.2 Python checks

```bash
cd packages/analysis && poetry run ruff check src && poetry run pytest
cd packages/retrieval && poetry run ruff check src && poetry run pytest
cd packages/generation && poetry run ruff check src && poetry run pytest
cd packages/mock-interview && poetry run ruff check src && poetry run pytest
```

### 9.3 End-to-end smoke test (no API keys needed)

1. `pnpm dev` and all four Python services running.
2. Login via GitHub OAuth (or use the seeded `demo-user` if you skip OAuth).
3. Connect `https://github.com/<you>/<some-small-repo>` with a read-only PAT.
4. Watch `/repos/:id` live-update through `analysis:progress` stages (CLONING → … → DONE).
5. Open **Architecture**, **Modules**, **Question Bank** — all populated from the demo-stub generation.
6. Ask a question in **Chat** — you get a stub answer with a citation line.
7. Run a **Mock Interview** — scores appear after each answer, then a completion event.

The full manual test matrix is in `VIBE_CODER_QA_TEST_PLAN.md` (ARCH / AUTH / CHAT / INTERV / RETREC / PERF suites). The evaluation harness in `VIBE_CODER_EVALUATION_FRAMEWORK.md` validates answer quality once real LLM keys are configured.

---

## 10. Build Order / Milestones

Implement in this order so each stage is runnable before the next:

| # | Milestone | Done when |
|---|---|---|
| 1 | **Scaffold + infra** | `pnpm install`, Postgres/Redis/OpenSearch up, health endpoints respond |
| 2 | **Database** | `prisma migrate dev`, seed runs, tables exist |
| 3 | **API service** | `/health`, `/v1/auth/github`, `/v1/users/me`, `/v1/repos` return envelopes |
| 4 | **Analysis pipeline** | Connect a repo → worker → AST service → retrieval index → artifacts in DB |
| 5 | **Generation** | Architecture/Modules/Questions artifacts generated (demo stub first, then real LLM) |
| 6 | **WebSocket + chat** | repo join rooms, streaming chunks reach the chat UI |
| 7 | **Mock interview** | persona start → Q&A → scores → completion report |
| 8 | **Web app polish** | dashboard, artifact viewer, graph, streaming UX, loading states |
| 9 | **Hardening** | rate limits, auth expiry, size limits (`REPO_TOO_LARGE`), error envelopes |
| 10 | **Deploy** | follow `VIBE_CODER_DEPLOYMENT_GUIDE.md`: Dockerfiles, ECS/Terraform, CI/CD |

---

## Quick Reference — Ports & Commands

| Service | Port | Dev command |
|---|---|---|
| Web (Next.js) | 3000 | `pnpm --filter @vibe-coder/web dev` |
| REST API | 4000 | `pnpm --filter @vibe-coder/api dev` |
| WebSocket | 4001 | `pnpm --filter @vibe-coder/websocket dev` |
| Worker (BullMQ) | — | `pnpm --filter @vibe-coder/worker dev` |
| Analysis (Python) | 8100 | `uvicorn analysis.main:app --port 8100` |
| Retrieval (Python) | 8200 | `uvicorn retrieval.main:app --port 8200` |
| Generation (Python) | 8300 | `uvicorn generation.main:app --port 8300` |
| Mock Interview (Python) | 8400 | `uvicorn mock_interview.main:app --port 8400` |
| PostgreSQL | 5432 | docker compose |
| Redis | 6379 | docker compose |
| OpenSearch | 9200 | docker compose |