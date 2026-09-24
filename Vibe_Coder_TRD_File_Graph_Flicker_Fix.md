# Vibe Coder — Technical Requirements Document
## File Graph Tab Flicker / Mount-Loop Fix

Repo: Vibe Coder monorepo (`apps/web`) • September 2026 • **rev 2 (re-verified against working tree)**

> Companion to `Vibe_Coder_PRD_File_Graph_Flicker_Fix.md`. Every requirement `PRD-F0x` maps to a
> fix `TRD-F0x` below. All file/line references verified against the working tree at time of
> writing. **Legend:** ✅ implemented in working tree (uncommitted) · ⬜ not started · ⚠️ partial.
>
> **Verification snapshot (rev 2):** `pnpm --filter @vibe-coder/web typecheck` → clean;
> `pnpm --filter @vibe-coder/web test` → **5/5 passed** (`FileGraphTab.stability.test.tsx`).
> Modified (uncommitted): `FileGraphTab.tsx`, `ClientRepoPage.tsx`, `analyze/[id]/page.tsx`,
> `lib/api.ts`, `lib/socket.ts`, `apps/web/package.json`, `pnpm-lock.yaml`.
> Untouched: `FileGraph.tsx` (RC5/PRD-F05 still open).

---

## 1. Architecture of the affected path

```
ClientRepoPage (apps/web/src/app/repos/[repoId]/ClientRepoPage.tsx)
  ├── useAuthRedirect()          → authStatus
  ├── useAuthedFetch()  (RC2 ✅) → api            ← useMemo-stable
  ├── useSocket()       (RC2 ✅) → socket         ← state, stable after connect
  ├── state: repo, activeTab, analysisProgress     (RC4 ✅ throttled 250ms)
  │
  ├── const fetchTree  = useCallback(..., [api, repoId])     (RC1 ✅)
  ├── const explainFile = useCallback(..., [api, repoId])    (RC1 ✅)
  │
  └── {activeTab === "filegraph" && (             (RC3 ⬜ UNMOUNTS on switch)
        <FileGraphTab fetchTree={fetchTree} explainFile={explainFile} />
      )}

FileGraphTab (apps/web/src/components/FileGraphTab.tsx)
  ├── treeRef distinguishes first load vs silent refetch     (RC1 ✅)
  ├── useEffect([fetchTree])  → first load: spinner; later: silent refresh,
  │                             failure with cached tree → inline banner (RC1/F04-partial ✅)
  ├── useEffect([selectedPath, explainFile]) → explanationCache-first (F07-cache ✅)
  └── retryRefresh / retryExplain guarded paths              (F08 ✅)

Public page: apps/web/src/app/analyze/[id]/page.tsx
  ├── 3s poll until READY/FAILED
  ├── fileTreeArtifact = useMemo(..., [result])              (RC6 ✅)
  ├── fetchTree = useCallback(..., [fileTreeArtifact])       (RC6 ✅)
  └── {activeTab === "files" && <FileGraphTab .../>}         (RC3 ⬜ UNMOUNTS on switch)

Dormant (not mounted anywhere): apps/web/src/components/FileGraph.tsx  (RC5 ⬜ untouched)
  ├── ResizeObserver → setSize with no equality guard        (:132–141)
  ├── TWO effects on [size.w, size.h] → double sim restart   (:147–185, :188–191)
  └── setTick on every simulation frame regardless of alpha   (:201–208)
```

## 2. Root causes — evidence (pre-fix HEAD, confirmed via `git diff`)

### RC1 — Inline fetcher props ⇒ load effect re-fires per parent render ✅ FIXED
Pre-fix `ClientRepoPage.tsx` passed inline arrows:
```tsx
{activeTab === "filegraph" && (
  <FileGraphTab
    fetchTree={async () => { const art = await api.get(...); return art.content ?? ...; }}
    explainFile={(path) => api.post(..., { path })}
  />
)}
```
Every parent render created new function instances. `FileGraphTab`'s loader keyed on the prop and
called `setLoading(true)` unconditionally:
```tsx
useEffect(() => {
  let cancelled = false;
  setLoading(true);          // ← flips the WHOLE panel to the spinner
  fetchTree()...
}, [fetchTree]);             // ← fires on every parent render
```
Because the parent re-rendered on **every `analysis:progress` event** (RC4), the tab toggled
loading → content → loading in sync with the event stream.

