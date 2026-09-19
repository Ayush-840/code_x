# Vibe Coder Technical Specification

## Database Schema & System Architecture

---

## 1. System Architecture Overview

### 1.1 High-Level Distributed Architecture

```
                            ┌─────────────────────────────────┐
                            │         CDN / Edge Layer         │
                            │      (CloudFront / Vercel)       │
                            └───────────────┬─────────────────┘
                                            │
                            ┌───────────────▼─────────────────┐
                            │      API Gateway / Load Balancer │
                            │         (AWS ALB / Kong)         │
                            └───────┬───────────────┬─────────┘
                                    │               │
                    ┌───────────────▼───┐   ┌───────▼───────────────┐
                    │  Web Application  │   │   WebSocket Server    │
                    │  (Next.js SSR)    │   │   (Chat / Streaming)  │
                    │  Port: 3000       │   │   Port: 8080          │
                    └───────────┬───────┘   └───────┬───────────────┘
                                │                   │
                ┌───────────────▼───────────────────▼───────────────┐
                │                   Service Mesh                     │
                │                                                    │
                │  ┌──────────┐ ┌──────────┐ ┌──────────────────┐  │
                │  │  Auth    │ │  Repo    │ │  Analysis        │  │
                │  │  Service │ │  Service │ │  Orchestrator    │  │
                │  └────┬─────┘ └────┬─────┘ └────────┬─────────┘  │
                │       │            │                 │            │
                │  ┌────▼─────┐ ┌────▼─────┐ ┌────────▼─────────┐  │
                │  │  AST     │ │ Retrieval│ │  Generation      │  │
                │  │  Parser  │ │  Engine  │ │  Service         │  │
                │  │  Service │ │          │ │  (LLM Gateway)   │  │
                │  └────┬─────┘ └────┬─────┘ └────────┬─────────┘  │
                │       │            │                 │            │
                │  ┌────▼─────┐ ┌────▼─────┐ ┌────────▼─────────┐  │
                │  │  Mock    │ │  Crawler │ │  Notification    │  │
                │  │  Interview│ │  Service │ │  Service         │  │
                │  │  Engine  │ │          │ │                  │  │
                │  └──────────┘ └──────────┘ └──────────────────┘  │
                │                                                    │
                └───────────────────────────────────────────────────┘
                                │               │
                ┌───────────────▼───────────────▼───────────────────┐
                │                  Data Layer                        │
                │                                                    │
                │  ┌──────────┐ ┌──────────┐ ┌──────────────────┐  │
                │  │PostgreSQL│ │  Redis   │ │  Elasticsearch   │  │
                │  │ (Primary │ │ (Cache / │ │  (Sparse Index)  │  │
                │  │  DB)     │ │  Queue)  │ │                  │  │
                │  └──────────┘ └──────────┘ └──────────────────┘  │
                │                                                    │
                │  ┌──────────┐ ┌──────────────────────────────┐   │
                │  │  S3 /    │ │  Vector Database             │   │
                │  │  Blob    │ │  (Pinecone / pgvector)       │   │
                │  │ Storage  │ │  (Dense Embeddings)          │   │
                │  └──────────┘ └──────────────────────────────┘   │
                │                                                    │
                └───────────────────────────────────────────────────┘
```

### 1.2 Service Responsibilities

| Service | Responsibility | Technology | Scaling Strategy |
|---|---|---|---|
| **Web Application** | SSR rendering, static assets, page routing | Next.js 14+ (App Router) | Horizontal via container replicas |
| **WebSocket Server** | Real-time chat streaming, mock interview sessions | Socket.IO / ws | Sticky sessions, Redis adapter |
| **Auth Service** | OAuth2 (GitHub), JWT management, session handling | Node.js + Passport.js | Stateless, horizontally scalable |
| **Repo Service** | GitHub API integration, repo cloning, webhook management | Node.js + Octokit | Queue-backed, rate-limited |
| **Analysis Orchestrator** | Coordinates the full analysis pipeline, job scheduling | Node.js + BullMQ | Worker pool scaling |
| **AST Parser Service** | Multi-language parsing, symbol extraction, pattern detection | Rust (Tree-sitter bindings) / Python | CPU-bound, vertical scaling |
| **Retrieval Engine** | Hybrid search, RRF fusion, reranking | Python + FastAPI | Stateless, horizontally scalable |
| **Generation Service** | LLM orchestration, prompt management, citation grounding | Python + LangChain | Token-bucket rate limiting |
| **Mock Interview Engine** | Persona simulation, scoring, session management | Python + FastAPI | In-memory session state, Redis-backed |
| **Crawler Service** | Deep repo scanning, file tree extraction, config detection | Node.js + isomorphic-git | Queue-backed, parallel workers |
| **Notification Service** | Email alerts, analysis completion, webhook delivery | Node.js + Nodemailer | Async via Redis queue |

---

## 2. Database Schema (PostgreSQL)

### 2.1 Entity-Relationship Diagram

