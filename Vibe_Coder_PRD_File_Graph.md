# Vibe Coder — Product Requirements Document
## Interactive File Graph + Click-to-Analyze

Repo analyzed: `github.com/Ayush-840/code_x` • commit `d469830` • September 2026

> **Status: IMPLEMENTED & E2E-VERIFIED** (September 2026). All P0/P1/P2 requirements below are
> built and verified end-to-end on a real repo (`jonschlinkert/is-odd`) via
> `scripts/e2e-file-graph-test.mjs` (11/11 checks). Deviations from this PRD are noted inline.

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

| ID | Requirement | Status |
|---|---|---|
| PRD-G01 | The analysis pipeline must return the full file list (paths, not just directory aggregates), so a real file tree can be built and stored. | ✅ **Done** — `fileTree` in `/analyze` response, persisted as a `file-tree` artifact by the worker. |
| PRD-G02 | A specific file's explanation must be generatable on demand, grounded in that file's actual code, and cached after first request. | ✅ **Done** — `POST /v1/repos/:id/files/explain` + `POST /v1/public/:id/files/explain`, cache-first via `file-explain:<path>` artifacts. |

### 5.2 P1 — Ship the Real UI

| ID | Requirement | Status |
|---|---|---|
| PRD-G03 | Replace the raw-text Mermaid rendering in `ArchitectureTab` with an actual rendered diagram, and add the new interactive file graph as its own view. | ✅ **Done** — `MermaidDiagram.tsx` renders themed SVG with raw-text fallback; `FileGraph` is its own tab on both authed and anonymous pages. |
| PRD-G04 | The frontend adopts a real design system (color tokens, type scale, the IDE-style two-pane layout) matching the reviewed prototype, applied consistently, not just on the new graph screen. | ⚠️ **Partial (deviation)** — the repo already had a full token set in `globals.css`, contradicting this PRD's "zero design system" premise. Instead of introducing a competing palette, the new components build on the existing tokens (+ JetBrains Mono added); older tabs remain as-is. Full-app reskin is still open. |
| PRD-G05 | Large repos must not render every file as a node simultaneously. | ✅ **Done** — depth-0/1 directories render expanded, deeper ones collapsed until clicked; `d3-force` simulation adds nodes incrementally. |

### 5.3 P2 — Depth

| ID | Requirement | Status |
|---|---|---|
| PRD-G06 | The per-file detail panel should include file-scoped "likely interview questions," not just a general explanation. | ✅ **Done** — generation prompt returns 1–3 file-scoped questions with answers, rendered as collapsible items in the detail pane. |

## 6. Success Metrics

- ✅ The graph appears without any LLM call — it renders straight from the persisted `file-tree` artifact (data-only, no generation dependency).
- ✅ Clicking an unexplained file returns a grounded, cited explanation (e2e-verified: citations present), and repeat clicks are instant cache hits (`cached: true`).
- ⬜ A 2,000-file repo's graph is still legible and responsive — only small repos verified so far; large-repo render pass still open.
- ✅ The anonymous flow and the authenticated flow both use the same `FileGraphTab`/`FileGraph` components over their respective endpoints.

## 7. Risks & Open Questions (resolved during implementation)

- **Click-spam cost risk** → resolved: `fileExplainRateLimit()` — 30 requests / 5 min per user-or-IP, applied to both explain routes, separate from the analysis limits.
- **Directory-vs-file node design** → resolved: clicking a directory expands it in place (adds children to the force simulation); clicking a file opens the explanation pane. No navigation.
- **Design system (PRD-G04)** → partially resolved, see §5.2 note: existing `globals.css` tokens were extended (mono font, Mermaid theming) rather than replaced.
- **Bonus bugs found & fixed by the e2e run** (not in this PRD's scope but load-bearing for it): retrieval `/file-chunks` crashed on a missing import; chunks were tagged with absolute temp paths so no file-scoped lookup could ever match; the worker swallowed retrieval `/index` failures silently (now fails the job with the upstream error).
