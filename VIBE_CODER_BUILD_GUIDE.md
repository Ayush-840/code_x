# Vibe Coder — Complete Build Guide

## End-to-End Instructions for Building the Interview-Prep Platform

---

## Table of Contents

1. [Prerequisites & Setup](#1-prerequisites--setup)
2. [Project Structure](#2-project-structure)
3. [Phase 1: Foundation (Weeks 1-3)](#3-phase-1-foundation)
4. [Phase 2: Core Intelligence (Weeks 4-7)](#4-phase-2-core-intelligence)
5. [Phase 3: User Interface (Weeks 8-10)](#5-phase-3-user-interface)
6. [Phase 4: Advanced Features (Weeks 11-14)](#6-phase-4-advanced-features)
7. [Phase 5: Production Readiness (Weeks 15-16)](#7-phase-5-production-readiness)
8. [Configuration Reference](#8-configuration-reference)
9. [Troubleshooting](#9-troubleshooting)

---

## 1. Prerequisites & Setup

### 1.1 Required Tools

```bash
# Node.js 20+ and npm/pnpm
node -v  # v20.x or higher required
npm -v   # v10.x or higher
corepack enable
corepack prepare pnpm@8 --activate

# Rust toolchain (for AST parser)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup update stable
cargo --version  # 1.75+

# Python 3.11+ (for retrieval and generation services)
python3 --version  # 3.11+
pip3 install poetry

# Docker and Docker Compose
docker --version  # 24+
docker compose version  # v2.20+

# AWS CLI v2
aws --version
aws configure  # Set up credentials

# PostgreSQL client
psql --version  # 15+

# Redis CLI
redis-cli --version

# Git
git --version
```

### 1.2 API Keys & Accounts

Create accounts and obtain keys for:

| Service | Purpose | Get Key At |
|---|---|---|
| GitHub OAuth App | User authentication | https://github.com/settings/developers |
| GitHub Personal Access Token | Repo cloning (for server-side operations) | https://github.com/settings/tokens |
| OpenAI API | LLM generation + embeddings | https://platform.openai.com/api-keys |
| Voyage AI API | Code embeddings (alternative to OpenAI) | https://voyage.ai/api-keys |
| Stripe | Payment processing | https://dashboard.stripe.com/apikeys |
| Pinecone | Vector database | https://app.pinecone.io |
| SendGrid | Transactional email | https://app.sendgrid.com/settings/api_keys |
| Sentry | Error tracking | https://sentry.io |

### 1.3 Environment Variables

Create `.env.example` in the project root:

```bash
# ============================================================
# Application
# ============================================================
NODE_ENV=development
APP_URL=http://localhost:3000
API_URL=http://localhost:8000

# ============================================================
# Database
# ============================================================
DATABASE_URL=postgresql://vibecoder:devpassword@localhost:5432/vibecoder_dev
DATABASE_URL_TEST=postgresql://vibecoder:devpassword@localhost:5432/vibecoder_test

# ============================================================
# Redis
# ============================================================
REDIS_URL=redis://localhost:6379
REDIS_CACHE_TTL=3600

# ============================================================
# Authentication
# ============================================================
JWT_SECRET=your-256-bit-secret-key-change-in-production
JWT_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d
GITHUB_CLIENT_ID=your-github-oauth-client-id
GITHUB_CLIENT_SECRET=your-github-oauth-client-secret
GITHUB_WEBHOOK_SECRET=your-webhook-secret

# ============================================================
# AI / LLM
# ============================================================
OPENAI_API_KEY=sk-your-openai-api-key
OPENAI_MODEL=gpt-4-turbo-preview
OPENAI_EMBEDDING_MODEL=text-embedding-3-large
VOYAGE_API_KEY=your-voyage-api-key
LLM_MAX_TOKENS=4096
LLM_TEMPERATURE=0.3
LLM_MAX_CONCURRENT=10

# ============================================================
# Vector Database (Pinecone)
# ============================================================
PINECONE_API_KEY=your-pinecone-api-key
PINECONE_ENVIRONMENT=us-east-1
PINECONE_INDEX_NAME=vibecoder-embeddings

# ============================================================
# Search (Elasticsearch)
# ============================================================
ELASTICSEARCH_URL=http://localhost:9200
ELASTICSEARCH_INDEX_NAME=code_chunks

# ============================================================
# Storage
# ============================================================
S3_BUCKET_NAME=vibecoder-repo-clones
S3_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-aws-access-key
AWS_SECRET_ACCESS_KEY=your-aws-secret-key

# ============================================================
# Payments (Stripe)
# ============================================================
STRIPE_SECRET_KEY=sk_test_your-stripe-secret-key
STRIPE_PUBLISHABLE_KEY=pk_test_your-stripe-publishable-key
STRIPE_WEBHOOK_SECRET=whsec_your-webhook-secret
STRIPE_PRICE_STARTER_MONTHLY=price_xxx
STRIPE_PRICE_PRO_MONTHLY=price_xxx
STRIPE_PRICE_INSTITUTIONAL_MONTHLY=price_xxx

# ============================================================
# Email (SendGrid)
# ============================================================
SENDGRID_API_KEY=SG.your-sendgrid-api-key
EMAIL_FROM=noreply@vibecoder.com

# ============================================================
# Monitoring
# ============================================================
SENTRY_DSN=https://your-sentry-dsn
SENTRY_ENVIRONMENT=development
LOG_LEVEL=debug

# ============================================================
# Feature Flags
# ============================================================
FEATURE_MOCK_INTERVIEW=true
FEATURE_DEEP_DIVE=true
FEATURE_EXPORT_PDF=true
```

---

## 2. Project Structure

```
vibecoder/
├── apps/
│   ├── web/                          # Next.js 14 web application
│   │   ├── app/                      # App Router pages
│   │   │   ├── (auth)/               # Auth-related pages
│   │   │   │   ├── login/page.tsx
│   │   │   │   ├── callback/page.tsx
│   │   │   │   └── layout.tsx
│   │   │   ├── (dashboard)/          # Dashboard pages
│   │   │   │   ├── page.tsx          # Dashboard home
│   │   │   │   ├── repos/            # Repository management
│   │   │   │   │   ├── page.tsx      # List repos
│   │   │   │   │   └── [repoId]/     # Repo detail
│   │   │   │   │       ├── page.tsx
│   │   │   │   │       ├── architecture/page.tsx
│   │   │   │   │       ├── modules/page.tsx
│   │   │   │   │       ├── questions/page.tsx
│   │   │   │   │       ├── chat/page.tsx
│   │   │   │   │       └── mock-interview/page.tsx
│   │   │   │   └── billing/page.tsx
│   │   │   ├── layout.tsx            # Root layout
│   │   │   ├── page.tsx              # Landing page
│   │   │   └── globals.css
│   │   ├── components/
│   │   │   ├── ui/                   # Shadcn/ui components
│   │   │   ├── repo/                 # Repository-related components
│   │   │   ├── chat/                 # Chat interface components
│   │   │   ├── interview/            # Mock interview components
│   │   │   ├── architecture/         # Architecture visualization
│   │   │   └── shared/               # Shared components
│   │   ├── hooks/                    # Custom React hooks
│   │   ├── lib/                      # Utility functions
│   │   ├── stores/                   # Zustand state stores
│   │   ├── types/                    # TypeScript types
│   │   └── public/                   # Static assets
│   │
│   └── api/                          # API server (Express/Fastify)
│       ├── src/
│       │   ├── index.ts              # Entry point
│       │   ├── app.ts                # App configuration
│       │   ├── routes/               # API route handlers
│       │   │   ├── auth.routes.ts
│       │   │   ├── repos.routes.ts
│       │   │   ├── analysis.routes.ts
│       │   │   ├── chat.routes.ts
│       │   │   ├── interview.routes.ts
│       │   │   ├── billing.routes.ts
│       │   │   └── admin.routes.ts
│       │   ├── middleware/           # Express middleware
│       │   │   ├── auth.middleware.ts
│       │   │   ├── rateLimit.middleware.ts
│       │   │   ├── validation.middleware.ts
│       │   │   └── errorHandler.middleware.ts
│       │   ├── services/            # Business logic
│       │   │   ├── auth.service.ts
│       │   │   ├── repo.service.ts
│       │   │   ├── analysis.service.ts
│       │   │   ├── chat.service.ts
│       │   │   ├── interview.service.ts
│       │   │   ├── billing.service.ts
│       │   │   └── email.service.ts
│       │   ├── models/              # Database models (Prisma)
│       │   ├── utils/               # Utility functions
│       │   └── config/              # Configuration
│       └── prisma/
│           ├── schema.prisma        # Database schema
│           └── migrations/          # Database migrations
│
├── services/
│   ├── analysis-orchestrator/       # Pipeline coordinator (Node.js)
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── pipeline.ts          # Main pipeline logic
│   │   │   ├── stages/
│   │   │   │   ├── ingestion.ts     # Stage 1: Clone repo
│   │   │   │   ├── parsing.ts       # Stage 2: AST parsing
│   │   │   │   ├── decomposition.ts # Stage 3: Module decomposition
│   │   │   │   ├── chunking.ts      # Stage 4: Text chunking
│   │   │   │   └── generation.ts    # Stage 5: LLM generation
│   │   │   └── workers/
│   │   │       └── analysis.worker.ts
│   │   └── package.json
│   │
│   ├── ast-parser/                  # AST parsing service (Rust)
│   │   ├── src/
│   │   │   ├── main.rs
│   │   │   ├── parser/
│   │   │   │   ├── mod.rs
│   │   │   │   ├── typescript.rs
│   │   │   │   ├── python.rs
│   │   │   │   ├── go.rs
│   │   │   │   └── rust.rs
│   │   │   ├── symbols/
│   │   │   │   ├── mod.rs
│   │   │   │   ├── extractor.rs
│   │   │   │   └── types.rs
│   │   │   ├── complexity/
│   │   │   │   ├── mod.rs
│   │   │   │   └── metrics.rs
│   │   │   └── api/
│   │   │       └── routes.rs
│   │   ├── Cargo.toml
│   │   └── Dockerfile
│   │
│   ├── retrieval-engine/            # Hybrid search service (Python)
│   │   ├── app/
│   │   │   ├── __init__.py
│   │   │   ├── main.py              # FastAPI app
│   │   │   ├── api/
│   │   │   │   ├── search.py        # Search endpoints
│   │   │   │   └── index.py         # Indexing endpoints
│   │   │   ├── core/
│   │   │   │   ├── hybrid_search.py # Hybrid retrieval logic
│   │   │   │   ├── embeddings.py    # Embedding generation
│   │   │   │   ├── reranker.py      # Cross-encoder reranking
│   │   │   │   └── fusion.py        # RRF fusion
│   │   │   ├── ingestion/
│   │   │   │   ├── chunker.py       # Text chunking
│   │   │   │   ├── indexer.py       # Index management
│   │   │   │   └── preprocessor.py  # Code preprocessing
│   │   │   └── config.py
│   │   ├── pyproject.toml
│   │   └── Dockerfile
│   │
│   ├── generation-service/          # LLM orchestration (Python)
│   │   ├── app/
│   │   │   ├── __init__.py
│   │   │   ├── main.py
│   │   │   ├── api/
│   │   │   │   ├── generate.py      # Generation endpoints
│   │   │   │   └── chat.py          # Chat streaming
│   │   │   ├── core/
│   │   │   │   ├── llm_client.py    # OpenAI/Anthropic client
│   │   │   │   ├── prompts/         # Prompt templates
│   │   │   │   │   ├── architecture.py
│   │   │   │   │   ├── questions.py
│   │   │   │   │   ├── chat.py
│   │   │   │   │   └── mock_interview.py
│   │   │   │   ├── citations.py     # Citation extraction
│   │   │   │   └── guardrails.py    # Output validation
│   │   │   └── config.py
│   │   ├── pyproject.toml
│   │   └── Dockerfile
│   │
│   ├── mock-interview-engine/       # Interview simulator (Python)
│   │   ├── app/
│   │   │   ├── __init__.py
│   │   │   ├── main.py
│   │   │   ├── api/
│   │   │   │   ├── sessions.py      # Session management
│   │   │   │   └── scoring.py       # Score evaluation
│   │   │   ├── core/
│   │   │   │   ├── personas.py      # Interviewer personas
│   │   │   │   ├── question_gen.py  # Question generation
│   │   │   │   ├── answer_eval.py   # Answer evaluation
│   │   │   │   ├── coaching.py      # Coaching breaks
│   │   │   │   └── report.py        # Final report generation
│   │   │   └── config.py
│   │   ├── pyproject.toml
│   │   └── Dockerfile
│   │
│   └── websocket-server/            # Real-time communication (Node.js)
│       ├── src/
│       │   ├── index.ts
│       │   ├── handlers/
│       │   │   ├── chat.handler.ts
│       │   │   └── interview.handler.ts
│       │   └── middleware/
│       │       └── auth.middleware.ts
│       └── package.json
│
├── packages/
│   ├── shared/                      # Shared types and utilities
│   │   ├── src/
│   │   │   ├── types/
│   │   │   │   ├── index.ts
│   │   │   │   ├── repository.ts
│   │   │   │   ├── analysis.ts
│   │   │   │   ├── interview.ts
│   │   │   │   └── chat.ts
│   │   │   ├── constants/
│   │   │   │   ├── plans.ts
│   │   │   │   └── limits.ts
│   │   │   └── utils/
│   │   │       ├── validation.ts
│   │   │       └── formatting.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── ui/                          # Shared UI component library
│       ├── src/
│       │   ├── components/
│       │   └── hooks/
│       ├── package.json
│       └── tsconfig.json
│
├── infra/                           # Infrastructure as Code
│   ├── docker/
│   │   ├── docker-compose.yml       # Local development
│   │   ├── docker-compose.prod.yml  # Production-like
│   │   └── services/
│   │       ├── Dockerfile.web
│   │       ├── Dockerfile.api
│   │       ├── Dockerfile.worker
│   │       ├── Dockerfile.ast-parser
│   │       ├── Dockerfile.retrieval
│   │       ├── Dockerfile.generation
│   │       ├── Dockerfile.mock-interview
│   │       └── Dockerfile.websocket
│   ├── terraform/
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   ├── outputs.tf
│   │   ├── ecs.tf
│   │   ├── rds.tf
│   │   ├── elasticache.tf
│   │   ├── opensearch.tf
│   │   ├── s3.tf
│   │   ├── iam.tf
│   │   └── vpc.tf
│   └── kubernetes/                  # Optional: K8s manifests
│       ├── base/
│       └── overlays/
│
├── tests/
│   ├── unit/                        # Unit tests
│   ├── integration/                 # Integration tests
│   ├── e2e/                         # End-to-end tests (Playwright)
│   ├── performance/                 # Load tests (k6)
│   └── fixtures/                    # Test data
│
├── scripts/                         # Build and utility scripts
│   ├── setup.sh                     # Initial project setup
│   ├── dev.sh                       # Start all dev services
│   ├── seed.sh                      # Seed test data
│   └── deploy.sh                    # Deployment script
│
├── package.json                     # Root package.json (monorepo)
├── pnpm-workspace.yaml              # pnpm workspace config
├── turbo.json                       # Turborepo config
├── .env.example                     # Environment template
├── .gitignore
├── .eslintrc.js
├── .prettierrc
├── tsconfig.base.json
└── README.md
```

---

## 3. Phase 1: Foundation (Weeks 1-3)

### Step 1: Initialize Monorepo

```bash
# Create project root
mkdir vibecoder && cd vibecoder

# Initialize monorepo with pnpm workspaces
cat > pnpm-workspace.yaml << 'EOF'
packages:
  - 'apps/*'
  - 'services/*'
  - 'packages/*'
EOF

# Root package.json
cat > package.json << 'EOF'
{
  "name": "vibecoder",
  "private": true,
  "scripts": {
    "dev": "turbo dev",
    "build": "turbo build",
    "test": "turbo test",
    "lint": "turbo lint",
    "typecheck": "turbo typecheck",
    "db:migrate": "cd apps/api && npx prisma migrate dev",
    "db:seed": "cd apps/api && npx ts-node prisma/seed.ts"
  },
  "devDependencies": {
    "turbo": "^1.10.0",
    "typescript": "^5.3.0",
    "eslint": "^8.50.0",
    "prettier": "^3.0.0"
  }
}
EOF

# Turborepo config
cat > turbo.json << 'EOF'
{
  "$schema": "https://turbo.build/schema.json",
  "globalDependencies": ["**/.env.*local"],
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", ".next/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "test": {
      "dependsOn": ["build"]
    },
    "lint": {},
    "typecheck": {
      "dependsOn": ["^build"]
    }
  }
}
EOF

# Install dependencies
pnpm install
```

### Step 2: Set Up Database

```bash
# Create the API app
mkdir -p apps/api

# Initialize with Prisma
cd apps/api
cat > package.json << 'EOF'
{
  "name": "@vibecoder/api",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "db:migrate": "prisma migrate dev",
    "db:generate": "prisma generate",
    "db:seed": "tsx prisma/seed.ts"
  },
  "dependencies": {
    "@prisma/client": "^5.8.0",
    "express": "^4.18.0",
    "cors": "^2.8.5",
    "helmet": "^7.1.0",
    "morgan": "^1.10.0",
    "jsonwebtoken": "^9.0.0",
    "bcryptjs": "^2.4.3",
    "zod": "^3.22.0",
    "bullmq": "^4.12.0",
    "ioredis": "^5.3.0",
    "octokit": "^3.1.0",
    "@octokit/rest": "^20.0.0",
    "stripe": "^14.0.0",
    "nodemailer": "^6.9.0",
    "pino": "^8.17.0",
    "pino-pretty": "^10.3.0"
  },
  "devDependencies": {
    "typescript": "^5.3.0",
    "tsx": "^4.7.0",
    "prisma": "^5.8.0",
    "@types/express": "^4.17.0",
    "@types/cors": "^2.8.0",
    "@types/jsonwebtoken": "^9.0.0",
    "@types/bcryptjs": "^2.4.0",
    "@types/morgan": "^1.9.0",
    "vitest": "^1.2.0"
  }
}
EOF

# Prisma schema
cat > prisma/schema.prisma << 'PRISMAEOF'
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id        String   @id @default(uuid())
  githubId  BigInt   @unique
  email     String   @unique
  username  String   @unique
  displayName String?
  avatarUrl String?
  bio       String?
  planTier  String   @default("free") // free, starter, pro, institutional
  githubToken String? // encrypted
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  repositories     Repository[]
  chatSessions     ChatSession[]
  mockInterviews   MockInterviewSession[]
  subscriptions    Subscription[]
  usageEvents      UsageEvent[]

  @@map("users")
}

model Repository {
  id             String   @id @default(uuid())
  userId         String   @map("user_id")
  githubRepoId   BigInt   @unique @map("github_repo_id")
  fullName       String   @map("full_name")
  defaultBranch  String   @default("main") @map("default_branch")
  languagePrimary String? @map("language_primary")
  languages      Json     @default("{}")
  totalFiles     Int      @default(0) @map("total_files")
  totalLines     Int      @default(0) @map("total_lines")
  visibility     String   @default("private")
  lastAnalyzedAt DateTime? @map("last_analyzed_at")
  analysisCount  Int      @default(0) @map("analysis_count")
  createdAt      DateTime @default(now()) @map("created_at")
  updatedAt      DateTime @updatedAt @map("updated_at")

  user           User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  analysisJobs   AnalysisJob[]
  codeModules    CodeModule[]
  codeChunks     CodeChunk[]
  interviewQuestions InterviewQuestion[]
  chatSessions   ChatSession[]
  mockInterviews MockInterviewSession[]
  dependencyEdges DependencyEdge[]
  usageEvents    UsageEvent[]

  @@unique([userId, githubRepoId])
  @@map("repositories")
}

model AnalysisJob {
  id           String   @id @default(uuid())
  repoId       String   @map("repo_id")
  status       String   @default("queued") // queued, cloning, parsing, indexing, generating, completed, failed
  startedAt    DateTime? @map("started_at")
  completedAt  DateTime? @map("completed_at")
  errorMessage String?  @map("error_message")
  errorTrace   String?  @map("error_trace")
  workerId     String?  @map("worker_id")
  config       Json     @default("{}")
  stats        Json     @default("{}")
  createdAt    DateTime @default(now()) @map("created_at")

  repository      Repository @relation(fields: [repoId], references: [id], onDelete: Cascade)
  codeModules     CodeModule[]
  artifacts       AnalysisArtifact[]

  @@index([repoId])
  @@index([status])
  @@index([createdAt(sort: Desc)])
  @@map("analysis_jobs")
}

model CodeModule {
  id              String   @id @default(uuid())
  repoId          String   @map("repo_id")
  jobId           String   @map("job_id")
  name            String
  path            String
  moduleType      String   @map("module_type")
  purposeSummary  String?  @map("purpose_summary")
  keyAbstractions Json     @default("[]") @map("key_abstractions")
  internalLogic   String?  @map("internal_logic")
  failureModes    Json     @default("[]") @map("failure_modes")
  interviewPoints Json     @default("[]") @map("interview_points")
  complexityScore Float    @default(0) @map("complexity_score")
  fileCount       Int      @default(0) @map("file_count")
  lineCount       Int      @default(0) @map("line_count")
  couplingScore   Float    @default(0) @map("coupling_score")
  createdAt       DateTime @default(now()) @map("created_at")

  repository   Repository @relation(fields: [repoId], references: [id], onDelete: Cascade)
  job          AnalysisJob @relation(fields: [jobId], references: [id], onDelete: Cascade)
  symbols      CodeSymbol[]
  sourceEdges  DependencyEdge[] @relation("SourceModule")
  targetEdges  DependencyEdge[] @relation("TargetModule")

  @@index([repoId])
  @@index([jobId])
  @@map("code_modules")
}

model CodeSymbol {
  id         String   @id @default(uuid())
  moduleId   String   @map("module_id")
  symbolType String   @map("symbol_type")
  name       String
  signature  String?
  filePath   String   @map("file_path")
  startLine  Int      @map("start_line")
  endLine    Int      @map("end_line")
  complexity Float    @default(0)
  docstring  String?
  annotations Json    @default("[]")
  parameters Json     @default("[]")
  returnType String?  @map("return_type")
  visibility String   @default("public")
  isExported Boolean  @default(false) @map("is_exported")
  dependencies Json  @default("[]")
  dependents    Json  @default("[]")
  createdAt  DateTime @default(now()) @map("created_at")

  module     CodeModule @relation(fields: [moduleId], references: [id], onDelete: Cascade)
  chunks     CodeChunk[]

  @@index([moduleId])
  @@index([symbolType])
  @@index([name])
  @@map("code_symbols")
}

model CodeChunk {
  id             String   @id @default(uuid())
  repoId         String   @map("repo_id")
  symbolId       String?  @map("symbol_id")
  filePath       String   @map("file_path")
  startLine      Int      @map("start_line")
  endLine        Int      @map("end_line")
  content        String
  chunkType      String   @map("chunk_type")
  tokenCount     Int      @default(0) @map("token_count")
  embeddingId    String?  @map("embedding_id")
  embeddingModel String?  @map("embedding_model")
  createdAt      DateTime @default(now()) @map("created_at")

  repository Repository  @relation(fields: [repoId], references: [id], onDelete: Cascade)
  symbol     CodeSymbol? @relation(fields: [symbolId], references: [id], onDelete: SetNull)

  @@index([repoId])
  @@index([symbolId])
  @@index([filePath])
  @@map("code_chunks")
}

model AnalysisArtifact {
  id           String   @id @default(uuid())
  jobId        String   @map("job_id")
  artifactType String   @map("artifact_type")
  title        String?
  content      Json
  version      Int      @default(1)
  generatedAt  DateTime @default(now()) @map("generated_at")
  tokenCount   Int      @default(0) @map("token_count")
  modelUsed    String?  @map("model_used")

  job       AnalysisJob @relation(fields: [jobId], references: [id], onDelete: Cascade)
  questions InterviewQuestion[]

  @@index([jobId])
  @@index([artifactType])
  @@map("analysis_artifacts")
}

model InterviewQuestion {
  id             String   @id @default(uuid())
  artifactId     String   @map("artifact_id")
  repoId         String   @map("repo_id")
  category       String
  difficulty     String
  questionType   String   @map("question_type")
  questionText   String   @map("question_text")
  modelAnswer    String   @map("model_answer")
  citations      Json     @default("[]")
  followUps      Json     @default("[]")
  tips           String?
  sourceModules  Json     @default("[]") @map("source_modules")
  createdAt      DateTime @default(now()) @map("created_at")

  artifact AnalysisArtifact @relation(fields: [artifactId], references: [id], onDelete: Cascade)
  repository Repository     @relation(fields: [repoId], references: [id], onDelete: Cascade)

  @@index([repoId])
  @@index([category])
  @@index([difficulty])
  @@map("interview_questions")
}

model ChatSession {
  id           String   @id @default(uuid())
  userId       String   @map("user_id")
  repoId       String   @map("repo_id")
  title        String?
  mode         String   @default("general")
  messageCount Int      @default(0) @map("message_count")
  totalTokens  Int      @default(0) @map("total_tokens")
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")

  user     User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  repository Repository  @relation(fields: [repoId], references: [id], onDelete: Cascade)
  messages ChatMessage[]

  @@index([userId])
  @@index([repoId])
  @@map("chat_sessions")
}

model ChatMessage {
  id        String   @id @default(uuid())
  sessionId String   @map("session_id")
  role      String
  content   String
  citations Json     @default("[]")
  metadata  Json     @default("{}")
  tokensUsed Int     @default(0) @map("tokens_used")
  modelUsed String?  @map("model_used")
  latencyMs Int?     @map("latency_ms")
  createdAt DateTime @default(now()) @map("created_at")

  session ChatSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)

  @@index([sessionId])
  @@index([createdAt])
  @@map("chat_messages")
}

model MockInterviewSession {
  id                 String    @id @default(uuid())
  userId             String    @map("user_id")
  repoId             String    @map("repo_id")
  persona            String
  difficulty         String    @default("mid")
  questionCount      Int       @default(0) @map("question_count")
  scoreOverall       Float?    @map("score_overall")
  scoreClarity       Float?    @map("score_clarity")
  scoreDepth         Float?    @map("score_depth")
  scoreSpecificity   Float?    @map("score_specificity")
  scoreConfidence    Float?    @map("score_confidence")
  timeSpentSec       Int       @default(0) @map("time_spent_sec")
  feedbackSummary    String?   @map("feedback_summary")
  strengths          Json      @default("[]")
  weaknesses         Json      @default("[]")
  studyRecommendations Json   @default("[]") @map("study_recommendations")
  status             String    @default("active")
  startedAt          DateTime  @default(now()) @map("started_at")
  completedAt        DateTime? @map("completed_at")

  user     User                @relation(fields: [userId], references: [id], onDelete: Cascade)
  repository Repository        @relation(fields: [repoId], references: [id], onDelete: Cascade)
  questions MockInterviewQuestion[]

  @@index([userId])
  @@index([repoId])
  @@index([status])
  @@map("mock_interview_sessions")
}

model MockInterviewQuestion {
  id               String   @id @default(uuid())
  sessionId        String   @map("session_id")
  sequenceNum      Int      @map("sequence_num")
  questionText     String   @map("question_text")
  questionCategory String?  @map("question_category")
  answerText       String?  @map("answer_text")
  citations        Json     @default("[]")
  score            Float?
  feedback         String?
  timeSpentSec     Int      @default(0) @map("time_spent_sec")
  isCoachingBreak  Boolean  @default(false) @map("is_coaching_break")
  coachingNote     String?  @map("coaching_note")
  createdAt        DateTime @default(now()) @map("created_at")

  session MockInterviewSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)

  @@index([sessionId])
  @@map("mock_interview_questions")
}

model DependencyEdge {
  id             String   @id @default(uuid())
  repoId         String   @map("repo_id")
  sourceModuleId String   @map("source_module_id")
  targetModuleId String   @map("target_module_id")
  edgeType       String   @map("edge_type")
  weight         Float    @default(1)
  filePath       String?  @map("file_path")
  createdAt      DateTime @default(now()) @map("created_at")

  repository   Repository @relation(fields: [repoId], references: [id], onDelete: Cascade)
  sourceModule CodeModule @relation("SourceModule", fields: [sourceModuleId], references: [id], onDelete: Cascade)
  targetModule CodeModule @relation("TargetModule", fields: [targetModuleId], references: [id], onDelete: Cascade)

  @@unique([repoId, sourceModuleId, targetModuleId, edgeType])
  @@map("dependency_edges")
}

model Subscription {
  id                      String   @id @default(uuid())
  userId                  String   @map("user_id")
  planTier                String   @map("plan_tier")
  reposLimit              Int      @map("repos_limit")
  reposRemaining          Int      @map("repos_remaining")
  chatsLimit              Int      @map("chats_limit")
  chatsRemaining          Int      @map("chats_remaining")
  mockInterviewsLimit     Int      @map("mock_interviews_limit")
  mockInterviewsRemaining Int      @map("mock_interviews_remaining")
  tokensLimit             BigInt   @map("tokens_limit")
  tokensRemaining         BigInt   @map("tokens_remaining")
  billingCycle            String   @default("monthly") @map("billing_cycle")
  stripeSubscriptionId    String?  @map("stripe_subscription_id")
  createdAt               DateTime @default(now()) @map("created_at")
  expiresAt               DateTime @map("expires_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([expiresAt])
  @@map("subscriptions")
}

model UsageEvent {
  id         String   @id @default(uuid())
  userId     String   @map("user_id")
  eventType  String   @map("event_type")
  repoId     String?  @map("repo_id")
  metadata   Json     @default("{}")
  tokensUsed Int      @default(0) @map("tokens_used")
  createdAt  DateTime @default(now()) @map("created_at")

  user       User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  repository Repository? @relation(fields: [repoId], references: [id], onDelete: SetNull)

  @@index([userId])
  @@index([eventType])
  @@index([createdAt(sort: Desc)])
  @@map("usage_events")
}
PRISMAEOF

# Run initial migration
npx prisma migrate dev --name init
npx prisma generate
cd ../..
```

### Step 3: Set Up Local Development

```bash
# Docker Compose for local development
cat > infra/docker/docker-compose.yml << 'EOF'
version: '3.8'

services:
  postgres:
    image: postgres:16-alpine
    container_name: vibecoder-postgres
    environment:
      POSTGRES_DB: vibecoder_dev
      POSTGRES_USER: vibecoder
      POSTGRES_PASSWORD: devpassword
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U vibecoder"]
      interval: 5s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    container_name: vibecoder-redis
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 5

  elasticsearch:
    image: docker.elastic.co/elasticsearch/elasticsearch:8.11.0
    container_name: vibecoder-elasticsearch
    environment:
      - discovery.type=single-node
      - xpack.security.enabled=false
      - "ES_JAVA_OPTS=-Xms512m -Xmx512m"
    ports:
      - "9200:9200"
    volumes:
      - elasticsearch_data:/usr/share/elasticsearch/data
    healthcheck:
      test: ["CMD-SHELL", "curl -f http://localhost:9200/_cluster/health || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 10

volumes:
  postgres_data:
  redis_data:
  elasticsearch_data:
EOF

# Start local infrastructure
cd infra/docker
docker compose up -d
cd ../..

# Verify services are running
docker compose -f infra/docker/docker-compose.yml ps
```

### Step 4: Build the API Server

```bash
cd apps/api

# Install dependencies
pnpm install

# Create main entry point
cat > src/index.ts << 'EOF'
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { PrismaClient } from '@prisma/client';
import { createClient } from 'redis';
import authRoutes from './routes/auth.routes';
import reposRoutes from './routes/repos.routes';
import analysisRoutes from './routes/analysis.routes';
import chatRoutes from './routes/chat.routes';
import interviewRoutes from './routes/interview.routes';
import billingRoutes from './routes/billing.routes';
import { errorHandler } from './middleware/errorHandler.middleware';
import { rateLimiter } from './middleware/rateLimit.middleware';

const app = express();
const PORT = process.env.PORT || 8000;

// Initialize clients
export const prisma = new PrismaClient();
export const redis = createClient({ url: process.env.REDIS_URL });

// Middleware
app.use(helmet());
app.use(cors({ origin: process.env.APP_URL, credentials: true }));
app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));
app.use(rateLimiter);

// Routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/repos', reposRoutes);
app.use('/api/v1', analysisRoutes);
app.use('/api/v1', chatRoutes);
app.use('/api/v1', interviewRoutes);
app.use('/api/v1/billing', billingRoutes);

// Health check
app.get('/api/v1/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    await redis.ping();
    res.json({ status: 'healthy', version: process.env.npm_package_version });
  } catch (error) {
    res.status(503).json({ status: 'unhealthy', error: (error as Error).message });
  }
});

// Error handler
app.use(errorHandler);

// Start server
async function start() {
  await redis.connect();
  app.listen(PORT, () => {
    console.log(`🚀 API server running on port ${PORT}`);
  });
}

start().catch(console.error);
EOF

# Create middleware files
cat > src/middleware/auth.middleware.ts << 'EOF'
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthRequest extends Request {
  userId?: string;
  githubId?: number;
}

export const authenticate = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as {
      sub: string;
      github_id: number;
    };

    req.userId = decoded.sub;
    req.githubId = decoded.github_id;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};
EOF

cat > src/middleware/errorHandler.middleware.ts << 'EOF'
import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';

export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  console.error('Error:', err);

  if (err instanceof ZodError) {
    return res.status(400).json({
      error: 'Validation error',
      details: err.errors,
    });
  }

  if ((err as any).code === 'P2025') {
    return res.status(404).json({ error: 'Resource not found' });
  }

  res.status(500).json({ error: 'Internal server error' });
};
EOF

cat > src/middleware/rateLimit.middleware.ts << 'EOF'
import { Request, Response, NextFunction } from 'express';
import { redis } from '../index';

const WINDOW_SIZE = 60; // seconds
const MAX_REQUESTS = 100;

export const rateLimiter = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const key = `ratelimit:${ip}`;

  try {
    const current = await redis.incr(key);
    if (current === 1) {
      await redis.expire(key, WINDOW_SIZE);
    }

    if (current > MAX_REQUESTS) {
      return res.status(429).json({ error: 'Too many requests' });
    }

    next();
  } catch (error) {
    next();
  }
};
EOF

cd ../..
```

---

## 4. Phase 2: Core Intelligence (Weeks 4-7)

### Step 5: Build the AST Parser Service (Rust)

```bash
cd services/ast-parser

# Initialize Rust project
cargo init --name vibecoder-ast-parser

# Update Cargo.toml
cat > Cargo.toml << 'EOF'
[package]
name = "vibecoder-ast-parser"
version = "0.1.0"
edition = "2021"

[dependencies]
axum = "0.7"
tokio = { version = "1", features = ["full"] }
tower-http = { version = "0.5", features = ["cors", "trace"] }
tree-sitter = "0.22"
tree-sitter-typescript = "0.21"
tree-sitter-javascript = "0.21"
tree-sitter-python = "0.21"
tree-sitter-go = "0.21"
tree-sitter-rust = "0.21"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tracing = "0.1"
tracing-subscriber = "0.3"
anyhow = "1"
thiserror = "1"
rayon = "1.8"

[profile.release]
opt-level = 3
lto = true
EOF

# Create main.rs
cat > src/main.rs << 'RUSTEOF'
use axum::{
    extract::State,
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;

mod parser;
mod symbols;
mod complexity;

#[derive(Clone)]
struct AppState {
    // Shared state here
}

#[derive(Deserialize)]
struct ParseRequest {
    file_path: String,
    content: String,
    language: String,
}

#[derive(Serialize)]
struct ParseResponse {
    file_path: String,
    language: String,
    symbols: Vec<Symbol>,
    imports: Vec<Import>,
    exports: Vec<Export>,
    complexity: f64,
}

#[derive(Serialize)]
struct Symbol {
    name: String,
    symbol_type: String,
    signature: String,
    start_line: usize,
    end_line: usize,
    parameters: Vec<Parameter>,
    return_type: Option<String>,
    docstring: Option<String>,
    is_exported: bool,
}

#[derive(Serialize)]
struct Parameter {
    name: String,
    param_type: Option<String>,
    default_value: Option<String>,
    is_optional: bool,
}

#[derive(Serialize)]
struct Import {
    source: String,
    specifiers: Vec<String>,
    is_default: bool,
}

#[derive(Serialize)]
struct Export {
    name: String,
    export_type: String,
    is_default: bool,
}

async fn health() -> Json<serde_json::Value> {
    Json(serde_json::json!({ "status": "healthy" }))
}

async fn parse_code(
    State(_state): State<Arc<AppState>>,
    Json(req): Json<ParseRequest>,
) -> Result<Json<ParseResponse>, (StatusCode, String)> {
    let result = parser::parse_file(&req.file_path, &req.content, &req.language)
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;

    Ok(Json(result))
}

#[tokio::main]
async fn main() {
    tracing_subscriber::init();

    let state = Arc::new(AppState {});

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .route("/health", get(health))
        .route("/parse", post(parse_code))
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let listener = tokio::net::TcpListener::bind("0.0.0.0:8001")
        .await
        .unwrap();

    tracing::info!("AST Parser listening on 8001");
    axum::serve(listener, app).await.unwrap();
}
RUSTEOF

# Create parser module
mkdir -p src/parser
cat > src/parser/mod.rs << 'EOF'
use crate::{Export, Import, Parameter, ParseResponse, Symbol};
use anyhow::Result;
use tree_sitter::{Language, Parser};

pub fn parse_file(file_path: &str, content: &str, language: &str) -> Result<ParseResponse> {
    let lang = match language {
        "typescript" | "typescriptreact" => unsafe { tree_sitter_typescript::LANGUAGE_TYPESCRIPT },
        "javascript" | "javascriptreact" => unsafe { tree_sitter_javascript::LANGUAGE },
        "python" => unsafe { tree_sitter_python::LANGUAGE },
        "go" => unsafe { tree_sitter_go::LANGUAGE },
        "rust" => unsafe { tree_sitter_rust::LANGUAGE },
        _ => return Err(anyhow::anyhow!("Unsupported language: {}", language)),
    };

    let mut parser = Parser::new();
    parser.set_language(&lang)?;

    let tree = parser.parse(content, None).unwrap();
    let root = tree.root_node();

    let symbols = extract_symbols(root, content)?;
    let imports = extract_imports(root, content)?;
    let exports = extract_exports(root, content)?;
    let complexity = crate::complexity::calculate_cyclomatic(root);

    Ok(ParseResponse {
        file_path: file_path.to_string(),
        language: language.to_string(),
        symbols,
        imports,
        exports,
        complexity,
    })
}

fn extract_symbols(root: tree_sitter::Node, content: &str) -> Result<Vec<Symbol>> {
    let mut symbols = Vec::new();
    let mut cursor = root.walk();

    for child in root.named_children(&mut cursor) {
        match child.kind() {
            "function_declaration" | "function_definition" | "function_item" => {
                if let Some(sym) = extract_function_symbol(child, content) {
                    symbols.push(sym);
                }
            }
            "class_declaration" | "class_definition" | "class_item" => {
                if let Some(sym) = extract_class_symbol(child, content) {
                    symbols.push(sym);
                }
            }
            "interface_declaration" | "interface_definition" => {
                if let Some(sym) = extract_interface_symbol(child, content) {
                    symbols.push(sym);
                }
            }
            "type_alias_declaration" | "type_alias_definition" => {
                if let Some(sym) = extract_type_symbol(child, content) {
                    symbols.push(sym);
                }
            }
            "variable_declaration" | "let_declaration" | "const_declaration" => {
                if let Some(sym) = extract_variable_symbol(child, content) {
                    symbols.push(sym);
                }
            }
            _ => {}
        }
    }

    Ok(symbols)
}

fn extract_function_symbol(node: tree_sitter::Node, content: &str) -> Option<Symbol> {
    let name = node.child_by_field_name("name")?
        .utf8_text(content.as_bytes()).ok()?.to_string();

    let start_line = node.start_position().row + 1;
    let end_line = node.end_position().row + 1;

    let signature = node.utf8_text(content.as_bytes()).ok()?
        .split('{').next()?.trim().to_string();

    let parameters = extract_parameters(node, content);
    let return_type = extract_return_type(node, content);
    let docstring = extract_docstring(node, content);

    Some(Symbol {
        name,
        symbol_type: "function".to_string(),
        signature,
        start_line,
        end_line,
        parameters,
        return_type,
        docstring,
        is_exported: false, // Simplified
    })
}

fn extract_class_symbol(node: tree_sitter::Node, content: &str) -> Option<Symbol> {
    let name = node.child_by_field_name("name")?
        .utf8_text(content.as_bytes()).ok()?.to_string();

    let start_line = node.start_position().row + 1;
    let end_line = node.end_position().row + 1;

    let signature = format!("class {}", name);

    Some(Symbol {
        name,
        symbol_type: "class".to_string(),
        signature,
        start_line,
        end_line,
        parameters: vec![],
        return_type: None,
        docstring: extract_docstring(node, content),
        is_exported: false,
    })
}

fn extract_interface_symbol(node: tree_sitter::Node, content: &str) -> Option<Symbol> {
    let name = node.child_by_field_name("name")?
        .utf8_text(content.as_bytes()).ok()?.to_string();

    Some(Symbol {
        name: name.clone(),
        symbol_type: "interface".to_string(),
        signature: format!("interface {}", name),
        start_line: node.start_position().row + 1,
        end_line: node.end_position().row + 1,
        parameters: vec![],
        return_type: None,
        docstring: extract_docstring(node, content),
        is_exported: false,
    })
}

fn extract_type_symbol(node: tree_sitter::Node, content: &str) -> Option<Symbol> {
    let name = node.child_by_field_name("name")?
        .utf8_text(content.as_bytes()).ok()?.to_string();

    Some(Symbol {
        name: name.clone(),
        symbol_type: "type".to_string(),
        signature: format!("type {}", name),
        start_line: node.start_position().row + 1,
        end_line: node.end_position().row + 1,
        parameters: vec![],
        return_type: None,
        docstring: None,
        is_exported: false,
    })
}

fn extract_variable_symbol(node: tree_sitter::Node, content: &str) -> Option<Symbol> {
    let declarator = node.named_child(0)?;
    let name = declarator.child_by_field_name("name")?
        .utf8_text(content.as_bytes()).ok()?.to_string();

    let symbol_type = match node.kind() {
        "const_declaration" | "const" => "constant",
        _ => "variable",
    };

    Some(Symbol {
        name,
        symbol_type: symbol_type.to_string(),
        signature: node.utf8_text(content.as_bytes()).ok()?
            .split(';').next()?.trim().to_string(),
        start_line: node.start_position().row + 1,
        end_line: node.end_position().row + 1,
        parameters: vec![],
        return_type: None,
        docstring: None,
        is_exported: false,
    })
}

fn extract_parameters(node: tree_sitter::Node, content: &str) -> Vec<Parameter> {
    let mut params = Vec::new();
    if let Some(params_node) = node.child_by_field_name("parameters") {
        for child in params_node.named_children(&mut params_node.walk()) {
            if let Some(param_name) = child.child_by_field_name("name") {
                if let Ok(name) = param_name.utf8_text(content.as_bytes()) {
                    let param_type = child.child_by_field_name("type")
                        .and_then(|t| t.utf8_text(content.as_bytes()).ok())
                        .map(|s| s.to_string());

                    params.push(Parameter {
                        name: name.to_string(),
                        param_type,
                        default_value: None,
                        is_optional: false,
                    });
                }
            }
        }
    }
    params
}

fn extract_return_type(node: tree_sitter::Node, content: &str) -> Option<String> {
    node.child_by_field_name("return_type")
        .and_then(|t| t.utf8_text(content.as_bytes()).ok())
        .map(|s| s.to_string())
}

fn extract_docstring(node: tree_sitter::Node, content: &str) -> Option<String> {
    // Look for preceding comment
    if let Some(prev) = node.prev_named_sibling() {
        if prev.kind() == "comment" {
            return prev.utf8_text(content.as_bytes()).ok().map(|s| s.to_string());
        }
    }
    None
}

fn extract_imports(root: tree_sitter::Node, content: &str) -> Result<Vec<Import>> {
    let mut imports = Vec::new();
    let mut cursor = root.walk();

    for child in root.named_children(&mut cursor) {
        match child.kind() {
            "import_statement" | "import_declaration" => {
                if let Some(imp) = parse_import(child, content) {
                    imports.push(imp);
                }
            }
            _ => {}
        }
    }

    Ok(imports)
}

fn parse_import(node: tree_sitter::Node, content: &str) -> Option<Import> {
    let source = node.child_by_field_name("source")?
        .utf8_text(content.as_bytes()).ok()?
        .trim_matches(|c| c == '\'' || c == '"')
        .to_string();

    let mut specifiers = Vec::new();
    let mut is_default = false;

    for child in node.named_children(&mut node.walk()) {
        match child.kind() {
            "import_specifier" => {
                if let Some(name) = child.child_by_field_name("name") {
                    if let Ok(n) = name.utf8_text(content.as_bytes()) {
                        specifiers.push(n.to_string());
                    }
                }
            }
            "identifier" => {
                if let Ok(n) = child.utf8_text(content.as_bytes()) {
                    specifiers.push(n.to_string());
                    is_default = true;
                }
            }
            _ => {}
        }
    }

    Some(Import {
        source,
        specifiers,
        is_default,
    })
}

fn extract_exports(root: tree_sitter::Node, content: &str) -> Result<Vec<Export>> {
    let mut exports = Vec::new();
    let mut cursor = root.walk();

    for child in root.named_children(&mut cursor) {
        match child.kind() {
            "export_statement" | "export_declaration" => {
                if let Some(exp) = parse_export(child, content) {
                    exports.push(exp);
                }
            }
            _ => {}
        }
    }

    Ok(exports)
}

fn parse_export(node: tree_sitter::Node, content: &str) -> Option<Export> {
    let is_default = node.utf8_text(content.as_bytes()).ok()?
        .contains("default");

    let name = if let Some(decl) = node.named_child(0) {
        decl.child_by_field_name("name")
            .and_then(|n| n.utf8_text(content.as_bytes()).ok())
            .map(|s| s.to_string())
            .unwrap_or_else(|| "default".to_string())
    } else {
        "default".to_string()
    };

    let export_type = if is_default { "default" } else { "named" };

    Some(Export {
        name,
        export_type: export_type.to_string(),
        is_default,
    })
}
EOF

# Create complexity module
cat > src/complexity/mod.rs << 'EOF'
pub fn calculate_cyclomatic(root: tree_sitter::Node) -> f64 {
    let mut complexity = 1.0; // Base complexity

    let mut cursor = root.walk();
    for node in root.descendants(&mut cursor) {
        match node.kind() {
            "if_statement" | "if_expression" |
            "else_if_clause" | "else_clause" |
            "for_statement" | "for_in_statement" |
            "while_statement" | "do_statement" |
            "match_expression" | "match_arm" |
            "case_clause" | "try_expression" |
            "catch_clause" | "conditional_expression" |
            "binary_expression" => {
                if node.kind() == "binary_expression" {
                    if let Some(op) = node.child_by_field_name("operator") {
                        if let Ok(op_text) = op.utf8_text(root.to_string().as_bytes()) {
                            if matches!(op_text, "&&" | "||" | "and" | "or") {
                                complexity += 1.0;
                            }
                        }
                    }
                } else {
                    complexity += 1.0;
                }
            }
            _ => {}
        }
    }

    complexity
}
EOF

# Build and test the parser
cargo build --release
cargo test

cd ../..
```

### Step 6: Build the Retrieval Engine (Python)

```bash
cd services/retrieval-engine

# Initialize Python project with Poetry
poetry init --name vibecoder-retrieval-engine --python "^3.11"

# Add dependencies
poetry add fastapi uvicorn[standard] elasticsearch pinecone-client \
  openai tiktoken pydantic redis python-dotenv

poetry add --group dev pytest pytest-asyncio httpx black ruff mypy

# Create project structure
mkdir -p app/{api,core,ingestion}

# Create main.py
cat > app/main.py << 'PYEOF'
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from elasticsearch import AsyncElasticsearch
from pinecone import Pinecone
import redis.asyncio as redis

from app.config import settings
from app.api import search, index

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    app.state.es = AsyncElasticsearch(settings.ELASTICSEARCH_URL)
    app.state.pc = Pinecone(api_key=settings.PINECONE_API_KEY)
    app.state.redis = redis.from_url(settings.REDIS_URL)
    
    yield
    
    # Shutdown
    await app.state.es.close()
    await app.state.redis.close()

app = FastAPI(
    title="Vibe Coder Retrieval Engine",
    version="0.1.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(search.router, prefix="/search", tags=["search"])
app.include_router(index.router, prefix="/index", tags=["index"])

@app.get("/health")
async def health():
    return {"status": "healthy"}
PYEOF

# Create config.py
cat > app/config.py << 'PYEOF'
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    ELASTICSEARCH_URL: str = "http://localhost:9200"
    ELASTICSEARCH_INDEX: str = "code_chunks"
    PINECONE_API_KEY: str = ""
    PINECONE_ENVIRONMENT: str = "us-east-1"
    PINECONE_INDEX_NAME: str = "vibecoder-embeddings"
    OPENAI_API_KEY: str = ""
    OPENAI_EMBEDDING_MODEL: str = "text-embedding-3-large"
    REDIS_URL: str = "redis://localhost:6379"
    
    class Config:
        env_file = ".env"

settings = Settings()
PYEOF

# Create search module
cat > app/api/search.py << 'PYEOF'
from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from typing import List, Optional
import time

router = APIRouter()

class SearchRequest(BaseModel):
    query: str
    repo_id: str
    top_k: int = 10
    mode: str = "hybrid"  # hybrid, dense, sparse

class SearchResult(BaseModel):
    chunk_id: str
    file_path: str
    start_line: int
    end_line: int
    content: str
    dense_score: float
    sparse_score: float
    fused_score: float
    symbol_name: Optional[str] = None

class SearchResponse(BaseModel):
    results: List[SearchResult]
    query_time_ms: float
    total_results: int

@router.post("/", response_model=SearchResponse)
async def search_code(request: Request, req: SearchRequest):
    start_time = time.time()
    
    # Get clients from app state
    es = request.app.state.es
    pc = request.app.state.pc
    
    results = []
    
    if req.mode in ["hybrid", "dense"]:
        # Dense search via Pinecone
        dense_results = await dense_search(pc, req.query, req.repo_id, req.top_k)
        results.extend(dense_results)
    
    if req.mode in ["hybrid", "sparse"]:
        # Sparse search via Elasticsearch
        sparse_results = await sparse_search(es, req.query, req.repo_id, req.top_k)
        results.extend(sparse_results)
    
    # If hybrid, fuse results
    if req.mode == "hybrid":
        results = reciprocal_rank_fusion(results, k=60)
    
    # Sort by fused score
    results.sort(key=lambda x: x.fused_score, reverse=True)
    results = results[:req.top_k]
    
    query_time = (time.time() - start_time) * 1000
    
    return SearchResponse(
        results=results,
        query_time_ms=query_time,
        total_results=len(results)
    )

async def dense_search(pc, query: str, repo_id: str, top_k: int) -> List[SearchResult]:
    # Generate embedding for query
    from openai import OpenAI
    client = OpenAI()
    
    response = client.embeddings.create(
        model="text-embedding-3-large",
        input=query
    )
    query_embedding = response.data[0].embedding
    
    # Search Pinecone
    index = pc.Index("vibecoder-embeddings")
    results = index.query(
        vector=query_embedding,
        top_k=top_k,
        filter={"repo_id": repo_id},
        include_metadata=True
    )
    
    return [
        SearchResult(
            chunk_id=match.id,
            file_path=match.metadata.get("file_path", ""),
            start_line=match.metadata.get("start_line", 0),
            end_line=match.metadata.get("end_line", 0),
            content=match.metadata.get("content", ""),
            dense_score=match.score,
            sparse_score=0.0,
            fused_score=match.score,
            symbol_name=match.metadata.get("symbol_name")
        )
        for match in results.matches
    ]

async def sparse_search(es, query: str, repo_id: str, top_k: int) -> List[SearchResult]:
    response = await es.search(
        index="code_chunks",
        body={
            "query": {
                "bool": {
                    "must": [
                        {"match": {"content": query}},
                        {"term": {"repo_id": repo_id}}
                    ]
                }
            },
            "size": top_k,
            "_source": ["file_path", "start_line", "end_line", "content", "symbol_name"]
        }
    )
    
    return [
        SearchResult(
            chunk_id=hit["_id"],
            file_path=hit["_source"].get("file_path", ""),
            start_line=hit["_source"].get("start_line", 0),
            end_line=hit["_source"].get("end_line", 0),
            content=hit["_source"].get("content", ""),
            dense_score=0.0,
            sparse_score=hit["_score"],
            fused_score=hit["_score"],
            symbol_name=hit["_source"].get("symbol_name")
        )
        for hit in response["hits"]["hits"]
    ]

def reciprocal_rank_fusion(results: List[SearchResult], k: int = 60) -> List[SearchResult]:
    # Group results by chunk_id
    scores = {}
    for result in results:
        if result.chunk_id not in scores:
            scores[result.chunk_id] = {
                "result": result,
                "ranks": []
            }
        if result.dense_score > 0:
            scores[result.chunk_id]["ranks"].append(("dense", result.dense_score))
        if result.sparse_score > 0:
            scores[result.chunk_id]["ranks"].append(("sparse", result.sparse_score))
    
    # Calculate RRF scores
    fused_results = []
    for chunk_id, data in scores.items():
        rrf_score = 0.0
        for rank_type, score in data["ranks"]:
            # Convert score to rank (simplified)
            rank = 1 / (score + 1)
            rrf_score += 1 / (k + rank)
        
        result = data["result"]
        result.fused_score = rrf_score
        fused_results.append(result)
    
    return fused_results
PYEOF

# Create index module
cat > app/api/index.py << 'PYEOF'
from fastapi import APIRouter, Request
from pydantic import BaseModel
from typing import List, Optional
import hashlib

router = APIRouter()

class ChunkDocument(BaseModel):
    repo_id: str
    symbol_id: Optional[str]
    file_path: str
    start_line: int
    end_line: int
    content: str
    chunk_type: str
    token_count: int
    symbol_name: Optional[str] = None

class IndexRequest(BaseModel):
    chunks: List[ChunkDocument]

class IndexResponse(BaseModel):
    indexed_count: int
    errors: List[str]

@router.post("/chunks", response_model=IndexResponse)
async def index_chunks(request: Request, req: IndexRequest):
    es = request.app.state.es
    pc = request.app.state.pc
    
    errors = []
    indexed_count = 0
    
    for chunk in req.chunks:
        try:
            # Generate embedding
            from openai import OpenAI
            client = OpenAI()
            
            response = client.embeddings.create(
                model="text-embedding-3-large",
                input=chunk.content
            )
            embedding = response.data[0].embedding
            
            # Index in Elasticsearch
            doc_id = hashlib.md5(f"{chunk.repo_id}:{chunk.file_path}:{chunk.start_line}".encode()).hexdigest()
            
            await es.index(
                index="code_chunks",
                id=doc_id,
                body={
                    "repo_id": chunk.repo_id,
                    "symbol_id": chunk.symbol_id,
                    "file_path": chunk.file_path,
                    "start_line": chunk.start_line,
                    "end_line": chunk.end_line,
                    "content": chunk.content,
                    "chunk_type": chunk.chunk_type,
                    "token_count": chunk.token_count,
                    "symbol_name": chunk.symbol_name
                }
            )
            
            # Index in Pinecone
            index = pc.Index("vibecoder-embeddings")
            index.upsert(
                vectors=[{
                    "id": doc_id,
                    "values": embedding,
                    "metadata": {
                        "repo_id": chunk.repo_id,
                        "file_path": chunk.file_path,
                        "start_line": chunk.start_line,
                        "end_line": chunk.end_line,
                        "content": chunk.content[:1000],  # Truncate for metadata
                        "symbol_name": chunk.symbol_name or ""
                    }
                }]
            )
            
            indexed_count += 1
        except Exception as e:
            errors.append(f"Error indexing chunk {chunk.file_path}:{chunk.start_line}: {str(e)}")
    
    return IndexResponse(indexed_count=indexed_count, errors=errors)
PYEOF

poetry install

cd ../..
```

### Step 7: Build the Generation Service (Python)

```bash
cd services/generation-service

poetry init --name vibecoder-generation-service --python "^3.11"

poetry add fastapi uvicorn[standard] openai langchain tiktoken pydantic redis

mkdir -p app/{api,core/prompts}

# Create main.py
cat > app/main.py << 'PYEOF'
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from openai import AsyncOpenAI
import redis.asyncio as redis

from app.config import settings
from app.api import generate, chat

@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.openai = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
    app.state.redis = redis.from_url(settings.REDIS_URL)
    yield
    await app.state.redis.close()

app = FastAPI(
    title="Vibe Coder Generation Service",
    version="0.1.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(generate.router, prefix="/generate", tags=["generate"])
app.include_router(chat.router, prefix="/chat", tags=["chat"])

@app.get("/health")
async def health():
    return {"status": "healthy"}
PYEOF

# Create config.py
cat > app/config.py << 'PYEOF'
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    OPENAI_API_KEY: str = ""
    OPENAI_MODEL: str = "gpt-4-turbo-preview"
    LLM_MAX_TOKENS: int = 4096
    LLM_TEMPERATURE: float = 0.3
    REDIS_URL: str = "redis://localhost:6379"
    
    class Config:
        env_file = ".env"

settings = Settings()
PYEOF

# Create generate module
cat > app/api/generate.py << 'PYEOF'
from fastapi import APIRouter, Request
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
import json

router = APIRouter()

class Citation(BaseModel):
    file_path: str
    start_line: int
    end_line: int
    symbol_name: Optional[str] = None
    relevance: str

class ContextChunk(BaseModel):
    content: str
    file_path: str
    start_line: int
    end_line: int
    symbol_name: Optional[str] = None

class GenerateRequest(BaseModel):
    query: str
    context: List[ContextChunk]
    mode: str = "chat"  # chat, architecture, questions
    citation_required: bool = True

class GenerateResponse(BaseModel):
    content: str
    citations: List[Citation]
    follow_up_questions: List[str]
    tokens_used: int
    model_used: str

@router.post("/", response_model=GenerateResponse)
async def generate_response(request: Request, req: GenerateRequest):
    openai = request.app.state.openai
    
    # Build system prompt based on mode
    system_prompt = get_system_prompt(req.mode)
    
    # Build context from chunks
    context_text = "\n\n".join([
        f"File: {chunk.file_path} (Lines {chunk.start_line}-{chunk.end_line})\n{chunk.content}"
        for chunk in req.context
    ])
    
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": f"Context:\n{context_text}\n\nQuestion: {req.query}"}
    ]
    
    response = await openai.chat.completions.create(
        model=settings.OPENAI_MODEL,
        messages=messages,
        max_tokens=settings.LLM_MAX_TOKENS,
        temperature=settings.LLM_TEMPERATURE,
        response_format={"type": "json_object"} if req.citation_required else None
    )
    
    content = response.choices[0].message.content
    tokens_used = response.usage.total_tokens
    
    # Parse citations from response
    citations = []
    follow_ups = []
    
    if req.citation_required:
        try:
            parsed = json.loads(content)
            content = parsed.get("answer", content)
            citations = [Citation(**c) for c in parsed.get("citations", [])]
            follow_ups = parsed.get("follow_up_questions", [])
        except json.JSONDecodeError:
            pass
    
    return GenerateResponse(
        content=content,
        citations=citations,
        follow_up_questions=follow_ups,
        tokens_used=tokens_used,
        model_used=settings.OPENAI_MODEL
    )

def get_system_prompt(mode: str) -> str:
    prompts = {
        "chat": """You are an expert software engineer helping someone understand a codebase.
        
Your task is to answer questions about the code accurately, citing specific files and line numbers.

Always:
1. Reference specific files and line numbers from the context
2. Explain code in clear, accessible language
3. Provide relevant follow-up questions the user might want to ask
4. If you're unsure, say so rather than guessing

Format your response as JSON with:
- answer: Your detailed answer
- citations: Array of {file_path, start_line, end_line, symbol_name, relevance}
- follow_up_questions: Array of suggested follow-up questions""",
        
        "architecture": """You are a senior software architect analyzing a codebase.

Provide a comprehensive architecture overview including:
1. Project purpose and main functionality
2. Key modules and their responsibilities
3. Data flow and dependencies
4. Design patterns used
5. Technical decisions and trade-offs
6. Potential improvements or concerns

Cite specific files and modules in your analysis.""",
        
        "questions": """You are an experienced technical interviewer.

Generate interview questions based on the provided codebase context.
Include:
1. Questions of varying difficulty (junior, mid, senior)
2. Model answers with code citations
3. Follow-up questions
4. Tips for answering

Focus on:
- Architecture and design decisions
- Code quality and patterns
- Potential improvements
- Edge cases and error handling""",
    }
    return prompts.get(mode, prompts["chat"])
PYEOF

# Create chat module with streaming
cat > app/api/chat.py << 'PYEOF'
from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Optional
import json
import asyncio

router = APIRouter()

class ChatMessage(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    messages: List[ChatMessage]
    context: List[dict]
    stream: bool = True

@router.post("/stream")
async def chat_stream(request: Request, req: ChatRequest):
    openai = request.app.state.openai
    
    # Build messages for OpenAI
    messages = [{"role": "system", "content": get_system_prompt()}]
    
    # Add context
    context_text = "\n\n".join([
        f"File: {ctx.get('file_path', '')} (Lines {ctx.get('start_line', 0)}-{ctx.get('end_line', 0)})\n{ctx.get('content', '')}"
        for ctx in req.context
    ])
    
    if context_text:
        messages.append({"role": "system", "content": f"Relevant code context:\n{context_text}"})
    
    # Add conversation history
    for msg in req.messages:
        messages.append({"role": msg.role, "content": msg.content})
    
    async def generate():
        stream = await openai.chat.completions.create(
            model=settings.OPENAI_MODEL,
            messages=messages,
            max_tokens=settings.LLM_MAX_TOKENS,
            temperature=settings.LLM_TEMPERATURE,
            stream=True
        )
        
        async for chunk in stream:
            if chunk.choices[0].delta.content:
                yield f"data: {json.dumps({'content': chunk.choices[0].delta.content})}\n\n"
        
        yield "data: [DONE]\n\n"
    
    return StreamingResponse(generate(), media_type="text/event-stream")

def get_system_prompt() -> str:
    return """You are an expert software engineer helping someone understand a codebase.

Always:
1. Reference specific files and line numbers from the context
2. Explain code in clear, accessible language
3. Use code examples when helpful
4. Be concise but thorough

When citing code, use the format: `filename:startLine-endLine`"""
PYEOF

poetry install

cd ../..
```

---

## 5. Phase 3: User Interface (Weeks 8-10)

### Step 8: Build the Next.js Web Application

```bash
cd apps/web

# Initialize Next.js app
pnpm create next-app@latest . --typescript --tailwind --eslint --app --src-dir

# Install dependencies
pnpm add @tanstack/react-query zustand axios socket.io-client
pnpm add @radix-ui/react-dialog @radix-ui/react-dropdown-menu
pnpm add @radix-ui/react-tabs @radix-ui/react-tooltip
pnpm add class-variance-authority clsx tailwind-merge
pnpm add lucide-react
pnpm add recharts visx @visx/xychart

# Create directory structure
mkdir -p src/{components/{ui,repo,chat,interview,architecture,shared},hooks,lib,stores,types}

# Create types file
cat > src/types/index.ts << 'EOF'
export interface User {
  id: string;
  githubId: number;
  email: string;
  username: string;
  displayName: string;
  avatarUrl: string;
  planTier: 'free' | 'starter' | 'pro' | 'institutional';
}

export interface Repository {
  id: string;
  fullName: string;
  defaultBranch: string;
  languagePrimary: string;
  languages: Record<string, number>;
  totalFiles: number;
  totalLines: number;
  visibility: 'public' | 'private';
  lastAnalyzedAt: string | null;
  analysisCount: number;
}

export interface AnalysisJob {
  id: string;
  repoId: string;
  status: 'queued' | 'cloning' | 'parsing' | 'indexing' | 'generating' | 'completed' | 'failed';
  startedAt: string | null;
  completedAt: string | null;
  stats: {
    filesParsed: number;
    symbolsExtracted: number;
    chunksCreated: number;
  };
}

export interface CodeModule {
  id: string;
  name: string;
  path: string;
  moduleType: string;
  purposeSummary: string;
  keyAbstractions: string[];
  complexityScore: number;
  fileCount: number;
  lineCount: number;
}

export interface InterviewQuestion {
  id: string;
  category: string;
  difficulty: string;
  questionType: string;
  questionText: string;
  modelAnswer: string;
  citations: Citation[];
  followUps: string[];
}

export interface Citation {
  filePath: string;
  startLine: number;
  endLine: number;
  symbolName: string | null;
  relevance: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations: Citation[];
  createdAt: string;
}

export interface MockInterviewSession {
  id: string;
  persona: string;
  difficulty: string;
  status: 'active' | 'completed' | 'abandoned';
  scores: {
    overall: number;
    clarity: number;
    depth: number;
    specificity: number;
    confidence: number;
  };
  startedAt: string;
  completedAt: string | null;
}
EOF

# Create API client
cat > src/lib/api.ts << 'EOF'
import axios from 'axios';

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000',
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add auth token to requests
api.interceptors.request.use((config) => {
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle 401 errors
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      // Try to refresh token
      try {
        const refreshResponse = await api.post('/api/v1/auth/refresh');
        const newToken = refreshResponse.data.accessToken;
        localStorage.setItem('token', newToken);
        error.config.headers.Authorization = `Bearer ${newToken}`;
        return api(error.config);
      } catch {
        // Refresh failed, redirect to login
        localStorage.removeItem('token');
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

export default api;
EOF

# Create WebSocket hook
cat > src/hooks/useWebSocket.ts << 'EOF'
'use client';

import { useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';

interface UseWebSocketOptions {
  url?: string;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: Error) => void;
}

export function useWebSocket(options: UseWebSocketOptions = {}) {
  const socketRef = useRef<Socket | null>(null);
  const { 
    url = process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:8080',
    onConnect,
    onDisconnect,
    onError 
  } = options;

  useEffect(() => {
    const token = localStorage.getItem('token');
    
    const socket = io(url, {
      auth: { token },
      transports: ['websocket', 'polling'],
    });

    socket.on('connect', () => {
      console.log('WebSocket connected');
      onConnect?.();
    });

    socket.on('disconnect', () => {
      console.log('WebSocket disconnected');
      onDisconnect?.();
    });

    socket.on('error', (error) => {
      console.error('WebSocket error:', error);
      onError?.(error);
    });

    socketRef.current = socket;

    return () => {
      socket.disconnect();
    };
  }, [url, onConnect, onDisconnect, onError]);

  const emit = useCallback((event: string, data?: any) => {
    socketRef.current?.emit(event, data);
  }, []);

  const on = useCallback((event: string, callback: (...args: any[]) => void) => {
    socketRef.current?.on(event, callback);
    return () => {
      socketRef.current?.off(event, callback);
    };
  }, []);

  return { emit, on, socket: socketRef };
}
EOF

# Create chat store
cat > src/stores/chatStore.ts << 'EOF'
import { create } from 'zustand';
import { ChatMessage } from '@/types';

interface ChatState {
  messages: ChatMessage[];
  isLoading: boolean;
  error: string | null;
  addMessage: (message: ChatMessage) => void;
  setIsLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clearMessages: () => void;
}

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  isLoading: false,
  error: null,
  
  addMessage: (message) => set((state) => ({
    messages: [...state.messages, message]
  })),
  
  setIsLoading: (loading) => set({ isLoading: loading }),
  
  setError: (error) => set({ error }),
  
  clearMessages: () => set({ messages: [], error: null }),
}));
EOF

# Create main dashboard page
cat > src/app/\(dashboard\)/page.tsx << 'EOF'
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import { Repository } from '@/types';

export default function DashboardPage() {
  const router = useRouter();
  const [repos, setRepos] = useState<Repository[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchRepos();
  }, []);

  const fetchRepos = async () => {
    try {
      const response = await api.get('/api/v1/repos');
      setRepos(response.data);
    } catch (err) {
      setError('Failed to load repositories');
    } finally {
      setIsLoading(false);
    }
  };

  const handleConnectRepo = async (url: string) => {
    try {
      await api.post('/api/v1/repos/connect', { url });
      fetchRepos();
    } catch (err) {
      setError('Failed to connect repository');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Your Repositories</h1>
          <button
            onClick={() => router.push('/repos/connect')}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
          >
            Connect Repository
          </button>
        </div>

        {isLoading ? (
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-4 text-gray-600">Loading repositories...</p>
          </div>
        ) : error ? (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
            {error}
          </div>
        ) : repos.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-lg shadow">
            <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <h3 className="mt-2 text-sm font-medium text-gray-900">No repositories</h3>
            <p className="mt-1 text-sm text-gray-500">Get started by connecting a GitHub repository.</p>
            <div className="mt-6">
              <button
                onClick={() => router.push('/repos/connect')}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
              >
                Connect Repository
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {repos.map((repo) => (
              <div
                key={repo.id}
                className="bg-white rounded-lg shadow hover:shadow-lg transition-shadow cursor-pointer"
                onClick={() => router.push(`/repos/${repo.id}`)}
              >
                <div className="p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-gray-900 truncate">
                      {repo.fullName}
                    </h3>
                    <span className="px-2 py-1 text-xs rounded-full bg-gray-100 text-gray-700">
                      {repo.languagePrimary}
                    </span>
                  </div>
                  <div className="text-sm text-gray-500 space-y-1">
                    <p>{repo.totalFiles} files • {repo.totalLines.toLocaleString()} lines</p>
                    <p>
                      Last analyzed: {repo.lastAnalyzedAt 
                        ? new Date(repo.lastAnalyzedAt).toLocaleDateString()
                        : 'Never'}
                    </p>
                  </div>
                  {repo.lastAnalyzedAt && (
                    <div className="mt-4 flex gap-2">
                      <button className="text-sm text-blue-600 hover:text-blue-800">
                        View Architecture
                      </button>
                      <span className="text-gray-300">•</span>
                      <button className="text-sm text-blue-600 hover:text-blue-800">
                        Start Chat
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
EOF

# Create chat interface component
cat > src/components/chat/ChatInterface.tsx << 'EOF'
'use client';

import { useState, useRef, useEffect } from 'react';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useChatStore } from '@/stores/chatStore';
import { ChatMessage, Citation } from '@/types';

interface ChatInterfaceProps {
  repoId: string;
}

export function ChatInterface({ repoId }: ChatInterfaceProps) {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { messages, addMessage, isLoading, setIsLoading } = useChatStore();
  
  const { emit, on } = useWebSocket({
    onConnect: () => {
      console.log('Connected to chat');
    },
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    const cleanup = on('chat:stream:chunk', (data: { content: string; citations: Citation[] }) => {
      // Update the last assistant message with new content
      const lastMessage = messages[messages.length - 1];
      if (lastMessage && lastMessage.role === 'assistant') {
        addMessage({
          ...lastMessage,
          content: lastMessage.content + data.content,
          citations: data.citations || lastMessage.citations,
        });
      }
    });

    return cleanup;
  }, [messages, on, addMessage]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      citations: [],
      createdAt: new Date().toISOString(),
    };

    addMessage(userMessage);
    setInput('');
    setIsLoading(true);

    // Create placeholder for assistant response
    const assistantMessage: ChatMessage = {
      id: (Date.now() + 1).toString(),
      role: 'assistant',
      content: '',
      citations: [],
      createdAt: new Date().toISOString(),
    };
    addMessage(assistantMessage);

    // Send via WebSocket
    emit('chat:send', {
      sessionId: repoId,
      content: input,
    });
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-3xl rounded-lg px-4 py-2 ${
                message.role === 'user'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-900'
              }`}
            >
              <p className="whitespace-pre-wrap">{message.content}</p>
              {message.citations.length > 0 && (
                <div className="mt-2 pt-2 border-t border-gray-200">
                  <p className="text-xs font-medium text-gray-500 mb-1">Citations:</p>
                  {message.citations.map((citation, idx) => (
                    <p key={idx} className="text-xs text-gray-600">
                      {citation.filePath}:{citation.startLine}-{citation.endLine}
                      {citation.symbolName && ` (${citation.symbolName})`}
                    </p>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div className="border-t p-4">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about the codebase..."
            className="flex-1 border rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {isLoading ? 'Thinking...' : 'Send'}
          </button>
        </form>
      </div>
    </div>
  );
}
EOF

cd ../..
```

---

## 6. Phase 4: Advanced Features (Weeks 11-14)

### Step 9: Build the Mock Interview Engine

```bash
cd services/mock-interview-engine

poetry init --name vibecoder-mock-interview-engine --python "^3.11"

poetry add fastapi uvicorn[standard] openai pydantic redis

mkdir -p app/{api,core}

# Create main.py
cat > app/main.py << 'PYEOF'
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from openai import AsyncOpenAI
import redis.asyncio as redis

from app.config import settings
from app.api import sessions, scoring

@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.openai = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
    app.state.redis = redis.from_url(settings.REDIS_URL)
    yield
    await app.state.redis.close()

app = FastAPI(
    title="Vibe Coder Mock Interview Engine",
    version="0.1.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(sessions.router, prefix="/sessions", tags=["sessions"])
app.include_router(scoring.router, prefix="/scoring", tags=["scoring"])

@app.get("/health")
async def health():
    return {"status": "healthy"}
PYEOF

# Create personas module
cat > app/core/personas.py << 'PYEOF'
from typing import Dict, Any

PERSONAS: Dict[str, Dict[str, Any]] = {
    "friendly_senior": {
        "name": "Alex",
        "role": "Friendly Senior Engineer",
        "system_prompt": """You are Alex, a friendly senior engineer at a top tech company. You're conducting a technical interview but want the candidate to feel comfortable.

Your style:
- Start with easy warm-up questions
- Be encouraging when the candidate explains things well
- Offer hints if they're stuck (after 30 seconds)
- Use phrases like "That's a great start!" and "Can you tell me more about..."
- Be patient and let them think

When the candidate gets something wrong:
- Don't interrupt immediately
- Let them finish their thought
- Gently redirect: "That's interesting, but have you considered..."

Interview structure:
1. Warm-up (2 questions): Basic project understanding
2. Deep dive (3 questions): Technical details
3. Challenge (2 questions): Trade-offs and edge cases""",
    },
    
    "rigorous_hiring_manager": {
        "name": "Dr. Chen",
        "role": "Rigorous Hiring Manager",
        "system_prompt": """You are Dr. Chen, a rigorous hiring manager at a Fortune 500 company. You have high standards and expect precise, well-structured answers.

Your style:
- Ask direct, challenging questions
- Follow up aggressively on weak answers
- Test depth of understanding: "What's the time complexity of that?"
- Challenge assumptions: "Why did you choose that approach over X?"
- Be professional but not warm

When the candidate makes a mistake:
- Immediately point it out: "That's not quite right."
- Ask them to explain their reasoning
- Don't accept vague answers

Interview structure:
1. Technical screening (2 questions): Verify core knowledge
2. System design (3 questions): Architecture decisions
3. Problem solving (2 questions): Algorithmic thinking""",
    },
    
    "curious_peer": {
        "name": "Jordan",
        "role": "Curious Peer",
        "system_prompt": """You are Jordan, a curious peer who just joined the team. You're interviewing the candidate but also genuinely curious about their code.

Your style:
- Ask "how" and "why" questions naturally
- Share your own experience: "Oh interesting, I've seen a similar pattern..."
- Get excited about clever solutions
- Ask about things you'd actually want to know as a teammate
- Be conversational and relatable

Interview flow:
1. Code walkthrough: "Walk me through how this works"
2. Collaboration questions: "How would I contribute to this module?"
3. Learning questions: "What's the hardest part of this codebase?"

This persona is great for candidates who get nervous in formal interviews.""",
    },
    
    "stressed_tech_lead": {
        "name": "Sam",
        "role": "Stressed Tech Lead",
        "system_prompt": """You are Sam, a tech lead who's behind on a deadline. You're conducting the interview quickly but still need to assess the candidate.

Your style:
- Talk fast, expect fast responses
- Interrupt if they're rambling: "Get to the point"
- Focus on practical knowledge: "Have you used X? Yes or no?"
- Show mild impatience with long answers
- Be direct about what you need to hear

This tests how candidates handle pressure and communicate concisely.

Interview structure:
1. Quick fire (3 questions): Yes/no with explanation
2. Code review (2 questions): "What's wrong with this?"
3. Decision making (2 questions): "You have 10 minutes, what do you do?" """,
    },
    
    "detailed_reviewer": {
        "name": "Dr. Patel",
        "role": "Detailed Code Reviewer",
        "system_prompt": """You are Dr. Patel, an expert code reviewer. You focus on code quality, best practices, and maintainability.

Your style:
- Ask about specific lines of code
- Focus on edge cases: "What happens if X is null?"
- Test understanding of patterns: "Why use a factory here?"
- Ask about testing strategies
- Evaluate error handling

Review structure:
1. Code quality (3 questions): Naming, structure, patterns
2. Testing (2 questions): Coverage, strategies, mocking
3. Production concerns (2 questions): Monitoring, deployment""",
    },
}

def get_persona(persona_name: str) -> Dict[str, Any]:
    if persona_name == "random":
        import random
        return random.choice(list(PERSONS.values()))
    return PERSONAS.get(persona_name, PERSONAS["friendly_senior"])
PYEOF

# Create question generation module
cat > app/core/question_gen.py << 'PYEOF'
from openai import AsyncOpenAI
from typing import List, Dict, Any

class QuestionGenerator:
    def __init__(self, openai: AsyncOpenAI):
        self.openai = openai
    
    async def generate_questions(
        self,
        repo_context: str,
        persona: Dict[str, Any],
        difficulty: str,
        num_questions: int = 7
    ) -> List[Dict[str, Any]]:
        
        prompt = f"""Based on the following codebase context, generate {num_questions} interview questions.

Persona: {persona['name']} ({persona['role']})
Difficulty: {difficulty}

Codebase Context:
{repo_context[:3000]}  # Truncate to fit context window

Generate questions that:
1. Are specific to this codebase (reference actual files and functions)
2. Match the {difficulty} difficulty level
3. Cover different aspects: architecture, implementation, testing, trade-offs
4. Include the expected answer with code citations

Return as JSON array with this structure:
[
  {{
    "question": "Question text",
    "category": "architecture|implementation|testing|trade_offs",
    "expected_answer": "Model answer with citations",
    "citations": [{{"file_path": "...", "start_line": 0, "end_line": 0, "symbol_name": "..."}}],
    "follow_ups": ["Follow-up question 1", "Follow-up question 2"]
  }}
]"""
        
        response = await self.openai.chat.completions.create(
            model="gpt-4-turbo-preview",
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
            temperature=0.7
        )
        
        import json
        return json.loads(response.choices[0].message.content).get("questions", [])
    
    async def generate_coaching_break(
        self,
        question: str,
        answer: str,
        repo_context: str
    ) -> str:
        
        prompt = f"""The candidate struggled with this interview question. Provide a helpful coaching note.

Question: {question}
Candidate's Answer: {answer}

Relevant Code Context:
{repo_context[:2000]}

Provide a concise coaching note that:
1. Identifies what the candidate missed
2. Points them to the right part of the codebase
3. Gives a hint without the full answer"""
        
        response = await self.openai.chat.completions.create(
            model="gpt-4-turbo-preview",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.5,
            max_tokens=200
        )
        
        return response.choices[0].message.content
PYEOF

# Create scoring module
cat > app/core/scoring.py << 'PYEOF'
from openai import AsyncOpenAI
from typing import Dict, Any
import json

class AnswerScorer:
    def __init__(self, openai: AsyncOpenAI):
        self.openai = openai
    
    async def score_answer(
        self,
        question: str,
        expected_answer: str,
        candidate_answer: str,
        citations: list
    ) -> Dict[str, Any]:
        
        prompt = f"""Score this interview answer on a scale of 1-10 for each dimension.

Question: {question}
Expected Answer: {expected_answer}
Candidate's Answer: {candidate_answer}
Code Citations in Answer: {json.dumps(citations[:5])}

Score on these dimensions (1-10 each):
1. clarity: How clear and well-structured is the explanation?
2. depth: Does it show deep understanding of the code?
3. specificity: Does it reference specific code, not just general concepts?
4. accuracy: Is the technical information correct?
5. confidence: Does the candidate sound confident and certain?

Return JSON:
{{
  "clarity": 8,
  "depth": 7,
  "specificity": 9,
  "accuracy": 8,
  "confidence": 7,
  "overall": 7.8,
  "feedback": "Specific feedback on strengths and areas for improvement",
  "strengths": ["Strength 1", "Strength 2"],
  "weaknesses": ["Weakness 1"]
}}"""
        
        response = await self.openai.chat.completions.create(
            model="gpt-4-turbo-preview",
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
            temperature=0.3
        )
        
        return json.loads(response.choices[0].message.content)
    
    async def generate_final_report(
        self,
        questions_and_scores: list,
        persona: str
    ) -> Dict[str, Any]:
        
        scores_text = "\n".join([
            f"Q{i+1}: {q['question'][:50]}... | Score: {q['score']}/10"
            for i, q in enumerate(questions_and_scores)
        ])
        
        prompt = f"""Generate a final interview report based on these questions and scores.

Interview Persona: {persona}
Questions and Scores:
{scores_text}

Generate a comprehensive report including:
1. Overall assessment (1-10)
2. Strengths demonstrated
3. Areas for improvement
4. Specific study recommendations with code references
5. Readiness assessment for different interview types"""
        
        response = await self.openai.chat.completions.create(
            model="gpt-4-turbo-preview",
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
            temperature=0.5
        )
        
        return json.loads(response.choices[0].message.content)
PYEOF

# Create sessions API
cat > app/api/sessions.py << 'PYEOF'
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from typing import List, Optional
import uuid
from datetime import datetime

from app.core.personas import get_persona
from app.core.question_gen import QuestionGenerator
from app.core.scoring import AnswerScorer

router = APIRouter()

class CreateSessionRequest(BaseModel):
    repo_id: str
    persona: str = "friendly_senior"
    difficulty: str = "mid"

class SubmitAnswerRequest(BaseModel):
    session_id: str
    question_id: str
    answer: str

class QuestionResponse(BaseModel):
    id: str
    question_text: str
    category: str
    question_number: int
    total_questions: int

@router.post("/", response_model=QuestionResponse)
async def create_session(request: Request, req: CreateSessionRequest):
    openai = request.app.state.openai
    
    # Get persona
    persona = get_persona(req.persona)
    
    # Generate questions (simplified - in production, fetch from DB)
    generator = QuestionGenerator(openai)
    
    # For now, return a mock first question
    question_id = str(uuid.uuid4())
    
    return QuestionResponse(
        id=question_id,
        question_text=f"Tell me about the main purpose of this project and how you approached its architecture.",
        category="architecture",
        question_number=1,
        total_questions=7
    )

@router.post("/answer")
async def submit_answer(request: Request, req: SubmitAnswerRequest):
    openai = request.app.state.openai
    
    scorer = AnswerScorer(openai)
    
    # Score the answer (simplified)
    scores = await scorer.score_answer(
        question="Tell me about the main purpose of this project",
        expected_answer="The project is a web platform for...",
        candidate_answer=req.answer,
        citations=[]
    )
    
    return {
        "question_id": req.question_id,
        "scores": scores,
        "next_question": "Now, let's dive into the authentication system..."
    }

@router.get("/{session_id}")
async def get_session(session_id: str):
    # Fetch session from database
    return {
        "id": session_id,
        "status": "active",
        "current_question": 3,
        "total_questions": 7,
        "scores": {
            "overall": 7.5,
            "clarity": 8,
            "depth": 7,
            "specificity": 7,
            "confidence": 8
        }
    }

@router.post("/{session_id}/complete")
async def complete_session(session_id: str):
    return {
        "id": session_id,
        "status": "completed",
        "final_scores": {
            "overall": 7.5,
            "clarity": 8,
            "depth": 7,
            "specificity": 7,
            "confidence": 8
        },
        "feedback_summary": "Strong understanding of architecture, needs more depth on implementation details.",
        "strengths": ["Clear communication", "Good architectural thinking"],
        "weaknesses": ["Could go deeper on code specifics"],
        "study_recommendations": [
            "Review the authentication module in detail",
            "Practice explaining code at a lower level"
        ]
    }
PYEOF

poetry install

cd ../..
```

### Step 10: Build the WebSocket Server

```bash
cd services/websocket-server

cat > package.json << 'EOF'
{
  "name": "@vibecoder/websocket-server",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "socket.io": "^4.7.0",
    "ioredis": "^5.3.0",
    "jsonwebtoken": "^9.0.0",
    "axios": "^1.6.0",
    "pino": "^8.17.0",
    "pino-pretty": "^10.3.0"
  },
  "devDependencies": {
    "typescript": "^5.3.0",
    "tsx": "^4.7.0",
    "@types/node": "^20.0.0"
  }
}
EOF

cat > src/index.ts << 'EOF'
import { Server } from 'socket.io';
import { createClient } from 'redis';
import jwt from 'jsonwebtoken';
import axios from 'axios';
import pino from 'pino';

const logger = pino({ transport: { target: 'pino-pretty' } });

const io = new Server(process.env.PORT || 8080, {
  cors: {
    origin: process.env.APP_URL || 'http://localhost:3000',
    credentials: true,
  },
});

const redis = createClient({ url: process.env.REDIS_URL });
await redis.connect();

// Redis adapter for horizontal scaling
import { createAdapter } from '@socket.io/redis-adapter';
io.adapter(createAdapter(redis, redis.duplicate()));

// Authentication middleware
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) {
    return next(new Error('Authentication required'));
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as { sub: string };
    socket.data.userId = decoded.sub;
    next();
  } catch (err) {
    next(new Error('Invalid token'));
  }
});

io.on('connection', (socket) => {
  const userId = socket.data.userId;
  logger.info(`User connected: ${userId}`);

  // Join user's personal room
  socket.join(`user:${userId}`);

  // Chat events
  socket.on('chat:send', async (data: { sessionId: string; content: string }) => {
    try {
      // Store message in database via API
      await axios.post(`${process.env.API_URL}/api/v1/chat/messages`, {
        sessionId: data.sessionId,
        content: data.content,
      });

      // Generate response via generation service
      const response = await axios.post(`${process.env.GENERATION_URL}/chat/stream`, {
        messages: [{ role: 'user', content: data.content }],
        context: [], // Fetch from retrieval service
        stream: true,
      });

      // Stream response back to client
      socket.emit('chat:stream:start', { sessionId: data.sessionId });

      // For simplicity, send complete response
      // In production, use SSE or chunked transfer
      socket.emit('chat:stream:chunk', {
        sessionId: data.sessionId,
        content: response.data,
        citations: [],
      });

      socket.emit('chat:stream:end', {
        sessionId: data.sessionId,
        totalTokens: 0,
      });
    } catch (error) {
      logger.error('Chat error:', error);
      socket.emit('chat:error', { error: 'Failed to process message' });
    }
  });

  // Mock interview events
  socket.on('mock-interview:answer', async (data: { sessionId: string; answer: string }) => {
    try {
      const response = await axios.post(`${process.env.INTERVIEW_URL}/sessions/answer`, {
        session_id: data.sessionId,
        answer: data.answer,
      });

      socket.emit('mock-interview:score', {
        sessionId: data.sessionId,
        scores: response.data.scores,
        feedback: response.data.feedback,
      });

      socket.emit('mock-interview:next', {
        sessionId: data.sessionId,
        question: response.data.next_question,
      });
    } catch (error) {
      logger.error('Mock interview error:', error);
      socket.emit('mock-interview:error', { error: 'Failed to process answer' });
    }
  });

  socket.on('disconnect', () => {
    logger.info(`User disconnected: ${userId}`);
  });
});

logger.info('WebSocket server started on port', process.env.PORT || 8080);
EOF

cd ../..
```

---

## 7. Phase 5: Production Readiness (Weeks 15-16)

### Step 11: Docker Configuration

```bash
# Create Docker Compose for local development
cat > infra/docker/docker-compose.yml << 'EOF'
version: '3.8'

services:
  # Infrastructure
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: vibecoder_dev
      POSTGRES_USER: vibecoder
      POSTGRES_PASSWORD: devpassword
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

  elasticsearch:
    image: docker.elastic.co/elasticsearch/elasticsearch:8.11.0
    environment:
      - discovery.type=single-node
      - xpack.security.enabled=false
      - "ES_JAVA_OPTS=-Xms512m -Xmx512m"
    ports:
      - "9200:9200"

  # Application Services
  api:
    build:
      context: ../../
      dockerfile: infra/docker/Dockerfile.api
    ports:
      - "8000:8000"
    environment:
      - DATABASE_URL=postgresql://vibecoder:devpassword@postgres:5432/vibecoder_dev
      - REDIS_URL=redis://redis:6379
      - ELASTICSEARCH_URL=http://elasticsearch:9200
    depends_on:
      - postgres
      - redis
      - elasticsearch

  websocket:
    build:
      context: ../../
      dockerfile: infra/docker/Dockerfile.websocket
    ports:
      - "8080:8080"
    environment:
      - REDIS_URL=redis://redis:6379
    depends_on:
      - redis

  ast-parser:
    build:
      context: ../../services/ast-parser
      dockerfile: Dockerfile
    ports:
      - "8001:8001"

  retrieval-engine:
    build:
      context: ../../services/retrieval-engine
      dockerfile: Dockerfile
    ports:
      - "8002:8002"
    environment:
      - ELASTICSEARCH_URL=http://elasticsearch:9200
      - REDIS_URL=redis://redis:6379
    depends_on:
      - elasticsearch
      - redis

  generation-service:
    build:
      context: ../../services/generation-service
      dockerfile: Dockerfile
    ports:
      - "8003:8003"
    environment:
      - REDIS_URL=redis://redis:6379

  mock-interview:
    build:
      context: ../../services/mock-interview-engine
      dockerfile: Dockerfile
    ports:
      - "8004:8004"
    environment:
      - REDIS_URL=redis://redis:6379

  web:
    build:
      context: ../../
      dockerfile: infra/docker/Dockerfile.web
    ports:
      - "3000:3000"
    environment:
      - NEXT_PUBLIC_API_URL=http://localhost:8000
      - NEXT_PUBLIC_WS_URL=http://localhost:8080

volumes:
  postgres_data:
EOF

# Create Dockerfiles
cat > infra/docker/Dockerfile.web << 'EOF'
FROM node:20-alpine AS base
WORKDIR /app

FROM base AS deps
COPY apps/web/package.json pnpm-lock.yaml ./
RUN corepack enable pnpm && pnpm install --frozen-lockfile

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY apps/web/ .
RUN corepack enable pnpm && pnpm build

FROM base AS runner
ENV NODE_ENV production
COPY --from=builder /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static

USER node
EXPOSE 3000
ENV PORT 3000

CMD ["node", "server.js"]
EOF

cat > infra/docker/Dockerfile.api << 'EOF'
FROM node:20-alpine AS base
WORKDIR /app

FROM base AS deps
COPY apps/api/package.json pnpm-lock.yaml ./
RUN corepack enable pnpm && pnpm install --frozen-lockfile

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY apps/api/ .
RUN corepack enable pnpm && pnpm build

FROM base AS runner
ENV NODE_ENV production
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

EXPOSE 8000
CMD ["node", "dist/index.js"]
EOF

cat > infra/docker/Dockerfile.ast-parser << 'EOF'
FROM rust:1.75-slim AS builder
WORKDIR /app
COPY . .
RUN cargo build --release

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y libssl-dev && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/target/release/vibecoder-ast-parser /usr/local/bin/
EXPOSE 8001
CMD ["vibecoder-ast-parser"]
EOF

cat > infra/docker/Dockerfile.retrieval << 'EOF'
FROM python:3.11-slim AS builder
WORKDIR /app
COPY pyproject.toml poetry.lock ./
RUN pip install poetry && poetry export -f requirements.txt -o requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

FROM python:3.11-slim
WORKDIR /app
COPY --from=builder /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin
COPY app/ ./app/
EXPOSE 8002
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8002"]
EOF

cat > infra/docker/Dockerfile.generation << 'EOF'
FROM python:3.11-slim AS builder
WORKDIR /app
COPY pyproject.toml poetry.lock ./
RUN pip install poetry && poetry export -f requirements.txt -o requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

FROM python:3.11-slim
WORKDIR /app
COPY --from=builder /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin
COPY app/ ./app/
EXPOSE 8003
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8003"]
EOF

cat > infra/docker/Dockerfile.mock-interview << 'EOF'
FROM python:3.11-slim AS builder
WORKDIR /app
COPY pyproject.toml poetry.lock ./
RUN pip install poetry && poetry export -f requirements.txt -o requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

FROM python:3.11-slim
WORKDIR /app
COPY --from=builder /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin
COPY app/ ./app/
EXPOSE 8004
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8004"]
EOF

cat > infra/docker/Dockerfile.websocket << 'EOF'
FROM node:20-alpine AS base
WORKDIR /app

FROM base AS deps
COPY services/websocket-server/package.json pnpm-lock.yaml ./
RUN corepack enable pnpm && pnpm install --frozen-lockfile

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY services/websocket-server/ .
RUN corepack enable pnpm && pnpm build

FROM base AS runner
ENV NODE_ENV production
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

EXPOSE 8080
CMD ["node", "dist/index.js"]
EOF
```

### Step 12: Terraform Infrastructure

```bash
mkdir -p infra/terraform

cat > infra/terraform/main.tf << 'EOF'
terraform {
  required_version = ">= 1.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {
    bucket         = "vibecoder-terraform-state"
    key            = "prod/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "terraform-locks"
    encrypt        = true
  }
}

provider "aws" {
  region = var.aws_region
}

# VPC
module "vpc" {
  source = "./modules/vpc"
  
  project_name = var.project_name
  environment  = var.environment
  vpc_cidr     = var.vpc_cidr
}

# ECS Cluster
module "ecs" {
  source = "./modules/ecs"
  
  project_name = var.project_name
  environment  = var.environment
  vpc_id       = module.vpc.vpc_id
  subnet_ids   = module.vpc.private_subnet_ids
}

# RDS
module "rds" {
  source = "./modules/rds"
  
  project_name = var.project_name
  environment  = var.environment
  vpc_id       = module.vpc.vpc_id
  subnet_ids   = module.vpc.private_subnet_ids
  instance_class = var.rds_instance_class
}

# ElastiCache
module "elasticache" {
  source = "./modules/elasticache"
  
  project_name = var.project_name
  environment  = var.environment
  vpc_id       = module.vpc.vpc_id
  subnet_ids   = module.vpc.private_subnet_ids
}

# OpenSearch
module "opensearch" {
  source = "./modules/opensearch"
  
  project_name = var.project_name
  environment  = var.environment
  vpc_id       = module.vpc.vpc_id
  subnet_ids   = module.vpc.private_subnet_ids
}

# S3
module "s3" {
  source = "./modules/s3"
  
  project_name = var.project_name
  environment  = var.environment
}
EOF

cat > infra/terraform/variables.tf << 'EOF'
variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Project name"
  type        = string
  default     = "vibecoder"
}

variable "environment" {
  description = "Environment name"
  type        = string
  default     = "production"
}

variable "vpc_cidr" {
  description = "VPC CIDR block"
  type        = string
  default     = "10.0.0.0/16"
}

variable "rds_instance_class" {
  description = "RDS instance class"
  type        = string
  default     = "db.r6g.large"
}
EOF

cat > infra/terraform/outputs.tf << 'EOF'
output "vpc_id" {
  value = module.vpc.vpc_id
}

output "ecs_cluster_name" {
  value = module.ecs.cluster_name
}

output "rds_endpoint" {
  value = module.rds.endpoint
}

output "elasticache_endpoint" {
  value = module.elasticache.endpoint
}

output "opensearch_endpoint" {
  value = module.opensearch.endpoint
}
EOF
```

### Step 13: CI/CD Pipeline

```bash
mkdir -p .github/workflows

cat > .github/workflows/ci.yml << 'EOF'
name: CI

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
        with:
          version: 8
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint

  typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
        with:
          version: 8
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck

  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_DB: vibecoder_test
          POSTGRES_USER: vibecoder
          POSTGRES_PASSWORD: testpassword
        ports:
          - 5432:5432
      redis:
        image: redis:7-alpine
        ports:
          - 6379:6379
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
        with:
          version: 8
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - run: pnpm test
        env:
          DATABASE_URL: postgresql://vibecoder:testpassword@localhost:5432/vibecoder_test
          REDIS_URL: redis://localhost:6379

  build:
    runs-on: ubuntu-latest
    needs: [lint, typecheck, test]
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
        with:
          version: 8
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
EOF

cat > .github/workflows/deploy.yml << 'EOF'
name: Deploy

on:
  workflow_dispatch:
    inputs:
      environment:
        description: 'Environment to deploy to'
        required: true
        default: 'staging'
        type: choice
        options:
          - staging
          - production

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: ${{ inputs.environment }}
    steps:
      - uses: actions/checkout@v4
      
      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: us-east-1

      - name: Login to Amazon ECR
        id: login-ecr
        uses: aws-actions/amazon-ecr-login@v2

      - name: Build and push Docker images
        env:
          ECR_REGISTRY: ${{ steps.login-ecr.outputs.registry }}
          ECR_REPOSITORY: vibecoder
          IMAGE_TAG: ${{ github.sha }}
        run: |
          docker build -t $ECR_REGISTRY/$ECR_REPOSITORY-web:$IMAGE_TAG -f infra/docker/Dockerfile.web .
          docker build -t $ECR_REGISTRY/$ECR_REPOSITORY-api:$IMAGE_TAG -f infra/docker/Dockerfile.api .
          docker push $ECR_REGISTRY/$ECR_REPOSITORY-web:$IMAGE_TAG
          docker push $ECR_REGISTRY/$ECR_REPOSITORY-api:$IMAGE_TAG

      - name: Deploy to ECS
        run: |
          aws ecs update-service \
            --cluster vibecoder-${{ inputs.environment }} \
            --service web \
            --force-new-deployment
          aws ecs update-service \
            --cluster vibecoder-${{ inputs.environment }} \
            --service api \
            --force-new-deployment
EOF
```

### Step 14: Initial Setup Script

```bash
cat > scripts/setup.sh << 'EOF'
#!/bin/bash
set -e

echo "🚀 Setting up Vibe Coder development environment..."

# Check prerequisites
command -v node >/dev/null 2>&1 || { echo "Node.js is required. Install from https://nodejs.org"; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "Docker is required. Install from https://docker.com"; exit 1; }
command -v cargo >/dev/null 2>&1 || { echo "Rust is required. Install from https://rustup.rs"; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "Python 3.11+ is required"; exit 1; }

echo "✅ Prerequisites checked"

# Install root dependencies
echo "📦 Installing root dependencies..."
pnpm install

# Install app dependencies
echo "📦 Installing app dependencies..."
cd apps/web && pnpm install && cd ../..
cd apps/api && pnpm install && cd ../..

# Install service dependencies
echo "📦 Installing service dependencies..."
cd services/websocket-server && pnpm install && cd ../..

cd services/ast-parser && cargo build && cd ../..
cd services/retrieval-engine && poetry install && cd ../..
cd services/generation-service && poetry install && cd ../..
cd services/mock-interview-engine && poetry install && cd ../..

# Start infrastructure
echo "🐳 Starting infrastructure services..."
cd infra/docker && docker compose up -d && cd ../..

# Wait for services to be ready
echo "⏳ Waiting for services to be ready..."
sleep 10

# Run database migrations
echo "🗄️ Running database migrations..."
cd apps/api && pnpm db:migrate && cd ../..

# Create .env file from template
if [ ! -f .env ]; then
  echo "📝 Creating .env file from template..."
  cp .env.example .env
  echo "⚠️  Please edit .env file with your API keys"
fi

echo ""
echo "✅ Setup complete!"
echo ""
echo "To start development:"
echo "  pnpm dev"
echo ""
echo "Services will be available at:"
echo "  Web:        http://localhost:3000"
echo "  API:        http://localhost:8000"
echo "  WebSocket:  http://localhost:8080"
echo "  AST Parser: http://localhost:8001"
echo "  Retrieval:  http://localhost:8002"
echo "  Generation: http://localhost:8003"
echo "  Interview:  http://localhost:8004"
EOF

chmod +x scripts/setup.sh
```

---

## 8. Configuration Reference

### 8.1 Environment Variables Summary

| Variable | Description | Required | Default |
|---|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | Yes | - |
| `REDIS_URL` | Redis connection string | Yes | - |
| `JWT_SECRET` | JWT signing secret (256-bit) | Yes | - |
| `GITHUB_CLIENT_ID` | GitHub OAuth client ID | Yes | - |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth client secret | Yes | - |
| `OPENAI_API_KEY` | OpenAI API key | Yes | - |
| `OPENAI_MODEL` | LLM model name | No | `gpt-4-turbo-preview` |
| `PINECONE_API_KEY` | Pinecone API key | Yes | - |
| `ELASTICSEARCH_URL` | Elasticsearch URL | Yes | `http://localhost:9200` |
| `STRIPE_SECRET_KEY` | Stripe secret key | For payments | - |
| `APP_URL` | Frontend URL | Yes | `http://localhost:3000` |
| `API_URL` | API server URL | Yes | `http://localhost:8000` |
| `WS_URL` | WebSocket server URL | Yes | `http://localhost:8080` |

### 8.2 Port Allocation

| Service | Port | Protocol |
|---|---|---|
| Web (Next.js) | 3000 | HTTP |
| API Server | 8000 | HTTP |
| WebSocket Server | 8080 | WebSocket |
| AST Parser | 8001 | HTTP |
| Retrieval Engine | 8002 | HTTP |
| Generation Service | 8003 | HTTP |
| Mock Interview Engine | 8004 | HTTP |
| PostgreSQL | 5432 | TCP |
| Redis | 6379 | TCP |
| Elasticsearch | 9200 | HTTP |

---

## 9. Troubleshooting

### 9.1 Common Issues

| Issue | Cause | Solution |
|---|---|---|
| `ECONNREFUSED` to PostgreSQL | PostgreSQL not running | `docker compose up -d postgres` |
| `ECONNREFUSED` to Redis | Redis not running | `docker compose up -d redis` |
| `PrismaClientUnknownError` | Database not migrated | `cd apps/api && pnpm db:migrate` |
| `Module not found` errors | Dependencies not installed | Run `pnpm install` in affected package |
| `Permission denied` on scripts | Script not executable | `chmod +x scripts/*.sh` |
| OpenAI rate limit errors | Too many concurrent requests | Reduce `LLM_MAX_CONCURRENT` in env |
| WebSocket connection failed | CORS or auth issue | Check `APP_URL` and `JWT_SECRET` in env |
| AST parser OOM | Large file or memory leak | Increase container memory limit |
| Slow analysis jobs | Large repo or API latency | Check GitHub/OpenAI status, scale workers |

### 9.2 Debug Commands

```bash
# Check service health
curl http://localhost:8000/api/v1/health
curl http://localhost:8001/health
curl http://localhost:8002/health
curl http://localhost:8003/health

# Check database
psql $DATABASE_URL -c "SELECT count(*) FROM users;"
psql $DATABASE_URL -c "SELECT count(*) FROM repositories;"

# Check Redis
redis-cli INFO stats
redis-cli KEYS "ratelimit:*"

# Check Elasticsearch
curl http://localhost:9200/_cluster/health
curl http://localhost:9200/_cat/indices

# View logs
docker compose logs -f api
docker compose logs -f websocket
docker compose logs -f ast-parser
```

---

**Congratulations!** You now have complete instructions for building the Vibe Coder platform from scratch. Follow the phases sequentially, and you'll have a fully functional interview-prep platform in approximately 16 weeks with a small team.
