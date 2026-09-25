# Vibe Coder — Product Requirements Document
## Integrate CodeGraph as a Real Feature

Repo analyzed: `github.com/Ayush-840/code_x` • commit `091149b` • September 2026
Reference docs: `codebase-graph-prd-trd.md`, `-upd.md`, `-v3-prd-trd.md` (uploaded)

---

## 1. Purpose of This Document

Three CodeGraph spec docs were provided, the most recent of which (`v3`) assumes v0–v2 are fully built and shifts focus to validation and multi-language extension. **That assumption doesn't match what's in `code_x`.** This PRD corrects the picture using what was actually found in `packages/codegraph-api`, `packages/codegraph-parser`, and `apps/codegraph-web`, and defines what "integrate this as a real feature" actually requires from here.

## 2. Current State (Verified Against Code, Not Assumed)

| Piece | v0 spec says | What's actually there |
|---|---|---|
| Parser (§2.1) | tree-sitter, nodes/edges/imports/calls | ✅ Done, and well — correct byte-offset handling, gitignore respect, import/call resolution, dangling-edge pruning. Has real regression tests pinning 3 historical bug classes. |
| Graph store (§2.2) | `networkx.DiGraph`, `get_neighbors`, `get_subgraph_for_query` | ✅ Done — matches spec closely, keyword-scored seeding + 2-hop expansion. |
| Backend endpoints (§2.3) | `/parse`, `/graph`, `/node/{id}/explain`, `/chat` | ✅ All exist and are wired to the parser/graph store correctly. |
| **AI layer (§2.4)** — called *"the actual novelty"* in your own doc | LLM-generated explanations, graph-grounded chat, cited nodes, NIM-hosted inference | ❌ **Does not exist.** `_generate_explanation` and `_generate_chat_answer` in `main.py` are template-string formatters — no LLM call anywhere in this service. `httpx` is a declared dependency and never used for this. |
| Frontend (§2.5) | React, force-graph viz, click-to-explain, chat panel | ✅ Exists — `react-force-graph-2d` (matching the spec's own recommendation), Toolbar/SidePanel/ChatPanel components. But it's a **separate Next.js app** (`apps/codegraph-web`, port 3001), not part of `code_x`'s actual product (`apps/web`, port 3000). |
| Deployment (§6) | local app + NVIDIA-hosted NIM | Not deployed anywhere in `code_x`'s stack — absent from `docker-compose.yml`, `Dockerfile.python-all`, and every Railway config file checked. |
| v3's "Track A" (fixture, tests, eval harness) | Assumed already needed, just needs writing | Correctly identified as missing — this part of the v3 doc's plan is still valid, just needs to come *after* the AI layer exists, not instead of it. |
| Mode 3 (agentic) / Mode 4 (living docs) | v1/v2 roadmap items | Not started — no `agent.py`, no guardrail code, no doc generator. |

**Bottom line**: the hard, valuable infrastructure (parsing a real codebase into a correct, queryable graph) is genuinely done. The thing that makes it an *AI* tool is not built yet, and the thing that makes it *your* product's feature rather than a side project is not built yet either.

## 3. The Real Decision This PRD Has to Make: Standalone Tool or Integrated Feature?

The three uploaded docs describe CodeGraph as its own local, single-user tool (§4 "target user: you, first"; §6 "no auth, multi-tenancy, or hosted SaaS"). But it's sitting inside `code_x`, a product that already has auth, an anonymous flow, a job queue, a database, and a deployed frontend — all things a standalone CodeGraph would otherwise have to build for itself.

**Recommendation: integrate it as a new tab on the existing repo analysis page, not a separate tool.** Concretely: when someone analyzes a repo in `code_x` (anonymous or logged in), a "Code Graph" tab becomes available alongside Architecture/Modules/Chat, backed by this parser running against the same cloned repo the rest of the pipeline already fetched. This reuses `code_x`'s existing `repoId`/`publicAnalysisId`, auth, and rate-limiting instead of reinventing all of it, and it's a far stronger product story — "every analysis includes a real dependency graph" beats "here's a separate tool you have to also learn."

This is a product decision with real technical consequences (Section 5 of the TRD), so it's called out explicitly here rather than assumed.

## 4. Goals

- CodeGraph's `/explain` and `/chat` actually use an LLM, grounded in real graph structure — the thing the spec docs identify as the entire point.
- CodeGraph becomes reachable from `code_x`'s real product, for a repo someone has already analyzed — not a separate app on a different port that nobody finds.
- The validation work from the v3 doc (sample repo, tests, eval harness) happens once there's something real to validate.

## 5. Non-Goals (For Now)

- Mode 3 (agentic modification) and Mode 4 (living docs) — both explicitly deferred in the original docs, and doubly so until the integrated v0 experience is solid.
- Multi-language support — same reasoning; Python-only until the integrated Python path is proven.
- Embeddings-based retrieval — the v3 doc is right that this should be evidence-driven (Section 7 requirement below), not built preemptively.

## 6. Requirements

### 6.1 P0 — Make It Actually AI-Powered

| ID | Requirement | Why it's P0 |
|---|---|---|
| PRD-G01 | `/explain` and `/chat` must generate real LLM output grounded in the retrieved graph nodes, with cited node IDs extracted programmatically — matching §2.4's injection/generation design in the original spec. | Without this, "CodeGraph" is a graph viewer with a search box, not the AI tool the spec describes. This is the single highest-value fix here. |
| PRD-G02 | Model calls must go through the same provider/key-rotation infrastructure `packages/generation` already built (`shared_python`'s `KeyRotator`), not a new one-off integration. | You already solved "reliable, rotated, provider-flexible LLM calls" once — reusing it is strictly better than a second, divergent implementation. |

### 6.2 P0 — Make It Findable

| ID | Requirement | Why it's P0 |
|---|---|---|
| PRD-G03 | A "Code Graph" tab appears on the existing repo analysis page (both anonymous and authenticated flows), backed by the already-cloned repo. | Per Section 3 — this is what turns CodeGraph from a side project into a `code_x` feature. |
| PRD-G04 | The codegraph service is deployed alongside the other four Python services (analysis/retrieval/generation/mock-interview), reachable internally the same way they are. | It currently doesn't exist anywhere in the deployment story at all — this is a prerequisite for PRD-G03, not optional polish. |

### 6.3 P1 — Validate What's Now Real (adopting the v3 doc's Track A, correctly sequenced)

| ID | Requirement | Why it matters |
|---|---|---|
| PRD-G05 | A committed sample repo fixture with deliberate structure (cross-file imports, a multi-hop call chain, a name collision) exists for parser + retrieval testing. | Exactly as the v3 doc specified — this part of that plan was correct, just prematurely sequenced before the AI layer existed. |
| PRD-G06 | A small hand-written eval set (10–15 questions with expected cited nodes) produces a measured retrieval accuracy number. | This is the actual evidence needed to decide if embeddings-based retrieval (deferred, Non-Goals) is ever worth building — a real number, not a guess. |

### 6.4 P2 — Deferred, Tracked Not Forgotten

| ID | Requirement |
|---|---|
| PRD-G07 | Mode 3 (agentic modification) — only after PRD-G01–G06 are solid, per the original docs' own sequencing logic (mode 3 reuses mode 2's retrieval, so it needs mode 2 to actually work first). |
| PRD-G08 | Mode 4 (living docs) and multi-language (JS/TS) — same reasoning, explicitly deferred in all three source docs. |

## 7. Success Metrics

- Asking CodeGraph a real question about a real repo returns an LLM-generated answer with accurate cited nodes, not a bulleted list of keyword matches.
- A visitor to `code_x`'s actual site can reach the Code Graph view without knowing a separate app/port exists.
- The eval harness produces a real number (e.g. "11/15") that becomes the documented basis for any future retrieval-method decision.

## 8. Risks & Open Questions

- Folding `apps/codegraph-web`'s components into `apps/web` means reconciling two different design systems — `codegraph-web` has its own `tailwind.config.js` and never received the "AI Lab OS" redesign the rest of `code_x` just went through. This is real UI work, scoped in the TRD, not a copy-paste.
- The current codegraph-api holds a **single global graph in memory** (`GRAPH_STORE`/`GRAPH_DATA` module-level state) — fine for a personal local tool, actively wrong for a product where many users analyze many repos concurrently. This has to change as part of integration, not after.
- Confirm before building PRD-G01: which of `code_x`'s existing model providers (NVIDIA NIM, Gemini, Claude) CodeGraph's explain/chat should default to — the original docs specify NVIDIA NIM specifically, but reusing `packages/generation`'s existing rotation setup (PRD-G02) may make this a non-issue, since that infrastructure already handles multi-provider fallback.
