# Vibe Coder — Comprehensive QA Test Plan

---

## 1. Executive Summary

This document defines the quality assurance strategy for the Vibe Coder Interview-Prep Platform. It covers functional testing, integration testing, performance testing, security testing, and user acceptance testing across all platform features. The plan ensures reliability, accuracy, and performance meet the defined SLAs before production deployment.

**Testing Scope:**
- GitHub repository connection and analysis pipeline
- AST parsing and code understanding
- Hybrid retrieval engine (dense + sparse search)
- LLM-powered generation (architecture docs, question banks, chat)
- Mock interview simulator
- User management, authentication, and billing
- WebSocket real-time communication
- API endpoints and data integrity

**Quality Gates:**
| Gate | Threshold | Blocking? |
|---|---|---|
| Unit test coverage | ≥ 80% | Yes |
| Integration test pass rate | 100% | Yes |
| E2E critical path pass rate | 100% | Yes |
| Performance: p95 API latency | < 500ms (non-analysis) | Yes |
| Performance: Analysis job completion | < 15 min (10K LOC repo) | Yes |
| Security: No critical/high CVEs | 0 | Yes |
| Retrieval: Precision@8 | ≥ 0.75 | Yes |
| LLM citation accuracy | ≥ 90% | Yes |
| Accessibility: WCAG 2.1 AA | Pass | Yes |

---

## 2. Test Environment Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     TEST ENVIRONMENTS                         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │   DEV     │  │   STAGING    │  │    PRE-PROD          │  │
│  │          │  │              │  │                      │  │
│  │ Local    │  │ Mirror of    │  │ Prod-like with       │  │
│  │ Docker   │  │ production   │  │ synthetic data       │  │
│  │ Compose  │  │ (scaled down)│  │                      │  │
│  │          │  │              │  │ Load test traffic    │  │
│  │ Unit +   │  │ Integration  │  │ E2E + Performance    │  │
│  │ Component│  │ + E2E tests  │  │ + Security scans     │  │
│  │ tests    │  │              │  │                      │  │
│  └──────────┘  └──────────────┘  └──────────────────────┘  │
│                                                              │
│  Test Data Strategy:                                         │
│  • 5 reference repositories (100 LOC to 50K LOC)            │
│  • 3 synthetic repos (edge cases: monorepo, no README,      │
│    binary-heavy, 50+ languages)                              │
│  • Fixture datasets for retrieval evaluation                 │
│  • Mock GitHub API responses (wiremock)                      │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Functional Test Suites

### 3.1 Authentication & User Management

| ID | Test Case | Steps | Expected Result | Priority |
|---|---|---|---|---|
| AUTH-001 | GitHub OAuth login flow | Click "Connect with GitHub" → authorize → callback | User redirected to dashboard, JWT set, profile created | P0 |
| AUTH-002 | OAuth cancellation | Click "Connect" → deny access on GitHub | User sees friendly error, no account created | P1 |
| AUTH-003 | JWT token expiry | Wait for token expiry (15 min) or mock expiry | 401 response, refresh token used automatically | P0 |
| AUTH-004 | Refresh token rotation | Use valid refresh token to get new access token | New tokens issued, old refresh token invalidated | P0 |
| AUTH-005 | Logout invalidates session | Logout → attempt API call with old token | Token rejected, user logged out from all tabs | P1 |
| AUTH-006 | Duplicate GitHub account | Login with same GitHub account from different browser | Same user record, no duplicate | P1 |
| AUTH-007 | Rate limiting on auth endpoints | Send 100 rapid requests to /auth/github | Rate limited after 10 requests, 429 response | P1 |
| AUTH-008 | Institutional API key auth | Use valid API key in Authorization header | Authenticated, rate limit = 1000/hr | P1 |

### 3.2 Repository Connection & Management

