# Vibe Coder — Product Requirements Document
## Interactive File Graph + Click-to-Analyze

Repo analyzed: `github.com/Ayush-840/code_x` • commit `d469830` • September 2026

---

## 1. Purpose of This Document

The prototype built and reviewed alongside this document demonstrated the target experience: paste a repo, immediately see a real, structural graph of its files, click any node, get a grounded explanation of that specific file. This PRD defines what's needed to make that real, on top of the actual pipeline — not the mocked demo data.

## 2. Current State

- `packages/analysis`'s `/analyze` endpoint parses the full file list per directory internally (used to generate chunks for retrieval) but **discards it** before returning — the API response only carries aggregate `fileCount`/`lineCount` per directory. There is no per-file record anywhere in the system today.
- `CodeModule` in the database is directory-level only; there's no first-class concept of an individual file with its own summary.
- `CodeSymbol` does carry a `filePath` per symbol, so file identity exists at the symbol layer, but nothing groups these into a "here's what this file does" summary.
- `ArchitectureTab.tsx` already has a `diagram` field (LLM-generated Mermaid syntax) but renders it as literal text inside a `<pre>` block — no diagram library is installed, so nothing is actually drawn today.
- The frontend has no design system — bare inline styles, no Tailwind, no shared color/type tokens.

## 3. Goals

- The moment analysis finishes, show a real, structural graph of the repo's files — built from the actual file tree, not waiting on any LLM call.
- Clicking any file node returns a grounded, cited explanation of that specific file, generated on demand rather than for every file upfront.
- The graph and detail panel visually match the reviewed prototype's direction — distinctive, IDE-influenced layout, not a generic dashboard.
- This works identically for the anonymous flow and the authenticated flow — the graph doesn't require login any more than the rest of the anonymous-analyze feature does.

## 4. Non-Goals

- Rendering actual source code inline in the detail panel — this phase shows explanations, not a code viewer. (A "view source" link out to GitHub is fine and cheap; an embedded code viewer is a separate, later feature.)
- A fully accurate call-graph/dependency-edge visualization between files — this phase's graph is structural (the file tree), not a true import/dependency graph. That's a reasonable future extension, not required now.
- Real-time collaborative viewing of the same graph by multiple users.

## 5. Requirements

### 5.1 P0 — Make the Graph Real

| ID | Requirement | Why it's P0 |
|---|---|---|
| PRD-G01 | The analysis pipeline must return the full file list (paths, not just directory aggregates), so a real file tree can be built and stored. | This is the actual blocking gap — nothing downstream can work without it. |
| PRD-G02 | A specific file's explanation must be generatable on demand, grounded in that file's actual code, and cached after first request. | Generating an explanation for every file in a repo upfront is expensive and mostly wasted (most files never get clicked) — on-demand is both cheaper and faster to first-graph-render. |

### 5.2 P1 — Ship the Real UI

| ID | Requirement | Why it matters |
|---|---|---|
| PRD-G03 | Replace the raw-text Mermaid rendering in `ArchitectureTab` with an actual rendered diagram, and add the new interactive file graph as its own view. | The existing diagram field is already generated and simply never rendered — this is close to a pure bug fix, do it alongside the new graph work. |
| PRD-G04 | The frontend adopts a real design system (color tokens, type scale, the IDE-style two-pane layout) matching the reviewed prototype, applied consistently, not just on the new graph screen. | A distinctive graph screen sitting inside an otherwise generic-looking app undercuts the whole point — this needs to be a full-app treatment, not a single-page skin. |
| PRD-G05 | Large repos must not render every file as a node simultaneously. | A repo with thousands of files would be an unreadable, unusably dense graph and a slow render — directories should render collapsed by default, expanding into their files on interaction. |

### 5.3 P2 — Depth

| ID | Requirement | Why it matters |
|---|---|---|
| PRD-G06 | The per-file detail panel should include file-scoped "likely interview questions," not just a general explanation. | This was in the prototype and is a meaningful differentiator over a plain code-explainer — it's the product's actual value proposition, applied at file granularity. |

## 6. Success Metrics

- The graph appears within roughly 1–2 seconds of analysis completing — it should never be gated on an LLM call.
- Clicking an unexplained file returns a grounded, cited explanation within a few seconds, and instantly on any repeat click (cached).
- A 2,000-file repo's graph is still legible and responsive — verified with at least one real large repo, not just small test cases.
- The anonymous flow and the authenticated flow both produce working, identical graph experiences.

## 7. Risks & Open Questions

- **Click-spam cost risk**: since explanations are generated lazily per click, someone could rapidly click through every file in a large repo to force many LLM calls. This needs its own lightweight rate limit, separate from the whole-analysis rate limit already planned for the anonymous flow.
- **Directory-vs-file node design** needs a concrete interaction decision: does clicking a directory node expand it inline, or navigate into it? Worth deciding with a quick sketch before backend work starts, since it affects what the frontend needs from the tree data shape.
- The design-system work (PRD-G04) is the largest, least bounded item here — recommend treating it as its own short design pass (token extraction + a handful of shared components) rather than something engineers improvise per-screen while also building the graph feature.
