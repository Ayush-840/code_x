# Vibe Coder — Technical Requirements Document
## Interactive File Graph + Click-to-Analyze

Repo analyzed: `github.com/Ayush-840/code_x` • commit `d469830` • September 2026

> **Status: IMPLEMENTED & E2E-VERIFIED** (September 2026). Deviations from the design below are
> marked **[deviation]**; issues the e2e run exposed are marked **[bug found]**.

---

## 1. Current Pipeline, and Exactly Where the Gap Is

```python
# packages/analysis/src/analysis/main.py — current /analyze response
return {
    "modules": [{ "name", "path", "fileCount", "lineCount" }],  # directory-level only
    "symbols": [...],   # has filePath per symbol, but not grouped into file summaries
    "chunks": [...],    # used by retrieval indexing, not returned to the frontend
}
```

`parse_repo()` in `parser.py` already computes `mod["files"]: list[str]` — the real per-file paths — while building each directory module, but `main.py`'s response only keeps the aggregate counts. The data needed for a file tree already exists in memory at analysis time; it's just discarded before it leaves the service.

## 2. Data Model Changes

### 2.1 File tree (resolves PRD-G01)

No new table needed — reuse the existing `Artifact` model's free-form shape, same pattern as the deployment-detection feature from the prior TRD:

```python
# main.py — add fileTree to the response
def build_file_tree(modules: list[dict]) -> dict:
    """Nest the flat per-module file lists into a {name, path, kind, children} tree."""
    root = {"name": "/", "path": "", "kind": "dir", "children": {}}
    for mod in modules:
        for rel_path in mod["files"]:
            parts = Path(rel_path).parts
            node = root
            for i, part in enumerate(parts):
                is_file = i == len(parts) - 1
                node["children"].setdefault(part, {
                    "name": part,
                    "path": "/".join(parts[: i + 1]),
                    "kind": "file" if is_file else "dir",
                    "children": {},
                })
                node = node["children"][part]
    return _to_list_form(root)  # convert children dicts to arrays for JSON
```

```python
return {
    "modules": [...],
    "symbols": [...],
    "chunks": [...],
    "fileTree": build_file_tree(modules),   # ✅ new — dirs before files, stable order
}
```

> **[bug found]** while wiring this up: `chunk_source()` tags chunks with the **absolute**
> temp-clone path (`/var/folders/.../index.js`), so any per-file chunk lookup would miss.
> Fixed in `main.py` — chunks are re-tagged with the repo-relative path before returning.
> This also fixes file-scoped citations for the existing chat feature.

On the API side, `apps/worker`'s `analyzeRepo.ts` (already receiving this response to write modules/symbols) additionally writes:

```ts
await prisma.artifact.create({
  data: { repoId, jobId, artifactType: "file-tree", content: analysisResult.fileTree },
});
```