```
┌──────────────┐       ┌──────────────────┐       ┌──────────────────┐
│    users      │       │  repositories    │       │  analysis_jobs   │
├──────────────┤       ├──────────────────┤       ├──────────────────┤
│ id (PK)      │──┐    │ id (PK)          │──┐    │ id (PK)          │
│ github_id    │  │    │ user_id (FK)     │  │    │ repo_id (FK)     │
│ email        │  ├───▶│ full_name        │  ├───▶│ status           │
│ username     │  │    │ default_branch   │  │    │ started_at       │
│ avatar_url   │  │    │ language_primary │  │    │ completed_at     │
│ plan_tier    │  │    │ total_files      │  │    │ error_message    │
│ created_at   │  │    │ total_lines      │  │    │ worker_id        │
│ updated_at   │  │    │ last_analyzed_at │  │    │ created_at       │
└──────────────┘  │    └──────────────────┘  │    └──────────────────┘
                  │                           │
                  │    ┌──────────────────┐   │    ┌──────────────────┐
                  │    │ code_modules     │   │    │ analysis_        │
                  │    ├──────────────────┤   │    │ artifacts        │
                  │    │ id (PK)          │   │    ├──────────────────┤
                  │    │ repo_id (FK)     │───┘    │ id (PK)          │
                  │    │ job_id (FK)      │        │ job_id (FK)      │
                  │    │ name             │        │ artifact_type    │
                  │    │ path             │        │ content (JSONB)  │
                  │    │ purpose_summary  │        │ version          │
                  │    │ complexity_score │        │ generated_at     │
                  │    │ file_count       │        └──────────────────┘
                  │    │ line_count       │
                  │    │ created_at       │
                  │    └──────────────────┘
                  │
                  │    ┌──────────────────┐       ┌──────────────────┐
                  │    │ code_symbols     │       │ interview_       │
                  │    ├──────────────────┤       │ sessions         │
                  │    │ id (PK)          │       ├──────────────────┤
                  │    │ module_id (FK)   │       │ id (PK)          │
                  │    │ symbol_type      │       │ user_id (FK)     │
                  │    │ name             │       │ repo_id (FK)     │
                  │    │ signature        │       │ persona          │
                  │    │ file_path        │       │ difficulty       │
                  │    │ start_line       │       │ status           │
                  │    │ end_line         │       │ score_overall    │
                  │    │ complexity       │       │ score_clarity    │
                  │    │ dependencies     │       │ score_depth      │
                  │    │ docstring        │       │ score_specificity│
                  │    └──────────────────┘       │ started_at       │
                  │                                │ completed_at     │
                  │    ┌──────────────────┐       └──────────────────┘
                  │    │ embeddings       │
                  │    ├──────────────────┤
                  │    │ id (PK)          │
                  │    │ symbol_id (FK)   │
                  │    │ chunk_text       │
                  │    │ vector_id        │
                  │    │ embedding_model  │
                  │    │ created_at       │
                  │    └──────────────────┘
                  │
                  │    ┌──────────────────┐       ┌──────────────────┐
                  │    │ chat_messages    │       │ mock_interview_  │
                  │    ├──────────────────┤       │ questions        │
                  │    │ id (PK)          │       ├──────────────────┤
                  │    │ session_id (FK)  │       │ id (PK)          │
                  │    │ role             │       │ session_id (FK)  │
                  │    │ content          │       │ question_text    │
                  │    │ citations (JSONB)│       │ answer_text      │
                  │    │ tokens_used      │       │ citations (JSONB)│
                  │    │ created_at       │       │ score            │
                  │    └──────────────────┘       │ feedback         │
                  │                                │ time_spent_sec   │
                  │    ┌──────────────────┐       │ created_at       │
                  └───▶│ subscriptions    │       └──────────────────┘
                       ├──────────────────┤
                       │ id (PK)          │
                       │ user_id (FK)     │
                       │ plan_tier        │
                       │ repos_remaining  │
                       │ chats_remaining  │
                       │ mock_interviews_ │
                       │   remaining      │
                       │ billing_cycle    │
                       │ created_at       │
                       │ expires_at       │
                       └──────────────────┘
```

### 2.2 Complete Table Definitions