### RC2 — `useAuthedFetch()`/`useSocket()` were render-unstable ✅ FIXED
Pre-fix `api.ts` returned a fresh object literal every call. Pre-fix `socket.ts` returned
`socketRef.current` **during render** (read before the connect effect ran; no state → no
re-render on connect). Consequences: effects `[api, repoId, authStatus]` and
`[socket, repoId, api]` re-fired per render; the socket effect tore down and re-registered
`analysis:progress` and re-emitted `repo:join` on unrelated renders — the "repeated
reconnect/polling" symptom in the incident report.

### RC3 — No cache across tab switches ⬜ OPEN
`{activeTab === "filegraph" && <FileGraphTab .../>}` (`ClientRepoPage.tsx:177–179`) and
`{activeTab === "files" && ...}` (`analyze/[id]/page.tsx:267–272`) unmount the tab; `FileGraphTab`
holds `tree` in local state (`treeRef` dies with it), so returning to the tab always replays the
full-panel spinner at `FileGraphTab.tsx:239–248` while refetching. **This is the dominant
remaining flicker.**

### RC4 — Unthrottled progress state updates ✅ FIXED
Pre-fix handler called `setAnalysisProgress(p)` on every socket message. Worker emits progress
frequently (Redis→Socket.IO, `apps/websocket/src/index.ts`). Fixed with a 250 ms throttle that
always passes `progress === 100` through (`ClientRepoPage.tsx:90–101`).

### RC5 — Dormant d3 component hazards ⬜ OPEN (`apps/web/src/components/FileGraph.tsx`)
- `:132–141` — `ResizeObserver` does `setSize((s) => ({ ...s, w: width }))`: a new object every
  observed frame, no equality guard → fractional width jitter re-renders continuously (the
  "resize handler triggers a re-render loop" from the incident report).
- `:147–185` **and** `:188–191` — two effects depend on `[size.w, size.h]`: the simulation
  (re)build effect **and** a second one that replaces the center force and calls
  `alpha(0.3).restart()` → double restart per resize.
- `:201–208` + `:128` — `setTick` on **every** simulation frame regardless of alpha → continuous
  re-renders after the graph settles.
- `:265` — `viewBox={`0 0 ${size.w} 560`}` repaints the whole SVG on each accepted width change.
- `:226` — `handleNodeClick` guard `if (explanation && selected === node.id) return` reads stale
  closure state.

### RC6 — Public-page polling churn ✅ FIXED
Pre-fix `fetchTree` was `useCallback(..., [result])`; the 3 s poll replaced `result` every cycle
while pending → new prop identity per poll. Fixed by keying on the `fileTreeArtifact` reference
(`analyze/[id]/page.tsx:85–92`). Residual note: `fileTreeArtifact` still depends on `[result]`, so
any post-READY `setResult` (none today) would churn again — acceptable because post-churn effect
runs are now silent refetches (RC1 fix), not spinner flashes.

### Residual issues (PRD-F07/F09)
- `FileGraphTab.tsx:173` — `filter === "explained"` returns `false` for every file: the Explained
  chip hides everything (no-op stub).
- `FileGraphTab.tsx:199–212, 214–237` — `retryRefresh`/`retryExplain` return `cancelled`-cleanup
  functions that are discarded (called from onClick, not an effect): dead code, harmless.
- `apps/codegraph-web/src/app/page.tsx:67–76` — `ResizeObserver` → `setDims({w, h})` with no
  equality guard, effect re-run on `[graphData]` (disconnect/reconnect per data load): same
  hazard class as RC5 in the separate force-graph app.
- `apps/web/src/components/auth.ts` `useAuthRedirect` flips `loading → authed`, causing
  `ClientRepoPage` to render twice (spinner → page) before any tab mounts — out of scope,
  noted for observability only.

## 3. Fix design