(For anonymous jobs, write to `publicAnalysisId` instead, per the anonymous-analysis TRD's dual-write pattern.)

### 2.2 Per-file explanation, generated lazily (resolves PRD-G02)

New endpoint, not a batch pre-generation step:

```
POST /v1/repos/:repoId/files/explain     { path: string }
POST /v1/public/analyze/:id/files/explain { path: string }
```

Flow:

1. Check for an existing cached explanation: `Artifact { artifactType: "file-explain:" + path }`. If present, return it immediately.
2. If not cached, call `packages/retrieval`'s `/search` scoped to chunks where `filePath == path` (the retrieval service already indexes chunks with `filePath`/`startLine`/`endLine` per chunk — this is a filter on existing data, not new indexing work).
3. Pass those chunks to `packages/generation` with a file-scoped prompt: "explain what this specific file does, and generate 1–3 likely interview questions about it" (extending the existing question-generation prompt to accept a narrower scope than the whole repo).
4. Cache the result as a new `Artifact` row (`artifactType: "file-explain:" + path`), return it.

Using the file path embedded in `artifactType` is pragmatic and needs no migration — `Artifact.artifactType` is already a plain string with no enum constraint. If per-file lookups become awkward at scale (e.g. needing to list all cached file-explanations for a repo efficiently), a dedicated `FileExplanation` table is a clean follow-up migration; not necessary to start. ✅ Implemented exactly this way; a `GET /:repoId/files/explanations` cache-list endpoint was also added.

> **[deviation]** retrieval exposes `POST /file-chunks` (all chunks for one file, line-ordered)
> rather than a `/search` filter — a direct filter over `get_chunks()` is exact, cheaper, and
> doesn't depend on embedding similarity to find a file's own chunks.
>
> **[deviation]** the generation service dedicates `packages/generation/src/generation/files.py`
> (`POST /file-explain`) with a file-scoped system prompt instead of widening the chat prompt.
> If the model omits the `citations` array, the chunks it was shown are cited anyway — a
> grounding guarantee. Demo mode (no LLM keys) returns honest `[demo]` output grounded in real
> chunk boundaries, never fabricated prose.
>
> **[bug found]** the worker never checked the retrieval `/index` response — a silent 500 left
> chat and the explainer with zero indexed chunks. Indexing is now validated and fails the job
> with the upstream error.

## 3. API Rate Limiting (resolves the click-spam risk in PRD Risks)

Reuse the `rateLimit.ts` pattern again, scoped tighter than the whole-analysis limit:

```ts
export function fileExplainRateLimit() {
  return rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 30, // per IP (anonymous) or per user (authenticated) — tune after real usage
    keyGenerator: (req) => req.userId ?? req.ip ?? "unknown",
  });
}
```

✅ Applied to both the authenticated and public `files/explain` routes. The public route stacks
`fileExplainRateLimit()` with `anonymousRateLimit("status")` for defense in depth, and enforces
the analysis `expiresAt` (410 after expiry). The authed route checks repo ownership (allowing
placeholder repos reached via a public analysis).

## 4. Frontend

### 4.1 Diagram fix (resolves the raw-text bug, part of PRD-G03)

```
pnpm --filter @vibe-coder/web add mermaid
```

In `ArchitectureTab.tsx`, replace the `<pre>{arch.diagram}</pre>` block with `mermaid.render()` into a container div, themed via Mermaid's `theme: "base"` + `themeVariables` set to match the app's color tokens (Section 4.3) rather than Mermaid's default palette — an unstyled default diagram next to a custom UI would itself look inconsistent.

### 4.2 New `FileGraph` component (resolves PRD-G01/G03, consuming Section 2.1's data)

A new component, structurally close to the reviewed prototype: fetches the `"file-tree"` artifact, renders it with `d3-force` (already validated in the prototype), and on node click, calls `POST /files/explain` and renders the response in a detail pane. Loading state in the detail pane while the explain call is in flight — the graph itself never waits on this. ✅ Shipped as `FileGraph.tsx` + `FileGraphTab.tsx` (shared data plumbing for authed vs anonymous fetchers) plus `MermaidDiagram.tsx` for PRD-G03, with themed SVG and a raw-text fallback for unparseable diagrams. Node positions survive expand/collapse (surviving nodes keep coordinates), and per-tick re-renders go through React state rather than d3-selection — visible node count stays bounded by the collapse rule.

### 4.3 Design tokens (resolves PRD-G04)

> **[deviation]** this section's premise was wrong: the repo already ships a complete token set
> in `apps/web/src/app/globals.css` (`--bg`, `--brand-*`, `--surface-*`, …). Creating the
> `theme.css` palette below would have produced two competing design systems. What was actually
> done: `--font-mono` (JetBrains Mono) added to the existing `:root`, a `.mermaid-container`
> theming block added so diagrams use the app's tokens, and the new `FileGraph`/`MermaidDiagram`
> components built against the existing tokens. Migrating the older tabs onto tokens app-wide
> remains open (tracked in PRD-G04).

### 4.4 Large-repo handling (resolves PRD-G05)

The `d3-force` render defaults to rendering only top-level directory nodes (collapsed); clicking a directory node expands it in place, adding its immediate children to the simulation (`sim.nodes(newNodeSet)` + `sim.alpha(0.5).restart()`) rather than rendering the full tree at once. This keeps the initial render bounded regardless of total repo size — a 2,000-file repo still starts with only its top-level directories as nodes.

## 5. Sequencing

| Step | Work | Depends on | Status |
|---|---|---|---|
| 1 | `fileTree` in the analysis service response + worker persistence (2.1) | None | ✅ Done |
| 2 | Mermaid rendering fix in `ArchitectureTab` (4.1) | None — independent, small, ship any time | ✅ Done |
| 3 | `files/explain` endpoint + rate limit (2.2, 3) | Step 1 (needs the tree to know valid paths to explain) | ✅ Done |
| 4 | `FileGraph` component + design tokens (4.2, 4.3) | Steps 1 and 3 | ✅ Done (tokens: existing palette extended, see 4.3) |
| 5 | Collapsed/expand large-repo handling (4.4) | Step 4 | ✅ Done |
| 6 | E2E verification on a real repo (`scripts/e2e-file-graph-test.mjs`) | Steps 1–5 | ✅ Done — 11/11 checks |

## 6. Acceptance Criteria

- ✅ `POST /analyze`'s response (or the persisted `"file-tree"` artifact) contains every source file — e2e-verified: tree file count matches the modules' aggregate `fileCount` exactly (13/13 on `vercel/ms`, 15/15 on `sindresorhus/query-string`, 3/3 on `jonschlinkert/is-odd`).
- ✅ Clicking a file node the first time takes a few seconds (real generation); clicking it again is near-instant (cache hit) — e2e-verified: `cached: false` then `cached: true`.
- ✅ The Architecture tab shows an actual rendered diagram, not visible Mermaid syntax text (with graceful raw-text fallback when the syntax can't parse).
- ⬜ A repo with 1,000+ files loads its graph in collapsed (directory-only) form without a noticeable render stall — still to be exercised on a genuinely large repo.
- ✅ The 31st `files/explain` call from the same IP within 5 minutes returns `429` (rate limiter configured on both routes; not load-tested).
