# Vibe Coder API Specification

## Request Schemas, Response Formats & Contract Definitions

---

## 1. API Conventions

### 1.1 Base Configuration

```
Base URL (Production):  https://api.vibecoder.com/v1
Base URL (Staging):     https://api.staging.vibecoder.com/v1
Base URL (Local):       http://localhost:4000/v1

Content-Type:           application/json
Accept:                 application/json
API Versioning:         URL path prefix (/v1)
Date Format:            ISO 8601 (RFC 3339)
ID Format:              UUID v4 (lowercase, hyphenated)
Pagination:             Cursor-based (preferred) or offset-based
Rate Limit Headers:     X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset
```

### 1.2 Authentication Header

```
Authorization: Bearer <jwt_access_token>

# For institutional API key access:
Authorization: Bearer vc_inst_<api_key>
```

### 1.3 Standard Envelope

All successful responses wrap in a consistent envelope:

```json
{
  "ok": true,
  "data": { ... },
  "meta": {
    "requestId": "req_a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "timestamp": "2025-09-19T14:30:00.000Z"
  }
}
```

### 1.4 Error Envelope

```json
{
  "ok": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "The request body contains invalid fields.",
    "details": [
      {
        "field": "fullName",
        "message": "Must match format 'owner/repo'",
        "received": "invalid-repo-name"
      }
    ]
  },
  "meta": {
    "requestId": "req_a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "timestamp": "2025-09-19T14:30:00.000Z"
  }
}
```

### 1.5 Error Codes Reference

| HTTP Status | Code | Description |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Request body or query params failed validation |
| 400 | `INVALID_GITHUB_URL` | Provided URL is not a valid GitHub repository |
| 401 | `UNAUTHORIZED` | Missing or invalid authentication token |
| 401 | `TOKEN_EXPIRED` | JWT has expired; refresh required |
| 403 | `FORBIDDEN` | Authenticated but not authorized for this resource |
| 403 | `GITHUB_SCOPE_INSUFFICIENT` | GitHub token lacks required scopes |
| 404 | `NOT_FOUND` | Resource does not exist |
| 409 | `REPO_ALREADY_CONNECTED` | Repository is already connected to this account |
| 409 | `ANALYSIS_IN_PROGRESS` | An analysis job is already running for this repo |
| 413 | `REPO_TOO_LARGE` | Repository exceeds size limit (50MB uncompressed) |
| 422 | `UNSUPPORTED_LANGUAGE` | Repository contains no supported language files |
| 429 | `RATE_LIMITED` | Too many requests; check Retry-After header |
| 500 | `INTERNAL_ERROR` | Unexpected server error |
| 502 | `GITHUB_UNAVAILABLE` | GitHub API is unreachable or rate-limited |
| 503 | `SERVICE_UNAVAILABLE` | Temporary maintenance or overload |

### 1.6 Rate Limits

| Plan | Requests/min | Analysis Jobs/day | Chat Messages/hour |
|---|---|---|---|
| Free | 30 | 1 | 20 |
| Starter | 120 | 5 | 100 |
| Pro | 300 | 20 | 500 |
| Institutional | 1000 | 100 | 2000 |

---

## 2. Authentication API

### 2.1 POST `/auth/github`

Initiates GitHub OAuth flow.

**Response (302 Redirect):**
```
Location: https://github.com/login/oauth/authorize
  ?client_id=<GITHUB_CLIENT_ID>
  &redirect_uri=https://api.vibecoder.com/v1/auth/github/callback
  &scope=repo,user:email
  &state=<csrf_token>
```

### 2.2 POST `/auth/github/callback`

Exchanges OAuth code for platform credentials.

**Request:**
```json
{
  "code": "gho_a1b2c3d4e5f6",
  "state": "csrf_token_from_cookie"
}
```

**Response (200):**
```json
{
  "ok": true,
  "data": {
    "user": {
      "id": "usr_8f14e45f-ceea-467f-a5f1-d5b1c2b1c2b1",
      "githubId": 12345678,
      "email": "candidate@example.com",
      "username": "candidate-dev",
      "displayName": "Jane Doe",
      "avatarUrl": "https://avatars.githubusercontent.com/u/12345678",
      "planTier": "free",
      "createdAt": "2025-09-19T10:00:00.000Z"
    },
    "tokens": {
      "accessToken": "eyJhbGciOiJSUzI1NiIs...",
      "refreshToken": "rt_a1b2c3d4e5f6...",
      "expiresIn": 900,
      "tokenType": "Bearer"
    },
    "subscription": {
      "planTier": "free",
      "reposLimit": 3,
      "reposRemaining": 3,
      "chatsLimit": 20,
      "chatsRemaining": 20,
      "mockInterviewsLimit": 2,
      "mockInterviewsRemaining": 2,
      "expiresAt": "2025-10-19T10:00:00.000Z"
    },
    "isNewUser": true
  }
}
```

**Error Response (401):**
```json
{
  "ok": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "GitHub OAuth code exchange failed. The code may have expired or already been used."
  }
}
```

### 2.3 POST `/auth/refresh`

Refresh an expired access token.

**Request:**
```json
{
  "refreshToken": "rt_a1b2c3d4e5f6..."
}
```

**Response (200):**
```json
{
  "ok": true,
  "data": {
    "accessToken": "eyJhbGciOiJSUzI1NiIs...",
    "expiresIn": 900,
    "tokenType": "Bearer"
  }
}
```

**Error Response (401):**
```json
{
  "ok": false,
  "error": {
    "code": "TOKEN_EXPIRED",
    "message": "Refresh token is invalid or has been revoked. Please re-authenticate."
  }
}
```

---

## 3. User API

### 3.1 GET `/users/me`

Returns the authenticated user's profile.

**Response (200):**
```json
{
  "ok": true,
  "data": {
    "id": "usr_8f14e45f-ceea-467f-a5f1-d5b1c2b1c2b1",
    "githubId": 12345678,
    "email": "candidate@example.com",
    "username": "candidate-dev",
    "displayName": "Jane Doe",
    "avatarUrl": "https://avatars.githubusercontent.com/u/12345678",
    "bio": "Full-stack developer, bootcamp grad, preparing for interviews",
    "planTier": "pro",
    "createdAt": "2025-09-19T10:00:00.000Z",
    "updatedAt": "2025-09-19T14:30:00.000Z",
    "stats": {
      "repositoriesConnected": 4,
      "totalAnalysesRun": 12,
      "chatSessionsTotal": 37,
      "mockInterviewsCompleted": 8,
      "averageMockScore": 72.5
    }
  }
}
```

### 3.2 PATCH `/users/me`

Update user profile fields.

**Request:**
```json
{
  "displayName": "Jane Doe",
  "bio": "Full-stack developer preparing for backend roles"
}
```

**Response (200):** Same shape as GET `/users/me`.

### 3.3 GET `/users/me/subscription`