```sql
-- ============================================================
-- TABLE: users
-- Core user accounts, linked to GitHub OAuth
-- ============================================================
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    github_id       BIGINT UNIQUE NOT NULL,
    email           VARCHAR(255) UNIQUE NOT NULL,
    username        VARCHAR(100) UNIQUE NOT NULL,
    display_name    VARCHAR(255),
    avatar_url      TEXT,
    bio             TEXT,
    plan_tier       VARCHAR(20) DEFAULT 'free'
                        CHECK (plan_tier IN ('free', 'starter', 'pro', 'institutional')),
    github_token    TEXT,  -- encrypted at rest via pgcrypto
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_users_github_id ON users(github_id);
CREATE INDEX idx_users_email ON users(email);

-- ============================================================
-- TABLE: repositories
-- Connected GitHub repositories
-- ============================================================
CREATE TABLE repositories (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    github_repo_id  BIGINT UNIQUE NOT NULL,
    full_name       VARCHAR(500) NOT NULL,  -- e.g., "user/repo"
    default_branch  VARCHAR(100) DEFAULT 'main',
    language_primary VARCHAR(50),
    languages       JSONB DEFAULT '{}',     -- {"JavaScript": 12500, "TypeScript": 8300}
    total_files     INTEGER DEFAULT 0,
    total_lines     INTEGER DEFAULT 0,
    visibility      VARCHAR(20) DEFAULT 'private'
                        CHECK (visibility IN ('public', 'private')),
    last_analyzed_at TIMESTAMPTZ,
    analysis_count  INTEGER DEFAULT 0,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(user_id, github_repo_id)
);

CREATE INDEX idx_repos_user_id ON repositories(user_id);
CREATE INDEX idx_repos_full_name ON repositories(full_name);

-- ============================================================
-- TABLE: analysis_jobs
-- Tracks each analysis run on a repository
-- ============================================================
CREATE TABLE analysis_jobs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    repo_id         UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    status          VARCHAR(20) DEFAULT 'queued'
                        CHECK (status IN (
                            'queued', 'cloning', 'parsing',
                            'indexing', 'generating', 'completed', 'failed'
                        )),
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    error_message   TEXT,
    error_trace     TEXT,
    worker_id       VARCHAR(100),
    config          JSONB DEFAULT '{}',     -- analysis parameters
    stats           JSONB DEFAULT '{}',     -- {"files_parsed": 342, "symbols_extracted": 1847}
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_jobs_repo_id ON analysis_jobs(repo_id);
CREATE INDEX idx_jobs_status ON analysis_jobs(status);
CREATE INDEX idx_jobs_created_at ON analysis_jobs(created_at DESC);

-- ============================================================
-- TABLE: code_modules
-- Logical modules extracted from the repository
-- ============================================================
CREATE TABLE code_modules (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    repo_id         UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    job_id          UUID NOT NULL REFERENCES analysis_jobs(id) ON DELETE CASCADE,
    name            VARCHAR(255) NOT NULL,
    path            TEXT NOT NULL,
    module_type     VARCHAR(50) NOT NULL
                        CHECK (module_type IN (
                            'service', 'controller', 'model', 'middleware',
                            'util', 'config', 'test', 'hook', 'component',
                            'page', 'store', 'schema', 'migration', 'other'
                        )),
    purpose_summary TEXT,
    key_abstractions JSONB DEFAULT '[]',    -- ["UserService", "AuthMiddleware"]
    internal_logic   TEXT,
    failure_modes   JSONB DEFAULT '[]',
    interview_points JSONB DEFAULT '[]',
    complexity_score FLOAT DEFAULT 0.0,
    file_count      INTEGER DEFAULT 0,
    line_count      INTEGER DEFAULT 0,
    coupling_score  FLOAT DEFAULT 0.0,     -- 0=loose, 1=tight
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_modules_repo_id ON code_modules(repo_id);
CREATE INDEX idx_modules_job_id ON code_modules(job_id);
CREATE INDEX idx_modules_type ON code_modules(module_type);

-- ============================================================
-- TABLE: code_symbols
-- Individual symbols (functions, classes, variables, etc.)
-- ============================================================
CREATE TABLE code_symbols (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    module_id       UUID NOT NULL REFERENCES code_modules(id) ON DELETE CASCADE,
    symbol_type     VARCHAR(50) NOT NULL
                        CHECK (symbol_type IN (
                            'function', 'class', 'interface', 'type',
                            'enum', 'variable', 'constant', 'method',
                            'hook', 'route', 'middleware', 'schema',
                            'migration', 'other'
                        )),
    name            VARCHAR(500) NOT NULL,
    signature       TEXT,
    file_path       TEXT NOT NULL,
    start_line      INTEGER NOT NULL,
    end_line        INTEGER NOT NULL,
    complexity      FLOAT DEFAULT 0.0,
    docstring       TEXT,
    annotations     JSONB DEFAULT '[]',    -- decorators, annotations
    parameters      JSONB DEFAULT '[]',    -- [{"name": "id", "type": "string"}]
    return_type     VARCHAR(255),
    visibility      VARCHAR(20) DEFAULT 'public',
    is_exported     BOOLEAN DEFAULT FALSE,
    dependencies    JSONB DEFAULT '[]',    -- symbols this one depends on
    dependents      JSONB DEFAULT '[]',    -- symbols that depend on this one
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_symbols_module_id ON code_symbols(module_id);
CREATE INDEX idx_symbols_type ON code_symbols(symbol_type);
CREATE INDEX idx_symbols_name ON code_symbols(name);
CREATE INDEX idx_symbols_file_path ON code_symbols(file_path);

-- ============================================================
-- TABLE: code_chunks
-- Text chunks for retrieval (split from source files)
-- ============================================================
CREATE TABLE code_chunks (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    repo_id         UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    symbol_id       UUID REFERENCES code_symbols(id) ON DELETE SET NULL,
    file_path       TEXT NOT NULL,
    start_line      INTEGER NOT NULL,
    end_line        INTEGER NOT NULL,
    content         TEXT NOT NULL,
    chunk_type      VARCHAR(50) NOT NULL
                        CHECK (chunk_type IN (
                            'file', 'function', 'class', 'module_doc',
                            'config', 'test', 'comment_block', 'other'
                        )),
    token_count     INTEGER DEFAULT 0,
    embedding_id    VARCHAR(255),  -- reference to vector store
    embedding_model VARCHAR(100),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_chunks_repo_id ON code_chunks(repo_id);
CREATE INDEX idx_chunks_symbol_id ON code_chunks(symbol_id);
CREATE INDEX idx_chunks_file_path ON code_chunks(file_path);

-- ============================================================
-- TABLE: analysis_artifacts
-- Generated outputs (architecture doc, question banks, etc.)
-- ============================================================
CREATE TABLE analysis_artifacts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id          UUID NOT NULL REFERENCES analysis_jobs(id) ON DELETE CASCADE,
    artifact_type   VARCHAR(50) NOT NULL
                        CHECK (artifact_type IN (
                            'architecture_overview', 'module_explanation',
                            'question_bank', 'dependency_graph',
                            'tech_stack_report', 'interview_guide',
                            'mock_interview_rubric', 'study_plan'
                        )),
    title           VARCHAR(500),
    content         JSONB NOT NULL,
    version         INTEGER DEFAULT 1,
    generated_at    TIMESTAMPTZ DEFAULT NOW(),
    token_count     INTEGER DEFAULT 0,
    model_used      VARCHAR(100)
);

CREATE INDEX idx_artifacts_job_id ON analysis_artifacts(job_id);
CREATE INDEX idx_artifacts_type ON analysis_artifacts(artifact_type);

-- ============================================================
-- TABLE: interview_questions
-- Generated interview questions with model answers
-- ============================================================
CREATE TABLE interview_questions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    artifact_id     UUID NOT NULL REFERENCES analysis_artifacts(id) ON DELETE CASCADE,
    repo_id         UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    category        VARCHAR(50) NOT NULL
                        CHECK (category IN (
                            'architecture', 'data_modeling', 'api_design',
                            'security', 'performance', 'testing',
                            'devops', 'debugging', 'trade_offs'
                        )),
    difficulty      VARCHAR(20) NOT NULL
                        CHECK (difficulty IN ('junior', 'mid', 'senior')),
    question_type   VARCHAR(30) NOT NULL
                        CHECK (question_type IN (
                            'exploratory', 'adversarial', 'debugging',
                            'trade_off', 'deep_dive', 'scenario'
                        )),
    question_text   TEXT NOT NULL,
    model_answer    TEXT NOT NULL,
    citations       JSONB DEFAULT '[]',
    follow_ups      JSONB DEFAULT '[]',
    tips            TEXT,
    source_modules  JSONB DEFAULT '[]',
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_questions_repo_id ON interview_questions(repo_id);
CREATE INDEX idx_questions_category ON interview_questions(category);
CREATE INDEX idx_questions_difficulty ON interview_questions(difficulty);

-- ============================================================
-- TABLE: chat_sessions
-- Chat sessions per repository
-- ============================================================
CREATE TABLE chat_sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    repo_id         UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    title           VARCHAR(255),
    mode            VARCHAR(30) DEFAULT 'general'
                        CHECK (mode IN (
                            'general', 'mock_interview', 'study_guide',
                            'deep_dive', 'architecture_review'
                        )),
    message_count   INTEGER DEFAULT 0,
    total_tokens    INTEGER DEFAULT 0,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_chat_user_id ON chat_sessions(user_id);
CREATE INDEX idx_chat_repo_id ON chat_sessions(repo_id);

-- ============================================================
-- TABLE: chat_messages
-- Individual messages in a chat session
-- ============================================================
CREATE TABLE chat_messages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id      UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    role            VARCHAR(20) NOT NULL
                        CHECK (role IN ('user', 'assistant', 'system')),
    content         TEXT NOT NULL,
    citations       JSONB DEFAULT '[]',
    metadata        JSONB DEFAULT '{}',
    tokens_used     INTEGER DEFAULT 0,
    model_used      VARCHAR(100),
    latency_ms      INTEGER,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_messages_session_id ON chat_messages(session_id);
CREATE INDEX idx_messages_created_at ON chat_messages(created_at);

-- ============================================================
-- TABLE: mock_interview_sessions
-- Mock interview simulator sessions
-- ============================================================
CREATE TABLE mock_interview_sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    repo_id         UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    persona         VARCHAR(50) NOT NULL
                        CHECK (persona IN (
                            'friendly_senior', 'rigorous_hiring_manager',
                            'curious_peer', 'stressed_tech_lead',
                            'detailed_reviewer', 'random'
                        )),
    difficulty      VARCHAR(20) DEFAULT 'mid'
                        CHECK (difficulty IN ('junior', 'mid', 'senior')),
    question_count  INTEGER DEFAULT 0,
    score_overall   FLOAT,
    score_clarity   FLOAT,
    score_depth     FLOAT,
    score_specificity FLOAT,
    score_confidence FLOAT,
    time_spent_sec  INTEGER DEFAULT 0,
    feedback_summary TEXT,
    strengths       JSONB DEFAULT '[]',
    weaknesses      JSONB DEFAULT '[]',
    study_recommendations JSONB DEFAULT '[]',
    status          VARCHAR(20) DEFAULT 'active'
                        CHECK (status IN ('active', 'completed', 'abandoned')),
    started_at      TIMESTAMPTZ DEFAULT NOW(),
    completed_at    TIMESTAMPTZ
);

CREATE INDEX idx_mock_user_id ON mock_interview_sessions(user_id);
CREATE INDEX idx_mock_repo_id ON mock_interview_sessions(repo_id);
CREATE INDEX idx_mock_status ON mock_interview_sessions(status);

-- ============================================================
-- TABLE: mock_interview_questions
-- Individual questions within a mock interview
-- ============================================================
CREATE TABLE mock_interview_questions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id      UUID NOT NULL REFERENCES mock_interview_sessions(id) ON DELETE CASCADE,
    sequence_num    INTEGER NOT NULL,
    question_text   TEXT NOT NULL,
    question_category VARCHAR(50),
    answer_text     TEXT,
    citations       JSONB DEFAULT '[]',
    score           FLOAT,
    feedback        TEXT,
    time_spent_sec  INTEGER DEFAULT 0,
    is_coaching_break BOOLEAN DEFAULT FALSE,
    coaching_note   TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_mock_q_session_id ON mock_interview_questions(session_id);

-- ============================================================
-- TABLE: dependency_edges
-- Module-to-module dependency graph
-- ============================================================
CREATE TABLE dependency_edges (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    repo_id         UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    source_module_id UUID NOT NULL REFERENCES code_modules(id) ON DELETE CASCADE,
    target_module_id UUID NOT NULL REFERENCES code_modules(id) ON DELETE CASCADE,
    edge_type       VARCHAR(30) NOT NULL
                        CHECK (edge_type IN (
                            'imports', 'calls', 'extends',
                            'implements', 'configures', 'tests'
                        )),
    weight          FLOAT DEFAULT 1.0,
    file_path       TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(repo_id, source_module_id, target_module_id, edge_type)
);

CREATE INDEX idx_deps_repo_id ON dependency_edges(repo_id);
CREATE INDEX idx_deps_source ON dependency_edges(source_module_id);
CREATE INDEX idx_deps_target ON dependency_edges(target_module_id);

-- ============================================================
-- TABLE: subscriptions
-- Usage tracking and billing
-- ============================================================
CREATE TABLE subscriptions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan_tier           VARCHAR(20) NOT NULL
                            CHECK (plan_tier IN ('free', 'starter', 'pro', 'institutional')),
    repos_limit         INTEGER NOT NULL,
    repos_remaining     INTEGER NOT NULL,
    chats_limit         INTEGER NOT NULL,
    chats_remaining     INTEGER NOT NULL,
    mock_interviews_limit INTEGER NOT NULL,
    mock_interviews_remaining INTEGER NOT NULL,
    tokens_limit        BIGINT NOT NULL,
    tokens_remaining    BIGINT NOT NULL,
    billing_cycle       VARCHAR(20) DEFAULT 'monthly'
                            CHECK (billing_cycle IN ('monthly', 'yearly', 'semester', 'custom')),
    stripe_subscription_id VARCHAR(255),
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    expires_at          TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_sub_user_id ON subscriptions(user_id);
CREATE INDEX idx_sub_expires ON subscriptions(expires_at);

-- ============================================================
-- TABLE: usage_events
-- Detailed usage tracking for analytics
-- ============================================================
CREATE TABLE usage_events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_type      VARCHAR(50) NOT NULL
                        CHECK (event_type IN (
                            'repo_connected', 'analysis_started',
                            'analysis_completed', 'chat_message',
                            'mock_interview_started', 'mock_interview_completed',
                            'question_generated', 'export_downloaded'
                        )),
    repo_id         UUID REFERENCES repositories(id) ON DELETE SET NULL,
    metadata        JSONB DEFAULT '{}',
    tokens_used     INTEGER DEFAULT 0,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_usage_user_id ON usage_events(user_id);
CREATE INDEX idx_usage_type ON usage_events(event_type);
CREATE INDEX idx_usage_created_at ON usage_events(created_at DESC);
```