Fixes are ordered; **F02 must land before the callback memoization in F01** (stable `api` is what
makes `useCallback([api, repoId])` stable). F01/F02/F03 are done; F04/F05 remain.

### TRD-F01 — Stable fetcher props (resolves RC1, PRD-F01) ✅ IMPLEMENTED

**`ClientRepoPage.tsx:73–81`** — fetchers hoisted into `useCallback` keyed on stable deps:
```tsx
const fetchTree = useCallback(async () => {
  const art = await api.get<{ content: FileTreeNode }>(`/repos/${repoId}/file-tree`);
  return art.content ?? (art as unknown as FileTreeNode);
}, [api, repoId]);

const explainFile = useCallback(
  (path: string) => api.post<FileExplanation>(`/repos/${repoId}/files/explain`, { path }),
  [api, repoId]
);
```

**`FileGraphTab.tsx:92–129`** — idempotent, stale-tolerant loader:
- `isRefetch = treeRef.current !== null`; `setLoading(true)` **only** on first load.
- First-load failure → full-panel error (`error && !tree`, `:253`); background-refresh failure →
  inline banner with Retry (`error && tree`, `:281–291`), cached tree stays mounted.
- `cancelled` cleanup on effect teardown.

**Public page (`analyze/[id]/page.tsx:85–97`)** — artifact-keyed memo:
```tsx
const fileTreeArtifact = useMemo(
  () => result?.artifacts.find((a) => a.artifactType === "file-tree"),
  [result]
);
const fetchTree = useCallback(async () => {
  if (!fileTreeArtifact) throw new Error("No file tree for this analysis");
  return fileTreeArtifact.content as unknown as FileTreeNode;
}, [fileTreeArtifact]);
```
Hooks were also moved above the early returns (Rules of Hooks fix, `:78–84`).

### TRD-F02 — Stable hooks (resolves RC2, PRD-F02) ✅ IMPLEMENTED

**`lib/api.ts:71–87`** — returned client wrapped in `useMemo(..., [])` (signatures unchanged;
drop-in for all call sites).

**`lib/socket.ts:17–34`** — ref converted to observable state:
```ts
export function useSocket(): Socket | null {
  const [socket, setSocket] = useState<Socket | null>(null);
  useEffect(() => {
    const s = io(WS_URL, { withCredentials: true, transports: ["websocket"] });
    setSocket(s);
    return () => { s.disconnect(); setSocket(null); };
  }, []);
  return socket;
}
```
Also fixes the latent "socket is null on first render" race (effects gated on `!socket` now retry
when state flips).

### TRD-F03 — Bounded progress handling (resolves RC4, PRD-F03) ✅ IMPLEMENTED

`ClientRepoPage.tsx:83–104` — named handler, registered once per `[socket, repoId, api]` (all
stable after F01/F02), removed by reference in cleanup; 250 ms throttle with unconditional
`progress === 100` passthrough; completion triggers one repo refetch.

### TRD-F04 — Cache across tab switches (resolves RC3, PRD-F04) ⬜ OPEN — next PR

Choose the smallest change that satisfies PRD-F04:

- **Option A (preferred, minimal): keep mounted.** Replace conditional rendering with CSS hiding
  for the File Graph tab on the repo page:
  ```tsx
  <div style={{ display: activeTab === "filegraph" ? undefined : "none" }}>
    <FileGraphTab fetchTree={fetchTree} explainFile={explainFile} />
  </div>
  ```
  Caveat: the tab's effects run at page mount (fetch begins immediately) — acceptable, since the
  tree is needed on first tab open anyway and it is one request. Effects inside the hidden tab
  keep running; with F01 landed that is at most the one load + explanation requests.
- **Option B: session cache module.** A tiny module-scoped `Map<repoId, FileTreeNode>` (or React
  context provider) consulted by `FileGraphTab` before fetching; stale-while-revalidate per
  TRD-F01 rules (show cached tree immediately, silent background refresh, inline error on
  failure). Required on the public page if Option A is not acceptable there.

Recommendation: **Option A on `ClientRepoPage`; Option B (`Map` keyed by `id`) on
`analyze/[id]`** unless QA flags mount cost — the READY gate stops polling before the tab can
mount on the public page, so Option A is also safe there if preferred for symmetry.