| ID | Test Case | Steps | Expected Result | Priority |
|---|---|---|---|---|
| REPO-001 | Connect public repository | Enter valid public repo URL → click Connect | Repo details fetched, status = "connected", files visible | P0 |
| REPO-002 | Connect private repository | Enter valid private repo URL → authorize access | Repo accessible, correct file count displayed | P0 |
| REPO-003 | Invalid repository URL | Enter "github.com/invalid/repo" → Connect | Error: "Repository not found or not accessible" | P1 |
| REPO-004 | Large repository (>10K files) | Connect a monorepo with 15K files | Cloning succeeds, progress indicator shown, no timeout | P0 |
| REPO-005 | Empty repository | Connect repo with only README | Warning: "No code files detected for analysis" | P2 |
| REPO-006 | Repository with binary files | Connect repo with images, PDFs, compiled assets | Binaries skipped, code files parsed correctly | P1 |
| REPO-007 | Disconnect repository | Click Disconnect → confirm | Repo removed, analysis data purged from user view | P1 |
| REPO-008 | Re-analyze repository | Click Re-analyze on existing repo | New job created, previous artifacts archived | P1 |
| REPO-009 | Repository access revoked | Revoke GitHub app access → attempt analysis | Graceful error, re-authorization prompt | P1 |
| REPO-010 | Concurrent analysis of same repo | Trigger two analyses simultaneously | Second request queued or rejected with 409 | P1 |
| REPO-011 | Repository with submodules | Connect repo with git submodules | Submodules handled (skipped or shallow cloned) | P2 |
| REPO-012 | .gitignore filtering | Connect repo with large .gitignore | Ignored files excluded from analysis | P1 |

### 3.3 Analysis Pipeline

| ID | Test Case | Steps | Expected Result | Priority |
|---|---|---|---|---|
| ANL-001 | Full pipeline — small repo | Analyze a 500-line JavaScript repo | Completes in < 2 min, all artifacts generated | P0 |
| ANL-002 | Full pipeline — medium repo | Analyze a 5K-line TypeScript/Next.js repo | Completes in < 5 min, architecture overview + questions | P0 |
| ANL-003 | Full pipeline — large repo | Analyze a 30K-line polyglot repo | Completes in < 15 min, no OOM, no data loss | P0 |
| ANL-004 | Pipeline stage transitions | Monitor status field during analysis | Progresses: queued → cloning → parsing → indexing → generating → completed | P0 |
| ANL-005 | Pipeline failure recovery | Inject failure at parsing stage | Job marked failed, error message stored, retry possible | P0 |
| ANL-006 | Progress WebSocket updates | Connect via WebSocket during analysis | Real-time progress events emitted (stage, %, message) | P1 |
| ANL-007 | Analysis stats accuracy | Complete analysis of known repo | Stats (files_parsed, symbols_extracted) match manual count ±5% | P1 |
| ANL-008 | Concurrent analyses (multi-user) | 5 users analyze different repos simultaneously | All complete successfully, no cross-contamination | P0 |
| ANL-009 | Analysis cancellation | Cancel running analysis mid-pipeline | Job cancelled, partial results cleaned up | P2 |
| ANL-010 | Analysis timeout | Repo that takes > 30 min to analyze | Timed out at 30 min, partial results preserved if possible | P1 |

### 3.4 AST Parsing & Code Understanding