---

## 3. Data Models (Application Layer)

### 3.1 TypeScript Interfaces

```typescript
// ============================================================
// Core Domain Models
// ============================================================

interface User {
  id: string;
  githubId: number;
  email: string;
  username: string;
  displayName: string;
  avatarUrl: string;
  planTier: 'free' | 'starter' | 'pro' | 'institutional';
  createdAt: Date;
  updatedAt: Date;
}

interface Repository {
  id: string;
  userId: string;
  githubRepoId: number;
  fullName: string;           // "owner/repo"
  defaultBranch: string;
  languagePrimary: string;
  languages: Record<string, number>;
  totalFiles: number;
  totalLines: number;
  visibility: 'public' | 'private';
  lastAnalyzedAt: Date | null;
  analysisCount: number;
}

interface AnalysisJob {
  id: string;
  repoId: string;
  status: 'queued' | 'cloning' | 'parsing' | 'indexing' | 'generating' | 'completed' | 'failed';
  startedAt: Date | null;
  completedAt: Date | null;
  errorMessage: string | null;
  stats: {
    filesParsed: number;
    symbolsExtracted: number;
    chunksCreated: number;
    embeddingsGenerated: number;
    tokensUsed: number;
  };
}

interface CodeModule {
  id: string;
  repoId: string;
  jobId: string;
  name: string;
  path: string;
  moduleType: 'service' | 'controller' | 'model' | 'middleware' | 'util'
    | 'config' | 'test' | 'hook' | 'component' | 'page' | 'store'
    | 'schema' | 'migration' | 'other';
  purposeSummary: string;
  keyAbstractions: string[];
  internalLogic: string;
  failureModes: FailureMode[];
  interviewPoints: string[];
  complexityScore: number;
  fileCount: number;
  lineCount: number;
  couplingScore: number;
}

interface CodeSymbol {
  id: string;
  moduleId: string;
  symbolType: 'function' | 'class' | 'interface' | 'type' | 'enum'
    | 'variable' | 'constant' | 'method' | 'hook' | 'route'
    | 'middleware' | 'schema' | 'migration' | 'other';
  name: string;
  signature: string;
  filePath: string;
  startLine: number;
  endLine: number;
  complexity: number;
  docstring: string | null;
  parameters: ParameterInfo[];
  returnType: string | null;
  visibility: 'public' | 'private' | 'protected';
  isExported: boolean;
  dependencies: string[];
  dependents: string[];
}

interface CodeChunk {
  id: string;
  repoId: string;
  symbolId: string | null;
  filePath: string;
  startLine: number;
  endLine: number;
  content: string;
  chunkType: 'file' | 'function' | 'class' | 'module_doc'
    | 'config' | 'test' | 'comment_block' | 'other';
  tokenCount: number;
  embeddingId: string | null;
}

// ============================================================
// Interview & Chat Models
// ============================================================

interface InterviewQuestion {
  id: string;
  artifactId: string;
  repoId: string;
  category: 'architecture' | 'data_modeling' | 'api_design'
    | 'security' | 'performance' | 'testing' | 'devops'
    | 'debugging' | 'trade_offs';
  difficulty: 'junior' | 'mid' | 'senior';
  questionType: 'exploratory' | 'adversarial' | 'debugging'
    | 'trade_off' | 'deep_dive' | 'scenario';
  questionText: string;
  modelAnswer: string;
  citations: Citation[];
  followUps: string[];
  tips: string;
  sourceModules: string[];
}

interface Citation {
  filePath: string;
  startLine: number;
  endLine: number;
  symbolName: string | null;
  relevance: string;
}

interface ChatMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  citations: Citation[];
  metadata: Record<string, any>;
  tokensUsed: number;
  modelUsed: string;
  latencyMs: number;
}

interface MockInterviewSession {
  id: string;
  userId: string;
  repoId: string;
  persona: InterviewPersona;
  difficulty: 'junior' | 'mid' | 'senior';
  questions: MockInterviewQuestion[];
  scores: InterviewScores;
  timeSpentSec: number;
  feedbackSummary: string;
  strengths: string[];
  weaknesses: string[];
  studyRecommendations: string[];
  status: 'active' | 'completed' | 'abandoned';
}

interface MockInterviewQuestion {
  id: string;
  sessionId: string;
  sequenceNum: number;
  questionText: string;
  questionCategory: string;
  answerText: string | null;
  citations: Citation[];
  score: number | null;
  feedback: string | null;
  timeSpentSec: number;
  isCoachingBreak: boolean;
  coachingNote: string | null;
}

interface InterviewScores {
  overall: number;
  clarity: number;
  depth: number;
  specificity: number;
  confidence: number;
}

type InterviewPersona =
  | 'friendly_senior'
  | 'rigorous_hiring_manager'
  | 'curious_peer'
  | 'stressed_tech_lead'
  | 'detailed_reviewer'
  | 'random';

// ============================================================
// Retrieval & Generation Models
// ============================================================

interface RetrievalResult {
  chunkId: string;
  filePath: string;
  startLine: number;
  endLine: number;
  content: string;
  denseScore: number;
  sparseScore: number;
  fusedScore: number;
  symbolName: string | null;
}

interface GenerationRequest {
  query: string;
  context: RetrievalResult[];
  mode: 'chat' | 'mock_interview' | 'study_guide' | 'architecture_review';
  persona?: InterviewPersona;
  conversationHistory: ChatMessage[];
  citationRequired: boolean;
}

interface GenerationResponse {
  content: string;
  citations: Citation[];
  followUpQuestions: string[];
  tokensUsed: number;
  modelUsed: string;
  latencyMs: number;
}

// ============================================================
// Analysis Pipeline Models
// ============================================================

interface ASTParseResult {
  filePath: string;
  language: string;
  symbols: ParsedSymbol[];
  imports: ImportInfo[];
  exports: ExportInfo[];
  patterns: DetectedPattern[];
  complexity: number;
}

interface ParsedSymbol {
  name: string;
  type: string;
  signature: string;
  startLine: number;
  endLine: number;
  parameters: ParameterInfo[];
  returnType: string | null;
  docstring: string | null;
  annotations: string[];
  isExported: boolean;
  innerSymbols: ParsedSymbol[];
}

interface ImportInfo {
  source: string;
  specifiers: string[];
  isDefault: boolean;
  isTypeOnly: boolean;
}

interface ExportInfo {
  name: string;
  type: string;
  isDefault: boolean;
}

interface DetectedPattern {
  name: string;
  confidence: number;
  evidence: string[];
  category: 'architectural' | 'behavioral' | 'structural';
}

interface ParameterInfo {
  name: string;
  type: string | null;
  defaultValue: string | null;
  isOptional: boolean;
}

interface FailureMode {
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  affectedSymbols: string[];
  mitigationPresent: boolean;
}

interface DependencyGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

interface GraphNode {
  moduleId: string;
  name: string;
  type: string;
  weight: number;
}

interface GraphEdge {
  source: string;
  target: string;
  type: string;
  weight: number;
}
```

