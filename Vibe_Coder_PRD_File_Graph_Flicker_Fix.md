# Vibe Coder — Product Requirements Document
## File Graph Tab Flicker / Mount-Loop Fix

Repo: Vibe Coder monorepo (`apps/web`) • September 2026 • **rev 2 (re-verified against working tree)**

> **Status: IN IMPLEMENTATION.** Companion doc: `Vibe_Coder_TRD_File_Graph_Flicker_Fix.md`.
> Requirements are numbered `PRD-F0x`; the TRD maps each to a concrete fix `TRD-F0x`.
>
> **Implementation status at time of writing:**
> - ✅ P0 (PRD-F01/F02/F03) and PRD-F08 — **implemented in the working tree (uncommitted)**,
>   `pnpm --filter @vibe-coder/web typecheck` clean, stability suite **5/5 passing**.
> - ⬜ P1 (PRD-F04 keep-alive, PRD-F05 d3 hardening) — **not started**.
> - ⚠️ PRD-F07 — explanation cache done; the "Explained" filter chip remains a stub.
> - ⬜ PRD-F06, PRD-F09 — optional/residual cleanup, not started.

---

## 1. Problem Statement

The File Graph tab (`apps/web/src/components/FileGraphTab.tsx`, mounted on both the authenticated
repo page and the public `/analyze/:id` page) intermittently flickers: the whole panel repeatedly
collapses to the "Loading file graph…" spinner or the "File graph unavailable" error state and back
to content, in a visible loop. The loop is strongest while an analysis is running (WebSocket
`analysis:progress` events streaming) and every time the user toggles between tabs.

The user-visible effect is a component that appears to continuously unmount/remount. The
product effect is simple: **the tab is unusable during exactly the moments users are most engaged —
right after kicking off an analysis, and when exploring the finished graph.**

> **Note on the hypothesis vs. the code (re-verified).** The original report suspected the
> canvas/force-graph rendering path (`FileGraph.tsx`, d3-force) and a resize-handler re-render loop.
> Verified against the code: the d3 canvas component is **not mounted anywhere** (the UI redesign
> replaced it with the file-list layout in `FileGraphTab.tsx`; only its `FileTreeNode` type is still
> imported). The live flicker is a state/props-identity problem in `FileGraphTab` and its parent
> pages — mount/unmount churn, unstable hook/callback identities, and unthrottled socket updates —
> not a rendering-lifecycle loop inside SVG. The d3 component is retained but dormant; this PRD
> keeps a hardening requirement so it cannot reintroduce the bug if re-enabled (PRD-F05). The
> separate `apps/codegraph-web` force-graph canvas has the same ResizeObserver hazard class and is
> covered as a residual (PRD-F09).

## 2. Verified Root Causes (summary — full evidence in TRD §2)

| # | Cause | Where | Status |
|---|---|---|---|
| RC1 | Parent passed **inline arrow functions** as `fetchTree`/`explainFile` props → new identity on every parent render → `FileGraphTab`'s load effect re-ran → `setLoading(true)` flipped the whole panel to the spinner → refetch → content. Repeated on every `analysis:progress` event. | `ClientRepoPage.tsx` filegraph branch, `FileGraphTab.tsx` load effect | ✅ Fixed (working tree) |
| RC2 | `useAuthedFetch()` returned a **new object every render**; `useSocket()` read `socketRef.current` during render → unstable identities → effects re-fired → repeated `socket.off`/re-`emit("repo:join")` churn (the "WebSocket reconnect attempts" symptom). | `lib/api.ts`, `lib/socket.ts` | ✅ Fixed (working tree) |
| RC3 | Tab switching **unmounts** `FileGraphTab` with no tree cache → every tab return refetches and re-plays the loading flash. | `ClientRepoPage.tsx:177`, `analyze/[id]/page.tsx:267` conditional mounts | ⬜ **Open — highest remaining flicker source** |
| RC4 | Progress events called `setAnalysisProgress` on **every** socket message → parent re-render storm amplifying RC1. | `ClientRepoPage.tsx` socket effect | ✅ Fixed (250 ms throttle, working tree) |
| RC5 | (Dormant) d3 `FileGraph` restarts its simulation from two overlapping size effects and re-renders every tick via `setTick`; ResizeObserver updates state with no no-change guard. | `FileGraph.tsx:132–208` | ⬜ **Open — file untouched** |
| RC6 | Public page: `fetchTree` was keyed on the whole `result` object, which the 3 s poll replaced every cycle → new prop identity per poll. | `analyze/[id]/page.tsx` | ✅ Fixed (artifact-keyed memo, working tree) |

## 3. Goals

- Opening the File Graph tab shows **one** loading state, then stable content — no flashing, ever.
- While an analysis is running (progress events streaming), the File Graph tab stays visually
  stable; progress banner updates must not ripple into the tab.
- Switching away from and back to the tab re-shows the previously loaded tree **instantly**
  (stale-while-revalidate), with at most one silent background refresh.
- A failed tree fetch never destroys already-rendered content: errors appear as a non-blocking,
  dismissible inline notice with a Retry action.
- The explanation pane behaves the same way: selecting a file shows at most one spinner; a parent
  re-render never re-triggers an explanation request for the already-selected file.
- If the dormant d3 canvas graph is ever re-enabled, its resize/tick lifecycle cannot reintroduce
  a render loop.

## 4. Non-Goals