| ID | Test Case | Steps | Expected Result | Priority |
|---|---|---|---|---|
| PARSE-001 | TypeScript/JavaScript parsing | Parse a TypeScript file with classes, interfaces, functions | All symbols extracted with correct types, line numbers | P0 |
| PARSE-002 | Python parsing | Parse a Python file with classes, decorators, type hints | All symbols extracted including decorator metadata | P0 |
| PARSE-003 | Go parsing | Parse a Go file with structs, interfaces, methods | All symbols extracted with correct signatures | P0 |
| PARSE-004 | Mixed-language repo | Analyze repo with TS, Python, Go, Rust files | Each file parsed with correct language parser | P0 |
| PARSE-005 | Import/export graph | Parse file with complex imports | Import graph correctly built, circular deps detected | P1 |
| PARSE-006 | Nested function detection | Parse file with closures, arrow functions, callbacks | Inner functions detected and linked to parent | P1 |
| PARSE-007 | TypeScript generics | Parse file with complex generic types | Generic parameters captured in symbol metadata | P1 |
| PARSE-008 | Python async/await | Parse file with async functions and await expressions | Async symbols correctly identified | P1 |
| PARSE-009 | Minified code | Provide minified JS file | Handled gracefully (skip or attempt parse, no crash) | P2 |
| PARSE-010 | Very large file (10K+ lines) | Parse a single file with 15K lines | Completes within memory limits, all symbols extracted | P1 |
| PARSE-011 | Syntax errors in source | Parse file with intentional syntax errors | Error logged, file skipped, analysis continues for other files | P1 |
| PARSE-012 | Dead code detection | Parse file with unused functions/imports | Unused symbols flagged with low confidence | P2 |
| PARSE-013 | Module decomposition accuracy | Analyze a well-structured Next.js app | Modules correctly identified: pages, components, hooks, utils, API routes | P0 |
| PARSE-014 | Module type classification | Analyze repo with services, controllers, models | Each module correctly classified by type | P1 |
| PARSE-015 | Complexity metrics | Parse files with varying complexity | Cyclomatic/cognitive complexity scores correlate with manual assessment | P1 |

### 3.5 Retrieval Engine

| ID | Test Case | Steps | Expected Result | Priority |
|---|---|---|---|---|
| RET-001 | Dense search accuracy | Query "authentication middleware" | Returns auth-related code chunks in top-5 results | P0 |
| RET-002 | Sparse search accuracy | Query "bcrypt password hash" | Returns code containing "bcrypt" and "password" in top-5 | P0 |
| RET-003 | Hybrid fusion improvement | Compare dense-only vs hybrid results | Hybrid precision ≥ dense-only precision | P0 |
| RET-004 | Reranker effectiveness | Retrieve top-20 → rerank to top-8 | Reranked results have higher relevance than top-8 of original | P1 |
| RET-005 | Query expansion | Query "auth flow" → expanded queries | Expansion adds related terms (login, session, token, OAuth) | P1 |
| RET-006 | Cross-module query | Query about feature spanning multiple modules | Results span relevant modules, not just one | P1 |
| RET-007 | Empty index | Query against repo with no indexed code | Graceful handling, "no results found" message | P2 |
| RET-008 | Very short query | Query "config" | Returns configuration-related code, not noise | P1 |
| RET-009 | Very long query | Query with 500+ tokens | Truncated or handled, relevant results returned | P2 |
| RET-010 | Citation accuracy | Retrieve result for "user service" | Citations point to actual user service code, not random files | P0 |
| RET-011 | Freshness after re-analysis | Re-analyze repo, then query | Results reflect updated code, not stale data | P1 |
| RET-012 | Multi-language retrieval | Query in English about Python code | English query matches Python code chunks | P1 |
| RET-013 | Retrieval latency | Query against 10K LOC indexed repo | p95 latency < 200ms | P0 |
| RET-014 | Retrieval under load | 50 concurrent queries | p95 latency < 500ms, no errors | P1 |
| RET-015 | Precision@8 benchmark | Run against curated test set | Precision@8 ≥ 0.75 | P0 |

### 3.6 LLM Generation (Chat)