---

## 4. Analysis Pipeline — Detailed Data Flow

### 4.1 Pipeline Stages

```
┌─────────────────────────────────────────────────────────────────────┐
│                     ANALYSIS PIPELINE (per repository)               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Stage 1: REPO INGESTION                                            │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  GitHub Webhook / Manual Trigger                             │   │
│  │         │                                                    │   │
│  │         ▼                                                    │   │
│  │  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │   │
│  │  │ Clone Repo   │───▶│ Build File   │───▶│ Detect       │  │   │
│  │  │ (isomorphic- │    │ Tree         │    │ .gitignore   │  │   │
│  │  │  git)        │    │ (recursive)  │    │ Filters      │  │   │
│  │  └──────────────┘    └──────────────┘    └──────┬───────┘  │   │
│  │                                                  │          │   │
│  │         ┌────────────────────────────────────────┘          │   │
│  │         ▼                                                   │   │
│  │  ┌──────────────────────────────────────────────────────┐  │   │
│  │  │  Filtered File Manifest                              │  │   │
│  │  │  { path, language, size, lastModified }              │  │   │
│  │  └──────────────────────────────────────────────────────┘  │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                              │                                      │
│                              ▼                                      │
│  Stage 2: AST PARSING                                               │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  Per-file parallel processing (worker pool)                  │   │
│  │                                                              │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │   │
│  │  │ TypeScript  │  │ Python      │  │ Go          │  ...   │   │
│  │  │ (tree-sitter│  │ (tree-sitter│  │ (tree-sitter│        │   │
│  │  │  -typescript)│  │  -python)   │  │  -go)       │        │   │
│  │  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘        │   │
│  │         │                │                │                 │   │
│  │         └────────────────┼────────────────┘                 │   │
│  │                          ▼                                   │   │
│  │  ┌──────────────────────────────────────────────────────┐  │   │
│  │  │  Unified AST Output                                  │  │   │
│  │  │  • Symbols (functions, classes, interfaces)          │  │   │
│  │  │  • Import/Export graph                               │  │   │
│  │  │  • Annotations & decorators                          │  │   │
│  │  │  • Type annotations                                  │  │   │
│  │  │  • Complexity metrics (cyclomatic, cognitive)        │  │   │
│  │  └──────────────────────────────────────────────────────┘  │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                              │                                      │
│                              ▼                                      │
│  Stage 3: MODULE DECOMPOSITION                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                                                              │   │
│  │  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │   │
│  │  │ Directory    │───▶│ Import Graph │───▶│ Cluster      │  │   │
│  │  │ Structure    │    │ Analysis     │    │ Algorithm    │  │   │
│  │  │ Heuristic    │    │              │    │ (Louvain)    │  │   │
│  │  └──────────────┘    └──────────────┘    └──────┬───────┘  │   │
│  │                                                  │          │   │
│  │         ┌────────────────────────────────────────┘          │   │
│  │         ▼                                                   │   │
│  │  ┌──────────────────────────────────────────────────────┐  │   │
│  │  │  Module Map                                          │  │   │
│  │  │  • Logical module boundaries                         │  │   │
│  │  │  • Module type classification                        │  │   │
│  │  │  • Inter-module dependency edges                     │  │   │
│  │  │  • Coupling metrics                                  │  │   │
│  │  └──────────────────────────────────────────────────────┘  │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                              │                                      │
│                              ▼                                      │
│  Stage 4: CHUNKING & EMBEDDING                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                                                              │   │
│  │  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │   │
│  │  │ Chunk Source │───▶│ Generate     │───▶│ Store in     │  │   │
│  │  │ Files        │    │ Embeddings   │    │ Vector DB    │  │   │
│  │  │ (semantic    │    │ (OpenAI      │    │ + Sparse     │  │   │
│  │  │  splitting)  │    │  text-       │    │ Index        │  │   │
│  │  │              │    │  embedding-  │    │ (Elastic)    │  │   │
│  │  │              │    │  3-large)    │    │              │  │   │
│  │  └──────────────┘    └──────────────┘    └──────────────┘  │   │
│  │                                                              │   │
│  │  Chunking Strategy:                                         │   │
│  │  • Primary: AST-aware (function/class boundaries)           │   │
│  │  • Secondary: Recursive text splitter (1000 chars, 200 overlap)│
│  │  • Metadata: file path, line range, symbol name, type       │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                              │                                      │
│                              ▼                                      │
│  Stage 5: LLM GENERATION                                           │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                                                              │   │
│  │  ┌──────────────────────────────────────────────────────┐  │   │
│  │  │  Architecture Overview Generation                    │  │   │
│  │  │  • Input: Module map + dependency graph + tech stack │  │   │
│  │  │  • Output: Structured architecture document          │  │   │
│  │  └──────────────────────────────────────────────────────┘  │   │
│  │                                                              │   │
│  │  ┌──────────────────────────────────────────────────────┐  │   │
│  │  │  Module-by-Module Explanation                        │  │   │
│  │  │  • Input: Per-module symbol data + source chunks     │  │   │
│  │  │  • Output: Purpose, abstractions, logic, failures    │  │   │
│  │  └──────────────────────────────────────────────────────┘  │   │
│  │                                                              │   │
│  │  ┌──────────────────────────────────────────────────────┐  │   │
│  │  │  Interview Question Bank                             │  │   │
│  │  │  • Input: Full codebase context + module summaries   │  │   │
│  │  │  • Output: Questions + model answers + citations     │  │   │
│  │  └──────────────────────────────────────────────────────┘  │   │
│  │                                                              │   │
│  │  Citation Grounding:                                        │   │
│  │  Every generated claim → { file, startLine, endLine }      │   │
│  │  Verified via post-generation code search validation        │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 4.2 Pipeline State Machine

```
                    ┌─────────┐
                    │ QUEUED  │
                    └────┬────┘
                         │ trigger_analysis()
                         ▼
                    ┌─────────┐
              ┌─────│ CLONING │─────┐
              │     └────┬────┘     │
              │          │          │
           timeout    success    failure
              │          │          │
              ▼          ▼          ▼
         ┌────────┐  ┌────────┐  ┌────────┐
         │ QUEUED │  │PARSING │  │ FAILED │
         │(retry) │  └────┬───┘  └────────┘
         └────────┘       │
                     success
                          │
                          ▼
                    ┌──────────┐
                    │ INDEXING │
                    └────┬─────┘
                         │ success
                         ▼
                    ┌───────────┐
                    │GENERATING │
                    └────┬──────┘
                         │ success
                         ▼
                    ┌───────────┐
                    │ COMPLETED │
                    └───────────┘
