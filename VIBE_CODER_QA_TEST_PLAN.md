# Vibe Coder QA Test Plan

## Comprehensive Testing Strategy for the Interview-Prep Platform

---

## 1. Test Plan Overview

### 1.1 Purpose

This test plan defines the comprehensive testing strategy for the Vibe Coder platform. It ensures that every feature — from GitHub repository connection through AI-powered interview preparation — works correctly, reliably, and securely before reaching users.

### 1.2 Scope

| In Scope | Out of Scope |
|---|---|
| Authentication & authorization | Third-party service internals (OpenAI, Pinecone) |
| Repository connection & analysis pipeline | Terraform infrastructure provisioning |
| AST parsing (all supported languages) | Marketing website |
| Hybrid retrieval engine | Mobile app (future) |
| LLM generation & citation grounding | Load testing (covered in evaluation framework) |
| Chat interface (REST + WebSocket) | Chaos engineering |
| Mock interview simulator | Penetration testing (covered in security audit) |
| Billing & subscription management | Internationalization / localization |
| Error handling & edge cases | Performance benchmarking (covered in evaluation framework) |

### 1.3 Test Levels

```
┌─────────────────────────────────────────────────────────────────┐
│                       TEST PYRAMID                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│                        ╱╲                                        │
│                       ╱  ╲     E2E Tests (10%)                  │
│                      ╱    ╲    Playwright / Cypress              │
│                     ╱──────╲   Full user workflows               │
│                    ╱        ╲                                     │
│                   ╱          ╲  Integration Tests (30%)          │
│                  ╱            ╲ Supertest / pytest               │
│                 ╱              ╲ API + DB + external services    │
│                ╱────────────────╲                                │
│               ╱                  ╲                               │
│              ╱    Unit Tests (60%)╲                              │
│             ╱                      ╲ Jest / vitest / cargo test  │
│            ╱                        ╲ Isolated function testing  │
│           ╱──────────────────────────╲                          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 1.4 Test Environment Matrix

| Environment | Purpose | Data | Services |
|---|---|---|---|
| **Local** | Developer testing | Synthetic test data | Docker Compose |
| **CI** | Automated test suite | Isolated per-test DB | GitHub Actions |
| **Staging** | Pre-production validation | Anonymized production subset | Full AWS stack |
| **Production** | Smoke tests & monitoring | Live data | Full AWS stack |

---

## 2. Test Case Inventory

### 2.1 Module Breakdown

| Module | Test Cases | Priority | Automation |
|---|---|---|---|
| Authentication | 42 | P0 | 100% |
| Repository Management | 38 | P0 | 100% |
| Analysis Pipeline | 56 | P0 | 95% |
| AST Parser | 64 | P0 | 100% |
| Retrieval Engine | 48 | P0 | 100% |
| Generation Service | 44 | P0 | 90% |
| Chat Interface | 36 | P1 | 100% |
| Mock Interview | 40 | P1 | 95% |
| Billing & Subscriptions | 28 | P1 | 100% |
| Admin & Analytics | 20 | P2 | 80% |
| **Total** | **416** | | **~96%** |

---

## 3. Authentication & Authorization

### 3.1 Unit Tests

```typescript
// tests/unit/auth/jwt.test.ts

describe('JWT Token Management', () => {
  describe('generateAccessToken', () => {
    it('should generate a valid JWT with correct claims', () => {
      const token = generateAccessToken({ userId: 'usr_123', plan: 'pro' });
      const decoded = jwt.verify(token, JWT_SECRET);
      expect(decoded.sub).toBe('usr_123');
      expect(decoded.plan).toBe('pro');
      expect(decoded.exp - decoded.iat).toBe(900); // 15 minutes
    });

    it('should include jti (token ID) for revocation tracking', () => {
      const token = generateAccessToken({ userId: 'usr_123' });
      const decoded = jwt.verify(token, JWT_SECRET);
      expect(decoded.jti).toBeDefined();
      expect(typeof decoded.jti).toBe('string');
    });

    it('should reject expired tokens', () => {
      const token = jwt.sign(
        { sub: 'usr_123', exp: Math.floor(Date.now() / 1000) - 100 },
        JWT_SECRET
      );
      expect(() => verifyAccessToken(token)).toThrow('TokenExpiredError');
    });

    it('should reject tokens signed with wrong secret', () => {
      const token = jwt.sign({ sub: 'usr_123' }, 'wrong-secret');
      expect(() => verifyAccessToken(token)).toThrow('JsonWebTokenError');
    });
  });

  describe('generateRefreshToken', () => {
    it('should generate a refresh token with 7-day expiry', () => {
      const token = generateRefreshToken('usr_123');
      const decoded = jwt.verify(token, REFRESH_SECRET);
      expect(decoded.exp - decoded.iat).toBe(604800); // 7 days
    });

    it('should include token family for rotation tracking', () => {
      const token = generateRefreshToken('usr_123');
      const decoded = jwt.verify(token, REFRESH_SECRET);
      expect(decoded.family).toBeDefined();
    });
  });

  describe('Password Hashing', () => {
    it('should hash password with bcrypt cost factor 12', async () => {
      const hash = await hashPassword('testpassword');
      expect(hash).toMatch(/^\$2b\$12\$/);
    });

    it('should verify correct password', async () => {
      const hash = await hashPassword('correct');
      expect(await verifyPassword('correct', hash)).toBe(true);
    });

    it('should reject incorrect password', async () => {
      const hash = await hashPassword('correct');
      expect(await verifyPassword('wrong', hash)).toBe(false);
    });

    it('should handle empty password gracefully', async () => {
      await expect(hashPassword('')).rejects.toThrow('Password cannot be empty');
    });
  });
});
```

### 3.2 Integration Tests

```typescript
// tests/integration/auth/github-oauth.test.ts