| ID | Test Case | Steps | Expected Result | Priority |
|---|---|---|---|---|
| CHAT-001 | Basic question answering | Ask "What does this project do?" | Correct, citation-grounded answer about project purpose | P0 |
| CHAT-002 | Code-specific question | Ask "How does the auth middleware work?" | Detailed explanation with file + line citations | P0 |
| CHAT-003 | Citation verification | Check all cited file paths and line ranges | All citations resolve to actual code locations | P0 |
| CHAT-004 | Streaming response | Send message via WebSocket | Tokens stream in real-time, no large delays between chunks | P0 |
| CHAT-005 | Conversation context | Send 5 messages in sequence | Assistant maintains context across messages | P0 |
| CHAT-006 | Follow-up questions | Receive assistant response with follow-ups | Follow-ups are relevant and clickable | P1 |
| CHAT-007 | Hallucination detection | Ask about feature that doesn't exist in codebase | Assistant says "I don't see evidence of this in the codebase" | P0 |
| CHAT-008 | Token usage tracking | Send messages and check usage stats | Token count matches approximate calculation | P1 |
| CHAT-009 | Rate limiting | Send 100 messages in rapid succession | Rate limit enforced, graceful error messages | P1 |
| CHAT-010 | Large codebase context | Query about project with 50K LOC | Response is grounded, not generic | P1 |
| CHAT-011 | Multi-module question | Ask about interaction between two modules | Response references both modules with citations | P1 |
| CHAT-012 | Architecture explanation | Ask "Explain the architecture" | Structured overview with module relationships | P0 |
| CHAT-013 | Study guide generation | Ask "Help me study this codebase for an interview" | Structured study plan with prioritized topics | P1 |
| CHAT-014 | Session persistence | Close browser → reopen → return to session | Chat history preserved and loaded correctly | P1 |
| CHAT-015 | Response latency | Send question, measure time to first token | TTFT < 2s, total response < 10s | P0 |

### 3.7 Mock Interview Simulator

| ID | Test Case | Steps | Expected Result | Priority |
|---|---|---|---|---|
| MOCK-001 | Start interview session | Select persona + difficulty → Start | Session created, first question generated | P0 |
| MOCK-002 | Submit answer | Type answer → Submit | Score returned with feedback, next question presented | P0 |
| MOCK-003 | Complete interview (5 questions) | Answer all 5 questions | Final report with scores, strengths, weaknesses, study plan | P0 |
| MOCK-004 | Persona: Friendly Senior | Select "Friendly Senior" persona | Questions are encouraging, coaching breaks offered | P1 |
| MOCK-005 | Persona: Rigorous Hiring Manager | Select "Rigorous Hiring Manager" | Questions are challenging, direct feedback | P1 |
| MOCK-006 | Persona: Curious Peer | Select "Curious Peer" | Questions are exploratory, conversational tone | P1 |
| MOCK-007 | Difficulty: Junior | Select Junior difficulty | Questions focus on fundamentals, easier scope | P1 |
| MOCK-008 | Difficulty: Senior | Select Senior difficulty | Questions about trade-offs, system design, edge cases | P1 |
| MOCK-009 | Coaching breaks | After 2 difficult answers | Coaching break provides helpful code snippets | P1 |
| MOCK-010 | Score rubric accuracy | Compare AI scores with human rubric scores | Correlation ≥ 0.7 with human graders | P0 |
| MOCK-011 | Citation in questions | Review generated questions | All questions cite actual code locations | P0 |
| MOCK-012 | Timed session | Complete interview within time limit | Timer displayed, time recorded per question | P1 |
| MOCK-013 | Abandon session | Close tab mid-interview | Session marked abandoned, partial results saved | P2 |
| MOCK-014 | Resume interrupted session | Reopen abandoned session | Can resume from where left off | P2 |
| MOCK-015 | Random persona | Select "Random" persona | Random persona selected from the pool | P2 |
| MOCK-016 | Study recommendations | Complete interview → review recommendations | Recommendations are specific, actionable, code-referenced | P0 |
| MOCK-017 | Session history | View past mock interviews | All completed sessions listed with scores and dates | P1 |
| MOCK-018 | Comparison across sessions | Complete 3 interviews over time | Performance trends visible (improving scores) | P2 |

### 3.8 Architecture & Module Explanations

| ID | Test Case | Steps | Expected Result | Priority |
|---|---|---|---|---|
| ARCH-001 | Architecture overview accuracy | View architecture for known repo | Overview correctly describes project structure | P0 |
| ARCH-002 | Module purpose accuracy | Read module explanation for "auth" module | Correctly describes authentication purpose | P0 |
| ARCH-003 | Key abstractions listed | Check "key abstractions" for a module | Lists main classes/functions/interfaces | P1 |
| ARCH-004 | Failure modes documented | Check failure modes for critical module | Describes likely failure scenarios | P1 |
| ARCH-005 | Dependency graph visualization | Load dependency graph | Nodes = modules, edges = dependencies, layout readable | P1 |
| ARCH-006 | Complexity scoring | Check complexity scores across modules | Scores correlate with actual code complexity | P1 |
| ARCH-007 | Large project architecture | View architecture for 50K LOC project | Overview is coherent, not overwhelming | P1 |
| ARCH-008 | Tech stack detection | View tech stack for known project | All major technologies correctly identified | P1 |