Returns detailed subscription and usage data.

**Response (200):**
```json
{
  "ok": true,
  "data": {
    "id": "sub_c1d2e3f4-a5b6-7890-abcd-ef1234567890",
    "planTier": "pro",
    "billingCycle": "monthly",
    "reposLimit": 20,
    "reposRemaining": 16,
    "chatsLimit": 500,
    "chatsRemaining": 387,
    "mockInterviewsLimit": 30,
    "mockInterviewsRemaining": 22,
    "tokensLimit": 5000000,
    "tokensRemaining": 3240000,
    "expiresAt": "2025-10-19T10:00:00.000Z",
    "createdAt": "2025-09-19T10:00:00.000Z",
    "usageThisPeriod": {
      "reposConnected": 4,
      "analysesRun": 12,
      "chatMessages": 113,
      "mockInterviewSessions": 8,
      "totalTokensUsed": 1760000
    }
  }
}
```

---

## 4. Repository API

### 4.1 POST `/repos/connect`

Connect a GitHub repository to the user's account.

**Request:**
```json
{
  "fullName": "candidate-dev/my-portfolio-api",
  "visibility": "private"
}
```

**Validation Rules:**
| Field | Type | Required | Rules |
|---|---|---|---|
| `fullName` | string | Yes | Pattern: `^[a-zA-Z0-9._-]+/[a-zA-Z0-9._-]+$`, max 255 chars |
| `visibility` | string | No | Enum: `public`, `private`. Default: `private` |

**Response (201):**
```json
{
  "ok": true,
  "data": {
    "id": "repo_d3e4f5a6-b7c8-9012-abcd-ef1234567890",
    "githubRepoId": 987654321,
    "fullName": "candidate-dev/my-portfolio-api",
    "defaultBranch": "main",
    "languagePrimary": "TypeScript",
    "languages": {
      "TypeScript": 12500,
      "JavaScript": 8300,
      "SQL": 1200
    },
    "totalFiles": 342,
    "totalLines": 28400,
    "visibility": "private",
    "lastAnalyzedAt": null,
    "analysisCount": 0,
    "createdAt": "2025-09-19T14:30:00.000Z"
  }
}
```

**Error Responses:**

```json
// Repo already connected
{
  "ok": false,
  "error": {
    "code": "REPO_ALREADY_CONNECTED",
    "message": "Repository 'candidate-dev/my-portfolio-api' is already connected.",
    "details": {
      "existingRepoId": "repo_a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "connectedAt": "2025-09-18T10:00:00.000Z"
    }
  }
}
```

```json
// Repo too large
{
  "ok": false,
  "error": {
    "code": "REPO_TOO_LARGE",
    "message": "Repository size (127MB) exceeds the maximum allowed size (50MB).",
    "details": {
      "repositorySizeMB": 127,
      "maxSizeMB": 50
    }
  }
}
```

```json
// Insufficient GitHub scopes
{
  "ok": false,
  "error": {
    "code": "GITHUB_SCOPE_INSUFFICIENT",
    "message": "Your GitHub token does not have access to this repository.",
    "details": {
      "requiredScopes": ["repo"],
      "currentScopes": ["public_repo", "user:email"]
    }
  }
}
```

### 4.2 GET `/repos`

List all connected repositories for the authenticated user.

**Query Parameters:**
| Param | Type | Default | Description |
|---|---|---|---|
| `limit` | integer | 20 | Results per page (1–100) |
| `cursor` | string | null | Cursor for pagination |
| `sort` | string | `created_at` | Sort field: `created_at`, `last_analyzed_at`, `full_name` |
| `order` | string | `desc` | Sort order: `asc`, `desc` |

**Response (200):**
```json
{
  "ok": true,
  "data": [
    {
      "id": "repo_d3e4f5a6-b7c8-9012-abcd-ef1234567890",
      "fullName": "candidate-dev/my-portfolio-api",
      "languagePrimary": "TypeScript",
      "totalFiles": 342,
      "totalLines": 28400,
      "lastAnalyzedAt": "2025-09-19T12:00:00.000Z",
      "analysisCount": 3,
      "createdAt": "2025-09-18T10:00:00.000Z",
      "latestJob": {
        "id": "job_f6a7b8c9-d0e1-2345-abcd-ef1234567890",
        "status": "completed",
        "completedAt": "2025-09-19T12:00:00.000Z"
      }
    },
    {
      "id": "repo_e4f5a6b7-c8d9-0123-abcd-ef1234567890",
      "fullName": "candidate-dev/react-dashboard",
      "languagePrimary": "TypeScript",
      "totalFiles": 89,
      "totalLines": 11200,
      "lastAnalyzedAt": "2025-09-18T16:00:00.000Z",
      "analysisCount": 1,
      "createdAt": "2025-09-17T08:00:00.000Z",
      "latestJob": {
        "id": "job_a7b8c9d0-e1f2-3456-abcd-ef1234567890",
        "status": "completed",
        "completedAt": "2025-09-18T16:00:00.000Z"
      }
    }
  ],
  "pagination": {
    "hasMore": false,
    "nextCursor": null,
    "total": 2
  }
}
```

### 4.3 GET `/repos/:repoId`

Returns detailed information about a connected repository.

**Path Parameters:**
| Param | Type | Description |
|---|---|---|
| `repoId` | UUID | Repository ID |

**Response (200):**
```json
{
  "ok": true,
  "data": {
    "id": "repo_d3e4f5a6-b7c8-9012-abcd-ef1234567890",
    "githubRepoId": 987654321,
    "fullName": "candidate-dev/my-portfolio-api",
    "defaultBranch": "main",
    "languagePrimary": "TypeScript",
    "languages": {
      "TypeScript": 12500,
      "JavaScript": 8300,
      "SQL": 1200
    },
    "totalFiles": 342,
    "totalLines": 28400,
    "visibility": "private",
    "lastAnalyzedAt": "2025-09-19T12:00:00.000Z",
    "analysisCount": 3,
    "createdAt": "2025-09-18T10:00:00.000Z",
    "latestJob": {
      "id": "job_f6a7b8c9-d0e1-2345-abcd-ef1234567890",
      "status": "completed",
      "startedAt": "2025-09-19T11:58:00.000Z",
      "completedAt": "2025-09-19T12:00:00.000Z",
      "stats": {
        "filesParsed": 318,
        "symbolsExtracted": 1847,
        "chunksCreated": 4521,
        "embeddingsGenerated": 4521,
        "tokensUsed": 850000,
        "analysisDurationMs": 127000
      }
    },
    "artifacts": [
      { "type": "architecture_overview", "title": "System Architecture" },
      { "type": "module_explanation", "title": "14 Modules Explained" },
      { "type": "question_bank", "title": "45 Interview Questions" },
      { "type": "interview_guide", "title": "Complete Study Guide" }
    ],
    "moduleCount": 14,
    "symbolCount": 1847
  }
}
```

