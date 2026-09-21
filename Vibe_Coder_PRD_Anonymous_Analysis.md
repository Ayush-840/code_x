# Vibe Coder — Product Requirements Document
## Anonymous Repo Analysis + Deployment Understanding

Repo analyzed: `github.com/Ayush-840/code_x` • commit `d469830` • September 2026

---

## 1. Purpose of This Document

Right now, a visitor must complete GitHub OAuth before they can analyze anything — confirmed in code, `requireAuth` gates the entire `/v1/repos` route group, and even the connect step requires the visitor's own GitHub access token. This is real friction on a product whose whole pitch is "paste a repo, see the magic" — and it doesn't match how comparable tools (DeepWiki and others, per the original market research) let people try before they commit to anything.

This PRD defines an anonymous, no-login analysis path for public repos, plus two content improvements that were requested alongside it: a guided reading order through a codebase (not just a flat file list), and a dedicated "how and where does this actually deploy" section — grounded in whatever deployment config already exists in the repo, the same kind of analysis done manually on `code_x` itself throughout this review process.

## 2. Current State

- `POST /v1/repos/connect` and `POST /v1/repos/:repoId/analyze` both require a logged-in user and that user's own GitHub `accessToken` in the request body.
- The `Repository` table requires a non-null `userId` and is uniquely keyed on `(userId, fullName)` — there's no concept of an ownerless or anonymous analysis in the schema today.
- The worker's clone step always embeds `accessToken` into the git clone URL — there's no token-optional path for public repos.
- An `express-rate-limit`-based `planRateLimit` middleware already exists in the codebase but isn't wired into any route yet.
- The `Artifact` table already stores generation output as `{ artifactType: string, content: Json }` — a free-form, already-extensible slot that a new "deployment" artifact type can use without a schema change.

## 3. Goals

- A visitor with no account can paste a public GitHub repo URL and get a full analysis: architecture, module explanations, and interview questions — the same pipeline that already exists, just without a login wall in front of it.
- The codebase-understanding output includes a suggested reading order, not just a flat list of files.
- The codebase-understanding output includes a "Deployment & Infrastructure" summary, generated from whatever deployment config actually exists in the repo.
- Signing in remains valuable and is nudged, but for a real reason (private repos, saved history, unlimited chat) — not as a precondition to try the product at all.

## 4. Non-Goals

- Private repo analysis without login — that still correctly requires the user's own GitHub token.
- Removing authentication from account-scoped features (saved repos, billing, usage).
- A full account-less "claim later" migration system in this phase — a simple version is worth including (Section 5.3), but a robust merge-history feature is future work.

## 5. Requirements

### 5.1 P0 — Anonymous Analyze Path

| ID | Requirement | Why it's P0 |
|---|---|---|
| PRD-A01 | A visitor can submit a public repo URL and receive a full analysis without authenticating. | This is the core ask — everything else in this document supports it. |
| PRD-A02 | Anonymous requests must be rate-limited by IP, since there's no user identity to limit by. | Without this, the analysis pipeline (LLM calls, embeddings) is an open door to unbounded cost from a single visitor. |
| PRD-A03 | Anonymous analysis must be restricted to public repos, with a clear error (not a silent failure) if a private repo URL is submitted. | Prevents a confusing dead-end where someone pastes a private repo and gets an opaque error instead of "sign in to analyze private repos." |

### 5.2 P1 — Content Improvements

| ID | Requirement | Why it matters |
|---|---|---|
| PRD-A04 | The Modules view must present files in a suggested reading order (entry points → core modules → utilities), not just a flat or alphabetical list. | This is the actual "roadmap" ask — a visitor shouldn't have to guess where to start in an unfamiliar codebase. |
| PRD-A05 | Every analysis must include a "Deployment & Infrastructure" section, generated from whatever deployment config files are actually present (Dockerfiles, `docker-compose.yml`, `vercel.json`, `render.yaml`, Railway config, CI workflows, etc.), or an explicit "no deployment config found" state if none exist. | This is the second half of the original ask — understanding not just what the code does, but how and where it runs. |

### 5.3 P2 — Conversion Path (lightweight)

| ID | Requirement | Why it matters |
|---|---|---|
| PRD-A06 | A signed-out visitor who just ran an anonymous analysis can sign in afterward and have that specific analysis attached to their account, instead of losing it. | Removes the single biggest reason someone would avoid trying the anonymous flow in the first place — "if I like this, can I keep it." |

## 6. Success Metrics

- Time from landing on the site to seeing a real analysis result drops to zero required auth steps for a public repo.
- Anonymous analyses stay within whatever per-IP rate limit is set, with no incident of runaway cost from a single visitor.
- The Modules tab visibly starts from an entry point (e.g. `index.ts`, `main.py`) rather than alphabetical order, for a repo where that distinction is meaningful.
- A repo with a Dockerfile/CI config produces a populated Deployment section; a repo with none produces an honest "not found" state rather than a hallucinated guess.

## 7. Risks & Open Questions

- **Cost exposure**: anonymous usage has no billing backstop. The per-IP rate limit (PRD-A02) is the first line of defense; a hard cap on repo size/file count for the anonymous tier is a reasonable second line and should be decided alongside the rate limit value, not after launch.
- **GitHub's unauthenticated rate limit** (60 requests/hour per IP) applies to the anonymous path's own GitHub API calls (fetching repo metadata, listing files) — separate from your own app-level rate limiting, and worth surfacing a clear "try again in a few minutes" error for, rather than a generic 500.
- **Abuse via scripted repeat requests**: IP-based limiting helps but isn't bulletproof (VPNs, rotating IPs). Not worth over-engineering for a first version — a basic per-IP limit plus a repo-size cap covers the realistic case; add a CAPTCHA or similar only if abuse actually shows up in practice.
- The Deployment section (PRD-A05) should explicitly avoid guessing when config is genuinely absent or ambiguous — an incorrect "this deploys to AWS" claim is worse than saying nothing, given the product's whole value proposition rests on accuracy.