### 3.9 Interview Question Bank

| ID | Test Case | Steps | Expected Result | Priority |
|---|---|---|---|---|
| QB-001 | Question diversity | Review generated question bank | Mix of categories: architecture, security, performance, debugging | P0 |
| QB-002 | Difficulty levels | Filter by difficulty | Junior questions are simpler, senior questions require depth | P1 |
| QB-003 | Model answer quality | Read model answers for 10 questions | Answers are accurate, detailed, and cite code | P0 |
| QB-004 | Citations in answers | Check citations in 20 random answers | All citations resolve to actual code locations | P0 |
| QB-005 | Follow-up questions | Review follow-up suggestions | Follow-ups are relevant and progressively deeper | P1 |
| QB-006 | Question-source mapping | Check source_modules for each question | Modules referenced are actually relevant | P1 |
| QB-007 | Category coverage | Count questions per category | All 9 categories represented with ≥ 3 questions each | P1 |
| QB-008 | Question uniqueness | Check for duplicate questions | No duplicate questions in the bank | P1 |

---

## 4. Integration Test Suites

### 4.1 End-to-End Flows

| ID | Flow | Steps | Expected Result | Priority |
|---|---|---|---|---|
| E2E-001 | New user onboarding | Signup → connect repo → first analysis → view results | Complete flow works, no dead ends | P0 |
| E2E-002 | Analysis → Chat | Analyze repo → ask questions about architecture | Chat responses reference analyzed code | P0 |
| E2E-003 | Analysis → Mock Interview | Analyze repo → complete mock interview → view report | Interview questions are repo-specific, scores recorded | P0 |
| E2E-004 | Chat → Deep dive → Study guide | Chat about auth → deep dive into module → generate study plan | Context flows through all stages | P1 |
| E2E-005 | Upgrade flow | Free user → hit limit → upgrade → continue | Payment processed, limits updated, user continues | P0 |
| E2E-006 | Re-analysis flow | Old analysis → update code → re-analyze → chat | New analysis reflects code changes | P1 |
| E2E-007 | Multi-repo workflow | Connect 3 repos → analyze all → compare architectures | Each repo's data is isolated and correct | P1 |
| E2E-008 | Offline/reconnect | Analyze repo → lose connection → reconnect | Session resumes, no data loss | P2 |

### 4.2 Service Integration Tests

| ID | Integration | Test | Expected Result | Priority |
|---|---|---|---|---|
| INT-001 | API ↔ Database | Create analysis job, verify in DB | Job record created with correct schema | P0 |
| INT-002 | API ↔ Redis | Cache query results, verify cache hit | Second query returns cached result | P1 |
| INT-003 | API ↔ Elasticsearch | Index chunks, search for them | Chunks found with correct scores | P0 |
| INT-004 | API ↔ Pinecone | Insert embeddings, query them | Vector search returns correct results | P0 |
| INT-005 | API ↔ GitHub | Fetch repo metadata, clone repo | Data matches GitHub API response | P0 |
| INT-006 | API ↔ OpenAI | Send prompt, verify response format | Response parsed correctly, token count tracked | P0 |
| INT-007 | Worker ↔ Queue | Enqueue job, verify worker picks up | Job processed within 30 seconds | P0 |
| INT-008 | WebSocket ↔ API | Send chat message via WS, verify persistence | Message stored in DB, response streamed back | P0 |
| INT-009 | API ↔ Stripe | Create checkout, verify webhook | Subscription updated, limits refreshed | P0 |
| INT-010 | Full pipeline integration | Trigger analysis, monitor all services | All services communicate correctly, artifacts produced | P0 |