### 4.4 DELETE `/repos/:repoId`

Disconnect a repository. Does not delete analysis data.

**Response (200):**
```json
{
  "ok": true,
  "data": {
    "message": "Repository 'candidate-dev/my-portfolio-api' disconnected."
  }
}
```

### 4.5 POST `/repos/:repoId/analyze`

Trigger a new analysis of the repository. Fails if an analysis is already in progress.

**Request:**
```json
{
  "config": {
    "includeTests": false,
    "includeConfig": true,
    "maxFileSizeKB": 500,
    "excludedPaths": ["node_modules", "dist", "build", ".next"],
    "targetBranch": "main"
  }
}
```

**Validation Rules:**
| Field | Type | Required | Rules |
|---|---|---|---|
| `includeTests` | boolean | No | Default: `false` |
| `includeConfig` | boolean | No | Default: `true` |
| `maxFileSizeKB` | integer | No | Min: 10, Max: 1000, Default: 500 |
| `excludedPaths` | string[] | No | Max 50 entries, each max 255 chars |
| `targetBranch` | string | No | Default: repo's default branch |

**Response (202):**
```json
{
  "ok": true,
  "data": {
    "jobId": "job_a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "status": "queued",
    "estimatedDurationMs": 120000,
    "pollUrl": "/repos/d3e4f5a6-b7c8-9012-abcd-ef1234567890/status"
  }
}
```

**Error Responses:**

```json
// Analysis already running
{
  "ok": false,
  "error": {
    "code": "ANALYSIS_IN_PROGRESS",
    "message": "An analysis job is already running for this repository.",
    "details": {
      "existingJobId": "job_x1y2z3w4-a5b6-7890-abcd-ef1234567890",
      "status": "parsing",
      "progress": 45,
      "startedAt": "2025-09-19T14:25:00.000Z"
    }
  }
}
```

```json
// Insufficient plan
{
  "ok": false,
  "error": {
    "code": "QUOTA_EXCEEDED",
    "message": "You have reached your daily analysis limit for the free plan.",
    "details": {
      "currentPlan": "free",
      "limit": 1,
      "used": 1,
      "resetsAt": "2025-09-20T00:00:00.000Z",
      "upgradeUrl": "/billing/checkout"
    }
  }
}
```

### 4.6 GET `/repos/:repoId/status`

Poll the status of an analysis job.

**Response (200):**
```json
{
  "ok": true,
  "data": {
    "jobId": "job_a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "status": "indexing",
    "progress": {
      "percent": 65,
      "stage": "Generating embeddings for 4,521 code chunks",
      "stageIndex": 3,
      "totalStages": 5,
      "elapsedMs": 82000,
      "estimatedRemainingMs": 45000
    },
    "startedAt": "2025-09-19T14:25:00.000Z",
    "completedAt": null,
    "error": null,
    "stats": {
      "filesParsed": 318,
      "symbolsExtracted": 1847,
      "chunksCreated": 4521,
      "embeddingsGenerated": 2940
    }
  }
}
```

**Status values and their meaning:**

```
queued       → Job is waiting for a worker
cloning      → Fetching repository from GitHub
parsing      → Running AST parser on source files
indexing     → Building sparse index + generating embeddings
generating   → LLM generating artifacts (architecture, questions, etc.)
completed    → Analysis finished successfully
failed       → Analysis failed (see error field)
```

---

## 5. Analysis Artifacts API

### 5.1 GET `/repos/:repoId/artifacts`

List all generated artifacts for the latest analysis.

**Query Parameters:**
| Param | Type | Default | Description |
|---|---|---|---|
| `type` | string | null | Filter by artifact type |
| `jobId` | UUID | null | Specific analysis job (default: latest completed) |

**Response (200):**
```json
{
  "ok": true,
  "data": [
    {
      "id": "art_e1f2a3b4-c5d6-7890-abcd-ef1234567890",
      "jobId": "job_f6a7b8c9-d0e1-2345-abcd-ef1234567890",
      "artifactType": "architecture_overview",
      "title": "System Architecture Overview",
      "version": 1,
      "tokenCount": 12400,
      "modelUsed": "gpt-4o",
      "generatedAt": "2025-09-19T12:00:00.000Z"
    },
    {
      "id": "art_f2a3b4c5-d6e7-8901-abcd-ef1234567890",
      "jobId": "job_f6a7b8c9-d0e1-2345-abcd-ef1234567890",
      "artifactType": "question_bank",
      "title": "45 Interview Questions with Model Answers",
      "version": 1,
      "tokenCount": 34200,
      "modelUsed": "gpt-4o",
      "generatedAt": "2025-09-19T12:00:00.000Z"
    },
    {
      "id": "art_a3b4c5d6-e7f8-9012-abcd-ef1234567890",
      "jobId": "job_f6a7b8c9-d0e1-2345-abcd-ef1234567890",
      "artifactType": "module_explanation",
      "title": "Module-by-Module Breakdown (14 modules)",
      "version": 1,
      "tokenCount": 28700,
      "modelUsed": "gpt-4o",
      "generatedAt": "2025-09-19T12:00:00.000Z"
    },
    {
      "id": "art_b4c5d6e7-f8a9-0123-abcd-ef1234567890",
      "jobId": "job_f6a7b8c9-d0e1-2345-abcd-ef1234567890",
      "artifactType": "interview_guide",
      "title": "Complete Interview Study Guide",
      "version": 1,
      "tokenCount": 8900,
      "modelUsed": "gpt-4o",
      "generatedAt": "2025-09-19T12:00:00.000Z"
    }
  ]
}
```

### 5.2 GET `/repos/:repoId/artifacts/:artifactType`

Returns the full content of a specific artifact type.

**Path Parameters:**
| Param | Type | Values |
|---|---|---|
| `artifactType` | string | `architecture_overview`, `module_explanation`, `question_bank`, `dependency_graph`, `tech_stack_report`, `interview_guide`, `mock_interview_rubric`, `study_plan` |