Acceptance: 20× tab toggle produces **zero** spinners and **zero** additional `/file-tree`
requests after the first (served from live state / cache).

### TRD-F05 — Harden the dormant d3 component (resolves RC5, PRD-F05) ⬜ OPEN

In `apps/web/src/components/FileGraph.tsx`:

1. **Single resize→simulation effect.** Merge the two `[size.w, size.h]` effects: update the
   center force and restart only inside the existing simulation effect (`:147–185`); delete the
   standalone effect at `:188–191` (it double-restarts on every resize).
2. **Equality-guarded ResizeObserver:**
   ```ts
   const ro = new ResizeObserver((entries) => {
     const { width } = entries[0].contentRect;
     setSize((s) => (Math.abs(s.w - width) < 1 ? s : { ...s, w: width })); // no-op on jitter
   });
   ```
   Returning the same state object bails out of the re-render.
3. **Tick renders only while the simulation is active:** in the tick handler (`:201–208`), skip
   `setTick` when `simRef.current.alpha() < 0.02` (and `sim.stop()` at that threshold), so idle
   graphs stop re-rendering every frame.
4. While touching the file, fix the `selected`/`explanation` guard in `handleNodeClick`
   (`:226` — reads stale closure state); memoize per-path with an explanation cache like
   TRD-F01's.

### TRD-F06 — Type-only import hygiene (PRD-F06, optional) ⬜ DEFERRED

`FileGraph.tsx` is mounted nowhere; `FileGraphTab.tsx` and both pages import only the
`FileTreeNode` type. Move `FileTreeNode` (+ the `FileExplanation` shape, currently duplicated in
three files) into a small `types.ts`, re-point the imports, and delete `FileGraph.tsx` + the
`d3-force` dependency if the team confirms it is not coming back. Decide in the TRD-F05 PR.

### TRD-F07 — Explanation cache + filter chip (PRD-F07) ⚠️ PARTIAL

- ✅ Per-path `explanationCache` (`FileGraphTab.tsx:87, 139–145, 152`) — cache-first selection,
  re-render with new prop identities never re-requests (covered by stability test 5).
- ⬜ Fix or remove the Explained chip (`:173`): with the cache available, implement
  `filter === "explained"` as `explanationCache.current.has(item.node.path)` (and complement for
  Unexplained), or delete the chip. **Recommendation: implement it** — the cache makes it cheap.

### TRD-F08 — Guarded retry paths (PRD-F08) ✅ IMPLEMENTED

`retryRefresh` (`:199–212`) and `retryExplain` (`:214–237`) mirror the effects' loading/error
handling; no unhandled rejections. (Dead `cancelled` returns noted under TRD-F09.)

### TRD-F09 — Residual hygiene (PRD-F09) ⬜ OPEN

1. Remove (or wire up) the discarded `cancelled`-cleanup returns in `retryRefresh`/`retryExplain`
   — event-handler context cannot be cancelled by returning a function; either drop the return or
   hold a ref flag flipped on unmount.
2. `apps/codegraph-web/src/app/page.tsx:67–76` — apply the TRD-F05.2 equality guard to the
   `ResizeObserver` (`setDims` only when `w`/`h` actually changed by ≥1 px) and disconnect the
   observer outside the `[graphData]` dependency (key it on `[]`; measurement does not depend on
   data).

## 4. Files touched