---

## 5. Performance Test Plan

### 5.1 Load Testing Scenarios

| ID | Scenario | Load | Duration | Success Criteria |
|---|---|---|---|---|
| PERF-001 | Normal traffic | 50 concurrent users, 10 req/s | 30 min | p95 < 500ms, 0 errors |
| PERF-002 | Peak traffic | 200 concurrent users, 40 req/s | 15 min | p95 < 1s, error rate < 1% |
| PERF-003 | Analysis spike | 20 concurrent analyses triggered | Until completion | All complete < 15 min, no OOM |
| PERF-004 | Chat streaming | 100 concurrent chat sessions | 15 min | TTFT < 2s, no dropped connections |
| PERF-005 | Mock interview load | 50 concurrent mock interviews | 20 min | All complete, scores generated |
| PERF-006 | Database stress | 500 concurrent queries | 10 min | p99 < 100ms, no connection pool exhaustion |
| PERF-007 | WebSocket scale | 1000 concurrent WebSocket connections | 30 min | < 1% disconnections, messages delivered |
| PERF-008 | Endurance test | Normal traffic | 24 hours | No memory leaks, no degradation |

### 5.2 Key Performance Metrics

| Metric | Target | Measurement Method |
|---|---|---|
| API response time (non-analysis) | p95 < 500ms | Application Performance Monitoring |
| Chat first token latency | p95 < 2s | WebSocket timestamp delta |
| Chat full response time | p95 < 10s | WebSocket timestamp delta |
| Analysis completion time | p95 < 15 min (10K LOC) | Job timestamp delta |
| Retrieval query latency | p95 < 200ms | Backend instrumentation |
| Database query latency | p95 < 100ms | pg_stat_statements |
| Memory usage per worker | < 2GB peak | Container metrics |
| CPU utilization | < 70% sustained | ECS metrics |
| Error rate | < 0.1% | Log aggregation |

### 5.3 Stress Testing

| ID | Stress Scenario | Expected Behavior |
|---|---|---|
| STRESS-001 | 10x normal traffic | Graceful degradation, 429 responses, no crash |
| STRESS-002 | Database connection pool exhaustion | Queued requests, no dropped connections |
| STRESS-003 | Redis failure | Fallback to direct DB queries, reduced performance |
| STRESS-004 | OpenAI API rate limit hit | Queued generation, user notified of delay |
| STRESS-005 | GitHub API rate limit hit | Analysis queued, retried when limit resets |
| STRESS-006 | Disk space exhaustion (repo clones) | Old clones cleaned up, new analysis still works |
| STRESS-007 | Worker process crash | Job detected, retried automatically |

---

## 6. Security Test Plan

| ID | Test Case | Method | Expected Result | Priority |
|---|---|---|---|---|
| SEC-001 | SQL injection | Attempt injection in all API parameters | All inputs parameterized, no injection | P0 |
| SEC-002 | XSS (stored) | Submit script tags in chat messages | Messages sanitized, no script execution | P0 |
| SEC-003 | XSS (reflected) | Inject script in URL parameters | Parameters escaped in responses | P0 |
| SEC-004 | CSRF | Submit forms without CSRF token | Requests rejected with 403 | P0 |
| SEC-005 | JWT manipulation | Modify JWT payload, attempt use | Signature validation fails, 401 returned | P0 |
| SEC-006 | Horizontal privilege escalation | Access another user's repo data | 403 Forbidden, data not leaked | P0 |
| SEC-007 | Vertical privilege escalation | Free user accessing pro features | Upgrade prompt, access denied | P1 |
| SEC-008 | Rate limiting bypass | Attempt to bypass rate limits | Limits enforced at gateway level | P1 |
| SEC-009 | Repository data isolation | Verify User A cannot see User B's repos | Strict tenant isolation in all queries | P0 |
| SEC-010 | GitHub token exposure | Scan logs and API responses for tokens | No tokens in plaintext anywhere | P0 |
| SEC-011 | Dependency vulnerability scan | Run npm audit, cargo audit, pip-audit | No critical/high vulnerabilities | P0 |
| SEC-012 | Container image scan | Scan Docker images for CVEs | No critical/high CVEs in base images | P1 |
| SEC-013 | API authentication bypass | Call protected endpoints without auth | 401 returned for all protected routes | P0 |
| SEC-014 | File path traversal | Attempt to access files outside repo scope | Path traversal blocked, 400 returned | P0 |
| SEC-015 | Prompt injection in chat | Send malicious instructions in chat | LLM ignores injection, responds appropriately | P0 |
| SEC-016 | Data at rest encryption | Verify database encryption | All data encrypted with AES-256 | P1 |
| SEC-017 | TLS in transit | Verify all connections use HTTPS | HTTP requests redirected, no mixed content | P0 |
| SEC-018 | Secret management | Verify secrets in Secrets Manager | No secrets in code, env vars, or logs | P0 |