**Response (200) — Architecture Overview:**
```json
{
  "ok": true,
  "data": {
    "id": "art_e1f2a3b4-c5d6-7890-abcd-ef1234567890",
    "artifactType": "architecture_overview",
    "title": "System Architecture Overview",
    "version": 1,
    "content": {
      "summary": "A RESTful API built with Express.js and TypeScript, following a layered architecture pattern. The application serves a portfolio management system with authentication, CRUD operations for projects, and a real-time notification system via WebSockets.",
      "architecturePattern": "Layered (Controller → Service → Repository → Database)",
      "entryPoints": [
        {
          "file": "src/index.ts",
          "description": "Application entry point. Initializes Express, middleware, routes, and database connection.",
          "line": 1
        },
        {
          "file": "src/config/routes.ts",
          "description": "Central route registration. Maps all API endpoints to their controllers.",
          "line": 15
        }
      ],
      "techStack": {
        "runtime": "Node.js 20.x",
        "language": "TypeScript 5.3",
        "framework": "Express 4.18",
        "database": "PostgreSQL 16 (via Prisma ORM)",
        "authentication": "JWT (access + refresh tokens)",
        "realTime": "Socket.IO 4.x",
        "testing": "Jest 29, Supertest",
        "deployment": "Docker + AWS ECS Fargate"
      },
      "components": [
        {
          "name": "Authentication Module",
          "description": "Handles user registration, login, JWT token generation, and refresh token rotation.",
          "type": "middleware",
          "files": ["src/modules/auth/"],
          "keyAbstractions": ["AuthService", "JwtGuard", "RefreshTokenGuard"],
          "interviewTip": "Be prepared to discuss why you chose JWT over sessions, token rotation strategy, and refresh token storage."
        },
        {
          "name": "Project Module",
          "description": "CRUD operations for portfolio projects. Includes image upload, tagging, and visibility controls.",
          "type": "service",
          "files": ["src/modules/projects/"],
          "keyAbstractions": ["ProjectService", "ProjectController", "ProjectRepository"],
          "interviewTip": "Discuss the repository pattern choice, how you handle file uploads (S3 presigned URLs), and pagination strategy."
        },
        {
          "name": "Notification Module",
          "description": "Real-time notification delivery via WebSocket connections. Supports in-app and email channels.",
          "type": "service",
          "files": ["src/modules/notifications/"],
          "keyAbstractions": ["NotificationService", "WebSocketGateway", "EmailAdapter"],
          "interviewTip": "Explain how you handle WebSocket authentication, connection management, and fallback to polling."
        }
      ],
      "dataFlow": "HTTP Request → Express Router → Auth Middleware → Controller → Service → Repository → Prisma → PostgreSQL",
      "deploymentArchitecture": "Containerized (Docker) deployed on AWS ECS Fargate behind ALB. PostgreSQL on RDS Multi-AZ. Redis on ElastiCache for session storage and WebSocket adapter."
    },
    "generatedAt": "2025-09-19T12:00:00.000Z"
  }
}
```

**Response (200) — Question Bank:**
```json
{
  "ok": true,
  "data": {
    "id": "art_f2a3b4c5-d6e7-8901-abcd-ef1234567890",
    "artifactType": "question_bank",
    "title": "45 Interview Questions with Model Answers",
    "version": 1,
    "content": {
      "totalQuestions": 45,
      "categories": {
        "architecture": 8,
        "data_modeling": 6,
        "api_design": 7,
        "security": 5,
        "performance": 6,
        "testing": 5,
        "devops": 4,
        "debugging": 4
      },
      "difficultyBreakdown": {
        "junior": 15,
        "mid": 20,
        "senior": 10
      },
      "questions": [
        {
          "id": "q_a1b2c3d4-e5f6-7890-abcd-ef1234567890",
          "category": "architecture",
          "difficulty": "mid",
          "questionType": "exploratory",
          "questionText": "Can you walk me through the overall architecture of this project? What patterns did you use and why?",
          "modelAnswer": "This project follows a layered architecture pattern with clear separation of concerns. At the top, Express route handlers receive HTTP requests and delegate to service classes. Services contain business logic and orchestrate calls to repositories, which abstract database access via Prisma. I chose this pattern because it makes the codebase testable — each layer can be mocked independently — and it maps naturally to how most backend developers think about request processing. For example, the ProjectService in src/modules/projects/service.ts handles all business rules like slug generation and visibility checks, while ProjectRepository handles only data queries. The auth middleware sits between routes and controllers, ensuring protected endpoints are guarded without cluttering business logic.",
          "citations": [
            {
              "filePath": "src/modules/projects/service.ts",
              "startLine": 1,
              "endLine": 45,
              "symbolName": "ProjectService",
              "relevance": "Core business logic layer demonstrating the service pattern"
            },
            {
              "filePath": "src/modules/projects/repository.ts",
              "startLine": 1,
              "endLine": 32,
              "symbolName": "ProjectRepository",
              "relevance": "Data access abstraction demonstrating the repository pattern"
            },
            {
              "filePath": "src/middleware/auth.ts",
              "startLine": 12,
              "endLine": 38,
              "symbolName": "JwtGuard",
              "relevance": "Authentication middleware showing the guard pattern"
            }
          ],
          "followUps": [
            "What would change if you had to add a second database (e.g., Redis for caching)?",
            "How would you refactor this to support microservices?",
            "What trade-offs does this layered approach have compared to a vertical slice architecture?"
          ],
          "tips": "Interviewers are evaluating: (1) your ability to articulate architectural decisions, (2) awareness of trade-offs, (3) whether you actually understand the code or are just reciting. Mention specific files and explain the 'why', not just the 'what'.",
          "sourceModules": ["Authentication Module", "Project Module"]
        },
        {
          "id": "q_b2c3d4e5-f6a7-8901-abcd-ef1234567890",
          "category": "security",
          "difficulty": "senior",
          "questionType": "adversarial",
          "questionText": "I see you're using JWT for authentication. How do you handle token revocation if a user's account is compromised?",
          "modelAnswer": "Great question. JWTs are stateless by design, which means they can't be revoked server-side without additional infrastructure. In this project, I addressed this through three mechanisms. First, access tokens have a short 15-minute expiry, limiting the window of exposure. Second, I maintain a server-side refresh token store in Redis (src/modules/auth/refresh-token.service.ts, lines 8-24) — when a refresh token is used, the previous one is invalidated (rotation). This means if a token is compromised, using it will invalidate all subsequent refresh attempts, effectively logging out the attacker. Third, for emergency revocation, I have an endpoint that blacklists a user's token family in Redis, which the auth middleware checks on every request (src/middleware/auth.ts, lines 52-67). The trade-off is that this introduces a Redis dependency for auth — if Redis goes down, the system falls back to accepting unrevoked tokens, which I've documented as an acceptable risk with a Redis health check alert.",
          "citations": [
            {
              "filePath": "src/modules/auth/refresh-token.service.ts",
              "startLine": 8,
              "endLine": 24,
              "symbolName": "RefreshTokenService.rotate",
              "relevance": "Token rotation implementation"
            },
            {
              "filePath": "src/middleware/auth.ts",
              "startLine": 52,
              "endLine": 67,
              "symbolName": "JwtGuard.checkRevocation",
              "relevance": "Token blacklist check in auth middleware"
            }
          ],
          "followUps": [
            "What happens if Redis is unavailable? Is there a fallback?",
            "How would you implement this in a distributed system with multiple API servers?",
            "Have you considered using opaque tokens with server-side sessions instead?"
          ],
          "tips": "This is a common senior-level question. The interviewer wants to see that you understand the limitations of JWT and have thought about security beyond 'it works'. Acknowledge trade-offs honestly.",
          "sourceModules": ["Authentication Module"]
        }
      ]
    },
    "generatedAt": "2025-09-19T12:00:00.000Z"
  }
}
```