describe('GitHub OAuth Flow', () => {
  let app: Express;
  let db: PrismaClient;

  beforeAll(async () => {
    app = await createTestApp();
    db = await createTestDatabase();
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  describe('POST /auth/github/callback', () => {
    it('should create new user on first login', async () => {
      mockGitHubCodeExchange({ github_id: 99999, email: 'new@test.com' });

      const res = await request(app)
        .post('/v1/auth/github/callback')
        .send({ code: 'valid-code', state: 'valid-state' });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.data.user.email).toBe('new@test.com');
      expect(res.body.data.user.planTier).toBe('free');
      expect(res.body.data.isNewUser).toBe(true);
      expect(res.body.data.tokens.accessToken).toBeDefined();
      expect(res.body.data.subscription.reposRemaining).toBe(3);
    });

    it('should return existing user on subsequent login', async () => {
      await db.user.create({
        data: { github_id: 88888, email: 'existing@test.com', username: 'existing' }
      });
      mockGitHubCodeExchange({ github_id: 88888, email: 'existing@test.com' });

      const res = await request(app)
        .post('/v1/auth/github/callback')
        .send({ code: 'valid-code', state: 'valid-state' });

      expect(res.body.data.isNewUser).toBe(false);
    });

    it('should reject invalid OAuth code', async () => {
      mockGitHubCodeExchangeFails('bad_verification_code');

      const res = await request(app)
        .post('/v1/auth/github/callback')
        .send({ code: 'invalid-code', state: 'valid-state' });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should reject expired CSRF state', async () => {
      const res = await request(app)
        .post('/v1/auth/github/callback')
        .send({ code: 'valid-code', state: 'expired-state' });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('CSRF_VALIDATION_FAILED');
    });

    it('should return GitHub token encrypted in database', async () => {
      mockGitHubCodeExchange({ github_id: 77777, email: 'crypto@test.com' });

      await request(app)
        .post('/v1/auth/github/callback')
        .send({ code: 'valid-code', state: 'valid-state' });

      const user = await db.user.findUnique({ where: { github_id: 77777 } });
      // Token should be encrypted, not plaintext
      expect(user.github_token).not.toMatch(/^gho_/);
      expect(user.github_token).toMatch(/^enc:/);
    });
  });

  describe('POST /auth/refresh', () => {
    it('should issue new access token with valid refresh token', async () => {
      const refreshToken = generateRefreshToken('usr_123');

      const res = await request(app)
        .post('/v1/auth/refresh')
        .send({ refreshToken });

      expect(res.status).toBe(200);
      expect(res.body.data.accessToken).toBeDefined();
      expect(res.body.data.expiresIn).toBe(900);
    });

    it('should invalidate previous refresh token (rotation)', async () => {
      const refreshToken = generateRefreshToken('usr_123');

      // First refresh — should succeed
      await request(app)
        .post('/v1/auth/refresh')
        .send({ refreshToken });

      // Second refresh with same token — should fail (rotation)
      const res = await request(app)
        .post('/v1/auth/refresh')
        .send({ refreshToken });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('TOKEN_REUSE_DETECTED');
    });

    it('should detect token family reuse (potential theft)', async () => {
      const { token: token1, family } = generateRefreshTokenWithFamily('usr_123');

      // Rotate to get token2
      const res2 = await request(app)
        .post('/v1/auth/refresh')
        .send({ refreshToken: token1 });

      // Rotate to get token3
      await request(app)
        .post('/v1/auth/refresh')
        .send({ refreshToken: res2.body.data.refreshToken });

      // Try to use token1 again (replay attack)
      const res = await request(app)
        .post('/v1/auth/refresh')
        .send({ refreshToken: token1 });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('TOKEN_FAMILY_COMPROMISED');

      // Verify entire family is invalidated
      const res3 = await request(app)
        .post('/v1/auth/refresh')
        .send({ refreshToken: res2.body.data.refreshToken });

      expect(res3.status).toBe(401);
    });
  });
});
```

### 3.3 Authorization Tests

```typescript
// tests/integration/auth/authorization.test.ts

describe('Authorization', () => {
  const endpoints = [
    { method: 'GET', path: '/v1/users/me', auth: true },
    { method: 'POST', path: '/v1/repos/connect', auth: true },
    { method: 'GET', path: '/v1/repos', auth: true },
    { method: 'GET', path: '/v1/repos/:id', auth: true },
    { method: 'POST', path: '/v1/repos/:id/analyze', auth: true },
    { method: 'POST', path: '/v1/auth/refresh', auth: false },
  ];

  endpoints.forEach(({ method, path, auth }) => {
    it(`${method} ${path} should ${auth ? 'require' : 'not require'} authentication`, async () => {
      const res = await request(app)[method.toLowerCase()](path);
      if (auth) {
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe('UNAUTHORIZED');
      } else {
        expect(res.status).not.toBe(401);
      }
    });
  });

  it('should prevent user A from accessing user B repository', async () => {
    const userA = await createAuthenticatedUser('userA');
    const userB = await createAuthenticatedUser('userB');
    const repoB = await db.repository.create({
      data: { user_id: userB.id, full_name: 'userB/project', github_repo_id: 111 }
    });

    const res = await request(app)
      .get(`/v1/repos/${repoB.id}`)
      .set('Authorization', `Bearer ${userA.token}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('should enforce plan-based rate limits', async () => {
    const freeUser = await createAuthenticatedUser('free', { plan: 'free' });

    // Make requests up to the limit
    for (let i = 0; i < 30; i++) {
      await request(app)
        .get('/v1/repos')
        .set('Authorization', `Bearer ${freeUser.token}`);
    }

    // 31st request should be rate limited
    const res = await request(app)
      .get('/v1/repos')
      .set('Authorization', `Bearer ${freeUser.token}`);

    expect(res.status).toBe(429);
    expect(res.headers['x-ratelimit-remaining']).toBe('0');
    expect(res.body.error.code).toBe('RATE_LIMITED');
  });
});
```

---

## 4. Repository Management

### 4.1 Unit Tests

```typescript
// tests/unit/repos/repository.test.ts

describe('Repository Service', () => {
  describe('connectRepository', () => {
    it('should parse valid GitHub URL', () => {
      expect(parseGitHubUrl('https://github.com/user/repo')).toEqual({
        owner: 'user', repo: 'repo'
      });
    });

    it('should parse shorthand format', () => {
      expect(parseGitHubUrl('user/repo')).toEqual({
        owner: 'user', repo: 'repo'
      });
    });

    it('should reject invalid URLs', () => {
      expect(() => parseGitHubUrl('https://gitlab.com/user/repo')).toThrow('INVALID_GITHUB_URL');
      expect(() => parseGitHubUrl('not-a-url')).toThrow('INVALID_GITHUB_URL');
      expect(() => parseGitHubUrl('')).toThrow('INVALID_GITHUB_URL');
    });

    it('should enforce max repository size', async () => {
      mockGitHubRepoInfo({ size: 120_000 }); // 120MB

      await expect(
        connectRepository('user/large-repo', githubToken)
      ).rejects.toThrow('REPO_TOO_LARGE');
    });
  });

  describe('Analysis Configuration', () => {
    it('should apply default excluded paths', () => {
      const config = getDefaultAnalysisConfig();
      expect(config.excludedPaths).toContain('node_modules');
      expect(config.excludedPaths).toContain('.git');
      expect(config.excludedPaths).toContain('dist');
    });

    it('should merge user config with defaults', () => {
      const config = mergeAnalysisConfig(
        getDefaultAnalysisConfig(),
        { excludedPaths: ['custom-dir'], includeTests: true }
      );
      expect(config.excludedPaths).toContain('node_modules');
      expect(config.excludedPaths).toContain('custom-dir');
      expect(config.includeTests).toBe(true);
    });
  });
});
```

### 4.2 Integration Tests

```typescript
// tests/integration/repos/repository.test.ts

describe('Repository API', () => {
  describe('POST /repos/connect', () => {
    it('should connect a valid repository', async () => {
      mockGitHubRepo({
        full_name: 'test-user/portfolio-api',
        default_branch: 'main',
        language: 'TypeScript',
        size: 5000
      });

      const res = await request(app)
        .post('/v1/repos/connect')
        .set('Authorization', `Bearer ${token}`)
        .send({ fullName: 'test-user/portfolio-api' });

      expect(res.status).toBe(201);
      expect(res.body.data.fullName).toBe('test-user/portfolio-api');
      expect(res.body.data.languagePrimary).toBe('TypeScript');
      expect(res.body.data.analysisCount).toBe(0);
    });

    it('should reject duplicate connection', async () => {
      await connectRepo('test-user/portfolio-api');

      const res = await request(app)
        .post('/v1/repos/connect')
        .set('Authorization', `Bearer ${token}`)
        .send({ fullName: 'test-user/portfolio-api' });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('REPO_ALREADY_CONNECTED');
    });

    it('should enforce repository limit per plan', async () => {
      // Connect 3 repos (free tier limit)
      for (let i = 0; i < 3; i++) {
        await connectRepo(`user/repo-${i}`);
      }

      const res = await request(app)
        .post('/v1/repos/connect')
        .set('Authorization', `Bearer ${token}`)
        .send({ fullName: 'user/repo-4' });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('PLAN_LIMIT_EXCEEDED');
    });
  });

  describe('POST /repos/:repoId/analyze', () => {
    it('should queue analysis job', async () => {
      const repo = await connectRepo('user/analyzable-repo');

      const res = await request(app)
        .post(`/v1/repos/${repo.id}/analyze`)
        .set('Authorization', `Bearer ${token}`)
        .send({});

      expect(res.status).toBe(202);
      expect(res.body.data.status).toBe('queued');
      expect(res.body.data.jobId).toBeDefined();
    });

    it('should prevent concurrent analysis', async () => {
      const repo = await connectRepo('user/repo');
      await triggerAnalysis(repo.id); // Start first analysis

      const res = await request(app)
        .post(`/v1/repos/${repo.id}/analyze`)
        .set('Authorization', `Bearer ${token}`)
        .send({});

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ANALYSIS_IN_PROGRESS');
    });

    it('should respect plan analysis limits', async () => {
      const repo = await connectRepo('user/repo');
      // Use up free tier limit (1 analysis)
      await triggerAnalysis(repo.id);
      await waitForAnalysisCompletion();

      const res = await request(app)
        .post(`/v1/repos/${repo.id}/analyze`)
        .set('Authorization', `Bearer ${token}`)
        .send({});

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('QUOTA_EXCEEDED');
    });
  });

  describe('GET /repos/:repoId/status', () => {
    it('should report analysis progress', async () => {
      const repo = await connectRepo('user/repo');
      const job = await triggerAnalysis(repo.id);

      const res = await request(app)
        .get(`/v1/repos/${repo.id}/status`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(['queued', 'cloning', 'parsing', 'indexing', 'generating']).toContain(
        res.body.data.status
      );
      expect(res.body.data.progress).toBeDefined();
    });
  });
});
```

---

## 5. Analysis Pipeline

### 5.1 AST Parser Tests

```python
# tests/unit/ast_parser/test_parser.py

import pytest
from ast_parser import parse_file, SupportedLanguage

class TestTypeScriptParser:
    def test_extract_function_symbols(self):
        code = """
        export function authenticate(token: string): User {
          const decoded = jwt.verify(token, SECRET);
          return decoded as User;
        }
        """
        result = parse_file(code, SupportedLanguage.TYPESCRIPT)

        assert len(result.symbols) == 1
        assert result.symbols[0].name == "authenticate"
        assert result.symbols[0].symbol_type == "function"
        assert result.symbols[0].is_exported is True
        assert result.symbols[0].parameters[0].name == "token"
        assert result.symbols[0].parameters[0].type == "string"
        assert result.symbols[0].return_type == "User"

    def test_extract_class_symbols(self):
        code = """
        export class AuthService {
          private readonly jwtSecret: string;

          constructor(secret: string) {
            this.jwtSecret = secret;
          }

          async login(email: string, password: string): Promise<TokenPair> {
            // implementation
          }
        }
        """
        result = parse_file(code, SupportedLanguage.TYPESCRIPT)

        assert len(result.symbols) >= 1
        class_symbol = [s for s in result.symbols if s.symbol_type == "class"][0]
        assert class_symbol.name == "AuthService"
        assert class_symbol.visibility == "public"
        assert class_symbol.is_exported is True

    def test_extract_interface_symbols(self):
        code = """
        export interface User {
          id: string;
          email: string;
          plan: 'free' | 'pro';
        }
        """
        result = parse_file(code, SupportedLanguage.TYPESCRIPT)

        interface_symbol = result.symbols[0]
        assert interface_symbol.symbol_type == "interface"
        assert interface_symbol.name == "User"

    def test_detect_imports(self):
        code = """
        import { Router } from 'express';
        import jwt from 'jsonwebtoken';
        import type { User } from './types';
        """
        result = parse_file(code, SupportedLanguage.TYPESCRIPT)

        assert len(result.imports) == 3
        assert result.imports[0].source == "express"
        assert result.imports[1].is_default is True
        assert result.imports[2].is_type_only is True

    def test_calculate_cyclomatic_complexity(self):
        simple_code = "function add(a, b) { return a + b; }"
        complex_code = """
        function processUser(user) {
          if (!user) return null;
          if (user.plan === 'pro') {
            if (user.active) {
              return { ...user, features: ALL_FEATURES };
            } else {
              return { ...user, features: BASIC_FEATURES };
            }
          }
          return user;
        }
        """

        simple = parse_file(simple_code, SupportedLanguage.TYPESCRIPT)
        complex = parse_file(complex_code, SupportedLanguage.TYPESCRIPT)

        assert simple.complexity <= 1.0
        assert complex.complexity > 1.0

    def test_handle_empty_file(self):
        result = parse_file("", SupportedLanguage.TYPESCRIPT)
        assert len(result.symbols) == 0
        assert len(result.imports) == 0
        assert result.complexity == 0.0

    def test_handle_syntax_error_gracefully(self):
        broken_code = "function broken( { missing closing paren"
        result = parse_file(broken_code, SupportedLanguage.TYPESCRIPT)
        # Should not throw, should return partial results
        assert result.symbols == []
        assert hasattr(result, 'error')


class TestPythonParser:
    def test_extract_function_symbols(self):
        code = """
        def authenticate(token: str) -> User:
            decoded = jwt.verify(token, SECRET)
            return decoded
        """
        result = parse_file(code, SupportedLanguage.PYTHON)

        assert len(result.symbols) == 1
        assert result.symbols[0].name == "authenticate"
        assert result.symbols[0].symbol_type == "function"
        assert result.symbols[0].return_type == "User"

    def test_extract_class_with_decorators(self):
        code = """
        @dataclass
        class User:
            id: str
            email: str
        """
        result = parse_file(code, SupportedLanguage.PYTHON)

        class_symbol = result.symbols[0]
        assert class_symbol.symbol_type == "class"
        assert "dataclass" in class_symbol.annotations


class TestGoParser:
    def test_extract_function_symbols(self):
        code = """
        func Authenticate(token string) (*User, error) {
            decoded, err := jwt.Verify(token, secret)
            if err != nil {
                return nil, err
            }
            return decoded, nil
        }
        """
        result = parse_file(code, SupportedLanguage.GO)

        assert len(result.symbols) == 1
        assert result.symbols[0].name == "Authenticate"
        assert result.symbols[0].return_type == "(*User, error)"


class TestDesignPatternDetection:
    def test_detect_repository_pattern(self):
        code = """
        export class ProjectRepository {
          constructor(private prisma: PrismaClient) {}

          async findById(id: string): Promise<Project | null> {
            return this.prisma.project.findUnique({ where: { id } });
          }

          async create(data: CreateProjectInput): Promise<Project> {
            return this.prisma.project.create({ data });
          }
        }
        """
        result = parse_file(code, SupportedLanguage.TYPESCRIPT)

        patterns = [p for p in result.patterns if p.category == "architectural"]
        assert any(p.name == "Repository Pattern" for p in patterns)

    def test_detect_middleware_pattern(self):
        code = """
        export function authMiddleware(req, res, next) {
          const token = req.headers.authorization?.split(' ')[1];
          if (!token) return res.status(401).json({ error: 'No token' });
          try {
            req.user = jwt.verify(token, SECRET);
            next();
          } catch {
            res.status(401).json({ error: 'Invalid token' });
          }
        }
        """
        result = parse_file(code, SupportedLanguage.TYPESCRIPT)

        patterns = [p for p in result.patterns if p.category == "behavioral"]
        assert any(p.name == "Middleware Pattern" for p in patterns)
```

### 5.2 Module Decomposition Tests

```python
# tests/unit/module_decomposition/test_decomposer.py

class TestModuleDecomposition:
    def test_decompose_by_directory_structure(self, sample_repo):
        modules = decompose_modules(sample_repo)

        # Should identify auth module
        auth_modules = [m for m in modules if 'auth' in m.name.lower()]
        assert len(auth_modules) >= 1
        assert auth_modules[0].module_type in ('middleware', 'service')

    def test_decompose_by_import_graph(self, sample_repo):
        modules = decompose_modules(sample_repo)

        # Modules should have dependency edges
        assert len(modules) > 0
        for module in modules:
            assert hasattr(module, 'coupling_score')
            assert 0.0 <= module.coupling_score <= 1.0

    def test_classify_module_types(self, sample_repo):
        modules = decompose_modules(sample_repo)

        type_counts = {}
        for m in modules:
            type_counts[m.module_type] = type_counts.get(m.module_type, 0) + 1

        # Should have at least one service and one config
        assert type_counts.get('service', 0) >= 1
        assert type_counts.get('config', 0) >= 1

    def test_generate_purpose_summary(self, auth_module):
        summary = generate_purpose_summary(auth_module)

        assert len(summary) > 0
        assert len(summary) <= 200  # Concise
        assert 'auth' in summary.lower() or 'authentication' in summary.lower()
```

---

## 6. Retrieval Engine

### 6.1 Unit Tests

```python
# tests/unit/retrieval/test_hybrid_retrieval.py

class TestHybridRetriever:
    def test_dense_retrieval_returns_semantic_matches(self):
        retriever = HybridRetriever(dense_only=True)
        results = retriever.search(
            "How does authentication work?",
            repo_id="test-repo"
        )

        assert len(results) > 0
        assert results[0].dense_score > 0.5
        # Top results should be auth-related
        auth_files = ['auth', 'login', 'jwt', 'token', 'session']
        assert any(
            auth_keyword in results[0].file_path.lower()
            for auth_keyword in auth_files
        )

    def test_sparse_retrieval_returns_exact_matches(self):
        retriever = HybridRetriever(sparse_only=True)
        results = retriever.search(
            "JwtGuard middleware",
            repo_id="test-repo"
        )

        assert len(results) > 0
        # Should find the exact function/class name
        assert any('JwtGuard' in r.content for r in results[:5])

    def test_hybrid_outperforms_individual(self):
        dense_retriever = HybridRetriever(dense_only=True)
        sparse_retriever = HybridRetriever(sparse_only=True)
        hybrid_retriever = HybridRetriever(hybrid=True)

        queries = load_test_queries(category="security")
        dense_precision = evaluate_precision(dense_retriever, queries)
        sparse_precision = evaluate_precision(sparse_retriever, queries)
        hybrid_precision = evaluate_precision(hybrid_retriever, queries)

        assert hybrid_precision >= max(dense_precision, sparse_precision)

    def test_rrf_fusion_boosts_results_in_both_lists(self):
        retriever = HybridRetriever(hybrid=True)
        results = retriever.search("refresh token rotation", repo_id="test-repo")

        # Results that appear in both dense and sparse should rank higher
        for i, result in enumerate(results[:5]):
            if result.dense_score > 0 and result.sparse_score > 0:
                # Combined score should be higher than individual
                assert result.fused_score > max(result.dense_score, result.sparse_score)

    def test_reranker_improves_top_k_precision(self):
        retriever_no_rerank = HybridRetriever(hybrid=True, rerank=False)
        retriever_with_rerank = HybridRetriever(hybrid=True, rerank=True)

        queries = load_test_queries()
        precision_no_rerank = evaluate_precision_at_5(retriever_no_rerank, queries)
        precision_with_rerank = evaluate_precision_at_5(retriever_with_rerank, queries)

        assert precision_with_rerank >= precision_no_rerank

    def test_handles_empty_repository(self):
        retriever = HybridRetriever()
        results = retriever.search("anything", repo_id="empty-repo")
        assert results == []

    def test_handles_query_with_no_relevant_results(self):
        retriever = HybridRetriever()
        results = retriever.search(
            "quantum computing optimization",
            repo_id="portfolio-api"  # No quantum computing code
        )
        # Should return results but with low scores
        for result in results[:3]:
            assert result.fused_score < 0.3


class TestChunking:
    def test_ast_aware_chunking_respects_function_boundaries(self):
        code = """
        function auth() { /* 20 lines */ }
        function login() { /* 30 lines */ }
        function logout() { /* 10 lines */ }
        """
        chunks = ast_aware_chunk(code, "auth.ts", SupportedLanguage.TYPESCRIPT)

        # Each function should be its own chunk
        assert len(chunks) == 3
        assert chunks[0].chunk_type == "function"
        assert chunks[0].start_line > 0

    def test_chunk_token_count_within_limit(self):
        large_file = read_test_file("large-module.ts")
        chunks = chunk_file(large_file, "module.ts", max_tokens=1000)

        for chunk in chunks:
            assert chunk.token_count <= 1000

    def test_chunks_preserve_metadata(self):
        code = "export async function processPayment(amount: number): Promise<Result> {}"
        chunks = chunk_file(code, "payments.ts", SupportedLanguage.TYPESCRIPT)

        assert chunks[0].symbol_name == "processPayment"
        assert chunks[0].file_path == "payments.ts"
        assert chunks[0].chunk_type == "function"
```

### 6.2 Integration Tests

```python
# tests/integration/retrieval/test_retrieval_api.py

class TestRetrievalAPI:
    @pytest.mark.integration
    def test_retrieve_via_api(self, client, auth_headers, analyzed_repo):
        res = client.get(
            f"/v1/repos/{analyzed_repo.id}/retrieval/search",
            query_string={"q": "authentication middleware"},
            headers=auth_headers
        )

        assert res.status_code == 200
        assert len(res.json["data"]["results"]) > 0
        assert res.json["data"]["results"][0]["filePath"] is not None
        assert res.json["data"]["results"][0]["fusedScore"] > 0

    @pytest.mark.integration
    def test_retrieval_respects_repo_access_control(self, client, auth_headers):
        other_user_repo = create_repo_for_other_user()

        res = client.get(
            f"/v1/repos/{other_user_repo.id}/retrieval/search",
            query_string={"q": "anything"},
            headers=auth_headers
        )

        assert res.status_code == 403
```

---

## 7. Generation Service

### 7.1 Unit Tests

```python
# tests/unit/generation/test_answer_generator.py

class TestAnswerGenerator:
    def test_generates_answer_with_citations(self, mock_retrieval_results):
        generator = AnswerGenerator()
        answer = generator.generate(
            query="How does authentication work?",
            context=mock_retrieval_results,
            citation_required=True
        )

        assert len(answer.content) > 0
        assert len(answer.citations) > 0
        assert answer.citations[0].file_path is not None
        assert answer.citations[0].start_line > 0

    def test_citations_reference_existing_files(self, mock_retrieval_results):
        generator = AnswerGenerator()
        answer = generator.generate(
            query="How does authentication work?",
            context=mock_retrieval_results,
            citation_required=True
        )

        for citation in answer.citations:
            assert file_exists(citation.file_path), \
                f"Citation references non-existent file: {citation.file_path}"

    def test_answer_is_faithful_to_context(self, mock_retrieval_results):
        generator = AnswerGenerator()
        answer = generator.generate(
            query="How does authentication work?",
            context=mock_retrieval_results,
            citation_required=True
        )

        faithfulness = evaluate_faithfulness(answer.content, mock_retrieval_results)
        assert faithfulness >= 0.85

    def test_generates_structured_interview_answer(self, mock_retrieval_results):
        generator = AnswerGenerator()
        answer = generator.generate(
            query="How does authentication work?",
            context=mock_retrieval_results,
            format="interview_ready"
        )

        # Should have clear structure
        assert "##" in answer.content or "**" in answer.content  # Markdown formatting
        assert len(answer.content) >= 100  # Substantive answer

    def test_generates_concise_elevator_pitch(self, mock_retrieval_results):
        generator = AnswerGenerator()
        answer = generator.generate(
            query="Give me a 30-second summary of the auth system",
            context=mock_retrieval_results,
            format="concise"
        )

        # Should be short enough for 30-second delivery
        word_count = len(answer.content.split())
        assert word_count <= 100

    def test_handles_context_with_no_relevant_chunks(self):
        generator = AnswerGenerator()
        answer = generator.generate(
            query="How does the quantum entanglement module work?",
            context=[],
            citation_required=True
        )

        # Should indicate no relevant context found
        assert "no relevant" in answer.content.lower() or "not found" in answer.content.lower()
        assert len(answer.citations) == 0


class TestFollowUpGenerator:
    def test_generates_contextual_follow_ups(self, mock_answer):
        generator = FollowUpGenerator()
        follow_ups = generator.generate(mock_answer, context="mid")

        assert len(follow_ups) >= 2
        assert len(follow_ups) <= 5
        # Follow-ups should be questions
        assert all(q.endswith("?") for q in follow_ups)

    def test_follow_ups_target_weak_areas(self, weak_answer):
        generator = FollowUpGenerator()
        follow_ups = generator.generate(weak_answer, context="senior")

        # Should probe areas the answer didn't cover well
        assert any("why" in q.lower() or "trade" in q.lower() for q in follow_ups)
```

---

## 8. Chat Interface

### 8.1 Unit Tests

```typescript
// tests/unit/chat/chat-service.test.ts

describe('ChatService', () => {
  describe('sendMessage', () => {
    it('should create assistant message with citations', async () => {
      const response = await chatService.sendMessage({
        sessionId: 'chat_123',
        content: 'How does the auth middleware work?',
        userId: 'usr_123'
      });

      expect(response.role).toBe('assistant');
      expect(response.content.length).toBeGreaterThan(0);
      expect(response.citations.length).toBeGreaterThan(0);
      expect(response.modelUsed).toBeDefined();
    });

    it('should enforce daily message limit for free tier', async () => {
      // Set up user at limit
      for (let i = 0; i < 15; i++) {
        await chatService.sendMessage({
          sessionId: 'chat_123',
          content: `Message ${i}`,
          userId: 'usr_free'
        });
      }

      await expect(
        chatService.sendMessage({
          sessionId: 'chat_123',
          content: 'One more message',
          userId: 'usr_free'
        })
      ).rejects.toThrow('DAILY_LIMIT_EXCEEDED');
    });

    it('should track token usage per message', async () => {
      const response = await chatService.sendMessage({
        sessionId: 'chat_123',
        content: 'Explain the architecture',
        userId: 'usr_123'
      });

      expect(response.tokensUsed).toBeGreaterThan(0);
    });

    it('should maintain conversation context', async () => {
      await chatService.sendMessage({
        sessionId: 'chat_123',
        content: 'How does authentication work?',
        userId: 'usr_123'
      });

      const response = await chatService.sendMessage({
        sessionId: 'chat_123',
        content: 'What about token refresh?',
        userId: 'usr_123'
      });

      // Follow-up should reference previous context
      expect(response.content.toLowerCase()).toContain('refresh');
    });

    it('should handle streaming responses', async () => {
      const chunks: string[] = [];

      await chatService.sendMessageStream({
        sessionId: 'chat_123',
        content: 'Explain the architecture',
        userId: 'usr_123',
        onChunk: (chunk) => chunks.push(chunk)
      });

      expect(chunks.length).toBeGreaterThan(0);
      const fullResponse = chunks.join('');
      expect(fullResponse.length).toBeGreaterThan(0);
    });
  });
});
```

### 8.2 Integration Tests

```typescript
// tests/integration/chat/chat-api.test.ts

describe('Chat API', () => {
  describe('POST /repos/:repoId/chat/sessions', () => {
    it('should create a new chat session', async () => {
      const res = await request(app)
        .post(`/v1/repos/${repoId}/chat/sessions`)
        .set('Authorization', `Bearer ${token}`)
        .send({ mode: 'general', title: 'Auth questions' });

      expect(res.status).toBe(201);
      expect(res.body.data.id).toBeDefined();
      expect(res.body.data.mode).toBe('general');
      expect(res.body.data.messageCount).toBe(0);
    });

    it('should create mock interview session', async () => {
      const res = await request(app)
        .post(`/v1/repos/${repoId}/chat/sessions`)
        .set('Authorization', `Bearer ${token}`)
        .send({ mode: 'mock_interview' });

      expect(res.body.data.mode).toBe('mock_interview');
    });
  });

  describe('WebSocket Chat', () => {
    it('should stream response chunks', async () => {
      const socket = createAuthenticatedSocket(token);
      const chunks = [];

      socket.emit('chat:send', {
        sessionId: chatSessionId,
        content: 'How does authentication work?'
      });

      await new Promise((resolve) => {
        socket.on('chat:stream:chunk', (data) => {
          chunks.push(data.delta);
        });
        socket.on('chat:stream:end', () => resolve(undefined));
      });

      expect(chunks.length).toBeGreaterThan(0);
      const fullResponse = chunks.join('');
      expect(fullResponse.length).toBeGreaterThan(0);
    });

    it('should include citations in stream end event', async () => {
      const socket = createAuthenticatedSocket(token);
      let endData;

      socket.emit('chat:send', {
        sessionId: chatSessionId,
        content: 'How does authentication work?'
      });

      await new Promise((resolve) => {
        socket.on('chat:stream:end', (data) => {
          endData = data;
          resolve(undefined);
        });
      });

      expect(endData.totalTokens).toBeGreaterThan(0);
      expect(endData.modelUsed).toBeDefined();
    });

    it('should reject unauthenticated connections', async () => {
      const socket = io('ws://localhost:8080');

      await new Promise((resolve) => {
        socket.on('connect_error', (err) => {
          expect(err.message).toContain('Unauthorized');
          resolve(undefined);
        });
      });
    });
  });
});
```

---

## 9. Mock Interview Simulator

### 9.1 Unit Tests

```python
# tests/unit/mock_interview/test_interview_engine.py

class TestMockInterviewEngine:
    def test_generates_sequential_questions(self):
        engine = MockInterviewEngine(persona="rigorous_hiring_manager")
        session = engine.start_session(difficulty="mid", question_count=5)

        q1 = engine.get_next_question(session.id)
        assert q1.question_number == 1
        assert q1.category is not None

        q2 = engine.get_next_question(session.id)
        assert q2.question_number == 2
        assert q2.question_number > q1.question_number  # Progressive

    def test_evaluates_answer_with_scores(self):
        engine = MockInterviewEngine()
        session = engine.start_session(difficulty="mid")
        question = engine.get_next_question(session.id)

        evaluation = engine.evaluate_answer(
            session.id,
            question.id,
            "The auth middleware validates JWT tokens by extracting the Bearer token..."
        )

        assert 0 <= evaluation.score.overall <= 100
        assert 0 <= evaluation.score.clarity <= 100
        assert 0 <= evaluation.score.depth <= 100
        assert 0 <= evaluation.score.specificity <= 100
        assert len(evaluation.feedback) > 0

    def test_coaching_break_on_poor_answer(self):
        engine = MockInterviewEngine()
        session = engine.start_session(difficulty="senior")
        question = engine.get_next_question(session.id)

        # Submit very poor answer
        evaluation = engine.evaluate_answer(session.id, question.id, "I don't know")

        if evaluation.score.overall < 40:
            coaching = engine.get_coaching_break(session.id)
            assert coaching.note is not None
            assert len(coaching.relevant_code) > 0

    def test_generates_comprehensive_report(self):
        engine = MockInterviewEngine()
        session = engine.start_session(difficulty="mid", question_count=5)

        for _ in range(5):
            question = engine.get_next_question(session.id)
            engine.evaluate_answer(session.id, question.id, "Sample answer")

        report = engine.complete_session(session.id)

        assert report.overall_score > 0
        assert len(report.strengths) > 0
        assert len(report.weaknesses) > 0
        assert len(report.study_recommendations) > 0
        assert report.time_spent_sec > 0

    def test_persona_affects_question_style(self):
        friendly = MockInterviewEngine(persona="friendly_senior")
        strict = MockInterviewEngine(persona="rigorous_hiring_manager")

        q_friendly = friendly.get_next_question(friendly.start_session().id)
        q_strict = strict.get_next_question(strict.start_session().id)

        # Strict persona should have more adversarial questions
        # This is a heuristic check
        assert q_friendly.question_text != q_strict.question_text

    def test_difficulty_affects_question_complexity(self):
        easy_engine = MockInterviewEngine()
        hard_engine = MockInterviewEngine()

        easy_session = easy_engine.start_session(difficulty="junior")
        hard_session = hard_engine.start_session(difficulty="senior")

        q_easy = easy_engine.get_next_question(easy_session.id)
        q_hard = hard_engine.get_next_question(hard_session.id)

        # Senior questions should generally be longer/more complex
        # or cover more advanced topics
        assert q_easy.question_text != q_hard.question_text

    def test_session_timeout(self):
        engine = MockInterviewEngine(time_limit_minutes=1)
        session = engine.start_session(difficulty="mid", question_count=10)

        # Simulate time passing
        session.started_at = datetime.utcnow() - timedelta(minutes=2)

        with pytest.raises(SessionTimeoutError):
            engine.get_next_question(session.id)
```

---

## 10. Billing & Subscriptions

### 10.1 Unit Tests

```typescript
// tests/unit/billing/subscription.test.ts

describe('Subscription Service', () => {
  describe('checkQuota', () => {
    it('should allow usage within quota', async () => {
      const quota = await checkQuota('usr_123', 'chat_messages');

      expect(quota.allowed).toBe(true);
      expect(quota.remaining).toBeGreaterThan(0);
    });

    it('should block usage at quota limit', async () => {
      // Set up user at limit
      await setUserUsage('usr_free', 'chat_messages', 15);

      const quota = await checkQuota('usr_free', 'chat_messages');

      expect(quota.allowed).toBe(false);
      expect(quota.remaining).toBe(0);
      expect(quota.resetsAt).toBeDefined();
    });

    it('should reset quota on new billing period', async () => {
      await setUserUsage('usr_123', 'chat_messages', 500);
      await advanceToNextBillingPeriod('usr_123');

      const quota = await checkQuota('usr_123', 'chat_messages');

      expect(quota.allowed).toBe(true);
      expect(quota.remaining).toBe(500);
    });
  });

  describe('Stripe Webhook Handling', () => {
    it('should activate subscription on checkout.session.completed', async () => {
      const event = createStripeEvent('checkout.session.completed', {
        customer: 'cus_123',
        subscription: 'sub_123',
        metadata: { userId: 'usr_123', plan: 'pro' }
      });

      await handleStripeWebhook(event);

      const user = await getUser('usr_123');
      expect(user.planTier).toBe('pro');
    });

    it('should downgrade on subscription deleted', async () => {
      await setUserPlan('usr_123', 'pro');
      const event = createStripeEvent('customer.subscription.deleted', {
        id: 'sub_123',
        customer: 'cus_123'
      });

      await handleStripeWebhook(event);

      const user = await getUser('usr_123');
      expect(user.planTier).toBe('free');
    });

    it('should update quotas on subscription updated', async () => {
      const event = createStripeEvent('customer.subscription.updated', {
        id: 'sub_123',
        customer: 'cus_123',
        items: { data: [{ price: { id: 'price_pro_yearly' } }] }
      });

      await handleStripeWebhook(event);

      const sub = await getSubscription('usr_123');
      expect(sub.plan_tier).toBe('pro');
      expect(sub.billing_cycle).toBe('yearly');
    });

    it('should handle webhook signature verification', async () => {
      const invalidEvent = { type: 'checkout.session.completed', data: {} };

      await expect(
        handleStripeWebhook(invalidEvent, 'invalid-signature')
      ).rejects.toThrow('INVALID_WEBHOOK_SIGNATURE');
    });
  });
});
```

### 10.2 Integration Tests

```typescript
// tests/integration/billing/billing-api.test.ts

describe('Billing API', () => {
  describe('POST /billing/checkout', () => {
    it('should create Stripe checkout session', async () => {
      const res = await request(app)
        .post('/v1/billing/checkout')
        .set('Authorization', `Bearer ${token}`)
        .send({ plan: 'pro', billingCycle: 'monthly' });

      expect(res.status).toBe(200);
      expect(res.body.data.checkoutUrl).toContain('stripe.com');
      expect(res.body.data.sessionId).toBeDefined();
    });

    it('should reject invalid plan', async () => {
      const res = await request(app)
        .post('/v1/billing/checkout')
        .set('Authorization', `Bearer ${token}`)
        .send({ plan: 'enterprise' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /usage/summary', () => {
    it('should return current usage data', async () => {
      const res = await request(app)
        .get('/v1/usage/summary')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.usage.reposConnected).toBeDefined();
      expect(res.body.data.usage.chatMessages).toBeDefined();
      expect(res.body.data.usage.analysisJobs).toBeDefined();
    });
  });
});
```

---

## 11. E2E Tests

### 11.1 User Workflow Tests (Playwright)

```typescript
// tests/e2e/workflows/complete-interview-prep.spec.ts

import { test, expect } from '@playwright/test';

test.describe('Complete Interview Preparation Workflow', () => {
  test('should connect repo, analyze, and practice interview', async ({ page }) => {
    // Step 1: Login
    await page.goto('http://localhost:3000');
    await page.click('[data-testid="github-login"]');
    await page.waitForURL('**/dashboard');

    // Step 2: Connect repository
    await page.click('[data-testid="connect-repo"]');
    await page.fill('[data-testid="repo-url"]', 'test-user/portfolio-api');
    await page.click('[data-testid="connect-button"]');

    // Verify repo appears in list
    await expect(page.locator('[data-testid="repo-card"]'))
      .toContainText('portfolio-api');

    // Step 3: Trigger analysis
    await page.click('[data-testid="repo-card"]');
    await page.click('[data-testid="analyze-button"]');

    // Wait for analysis to complete
    await expect(page.locator('[data-testid="analysis-status"]'))
      .toContainText('completed', { timeout: 120000 });

    // Step 4: View architecture overview
    await page.click('[data-testid="architecture-tab"]');
    await expect(page.locator('[data-testid="architecture-content"]'))
      .not.toBeEmpty();

    // Step 5: Browse questions
    await page.click('[data-testid="questions-tab"]');
    await expect(page.locator('[data-testid="question-list"]'))
      .not.toBeEmpty();

    // Step 6: Start chat
    await page.click('[data-testid="chat-tab"]');
    await page.fill('[data-testid="chat-input"]', 'How does authentication work?');
    await page.click('[data-testid="send-button"]');

    // Wait for response
    await expect(page.locator('[data-testid="assistant-message"]').last())
      .not.toBeEmpty({ timeout: 30000 });

    // Verify citations are present
    await expect(page.locator('[data-testid="citation"]').first())
      .toBeVisible();

    // Step 7: Start mock interview
    await page.click('[data-testid="mock-interview-tab"]');
    await page.selectOption('[data-testid="persona-select"]', 'rigorous_hiring_manager');
    await page.selectOption('[data-testid="difficulty-select"]', 'mid');
    await page.click('[data-testid="start-interview"]');

    // Answer first question
    await expect(page.locator('[data-testid="interview-question"]'))
      .not.toBeEmpty();
    await page.fill('[data-testid="interview-answer"]',
      'The project uses a layered architecture with Express middleware...');
    await page.click('[data-testid="submit-answer"]');

    // Verify scoring
    await expect(page.locator('[data-testid="answer-score"]'))
      .toBeVisible();

    // Complete interview
    await page.click('[data-testid="complete-interview"]');

    // Verify report
    await expect(page.locator('[data-testid="interview-report"]'))
      .toBeVisible();
    await expect(page.locator('[data-testid="strengths-list"]'))
      .not.toBeEmpty();
    await expect(page.locator('[data-testid="study-recommendations"]'))
      .not.toBeEmpty();
  });
});
```

### 11.2 Cross-Browser Tests

```typescript
// tests/e2e/cross-browser/basic-functionality.spec.ts

import { test, expect } from '@playwright/test';

const browsers = ['chromium', 'firefox', 'webkit'];

test.describe('Cross-Browser Compatibility', () => {
  browsers.forEach((browserName) => {
    test(`basic functionality works in ${browserName}`, async ({ page }) => {
      await page.goto('http://localhost:3000');

      // Login page renders
      await expect(page.locator('[data-testid="github-login"]')).toBeVisible();

      // After login, dashboard renders
      await login(page);
      await expect(page.locator('[data-testid="dashboard"]')).toBeVisible();

      // Navigation works
      await page.click('[data-testid="nav-repos"]');
      await expect(page.locator('[data-testid="repos-page"]')).toBeVisible();
    });
  });
});
```

---

## 12. Security Tests

```python
# tests/security/test_security.py

class TestSecurity:
    def test_sql_injection_prevention(self, client):
        malicious_inputs = [
            "'; DROP TABLE users; --",
            "1' OR '1'='1",
            "admin'--",
            "1; DELETE FROM repositories WHERE 1=1",
        ]

        for payload in malicious_inputs:
            res = client.get(
                f"/v1/repos/{payload}",
                headers={"Authorization": f"Bearer {valid_token}"}
            )
            # Should return 400 or 404, not 500
            assert res.status_code in (400, 404)

    def test_xss_prevention(self, client, auth_headers):
        xss_payloads = [
            "<script>alert('xss')</script>",
            "<img src=x onerror=alert(1)>",
            "javascript:alert(1)",
        ]

        for payload in xss_payloads:
            res = client.post(
                "/v1/chat/sessions",
                json={"title": payload, "mode": "general"},
                headers=auth_headers
            )
            if res.status_code == 201:
                # Verify the payload is escaped in the response
                assert "<script>" not in res.json["data"]["title"]
                assert "javascript:" not in res.json["data"]["title"]

    def test_cors_headers(self, client):
        res = client.options(
            "/v1/repos",
            headers={
                "Origin": "https://vibecoder.com",
                "Access-Control-Request-Method": "GET"
            }
        )
        assert res.headers.get("Access-Control-Allow-Origin") == "https://vibecoder.com"

        # Should block unauthorized origins
        res = client.options(
            "/v1/repos",
            headers={
                "Origin": "https://evil.com",
                "Access-Control-Request-Method": "GET"
            }
        )
        assert "evil.com" not in res.headers.get("Access-Control-Allow-Origin", "")

    def test_rate_limiting_headers(self, client, auth_headers):
        res = client.get("/v1/repos", headers=auth_headers)

        assert "X-RateLimit-Limit" in res.headers
        assert "X-RateLimit-Remaining" in res.headers
        assert "X-RateLimit-Reset" in res.headers

    def test_github_token_not_exposed_in_responses(self, client, auth_headers):
        res = client.get("/v1/users/me", headers=auth_headers)

        response_text = str(res.json)
        assert "gho_" not in response_text  # GitHub OAuth token prefix
        assert "github_token" not in response_text

    def test_refresh_token_not_in_url(self, client):
        # Refresh token should only be in request body, never in URL
        res = client.get("/v1/auth/refresh?token=some_token")
        assert res.status_code == 405  # Method not allowed

    def test_content_security_policy(self, client):
        res = client.get("/")
        csp = res.headers.get("Content-Security-Policy", "")

        assert "default-src 'self'" in csp
        assert "script-src 'self'" in csp
        assert "unsafe-inline" not in csp

    def test_sensitive_data_not_in_logs(self, caplog):
        with caplog.at_level(logging.INFO):
            process_login(email="user@test.com", password="secretsauce123")

        for record in caplog.records:
            assert "secretsauce123" not in record.message
            assert "password" not in record.message.lower() or "hashed" in record.message.lower()

    def test_concurrent_session_limit(self, client):
        # Create multiple sessions for the same user
        sessions = []
        for i in range(5):
            res = client.post(
                "/v1/repos/test-repo/chat/sessions",
                json={"mode": "general"},
                headers={"Authorization": f"Bearer {token}"}
            )
            sessions.append(res.json["data"]["id"])

        # Should allow up to a reasonable limit
        assert len(sessions) == 5

        # Excessive sessions should be handled gracefully
        for i in range(10):
            res = client.post(
                "/v1/repos/test-repo/chat/sessions",
                json={"mode": "general"},
                headers={"Authorization": f"Bearer {token}"}
            )
            # Should either succeed or return 429, not 500
            assert res.status_code in (201, 429)
```

---

## 13. Error Handling Tests

```typescript
// tests/integration/error-handling.test.ts

describe('Error Handling', () => {
  it('should return structured error for invalid JSON', async () => {
    const res = await request(app)
      .post('/v1/repos/connect')
      .set('Content-Type', 'application/json')
      .set('Authorization', `Bearer ${token}`)
      .send('{"invalid json');

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });

  it('should handle missing required fields', async () => {
    const res = await request(app)
      .post('/v1/repos/connect')
      .set('Authorization', `Bearer ${token}`)
      .send({}); // Missing fullName

    expect(res.status).toBe(400);
    expect(res.body.error.details).toBeDefined();
    expect(res.body.error.details[0].field).toBe('fullName');
  });

  it('should handle invalid UUID parameters', async () => {
    const res = await request(app)
      .get('/v1/repos/not-a-uuid')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('should handle database connection failure gracefully', async () => {
    // Temporarily break database connection
    await breakDatabaseConnection();

    const res = await request(app)
      .get('/v1/repos')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('SERVICE_UNAVAILABLE');
    expect(res.body.error.message).not.toContain('connection string');

    await restoreDatabaseConnection();
  });

  it('should handle OpenAI API failure gracefully', async () => {
    mockOpenAIFailure('rate_limit_exceeded');

    const res = await request(app)
      .post(`/v1/repos/${repoId}/chat/sessions`)
      .set('Authorization', `Bearer ${token}`)
      .send({ mode: 'general' });

    // Should create session but indicate service degradation
    expect(res.status).toBe(201);
    // Next chat message should return meaningful error
    const chatRes = await request(app)
      .post(`/v1/chat/sessions/${res.body.data.id}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ content: 'Hello' });

    expect(chatRes.status).toBe(503);
    expect(chatRes.body.error.message).toContain('temporarily unavailable');
  });

  it('should include request ID in all responses', async () => {
    const res = await request(app)
      .get('/v1/repos')
      .set('Authorization', `Bearer ${token}`);

    expect(res.body.meta.requestId).toBeDefined();
    expect(res.body.meta.requestId).toMatch(/^req_/);
  });

  it('should not leak stack traces in production', async () => {
    process.env.NODE_ENV = 'production';

    const res = await request(app)
      .get('/v1/repos/invalid-id')
      .set('Authorization', `Bearer ${token}`);

    expect(res.body.error.stack).toBeUndefined();
    expect(res.body.error.trace).toBeUndefined();

    process.env.NODE_ENV = 'test';
  });
});
```

---

## 14. Test Data Management

### 14.1 Fixtures

```typescript
// tests/fixtures/index.ts