- No changes to API contracts (`GET /repos/:id/file-tree`, `POST /repos/:id/files/explain`,
  public equivalents) or to the worker/analysis pipeline.
- No redesign of the File Graph layout — this is a stability fix only.
- No global state-management library adoption (no zustand/redux/react-query); fixes stay within
  React idioms already in the repo.
- Rewriting the dormant d3 `FileGraph.tsx` beyond hardening (it is not currently mounted; deleting
  it is an optional cleanup, PRD-F06).
- No behavior change to other tabs' first-mount spinners (Architecture/Modules/etc.) beyond what
  stable hooks give them for free.

## 5. Requirements

### 5.1 P0 — Stop the flicker — ✅ implemented (working tree, uncommitted)

| ID | Requirement | Status |
|---|---|---|
| PRD-F01 | Re-rendering the parent page (including bursts of `analysis:progress` events) must **not** re-run the File Graph tab's tree-load effect. `fetchTree`/`explainFile` prop identities must be stable for the lifetime of a page/repo, and the tab must not flip to its full-panel loading state when a tree is already loaded (first load only; later effect runs refresh silently). | ✅ Done — `ClientRepoPage` `useCallback` fetchers; `FileGraphTab` `treeRef`-guarded loader |
| PRD-F02 | The API client hook (`useAuthedFetch`) must return a referentially stable object, and the socket hook (`useSocket`) must return a referentially stable socket once connected, so all effects keyed on them run once per repo/page — not per render. | ✅ Done — `useMemo` client; state-based socket |
| PRD-F03 | Socket progress handling must not re-register listeners or re-emit `repo:join` on unrelated re-renders, and must throttle state updates so rapid event bursts cause bounded re-renders (target: ≤4 updates/sec rendered). | ✅ Done — named handler + 250 ms throttle, 100% always passes |

### 5.2 P1 — Degrade gracefully

| ID | Requirement | Status |
|---|---|---|
| PRD-F04 | Switching tabs and returning must show the cached tree immediately (no spinner) and refresh silently in the background. A background-refresh failure keeps the cached view and surfaces a small inline error with Retry — never the full-panel error screen. | ⬜ **Open** — the inline-error half is done (`FileGraphTab` renders an inline banner when `error && tree`); the **keep-alive/cache half is not** — both pages still conditionally unmount the tab |
| PRD-F05 | The dormant d3 `FileGraph` component must be hardened (single simulation lifecycle, no-op ResizeObserver updates on unchanged width, tick renders bounded to active-simulation frames) so re-enabling it cannot reintroduce render loops. | ⬜ **Open** — `FileGraph.tsx` untouched |
| PRD-F06 | (Optional cleanup) If the d3 component stays unreferenced after PRD-F05, delete it and keep only the shared `FileTreeNode` type in a types module — decision recorded in the TRD's rollout section. | ⬜ Deferred |

### 5.3 P2 — Quality

| ID | Requirement | Status |
|---|---|---|
| PRD-F07 | The explanation pane caches per-file explanations for the session: re-selecting a file shows cached content instantly; the broken "Explained" filter chip either works against that cache or is removed. | ⚠️ **Partial** — cache done (`explanationCache`); filter chip at `FileGraphTab.tsx:173` still returns `false` for every file (no-op stub) |
| PRD-F08 | The detail-pane "Retry" button must go through the same guarded request path as normal selection (loading state, error state, no unhandled promise rejections). | ✅ Done — `retryRefresh` / `retryExplain` |
| PRD-F09 | Residual render-loop hygiene: (a) dead `cancelled`-cleanup returns in the retry callbacks are removed or wired to real cancellation; (b) `apps/codegraph-web`'s ResizeObserver applies the same equality guard as PRD-F05 so container jitter cannot loop `setDims`. | ⬜ **Open** |

## 6. Success Metrics

- **Zero full-panel loading flashes** after first load: 60 s on a repo page while analysis runs, and
  across 20 tab toggles — the first scenario is covered by the automated regression suite
  (5/5 passing, TRD §6); the tab-toggle scenario requires PRD-F04 and is verified manually after it
  lands.
- **≤1 network fetch** of `/file-tree` per repo per page visit while the tab stays mounted;
  after PRD-F04, tab returns are served from cache with ≤1 silent background refresh.
- No `socket.off`/`repo:join` pairs in the browser log beyond one per connection while idle on the
  repo page for 60 s during an active analysis.
- `pnpm --filter @vibe-coder/web typecheck` clean; stability suite stays 5/5 (grows with PRD-F04
  keep-alive test); `scripts/e2e-file-graph-test.mjs` remains 11/11.

## 7. Rollout & Verification

1. **Commit the current working tree** (P0 + PRD-F08 + test infra) as PR 1 — pure stability, no
   UI change. Verified: typecheck clean, 5/5 tests pass.
2. **PR 2:** PRD-F04 keep-alive (TRD-F04 Option A on repo page, Option B cache on public page) +
   a keep-alive regression test (tab toggle → no refetch, no spinner).
3. **PR 3:** PRD-F05 d3 hardening + PRD-F09 residuals; then the PRD-F06 delete-vs-keep decision.
4. **PR 4 (small):** PRD-F07 filter-chip fix or removal.
5. Manual QA matrix after each PR: repo page during analysis (event storm), repo page idle, public
   `/analyze/:id` page, large repo (>5k files), offline/error injection on refetch, 20× tab toggle.