### 5.3 GET `/repos/:repoId/modules`

List all identified modules with summaries.

**Response (200):**
```json
{
  "ok": true,
  "data": [
    {
      "id": "mod_c3d4e5f6-a7b8-9012-abcd-ef1234567890",
      "name": "Authentication Module",
      "path": "src/modules/auth",
      "moduleType": "middleware",
      "purposeSummary": "Handles user registration, login, JWT token management, and route protection via middleware guards.",
      "keyAbstractions": ["AuthService", "JwtGuard", "RefreshTokenGuard", "PasswordUtil"],
      "complexityScore": 0.65,
      "fileCount": 8,
      "lineCount": 420,
      "couplingScore": 0.3,
      "interviewPoints": [
        "JWT vs session-based auth trade-offs",
        "Refresh token rotation strategy",
        "Password hashing with bcrypt (cost factor 12)",
        "Rate limiting on login endpoint (5 attempts/15min)"
      ]
    },
    {
      "id": "mod_d4e5f6a7-b8c9-0123-abcd-ef1234567890",
      "name": "Project Module",
      "path": "src/modules/projects",
      "moduleType": "service",
      "purposeSummary": "Full CRUD for portfolio projects with image upload, slug generation, tag management, and visibility controls.",
      "keyAbstractions": ["ProjectService", "ProjectController", "ProjectRepository", "ProjectValidator"],
      "complexityScore": 0.72,
      "fileCount": 12,
      "lineCount": 680,
      "couplingScore": 0.4,
      "interviewPoints": [
        "Repository pattern for data access abstraction",
        "S3 presigned URLs for image uploads",
        "Cursor-based pagination implementation",
        "Soft delete with restore capability"
      ]
    },
    {
      "id": "mod_e5f6a7b8-c9d0-1234-abcd-ef1234567890",
      "name": "Notification Module",
      "path": "src/modules/notifications",
      "moduleType": "service",
      "purposeSummary": "Real-time notification delivery via WebSocket with fallback to email. Manages connection state and message queuing.",
      "keyAbstractions": ["NotificationService", "WebSocketGateway", "EmailAdapter", "NotificationQueue"],
      "complexityScore": 0.58,
      "fileCount": 6,
      "lineCount": 310,
      "couplingScore": 0.2,
      "interviewPoints": [
        "Socket.IO authentication via JWT handshake",
        "Redis adapter for multi-server WebSocket support",
        "Message queue for email fallback",
        "Connection state management"
      ]
    }
  ],
  "pagination": {
    "hasMore": false,
    "total": 14
  }
}
```

### 5.4 GET `/repos/:repoId/modules/:moduleId`

Returns detailed information about a specific module.

**Response (200):**
```json
{
  "ok": true,
  "data": {
    "id": "mod_c3d4e5f6-a7b8-9012-abcd-ef1234567890",
    "name": "Authentication Module",
    "path": "src/modules/auth",
    "moduleType": "middleware",
    "purposeSummary": "Handles user registration, login, JWT token management, and route protection via middleware guards.",
    "keyAbstractions": ["AuthService", "JwtGuard", "RefreshTokenGuard", "PasswordUtil"],
    "internalLogic": "The authentication flow begins with the AuthController receiving login/register requests. Registration hashes the password using bcrypt (cost factor 12) via PasswordUtil before storing in the database. Login validates credentials against the stored hash, then generates a short-lived access token (15min) and a long-lived refresh token (7 days). The refresh token is stored in Redis with the user's ID and token family hash. On refresh, the old token is invalidated and a new pair is issued (rotation). JwtGuard middleware extracts the Bearer token from the Authorization header, validates its signature and expiry, and attaches the decoded user payload to the request context. RefreshTokenGuard is similar but specifically handles the refresh endpoint, checking the token against Redis and ensuring it hasn't been replayed.",
    "failureModes": [
      {
        "description": "Redis unavailability causes refresh token validation to fail, locking out users.",
        "severity": "high",
        "affectedSymbols": ["RefreshTokenService.validate", "RefreshTokenService.rotate"],
        "mitigationPresent": true
      },
      {
        "description": "Clock skew between servers could cause premature token expiry.",
        "severity": "low",
        "affectedSymbols": ["JwtGuard.validate"],
        "mitigationPresent": true
      }
    ],
    "interviewPoints": [
      "JWT vs session-based auth trade-offs",
      "Refresh token rotation prevents token reuse attacks",
      "Bcrypt cost factor 12 balances security and performance",
      "Rate limiting prevents brute-force login attempts"
    ],
    "complexityScore": 0.65,
    "fileCount": 8,
    "lineCount": 420,
    "couplingScore": 0.3,
    "symbols": [
      {
        "id": "sym_f6a7b8c9-d0e1-2345-abcd-ef1234567890",
        "name": "AuthService",
        "symbolType": "class",
        "signature": "class AuthService",
        "filePath": "src/modules/auth/auth.service.ts",
        "startLine": 1,
        "endLine": 120,
        "complexity": 0.7,
        "docstring": "Core authentication service handling registration, login, token generation, and refresh.",
        "parameters": [],
        "returnType": null,
        "visibility": "public",
        "isExported": true
      },
      {
        "id": "sym_a7b8c9d0-e1f2-3456-abcd-ef1234567890",
        "name": "JwtGuard",
        "symbolType": "middleware",
        "signature": "function JwtGuard(req: Request, res: Response, next: NextFunction): void",
        "filePath": "src/modules/auth/jwt-guard.ts",
        "startLine": 12,
        "endLine": 38,
        "complexity": 0.4,
        "docstring": "Express middleware that validates JWT access tokens and attaches user context.",
        "parameters": [
          { "name": "req", "type": "Request", "defaultValue": null, "isOptional": false },
          { "name": "res", "type": "Response", "defaultValue": null, "isOptional": false },
          { "name": "next", "type": "NextFunction", "defaultValue": null, "isOptional": false }
        ],
        "returnType": "void",
        "visibility": "public",
        "isExported": true
      },
      {
        "id": "sym_b8c9d0e1-f2a3-4567-abcd-ef1234567890",
        "name": "RefreshTokenService.rotate",
        "symbolType": "function",
        "signature": "async function rotate(userId: string, currentRefreshToken: string): Promise<{ accessToken: string; refreshToken: string }>",
        "filePath": "src/modules/auth/refresh-token.service.ts",
        "startLine": 8,
        "endLine": 24,
        "complexity": 0.55,
        "docstring": "Invalidates the current refresh token and issues a new token pair.",
        "parameters": [
          { "name": "userId", "type": "string", "defaultValue": null, "isOptional": false },
          { "name": "currentRefreshToken", "type": "string", "defaultValue": null, "isOptional": false }
        ],
        "returnType": "Promise<{ accessToken: string; refreshToken: string }>",
        "visibility": "public",
        "isExported": false
      }
    ],
    "created_at": "2025-09-19T12:00:00.000Z"
  }
}
```