```

---

## 5. API Design

### 5.1 REST API Endpoints

```
BASE: /api/v1

AUTHENTICATION
POST   /auth/github              → Redirect to GitHub OAuth
POST   /auth/github/callback     → Exchange code for JWT
POST   /auth/refresh             → Refresh access token
DELETE /auth/logout              → Invalidate session

USER
GET    /users/me                 → Current user profile
PATCH  /users/me                 → Update profile
GET    /users/me/subscription    → Current plan & usage

REPOSITORIES
POST   /repos/connect            → Connect a GitHub repo
GET    /repos                    → List connected repos
GET    /repos/:repoId            → Repo details & status
DELETE /repos/:repoId            → Disconnect repo
POST   /repos/:repoId/analyze    → Trigger (re-)analysis
GET    /repos/:repoId/status     → Analysis job status

ANALYSIS ARTIFACTS
GET    /repos/:repoId/artifacts              → List all artifacts
GET    /repos/:repoId/artifacts/:type        → Get specific artifact
GET    /repos/:repoId/architecture           → Architecture overview
GET    /repos/:repoId/modules                → Module list
GET    /repos/:repoId/modules/:moduleId      → Module detail
GET    /repos/:repoId/questions              → Interview question bank
GET    /repos/:repoId/dependency-graph       → Module dependency graph

CHAT
POST   /repos/:repoId/chat/sessions          → Create chat session
GET    /repos/:repoId/chat/sessions          → List sessions
GET    /chat/sessions/:sessionId             → Session detail
GET    /chat/sessions/:sessionId/messages    → Message history
POST   /chat/sessions/:sessionId/messages    → Send message (REST fallback)

MOCK INTERVIEWS
POST   /repos/:repoId/mock-interviews        → Start session
GET    /mock-interviews                      → List past sessions
GET    /mock-interviews/:sessionId           → Session detail & scores
POST   /mock-interviews/:sessionId/answer    → Submit answer
POST   /mock-interviews/:sessionId/next      → Get next question
POST   /mock-interviews/:sessionId/complete  → End & get report

USAGE & BILLING
GET    /usage/summary             → Current period usage
GET    /usage/events              → Detailed event history
POST   /billing/checkout          → Create Stripe checkout session
POST   /billing/webhook           → Stripe webhook handler
```

### 5.2 WebSocket Events (Chat & Mock Interview)

```typescript
// Client → Server
interface ClientEvents {
  'chat:send': {
    sessionId: string;
    content: string;
  };
  'mock-interview:answer': {
    sessionId: string;
    answer: string;
  };
  'mock-interview:next': {
    sessionId: string;
  };
  'typing:start': {
    sessionId: string;
  };
  'typing:stop': {
    sessionId: string;
  };
}