export const fixtures = {
  users: {
    free: {
      id: 'usr_test_free',
      github_id: 100001,
      email: 'free@test.com',
      username: 'free-user',
      plan_tier: 'free',
    },
    pro: {
      id: 'usr_test_pro',
      github_id: 100002,
      email: 'pro@test.com',
      username: 'pro-user',
      plan_tier: 'pro',
    },
    institutional: {
      id: 'usr_test_inst',
      github_id: 100003,
      email: 'inst@test.com',
      username: 'inst-user',
      plan_tier: 'institutional',
    },
  },

  repositories: {
    small: {
      id: 'repo_test_small',
      full_name: 'test-user/small-project',
      language_primary: 'TypeScript',
      total_files: 15,
      total_lines: 800,
    },
    medium: {
      id: 'repo_test_medium',
      full_name: 'test-user/portfolio-api',
      language_primary: 'TypeScript',
      total_files: 342,
      total_lines: 28400,
    },
    large: {
      id: 'repo_test_large',
      full_name: 'test-user/microservices',
      language_primary: 'Go',
      total_files: 1200,
      total_lines: 95000,
    },
  },

  analysisJobs: {
    completed: {
      id: 'job_test_completed',
      status: 'completed',
      stats: {
        filesParsed: 318,
        symbolsExtracted: 1847,
        chunksCreated: 4521,
        embeddingsGenerated: 4521,
      },
    },
    inProgress: {
      id: 'job_test_progress',
      status: 'parsing',
    },
    failed: {
      id: 'job_test_failed',
      status: 'failed',
      error_message: 'UNSUPPORTED_LANGUAGE',
    },
  },

  chatSessions: {
    general: {
      id: 'chat_test_general',
      mode: 'general',
    },
    mockInterview: {
      id: 'chat_test_mock',
      mode: 'mock_interview',
    },
  },
};
```

### 14.2 Test Helpers

```typescript
// tests/helpers/index.ts