### 5.5 GET `/repos/:repoId/dependency-graph`

Returns the full module dependency graph.

**Response (200):**
```json
{
  "ok": true,
  "data": {
    "nodes": [
      { "moduleId": "mod_c3d4e5f6-...", "name": "Auth Module", "type": "middleware", "weight": 420 },
      { "moduleId": "mod_d4e5f6a7-...", "name": "Project Module", "type": "service", "weight": 680 },
      { "moduleId": "mod_e5f6a7b8-...", "name": "Notification Module", "type": "service", "weight": 310 },
      { "moduleId": "mod_f6a7b8c9-...", "name": "User Module", "type": "service", "weight": 250 },
      { "moduleId": "mod_a7b8c9d0-...", "name": "Database Config", "type": "config", "weight": 80 },
      { "moduleId": "mod_b8c9d0e1-...", "name": "Middleware", "type": "middleware", "weight": 190 }
    ],
    "edges": [
      { "source": "mod_d4e5f6a7-...", "target": "mod_c3d4e5f6-...", "type": "imports", "weight": 2.5 },
      { "source": "mod_d4e5f6a7-...", "target": "mod_e5f6a7b8-...", "type": "calls", "weight": 1.8 },
      { "source": "mod_d4e5f6a7-...", "target": "mod_f6a7b8c9-...", "type": "imports", "weight": 1.2 },
      { "source": "mod_e5f6a7b8-...", "target": "mod_a7b8c9d0-...", "type": "imports", "weight": 1.0 },
      { "source": "mod_c3d4e5f6-...", "target": "mod_a7b8c9d0-...", "type": "imports", "weight": 1.5 },
      { "source": "mod_b8c9d0e1-...", "target": "mod_c3d4e5f6-...", "type": "calls", "weight": 3.0 }
    ],
    "metadata": {
      "totalNodes": 14,
      "totalEdges": 22,
      "mostCoupled": "Project Module (coupling score: 0.4)",
      "leastCoupled": "Notification Module (coupling score: 0.2)"
    }
  }
}
```

### 5.6 GET `/repos/:repoId/questions`

Returns the interview question bank with filtering.

**Query Parameters:**
| Param | Type | Default | Description |
|---|---|---|---|
| `category` | string | null | Filter by category |
| `difficulty` | string | null | Filter by difficulty level |
| `type` | string | null | Filter by question type |
| `limit` | integer | 50 | Max results (1–100) |
| `cursor` | string | null | Cursor for pagination |

**Response (200):**
```json
{
  "ok": true,
  "data": [
    {
      "id": "q_a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "category": "architecture",
      "difficulty": "mid",
      "questionType": "exploratory",
      "questionText": "Can you walk me through the overall architecture of this project?",
      "modelAnswer": "This project follows a layered architecture pattern...",
      "citations": [
        {
          "filePath": "src/modules/projects/service.ts",
          "startLine": 1,
          "endLine": 45,
          "symbolName": "ProjectService",
          "relevance": "Core business logic layer demonstrating the service pattern"
        }
      ],
      "followUps": [
        "What would change if you had to add a second database?",
        "How would you refactor this to support microservices?"
      ],
      "tips": "Interviewers are evaluating architectural articulation...",
      "sourceModules": ["Authentication Module", "Project Module"]
    }
  ],
  "pagination": {
    "hasMore": true,
    "nextCursor": "eyJpZCI6InFfYTFiMmMzZDQifQ==",
    "total": 45
  }
}
```

---

## 6. Chat API

### 6.1 POST `/repos/:repoId/chat/sessions`

Create a new chat session for a repository.

**Request:**
```json
{
  "mode": "general",
  "title": "Understanding the auth flow"
}
```

**Validation Rules:**
| Field | Type | Required | Rules |
|---|---|---|---|
| `mode` | string | No | Enum: `general`, `mock_interview`, `study_guide`, `deep_dive`, `architecture_review`. Default: `general` |
| `title` | string | No | Max 255 chars |

**Response (201):**
```json
{
  "ok": true,
  "data": {
    "id": "chat_f1a2b3c4-d5e6-7890-abcd-ef1234567890",
    "repoId": "repo_d3e4f5a6-b7c8-9012-abcd-ef1234567890",
    "mode": "general",
    "title": "Understanding the auth flow",
    "messageCount": 0,
    "totalTokens": 0,
    "createdAt": "2025-09-19T14:30:00.000Z"
  }
}
```

### 6.2 GET `/chat/sessions/:sessionId/messages`

Returns message history for a chat session.

**Query Parameters:**
| Param | Type | Default | Description |
|---|---|---|---|
| `limit` | integer | 50 | Messages to return (1–100) |
| `cursor` | string | null | Cursor for pagination |

**Response (200):**
```json
{
  "ok": true,
  "data": [
    {
      "id": "msg_a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "sessionId": "chat_f1a2b3c4-d5e6-7890-abcd-ef1234567890",
      "role": "user",
      "content": "How does the authentication flow work in this project?",
      "citations": [],
      "metadata": {},
      "tokensUsed": 0,
      "modelUsed": null,
      "latencyMs": null,
      "createdAt": "2025-09-19T14:30:05.000Z"
    },
    {
      "id": "msg_b2c3d4e5-f6a7-8901-abcd-ef1234567890",
      "sessionId": "chat_f1a2b3c4-d5e6-7890-abcd-ef1234567890",
      "role": "assistant",
      "content": "The authentication flow in this project uses JWT with refresh token rotation. Here's how it works step by step:\n\n**Registration** (`src/modules/auth/auth.service.ts:15-32`):\n1. User submits email + password\n2. Password is hashed with bcrypt (cost factor 12) via `PasswordUtil.hash()`\n3. User record is created in PostgreSQL\n\n**Login** (`src/modules/auth/auth.service.ts:34-58`):\n1. Credentials are validated against the stored hash\n2. A short-lived access token (15 minutes) is generated\n3. A refresh token (7 days) is created and stored in Redis\n4. Both tokens are returned to the client\n\n**Token Refresh** (`src/modules/auth/refresh-token.service.ts:8-24`):\n1. Client sends the refresh token\n2. Server validates it against Redis and checks the token family\n3. The old refresh token is invalidated\n4. A new access + refresh token pair is issued (rotation)\n\n**Route Protection** (`src/middleware/auth.ts:12-38`):\nThe `JwtGuard` middleware extracts the Bearer token, validates its signature and expiry, and attaches the user payload to the request context.\n\nThe key security decision here is **refresh token rotation** — each refresh invalidates the previous token, so if a token is compromised and used by an attacker, it will lock out the legitimate user's next refresh attempt, signaling a breach.",
      "citations": [
        {
          "filePath": "src/modules/auth/auth.service.ts",
          "startLine": 15,
          "endLine": 32,
          "symbolName": "AuthService.register",
          "relevance": "User registration with password hashing"
        },
        {
          "filePath": "src/modules/auth/auth.service.ts",
          "startLine": 34,
          "endLine": 58,
          "symbolName": "AuthService.login",
          "relevance": "Login flow with token generation"
        },
        {
          "filePath": "src/modules/auth/refresh-token.service.ts",
          "startLine": 8,
          "endLine": 24,
          "symbolName": "RefreshTokenService.rotate",
          "relevance": "Refresh token rotation implementation"
        },
        {
          "filePath": "src/middleware/auth.ts",
          "startLine": 12,
          "endLine": 38,
          "symbolName": "JwtGuard",
          "relevance": "JWT validation middleware"
        }
      ],
      "metadata": {
        "retrievalChunks": 12,
        "retrievalStrategy": "hybrid_rrf",
        "topDenseScore": 0.92,
        "topSparseScore": 0.87
      },
      "tokensUsed": 1247,
      "modelUsed": "gpt-4o",
      "latencyMs": 3200,
      "createdAt": "2025-09-19T14:30:08.200Z"
    }
  ],
  "pagination": {
    "hasMore": false,
    "total": 2
  }
}
```