// Server → Client
interface ServerEvents {
  'chat:stream:start': {
    messageId: string;
    sessionId: string;
  };
  'chat:stream:chunk': {
    messageId: string;
    delta: string;           // streamed token
    citations: Citation[];   // incremental citations
  };
  'chat:stream:end': {
    messageId: string;
    totalTokens: number;
    modelUsed: string;
  };
  'mock-interview:question': {
    questionId: string;
    questionText: string;
    category: string;
    questionNumber: number;
    totalQuestions: number;
  };
  'mock-interview:coaching': {
    note: string;
    relevantCode: string[];
    suggestedAnswer: string;
  };
  'mock-interview:score': {
    questionId: string;
    scores: InterviewScores;
    feedback: string;
  };
  'mock-interview:complete': {
    sessionId: string;
    report: MockInterviewReport;
  };
  'analysis:progress': {
    repoId: string;
    stage: string;
    progress: number;       // 0-100
    message: string;
  };
}
```

---

## 6. Retrieval Engine — Detailed Design

### 6.1 Hybrid Search Pipeline

```
┌────────────────────────────────────────────────────────────────┐
│                    QUERY PROCESSING                            │
│                                                                │
│  User Query: "How does the authentication middleware work?"    │
│                                                                │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐    │
│  │  Query        │    │  Query        │    │  Query        │   │
│  │  Expansion    │───▶│  Embedding    │───▶│  Tokenization │   │
│  │  (LLM-based) │    │  (OpenAI)     │    │  (BM25)       │   │
│  └──────────────┘    └──────┬───────┘    └──────┬────────┘   │
│                              │                   │             │
│                              ▼                   ▼             │
│                    ┌──────────────┐    ┌──────────────┐       │
│                    │  Vector      │    │  BM25        │       │
│                    │  Search      │    │  Search      │       │
│                    │  (Pinecone)  │    │  (Elastic)   │       │
│                    │  Top-K: 20   │    │  Top-K: 20   │       │
│                    └──────┬───────┘    └──────┬────────┘       │
│                           │                   │                │
│                           └─────────┬─────────┘                │
│                                     ▼                          │
│                           ┌──────────────────┐                │
│                           │  Reciprocal Rank │                │
│                           │  Fusion (RRF)    │                │
│                           │  k=60            │                │
│                           └────────┬─────────┘                │
│                                    ▼                           │
│                           ┌──────────────────┐                │
│                           │  Cross-Encoder   │                │
│                           │  Reranker        │                │
│                           │  (Top-K: 8)      │                │
│                           └────────┬─────────┘                │
│                                    ▼                           │
│                           ┌──────────────────┐                │
│                           │  Citation        │                │
│                           │  Enrichment      │                │
│                           │  (file + line)   │                │
│                           └────────┬─────────┘                │
│                                    ▼                           │
│                           ┌──────────────────┐                │
│                           │  Ranked Results   │                │
│                           │  + Citations      │                │
│                           └──────────────────┘                │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

### 6.2 RRF Scoring Formula

```
RRF_score(d) = Σ  1 / (k + rank_i(d))
               i∈{dense, sparse}

Where:
  k = 60 (constant, standard in literature)
  rank_dense(d) = rank of document d in dense retrieval
  rank_sparse(d) = rank of document d in sparse retrieval

Documents appearing in both lists get boosted.
Documents appearing in only one list still participate.
```

---

## 7. Infrastructure & Deployment