---

## 7. Accessibility Test Plan

| ID | Test Case | WCAG Criterion | Expected Result | Priority |
|---|---|---|---|---|
| A11Y-001 | Keyboard navigation | 2.1.1 | All interactive elements reachable via keyboard | P0 |
| A11Y-002 | Screen reader support | 4.1.2 | All elements have appropriate ARIA labels | P1 |
| A11Y-003 | Color contrast | 1.4.3 | Text contrast ratio ≥ 4.5:1 | P1 |
| A11Y-004 | Focus indicators | 2.4.7 | Visible focus outline on all interactive elements | P1 |
| A11Y-005 | Form labels | 1.3.1 | All form inputs have associated labels | P1 |
| A11Y-006 | Error identification | 3.3.1 | Errors clearly described and associated with fields | P1 |
| A11Y-007 | Responsive design | 1.4.10 | Readable and usable at 200% zoom | P1 |
| A11Y-008 | Chat accessibility | 4.1.3 | Chat messages announced to screen readers | P2 |
| A11Y-009 | Mock interview accessibility | 4.1.3 | Interview flow fully accessible via keyboard/screen reader | P2 |
| A11Y-010 | Code display accessibility | 1.4.1 | Code blocks have sufficient contrast, not color-only indicators | P2 |

---

## 8. API Contract Testing

### 8.1 Response Schema Validation

| Endpoint | Method | Validation | Priority |
|---|---|---|---|
| /api/v1/repos | GET | Array of Repository objects with required fields | P0 |
| /api/v1/repos/:id | GET | Single Repository with all fields | P0 |
| /api/v1/repos/:id/artifacts | GET | Array of AnalysisArtifact objects | P0 |
| /api/v1/repos/:id/questions | GET | Array of InterviewQuestion objects with citations | P0 |
| /api/v1/chat/sessions | POST | Returns ChatSession with id, created_at | P1 |
| /api/v1/chat/sessions/:id/messages | GET | Array of ChatMessage objects with pagination | P1 |
| /api/v1/mock-interviews | POST | Returns MockInterviewSession with id | P1 |
| /api/v1/usage/summary | GET | UsageSummary with limits and remaining counts | P1 |

### 8.2 Error Response Validation

| Scenario | Expected Status | Expected Body Shape | Priority |
|---|---|---|---|
| Not found | 404 | `{ error: { code, message, details } }` | P0 |
| Validation error | 400 | `{ error: { code, message, fieldErrors } }` | P0 |
| Unauthorized | 401 | `{ error: { code, message } }` | P0 |
| Forbidden | 403 | `{ error: { code, message } }` | P0 |
| Rate limited | 429 | `{ error: { code, message, retryAfter } }` | P1 |
| Server error | 500 | `{ error: { code, message } }` (no stack trace) | P0 |
| Conflict | 409 | `{ error: { code, message, conflictingResourceId } }` | P2 |

---

## 9. Regression Test Suite

### 9.1 Automated Regression Tests (Run on Every PR)