### 6.3 WebSocket Events (Real-time Chat)

**Connection:**
```javascript
const ws = new WebSocket('wss://api.vibecoder.com/v1/ws?token=<jwt>');

// Or via Socket.IO:
const socket = io('wss://api.vibecoder.com', {
  auth: { token: '<jwt>' }
});
```

**Client → Server Events:**

```typescript
// Send a chat message
socket.emit('chat:send', {
  sessionId: 'chat_f1a2b3c4-d5e6-7890-abcd-ef1234567890',
  content: 'What design patterns are used in the notification module?'
});

// Submit mock interview answer
socket.emit('mock-interview:answer', {
  sessionId: 'mock_a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  answer: 'The notification module uses the Observer pattern...'
});

// Request next mock interview question
socket.emit('mock-interview:next', {
  sessionId: 'mock_a1b2c3d4-e5f6-7890-abcd-ef1234567890'
});

// Typing indicators
socket.emit('chat:typing:start', { sessionId: 'chat_...' });
socket.emit('chat:typing:stop', { sessionId: 'chat_...' });
```

**Server → Client Events:**

```typescript
// Streaming chat response
socket.on('chat:stream:start', (data: {
  messageId: string;
  sessionId: string;
}) => { });

socket.on('chat:stream:chunk', (data: {
  messageId: string;
  delta: string;           // streamed token
  citations: Citation[];   // incremental citations
}) => { });

socket.on('chat:stream:end', (data: {
  messageId: string;
  totalTokens: number;
  modelUsed: string;
  latencyMs: number;
}) => { });

// Mock interview events
socket.on('mock-interview:question', (data: {
  questionId: string;
  questionText: string;
  category: string;
  questionNumber: number;    // current question
  totalQuestions: number;    // total in session
}) => { });

socket.on('mock-interview:coaching', (data: {
  note: string;
  relevantCode: {
    filePath: string;
    startLine: number;
    endLine: number;
    content: string;
  }[];
  suggestedAnswer: string;
}) => { });

socket.on('mock-interview:score', (data: {
  questionId: string;
  scores: {
    overall: number;        // 0-100
    clarity: number;
    depth: number;
    specificity: number;
    confidence: number;
  };
  feedback: string;
}) => { });

socket.on('mock-interview:complete', (data: {
  sessionId: string;
  report: {
    overallScore: number;
    categoryScores: Record<string, number>;
    strengths: string[];
    weaknesses: string[];
    studyRecommendations: {
      topic: string;
      modules: string[];
      priority: 'high' | 'medium' | 'low';
    }[];
    timeSpentSec: number;
  }
}) => { });
```

---

## 7. Mock Interview API

### 7.1 POST `/repos/:repoId/mock-interviews`

Start a new mock interview session.

**Request:**
```json
{
  "persona": "rigorous_hiring_manager",
  "difficulty": "mid",
  "questionCount": 8,
  "timeLimitMinutes": 30
}
```

**Validation Rules:**
| Field | Type | Required | Rules |
|---|---|---|---|
| `persona` | string | No | Enum: `friendly_senior`, `rigorous_hiring_manager`, `curious_peer`, `stressed_tech_lead`, `detailed_reviewer`, `random`. Default: `random` |
| `difficulty` | string | No | Enum: `junior`, `mid`, `senior`. Default: `mid` |
| `questionCount` | integer | No | Min: 3, Max: 15. Default: 8 |
| `timeLimitMinutes` | integer | No | Min: 10, Max: 60. Default: 30 |

**Response (201):**
```json
{
  "ok": true,
  "data": {
    "id": "mock_a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "repoId": "repo_d3e4f5a6-b7c8-9012-abcd-ef1234567890",
    "persona": "rigorous_hiring_manager",
    "difficulty": "mid",
    "questionCount": 8,
    "timeLimitMinutes": 30,
    "status": "active",
    "firstQuestion": {
      "questionId": "mq_a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "questionText": "I've looked at your repository. Before we dive into specifics — walk me through the high-level architecture. What are the main components and how do they interact?",
      "category": "architecture",
      "questionNumber": 1,
      "totalQuestions": 8
    },
    "startedAt": "2025-09-19T15:00:00.000Z"
  }
}
```

### 7.2 POST `/mock-interviews/:sessionId/answer`

Submit an answer for the current question (REST fallback for non-WebSocket clients).

**Request:**
```json
{
  "answer": "The project follows a layered architecture. At the top, Express route handlers receive HTTP requests and delegate to service classes. Services contain business logic and orchestrate calls to repositories, which abstract database access via Prisma. For authentication, I chose JWT with refresh token rotation because..."
}
```

**Validation Rules:**
| Field | Type | Required | Rules |
|---|---|---|---|
| `answer` | string | Yes | Min 10 chars, Max 5000 chars |

**Response (200):**
```json
{
  "ok": true,
  "data": {
    "questionId": "mq_a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "score": {
      "overall": 78,
      "clarity": 82,
      "depth": 75,
      "specificity": 70,
      "confidence": 85
    },
    "feedback": "Strong answer with clear articulation of the layered pattern. You explained the 'why' behind your choices, which is excellent. Two areas for improvement: (1) You mentioned Prisma but didn't explain why you chose it over raw SQL or other ORMs — interviewers will probe this. (2) You described the auth flow well but didn't mention the Redis dependency for refresh tokens, which is a key architectural decision worth highlighting.",
    "timeSpentSec": 95,
    "nextQuestion": {
      "questionId": "mq_b2c3d4e5-f6a7-8901-abcd-ef1234567890",
      "questionText": "You mentioned JWT with refresh token rotation. What happens if a user's access token is stolen? Walk me through the security implications and how your implementation handles this.",
      "category": "security",
      "questionNumber": 2,
      "totalQuestions": 8
    }
  }
}
```

