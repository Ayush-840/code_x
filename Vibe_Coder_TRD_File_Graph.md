# Vibe Coder — Technical Requirements Document
## Interactive File Graph + Click-to-Analyze

Repo analyzed: `github.com/Ayush-840/code_x` • commit `d469830` • September 2026

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
    "fileTree": build_file_tree(modules),   # new
}
```

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

Using the file path embedded in `artifactType` is pragmatic and needs no migration — `Artifact.artifactType` is already a plain string with no enum constraint. If per-file lookups become awkward at scale (e.g. needing to list all cached file-explanations for a repo efficiently), a dedicated `FileExplanation` table is a clean follow-up migration; not necessary to start.

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

Apply to both the authenticated and public `files/explain` routes.

## 4. Frontend

### 4.1 Diagram fix (resolves the raw-text bug, part of PRD-G03)

```
pnpm --filter @vibe-coder/web add mermaid
```

In `ArchitectureTab.tsx`, replace the `<pre>{arch.diagram}</pre>` block with `mermaid.render()` into a container div, themed via Mermaid's `theme: "base"` + `themeVariables` set to match the app's color tokens (Section 4.3) rather than Mermaid's default palette — an unstyled default diagram next to a custom UI would itself look inconsistent.

### 4.2 New `FileGraph` component (resolves PRD-G01/G03, consuming Section 2.1's data)

A new component, structurally close to the reviewed prototype: fetches the `"file-tree"` artifact, renders it with `d3-force` (already validated in the prototype), and on node click, calls `POST /files/explain` and renders the response in a detail pane. Loading state in the detail pane while the explain call is in flight — the graph itself never waits on this.

### 4.3 Design tokens (resolves PRD-G04)

Extract the prototype's CSS custom properties into a shared theme file consumed app-wide, not just by the new graph screen:

```css
/* apps/web/src/styles/theme.css */
:root {
  --bg: #14120F; --bg-elevated: #1C1914; --bg-elevated-2: #221E17;
  --border: #2E2A21; --text-primary: #F2EDE2; --text-secondary: #9A9184;
  --accent: #E3A23C; --accent-dim: #6B532A; --edge: #4E7A80;
  --font-display: 'Space Grotesk', system-ui, sans-serif;
  --font-body: 'Public Sans', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, monospace;
}
```

Given the frontend currently has zero design-system infrastructure (confirmed: no Tailwind, no shared tokens, per-component inline `style={}` objects), the pragmatic path is: add this `theme.css` + the Google Fonts `<link>` tags to the root layout now, and migrate existing tabs (`ArchitectureTab`, `ModulesTab`, etc.) to reference these variables incrementally rather than in one large rewrite — the new `FileGraph` component should be built against the tokens from day one, and older components adopt them as they're touched anyway.

### 4.4 Large-repo handling (resolves PRD-G05)

The `d3-force` render defaults to rendering only top-level directory nodes (collapsed); clicking a directory node expands it in place, adding its immediate children to the simulation (`sim.nodes(newNodeSet)` + `sim.alpha(0.5).restart()`) rather than rendering the full tree at once. This keeps the initial render bounded regardless of total repo size — a 2,000-file repo still starts with only its top-level directories as nodes.

## 5. Sequencing

| Step | Work | Depends on |
|---|---|---|
| 1 | `fileTree` in the analysis service response + worker persistence (2.1) | None |
| 2 | Mermaid rendering fix in `ArchitectureTab` (4.1) | None — independent, small, ship any time |
| 3 | `files/explain` endpoint + rate limit (2.2, 3) | Step 1 (needs the tree to know valid paths to explain) |
| 4 | `FileGraph` component + design tokens (4.2, 4.3) | Steps 1 and 3 |
| 5 | Collapsed/expand large-repo handling (4.4) | Step 4 |

## 6. Acceptance Criteria

- `POST /analyze`'s response (or the persisted `"file-tree"` artifact) contains every source file in a test repo, matching what `git ls-files` shows for that repo (minus the same `SKIP_DIRS` exclusions already applied).
- Clicking a file node the first time takes a few seconds (real generation); clicking it again is near-instant (cache hit).
- The Architecture tab shows an actual rendered diagram, not visible Mermaid syntax text.
- A repo with 1,000+ files loads its graph in collapsed (directory-only) form without a noticeable render stall.
- The 31st `files/explain` call from the same IP within 5 minutes returns `429`, not a queued generation.