export async function createTestUser(overrides?: Partial<User>): Promise<TestUser> {
  const userData = { ...fixtures.users.free, ...overrides };
  const user = await db.user.create({ data: userData });
  const token = generateAccessToken({ userId: user.id, plan: user.plan_tier });
  return { ...user, token };
}

export async function createTestRepo(userId: string, overrides?: Partial<Repository>): Promise<Repository> {
  const repoData = { ...fixtures.repositories.medium, user_id: userId, ...overrides };
  return db.repository.create({ data: repoData });
}

export async function createAnalyzedRepo(userId: string): Promise<{ repo: Repository; job: AnalysisJob }> {
  const repo = await createTestRepo(userId);
  const job = await db.analysisJob.create({
    data: {
      repo_id: repo.id,
      status: 'completed',
      stats: fixtures.analysisJobs.completed.stats,
    }
  });
  return { repo, job };
}

export async function waitForAnalysisCompletion(jobId: string, timeout = 30000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const job = await db.analysisJob.findUnique({ where: { id: jobId } });
    if (job.status === 'completed' || job.status === 'failed') return;
    await sleep(500);
  }
  throw new Error(`Analysis job ${jobId} did not complete within ${timeout}ms`);
}
```

---

## 15. Test Execution & Reporting

### 15.1 Run Commands

```bash
# Unit tests (all)
pnpm test:unit