### 7.3 POST `/mock-interviews/:sessionId/complete`

End the mock interview and receive the final report.

**Response (200):**
```json
{
  "ok": true,
  "data": {
    "sessionId": "mock_a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "status": "completed",
    "completedAt": "2025-09-19T15:28:00.000Z",
    "scores": {
      "overall": 74.5,
      "clarity": 78,
      "depth": 72,
      "specificity": 68,
      "confidence": 80
    },
    "feedbackSummary": "Solid mid-level performance. You demonstrate good understanding of your architecture and can articulate most decisions. Key gaps: (1) security depth — you described 'what' but not always 'why' for security choices, (2) you struggled with the performance optimization question, suggesting you should study your caching strategy more deeply, (3) your debugging walkthrough was strong but could be more systematic.",
    "strengths": [
      "Clear communication of architectural patterns",
      "Good understanding of the authentication flow",
      "Strong debugging methodology",
      "Confident delivery with minimal filler words"
    ],
    "weaknesses": [
      "Security depth — need more practice with token revocation scenarios",
      "Performance optimization — caching strategy explanation was surface-level",
      "Database design — didn't explain indexing decisions",
      "Edge cases — missed concurrent modification scenarios"
    ],
    "studyRecommendations": [
      {
        "topic": "Security — Token Revocation & Session Management",
        "modules": ["Authentication Module"],
        "priority": "high",
        "resources": [
          "Re-read: src/modules/auth/refresh-token.service.ts",
          "Review: Token blacklist implementation in src/middleware/auth.ts:52-67"
        ]
      },
      {
        "topic": "Performance — Caching Strategy",
        "modules": ["Project Module", "Database Config"],
        "priority": "high",
        "resources": [
          "Study: Redis cache invalidation in src/config/redis.ts",
          "Review: Cache-aside pattern in src/modules/projects/service.ts:45-67"
        ]
      },
      {
        "topic": "Database — Indexing Decisions",
        "modules": ["Database Config"],
        "priority": "medium",
        "resources": [
          "Review: Prisma schema at prisma/schema.prisma",
          "Study: Index definitions and query patterns"
        ]
      }
    ],
    "timeSpentSec": 1680,
    "questionsAnswered": 8,
    "averageTimePerQuestion": 210
  }
}
```

---

## 8. Usage & Billing API

### 8.1 GET `/usage/summary`

Returns current usage period summary.

**Response (200):**
```json
{
  "ok": true,
  "data": {
    "period": {
      "start": "2025-09-19T00:00:00.000Z",
      "end": "2025-09-19T23:59:59.999Z",
      "type": "daily"
    },
    "usage": {
      "reposConnected": { "current": 4, "limit": 20 },
      "analysisJobs": { "current": 2, "limit": 20 },
      "chatMessages": { "current": 47, "limit": 500 },
      "mockInterviews": { "current": 1, "limit": 30 },
      "tokensConsumed": { "current": 234000, "limit": 5000000 }
    },
    "costs": {
      "estimatedMonthly": 24.50,
      "currency": "USD"
    }
  }
}
```

### 8.2 POST `/billing/checkout`

Create a Stripe Checkout session for plan upgrade.

**Request:**
```json
{
  "plan": "pro",
  "billingCycle": "monthly"
}
```

**Validation Rules:**
| Field | Type | Required | Rules |
|---|---|---|---|
| `plan` | string | Yes | Enum: `starter`, `pro`, `institutional` |
| `billingCycle` | string | No | Enum: `monthly`, `yearly`. Default: `monthly` |

**Response (200):**
```json
{
  "ok": true,
  "data": {
    "checkoutUrl": "https://checkout.stripe.com/pay/cs_test_a1b2c3...",
    "sessionId": "cs_a1b2c3d4e5f6",
    "expiresAt": "2025-09-19T15:30:00.000Z"
  }
}
```

---

## 9. Pagination Reference

### 9.1 Cursor-Based Pagination (Preferred)

```json
// Request
GET /repos?limit=10&cursor=eyJpZCI6InJlcG9fZDRlNWY2YTcifQ==

// Response
{
  "data": [...],
  "pagination": {
    "hasMore": true,
    "nextCursor": "eyJpZCI6InJlcG9fYTdiOGM5ZDAifQ==",
    "total": 24
  }
}
```

### 9.2 Offset-Based Pagination (Legacy)

```json
// Request
GET /repos/:repoId/questions?limit=20&offset=40

// Response
{
  "data": [...],
  "pagination": {
    "limit": 20,
    "offset": 40,
    "total": 45,
    "hasMore": false
  }
}
```

---

## 10. Webhook Events (Optional)

For institutional clients and CI/CD integration.

### 10.1 Webhook Payload — Analysis Completed

```json
{
  "event": "analysis.completed",
  "timestamp": "2025-09-19T12:00:00.000Z",
  "data": {
    "jobId": "job_f6a7b8c9-d0e1-2345-abcd-ef1234567890",
    "repoFullName": "candidate-dev/my-portfolio-api",
    "status": "completed",
    "stats": {
      "filesParsed": 318,
      "symbolsExtracted": 1847,
      "artifactsGenerated": 4,
      "totalTokensUsed": 850000,
      "durationMs": 127000
    },
    "artifacts": [
      { "type": "architecture_overview", "url": "/repos/repo_id/artifacts/architecture_overview" },
      { "type": "question_bank", "url": "/repos/repo_id/artifacts/question_bank" }
    ]
  },
  "signature": "sha256=a1b2c3d4e5f6..."
}
```

### 10.2 Webhook Payload — Analysis Failed

```json
{
  "event": "analysis.failed",
  "timestamp": "2025-09-19T12:05:00.000Z",
  "data": {
    "jobId": "job_f6a7b8c9-d0e1-2345-abcd-ef1234567890",
    "repoFullName": "candidate-dev/my-portfolio-api",
    "status": "failed",
    "error": {
      "code": "UNSUPPORTED_LANGUAGE",
      "message": "Repository contains only Markdown and image files."
    },
    "durationMs": 5200
  },
  "signature": "sha256=b2c3d4e5f6a7..."
}
```

### 10.3 Webhook Signature Verification

```
X-VibeCoder-Signature: sha256=<hmac_sha256_hex>
X-VibeCoder-Event: analysis.completed
X-VibeCoder-Delivery: del_a1b2c3d4
```

Verify with: `HMAC-SHA256(webhook_secret, raw_request_body)`

---

*This document defines the complete API contract for the Vibe Coder platform. For database schema details, see the Technical Specification document. For business context and feature descriptions, see the main Product Proposal document.*