### 7.1 AWS Deployment Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        AWS Cloud                             │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  VPC (10.0.0.0/16)                                   │    │
│  │                                                      │    │
│  │  ┌───────────────────── Public Subnets ──────────┐  │    │
│  │  │                                                │  │    │
│  │  │  ┌──────────┐  ┌──────────┐  ┌──────────┐   │  │    │
│  │  │  │ ALB      │  │ NAT      │  │ Bastion  │   │  │    │
│  │  │  │ (HTTPS)  │  │ Gateway  │  │ Host     │   │  │    │
│  │  │  └─────┬────┘  └──────────┘  └──────────┘   │  │    │
│  │  └────────┼─────────────────────────────────────┘  │    │
│  │           │                                         │    │
│  │  ┌────────┼────────── Private Subnets ──────────┐  │    │
│  │  │        │                                      │  │    │
│  │  │  ┌─────▼──────────────────────────────┐      │  │    │
│  │  │  │  ECS Fargate Cluster                │      │  │    │
│  │  │  │                                     │      │  │    │
│  │  │  │  ┌──────────┐  ┌──────────┐       │      │  │    │
│  │  │  │  │ Web App  │  │ API      │       │      │  │    │
│  │  │  │  │ (2-10)   │  │ Server   │       │      │  │    │
│  │  │  │  │          │  │ (2-20)   │       │      │  │    │
│  │  │  │  └──────────┘  └──────────┘       │      │  │    │
│  │  │  │                                     │      │  │    │
│  │  │  │  ┌──────────┐  ┌──────────┐       │      │  │    │
│  │  │  │  │ WebSocket│  │ Worker   │       │      │  │    │
│  │  │  │  │ Server   │  │ Pool     │       │      │  │    │
│  │  │  │  │ (2-10)   │  │ (2-50)   │       │      │  │    │
│  │  │  │  └──────────┘  └──────────┘       │      │  │    │
│  │  │  │                                     │      │  │    │
│  │  │  │  ┌──────────┐  ┌──────────┐       │      │  │    │
│  │  │  │  │ AST      │  │ Retrieval│       │      │  │    │
│  │  │  │  │ Parser   │  │ Engine   │       │      │  │    │
│  │  │  │  │ (2-10)   │  │ (2-10)   │       │      │  │    │
│  │  │  │  └──────────┘  └──────────┘       │      │  │    │
│  │  │  └─────────────────────────────────────┘      │  │    │
│  │  │                                                │  │    │
│  │  │  ┌────────── Data Stores ──────────────┐      │  │    │
│  │  │  │                                       │      │  │    │
│  │  │  │  ┌──────────┐  ┌──────────┐         │      │  │    │
│  │  │  │  │ RDS      │  │ ElastiCache│        │      │  │    │
│  │  │  │  │ Postgres │  │ Redis    │         │      │  │    │
│  │  │  │  │ (Multi-  │  │ (Cluster)│         │      │  │    │
│  │  │  │  │  AZ)     │  │          │         │      │  │    │
│  │  │  │  └──────────┘  └──────────┘         │      │  │    │
│  │  │  │                                       │      │  │    │
│  │  │  │  ┌──────────┐  ┌──────────┐         │      │  │    │
│  │  │  │  │OpenSearch│  │ Pinecone │         │      │  │    │
│  │  │  │  │ (Sparse  │  │ (Dense   │         │      │  │    │
│  │  │  │  │  Index)  │  │  Vectors)│         │      │  │    │
│  │  │  │  └──────────┘  └──────────┘         │      │  │    │
│  │  │  │                                       │      │  │    │
│  │  │  │  ┌──────────┐                        │      │  │    │
│  │  │  │  │ S3       │                        │      │  │    │
│  │  │  │  │ (Clones, │                        │      │  │    │
│  │  │  │  │  Artifacts│                       │      │  │    │
│  │  │  │  └──────────┘                        │      │  │    │
│  │  │  └───────────────────────────────────────┘      │  │    │
│  │  └─────────────────────────────────────────────────┘  │    │
│  └──────────────────────────────────────────────────────┘    │
│                                                              │
│  ┌──────────── External Services ────────────────────┐      │
│  │                                                    │      │
│  │  GitHub API ←→ VPC (peered)                       │      │
│  │  OpenAI API ←→ NAT Gateway                        │      │
│  │  Stripe     ←→ NAT Gateway                        │      │
│  │  SendGrid   ←→ NAT Gateway                        │      │
│  │                                                    │      │
│  └────────────────────────────────────────────────────┘      │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 7.2 Scaling Strategy

| Component | Scaling Trigger | Strategy | Min → Max |
|---|---|---|---|
| Web App (Next.js) | CPU > 60% or req/s > 500 | Horizontal (ECS autoscaling) | 2 → 10 |
| API Server | CPU > 70% or p99 latency > 500ms | Horizontal | 2 → 20 |
| WebSocket Server | Connection count > 1000/instance | Horizontal + Redis pub/sub adapter | 2 → 10 |
| Worker Pool (Analysis) | Queue depth > 10 | Horizontal (scale-to-zero capable) | 2 → 50 |
| AST Parser | CPU > 80% | Vertical (memory/CPU) + horizontal | 2 → 10 |
| Retrieval Engine | QPS > 200 or p99 > 200ms | Horizontal | 2 → 10 |
| PostgreSQL | Connection count > 200 or CPU > 70% | Read replicas + connection pooling (PgBouncer) | 1 primary + 2 read replicas |
| Redis | Memory > 70% or CPU > 60% | Cluster mode sharding | 3-node cluster |
| Elasticsearch | Index size > 100GB or QPS > 500 | Data nodes + dedicated masters | 3 → 9 nodes |

### 7.3 Cost Estimation (Monthly, at Scale)

| Service | Configuration | Estimated Cost |
|---|---|---|
| ECS Fargate (20 tasks avg) | 1 vCPU, 2GB RAM | ~$480 |
| RDS PostgreSQL | db.r6g.large, Multi-AZ | ~$350 |
| ElastiCache Redis | cache.r6g.large, 3-node | ~$450 |
| OpenSearch | m6g.large.search, 3-node | ~$500 |
| Pinecone | Starter plan | ~$70 |
| S3 | 500GB storage + transfer | ~$25 |
| ALB | Active hours + LCU | ~$80 |
| NAT Gateway | Data processing | ~$100 |
| CloudFront | 1TB transfer | ~$85 |
| **Subtotal (Infrastructure)** | | **~$2,140** |
| OpenAI API (GPT-4) | ~2M tokens/day | ~$4,500 |
| Voyage AI (Embeddings) | ~5M tokens/day | ~$250 |
| **Subtotal (AI APIs)** | | **~$4,750** |
| **Total Estimated Monthly** | | **~$6,890** |

---

## 8. Security Architecture

### 8.1 Authentication & Authorization

```
┌────────────────────────────────────────────────────────────┐
│                    AUTH FLOW                                │
│                                                            │
│  1. User clicks "Connect with GitHub"                      │
│  2. Redirect → GitHub OAuth (scope: repo, user:email)     │
│  3. GitHub callback → /auth/github/callback                │
│  4. Exchange code → GitHub access token                    │
│  5. Fetch user profile + email                             │
│  6. Upsert user in PostgreSQL                              │
│  7. Generate JWT (RS256, 15min expiry)                     │
│  8. Generate refresh token (HttpOnly cookie, 7 days)       │
│  9. Store GitHub token encrypted (AES-256-GCM)            │
│                                                            │
│  ┌─────────────────────────────────────────────────────┐  │
│  │  JWT Payload                                         │  │
│  │  {                                                   │  │
│  │    "sub": "user-uuid",                              │  │
│  │    "github_id": 12345,                              │  │
│  │    "plan": "pro",                                   │  │
│  │    "repos_remaining": 15,                           │  │
│  │    "iat": 1695000000,                               │  │
│  │    "exp": 1695000900                                │  │
│  │  }                                                   │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                            │
│  API Key Auth (for institutional batch processing):        │
│  Header: Authorization: Bearer vc_inst_<key>              │
│  Rate limit: 1000 req/hour                                 │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

### 8.2 Data Protection

| Concern | Implementation |
|---|---|
| GitHub tokens | AES-256-GCM encryption at rest, rotated every 90 days |
| Chat messages | Encrypted at rest (RDS encryption), no PII in logs |
| Repo clones | Ephemeral S3 buckets, auto-deleted after 24 hours |
| API keys | Stored in AWS Secrets Manager, never in env vars |
| Rate limiting | Per-user token bucket + per-IP sliding window |
| CORS | Strict allowlist: `vibecoder.com`, `*.vibecoder.com` |
| CSP | Strict Content-Security-Policy headers |
| Audit logging | All data access logged to CloudWatch, 90-day retention |

---

## 9. Monitoring & Observability

```
┌────────────────────────────────────────────────────────────┐
│                  OBSERVABILITY STACK                         │
│                                                            │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                │
│  │ Metrics  │  │ Logs     │  │ Traces   │                │
│  │(CloudWatch│  │(CloudWatch│  │(X-Ray)  │                │
│  │ Metrics) │  │ Logs)    │  │          │                │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘                │
│       │              │              │                       │
│       └──────────────┼──────────────┘                       │
│                      ▼                                      │
│              ┌──────────────┐                               │
│              │  Grafana      │                              │
│              │  Dashboard    │                              │
│              └──────────────┘                               │
│                                                            │
│  Key Metrics Monitored:                                    │
│  • Analysis pipeline latency (p50, p95, p99)              │
│  • Retrieval precision@K                                   │
│  • LLM generation latency + token consumption             │
│  • Chat session active count                               │
│  • Mock interview completion rate                          │
│  • Error rates per service                                 │
│  • GitHub API rate limit utilization                       │
│  • Database connection pool saturation                     │
│  • WebSocket connection count                              │
│  • Cost per analysis job                                   │
│                                                            │
│  Alerts:                                                   │
│  • Analysis failure rate > 5% → PagerDuty                 │
│  • p99 latency > 10s → Slack alert                        │
│  • GitHub token rate limit > 80% → Slack alert            │
│  • Daily API cost > $300 → email alert                     │
│  • Database connections > 80% pool → PagerDuty            │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

---

*Document prepared as an accompanying technical specification. See the main product proposal document for business context, competitive analysis, and feature descriptions.*