# Unit tests (specific module)
pnpm test:unit -- --testPathPattern=auth

# Integration tests
pnpm test:integration

# Python unit tests
cd packages/retrieval && pytest tests/unit/ -v
cd packages/ast-parser && cargo test

# E2E tests
pnpm test:e2e

# Security tests
pnpm test:security

# Full suite with coverage
pnpm test:coverage

# Watch mode for development
pnpm test:watch
```

### 15.2 Coverage Targets

| Module | Line Coverage | Branch Coverage | Function Coverage |
|---|---|---|---|
| Authentication | ≥ 95% | ≥ 90% | ≥ 95% |
| Repository Management | ≥ 90% | ≥ 85% | ≥ 90% |
| Analysis Pipeline | ≥ 85% | ≥ 80% | ≥ 85% |
| Retrieval Engine | ≥ 90% | ≥ 85% | ≥ 90% |
| Generation Service | ≥ 80% | ≥ 75% | ≥ 80% |
| Chat Interface | ≥ 85% | ≥ 80% | ≥ 85% |
| Mock Interview | ≥ 80% | ≥ 75% | ≥ 80% |
| Billing | ≥ 90% | ≥ 85% | ≥ 90% |
| **Overall** | **≥ 88%** | **≥ 83%** | **≥ 88%** |

### 15.3 CI Integration

```yaml
# .github/workflows/test.yml
name: Test Suite

on: [push, pull_request]

jobs:
  test-unit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v4
      - run: pnpm install --frozen-lockfile
      - run: pnpm test:unit -- --coverage
      - uses: codecov/codecov-action@v3

  test-integration:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_DB: vibecoder_test
          POSTGRES_USER: vibecoder
          POSTGRES_PASSWORD: test
        ports: ["5432:5432"]
      redis:
        image: redis:7-alpine
        ports: ["6379:6379"]
    steps:
      - uses: actions/checkout@v4
      - run: pnpm install --frozen-lockfile
      - run: pnpm test:integration
        env:
          DATABASE_URL: postgresql://vibecoder:test@localhost:5432/vibecoder_test
          REDIS_URL: redis://localhost:6379

  test-e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: pnpm install --frozen-lockfile
      - run: docker compose up -d
      - run: npx playwright install
      - run: pnpm test:e2e
      - uses: actions/upload-artifact@v3
        if: failure()
        with:
          name: playwright-report
          path: test-results/
```

---

*This test plan ensures comprehensive coverage across all Vibe Coder features. Update test cases as new features are added and after every incident to prevent regression.*