| File | Change | Fixes | Status |
|---|---|---|---|
| `apps/web/src/lib/api.ts` | `useMemo` around returned client | RC2 | ✅ |
| `apps/web/src/lib/socket.ts` | state-based socket, stable identity | RC2 | ✅ |
| `apps/web/src/app/repos/[repoId]/ClientRepoPage.tsx` | memoized fetchers, throttled progress handler | RC1, RC4 | ✅ |
| `apps/web/src/app/repos/[repoId]/ClientRepoPage.tsx` | keep-mounted tab (`display:none`) | RC3 | ⬜ TRD-F04 |
| `apps/web/src/app/analyze/[id]/page.tsx` | artifact-keyed memoized `fetchTree`, hooks above early returns | RC6 | ✅ |
| `apps/web/src/app/analyze/[id]/page.tsx` | session tree cache (or keep-mounted) for tab returns | RC3 | ⬜ TRD-F04 |
| `apps/web/src/components/FileGraphTab.tsx` | idempotent loader, refetch error path, explanation cache, guarded retries | RC1, PRD-F07/F08 | ✅ |
| `apps/web/src/components/FileGraphTab.tsx` | Explained filter chip works against cache (or removed) | PRD-F07 | ⚠️ |
| `apps/web/src/components/FileGraph.tsx` | merge resize effects, guard RO, tick gating (or delete per F06) | RC5 | ⬜ TRD-F05 |
| `apps/codegraph-web/src/app/page.tsx` | RO equality guard, `[]` observer effect | PRD-F09 | ⬜ TRD-F09 |
| `apps/web/src/components/__tests__/FileGraphTab.stability.test.tsx` | 5-test flicker contract suite (new) | verification | ✅ 5/5 |
| `apps/web/vitest.config.mts`, `vitest.setup.ts`, `apps/web/package.json` | vitest + RTL infra (new) | verification | ✅ |

No API, worker, or pipeline changes.

## 5. Rollout order

1. **PR 1 (ready now):** commit the current working tree — TRD-F01 + F02 + F03 + F08 + test infra.
   Verified: typecheck clean, 5/5 tests pass.
2. **PR 2:** TRD-F04 keep-alive/cache + a tab-toggle regression test (no spinner, no refetch).
3. **PR 3:** TRD-F05 d3 hardening + TRD-F09 residuals; decide TRD-F06 (delete vs keep) in the PR.
4. **PR 4 (small):** TRD-F07 filter-chip completion.
5. Each PR runs `pnpm --filter @vibe-coder/web typecheck`,
   `pnpm --filter @vibe-coder/web test` (must stay green), and the e2e suite
   (`scripts/e2e-file-graph-test.mjs`, must stay 11/11).

## 6. Verification plan

### Component regression test (implemented — `FileGraphTab.stability.test.tsx`, 5/5 passing)
1. Render `FileGraphTab` with `jest.fn` fetchers; assert one `fetchTree` call and content after
   load.
2. Re-render 10× with **stable** prop identities (post-fix parent): `fetchTree` count stays 1;
   loading panel never appears.
3. Re-render 10× with **new inline function instances** (pre-fix parent shape): full-panel
   loading/error must never reappear; content stays; silent refetches bounded (≤11).
4. Background refresh rejects while a tree is loaded: cached content remains, inline error banner
   renders, full-panel error never shown.
5. Select a file, then re-render 5× with new identities: explanation stays; `explainFile` called
   exactly once.

### Remaining tests to add
- **TRD-F04:** tab-toggle test — toggling the parent's `display` (or unmount/remount with cache)
  must not refetch or flash the spinner.
- **TRD-F05:** (if the d3 component is kept) ResizeObserver width-jitter test — repeated
  observations with the same width produce zero additional renders; alpha-below-threshold ticks
  produce zero `setTick` updates.

### Manual QA matrix
| Scenario | Expected | Gate |
|---|---|---|
| Repo page during active analysis (progress events streaming) | File Graph tab static; banner updates ≤4/sec; no spinner flash in tab | PR 1 ✅ covered by tests |
| Public `/analyze/:id` while polling → READY | Tab mounts once on READY; no repeated explain requests | PR 1 |
| Kill network, trigger refresh | Cached tree stays; inline error + Retry; full-panel error never shown | PR 1 (test 4) |
| Toggle Architecture ↔ File Graph 20× | No spinner after first load; no `/file-tree` request after first | **PR 2 (TRD-F04)** |
| 5k+ file repo | First paint bounded (existing collapse rules), no resize jitter loops when resizing window | PR 3 (TRD-F05 if d3 re-enabled) |

### Observability
One `console.debug` counter behind `localStorage.__fileGraphDebug` logging `fetchTree` invocations
and socket re-registrations, so QA can verify "1 fetch per visit" without devtools breakpoints.