| Category | Tool | Tests | Execution Time |
|---|---|---|---|
| Unit tests (TS) | Vitest | ~500 tests | < 2 min |
| Unit tests (Rust) | cargo test | ~200 tests | < 1 min |
| Unit tests (Python) | pytest | ~300 tests | < 2 min |
| Integration tests | Testcontainers | ~100 tests | < 5 min |
| API contract tests | Supertest + Jest | ~150 tests | < 3 min |
| E2E critical path | Playwright | ~50 tests | < 10 min |
| Linting | ESLint + Clippy + Ruff | Full codebase | < 1 min |
| Type checking | tsc --noEmit | Full codebase | < 2 min |
| **Total** | | **~1,350 tests** | **< 25 min** |

### 9.2 Nightly Regression (Extended)

| Category | Additional Coverage | Execution Time |
|---|---|---|
| Full E2E suite | ~200 tests across all features | ~30 min |
| Performance benchmarks | Key metric regression checks | ~20 min |
| Security scans | Dependency audit + SAST | ~15 min |
| Visual regression | Screenshot comparison (Chromatic) | ~10 min |
| Accessibility audit | axe-core automated checks | ~10 min |
| **Total** | | **~85 min** |

---

## 10. Test Data Management

### 10.1 Reference Repositories

| Repository | Language | LOC | Purpose |
|---|---|---|---|
| `test-auth-service` | TypeScript | 2,500 | Auth flow testing |
| `test-ecommerce-api` | Python | 8,000 | Multi-module architecture |
| `test-microservices` | Go + TS | 25,000 | Polyglot, dependency graph |
| `test-frontend-app` | React/TS | 5,000 | Component/page detection |
| `test-cli-tool` | Rust | 3,000 | Non-Web project testing |

### 10.2 Edge Case Repositories

| Repository | Scenario | Why It Matters |
|---|---|---|
| `test-empty-repo` | Only README, no code | Graceful handling |
| `test-huge-repo` | 50K LOC monorepo | Performance limits |
| `test-binary-heavy` | 70% non-code files | Filtering accuracy |
| `test-circular-deps` | Circular import chains | Dependency graph correctness |
| `test-no-deps` | Zero external dependencies | Minimal analysis case |

---

## 11. Defect Management

### 11.1 Severity Definitions

| Severity | Definition | SLA |
|---|---|---|
| **S1 — Critical** | Data loss, security breach, complete service outage | Fix within 4 hours |
| **S2 — High** | Core feature broken, no workaround available | Fix within 24 hours |
| **S3 — Medium** | Feature degraded, workaround exists | Fix within 1 week |
| **S4 — Low** | Cosmetic issue, minor UX inconvenience | Fix in next sprint |

### 11.2 Bug Report Template

```markdown
## Bug Report

**Title:** [Brief description]
**Severity:** S1 / S2 / S3 / S4
**Environment:** Dev / Staging / Production
**Browser:** Chrome 120 / Firefox 121 / Safari 17

### Steps to Reproduce
1. ...
2. ...
3. ...

### Expected Result
What should happen.

### Actual Result
What actually happened.

### Screenshots / Videos
[Attach if applicable]

### Logs / Error Messages
[Attach relevant logs]

### Additional Context
- User plan tier: free / starter / pro
- Repository size: ~X LOC
- Analysis status: completed / in progress
```

---

## 12. Testing Schedule & Milestones

| Phase | Activities | Duration | Entry Criteria | Exit Criteria |
|---|---|---|---|---|
| **Sprint 0** | Test plan, environment setup, CI integration | 1 week | Requirements approved | Environments ready, CI passing |
| **Alpha** | Core flow testing (auth, analysis, chat) | 2 weeks | Core features implemented | All P0 tests passing |
| **Beta** | Full feature testing, integration, performance | 3 weeks | All features implemented | All P0+P1 tests passing, perf targets met |
| **RC** | Security audit, accessibility, UAT | 2 weeks | Beta complete | No open S1/S2, all gates passing |
| **GA** | Final regression, production smoke tests | 1 week | RC approved | Full regression green, monitoring active |

---

*This QA Test Plan should be reviewed and updated at the start of each sprint. Test cases should be automated wherever possible, with manual testing reserved for exploratory and usability scenarios.*
