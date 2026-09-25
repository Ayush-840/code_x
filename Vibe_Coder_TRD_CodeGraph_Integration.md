# Vibe Coder — Technical Requirements Document
## Integrate CodeGraph as a Real Feature

Repo analyzed: `github.com/Ayush-840/code_x` • commit `091149b` • September 2026

---

## 1. As-Built State (Corrected)

```
packages/codegraph-parser/   ✅ solid — parser.py, graph_store.py, real tests
packages/codegraph-api/      ⚠️  endpoints exist, generation is fake (template strings)
apps/codegraph-web/          ⚠️  real UI, but a fully separate app (port 3001, own Tailwind config)
docker-compose.yml           ❌ no reference to any codegraph service
railway/*.json, .railway/    ❌ no reference to any codegraph service
apps/web (real product)      ❌ no link to codegraph-web anywhere
```

## 2. Fix Specification (P0): Real LLM Generation (resolves PRD-G01, PRD-G02)

### 2.1 Reuse `shared_python`'s `KeyRotator`, don't reinvent it

`packages/generation/src/generation/llm.py` already has the exact pattern needed: NVIDIA NIM as primary provider via `get_generation_rotator()`, OpenRouter's free `nvidia/nemotron-3-ultra-550b-a55b:free` as automatic fallback when every NVIDIA key fails, and a citation-marker convention (`^[cite:FilePath:startLine-endLine]^`) the frontend already knows how to render. `codegraph-api` should import this the same way `generation` does:

```python
# packages/codegraph-api/src/codegraph_api/main.py
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "..", "shared_python", "src"))
from shared.key_rotation import get_generation_rotator
```

(`codegraph-api/pyproject.toml` needs no new LLM SDK dependency — `openai`, already a `shared_python`/`generation` dependency, is what `KeyRotator.get_client()` wraps.)

### 2.2 Replace the template functions with real generation calls

```python
def _generate_explanation(node_data: dict, neighbors: list[dict]) -> str:
    prompt = _build_explain_prompt(node_data, neighbors)  # same structure as §2.4b's injection format
    rotator = get_generation_rotator()
    with rotator.get_client() as client:
        resp = client.chat.completions.create(
            model=os.getenv("CODEGRAPH_EXPLAIN_MODEL", "meta/llama-3.1-8b-instruct"),  # small/cheap, per §2.4c
            messages=[{"role": "system", "content": _EXPLAIN_SYSTEM_PROMPT}, {"role": "user", "content": prompt}],
        )
    return resp.choices[0].message.content


def _generate_chat_answer(question: str, nodes: list[dict]) -> tuple[str, list[str]]:
    prompt = _build_chat_prompt(question, nodes)  # relevant nodes + relationships, per §2.4b
    rotator = get_generation_rotator()
    with rotator.get_client() as client:
        resp = client.chat.completions.create(
            model=os.getenv("CODEGRAPH_CHAT_MODEL", "meta/llama-3.1-70b-instruct"),  # stronger tier, per §2.4c
            messages=[{"role": "system", "content": _CHAT_SYSTEM_PROMPT}, {"role": "user", "content": prompt}],
            response_format={"type": "json_object"},  # forces {"answer": ..., "cited_nodes": [...]}
        )
    parsed = json.loads(resp.choices[0].message.content)
    return parsed["answer"], parsed["cited_nodes"]
```

`_CHAT_SYSTEM_PROMPT` should instruct the model to answer only from provided nodes/relationships and explicitly say when something isn't shown — directly per the original v0 doc's §2.4c constraint. This is the single most important code change in this whole document; everything else is integration plumbing around it.

## 3. Fix Specification (P0): Product Integration (resolves PRD-G03, PRD-G04)

### 3.1 Fix the global in-memory state first (blocks everything else)

`GRAPH_STORE`/`GRAPH_DATA`/`REPO_PATH` as module-level globals means one graph, for one repo, at a time — incompatible with `code_x` having many concurrent users analyzing many repos. Before this can be a real feature:

```python
# Replace module globals with a repo-keyed store
_GRAPHS: dict[str, GraphStore] = {}  # keyed by repoId or publicAnalysisId

@app.post("/parse")
def parse_repo_endpoint(req: ParseRequest) -> dict:
    ...
    _GRAPHS[req.repo_id] = GraphStore(graph_data)
    ...

@app.post("/chat")
def chat(req: ChatRequest) -> dict:
    store = _GRAPHS.get(req.repo_id)
    if store is None:
        raise HTTPException(400, "No graph for this repo — call /parse first.")
    ...
```

This mirrors `packages/retrieval`'s own earlier fix (moving off a single in-memory dict) — same class of problem, same shape of fix, and codegraph-api should persist to disk the same way retrieval now does, rather than reintroducing the "lost on restart" bug retrieval already fixed once.

### 3.2 Fold into the worker's existing analysis pipeline

`apps/worker/src/jobs/analyzeRepo.ts` already clones the repo and calls `analysis`/`retrieval`/`generation` in sequence. Add codegraph as a parallel call using the same already-cloned directory — no second clone:

```ts
// analyzeRepo.ts — alongside the existing service calls
const codegraphRes = await fetch(`${config.codegraphServiceUrl}/parse`, {
  method: "POST",
  body: JSON.stringify({ repo_id: repoId ?? publicAnalysisId, repo_path: clonedDir }),
});
```

Store the result as another `Artifact` (`artifactType: "codegraph"`, reusing the same extensible pattern as the deployment-detection and file-tree artifacts) rather than inventing a new table.

### 3.3 Fold `apps/codegraph-web`'s components into `apps/web`

Port `SidePanel.tsx`, `Toolbar.tsx`, `ChatPanel.tsx`, and the `react-force-graph-2d` setup from `page.tsx` into a new `CodeGraphTab.tsx` inside `apps/web`, following the same tab pattern as `ArchitectureTab`/`FileGraphTab`. This needs real design-system work, not a copy-paste — `codegraph-web` has its own unstyled `tailwind.config.js` and predates the "AI Lab OS" redesign (see the separate UI Revamp manual): recolor node types using `lab.blue`/`lab.card`/`lab.border` tokens, restyle the chat panel to match `ChatTab`'s existing treatment, and reuse the `eyebrow`/`section-label` header convention for consistency with every other tab.

Once ported, delete `apps/codegraph-web` and its now-redundant `package.json`/`tailwind.config.js`/etc. — don't maintain two frontends for one feature.

### 3.4 Deployment wiring

Add `codegraph-api` as a fifth Python service in `docker/Dockerfile.python-all` and `docker/start-python-services.sh` (same `--app-dir` pattern already used for the other four), on a new port (e.g. `8500`). Add to `docker-compose.yml` and to `.railway/railway.ts` / `railway/python.json`'s env — no new Railway *service* needed if it joins the existing combined `python` container the same way the other four do; just a new port and a new `CODEGRAPH_SERVICE_URL` env var on `api-worker`/`worker`.

## 4. Fix Specification (P1): Validation Harness (resolves PRD-G05, PRD-G06)

The v3 doc's Track A design (§2.1–2.3 of that doc) is sound and can be adopted close to as-written, now correctly sequenced *after* Section 2 of this TRD lands:

- `sample-repo/shop` fixture — commit it under `packages/codegraph-parser/sample-repo/`, matching the v3 doc's suggested shape (cross-file imports, a 3+-hop call chain, a name collision).
- `backend/eval/questions.json` + `run_eval.py` — 10–15 hand-written questions with expected cited nodes, scored against the now-real `/chat` endpoint. This is the actual point of building it now rather than earlier: with real generation in place, this eval produces a genuine accuracy number instead of measuring a template formatter's coverage of keyword matches (which would have told you nothing about the actual product).

## 5. Sequencing

| Step | Work | Depends on |
|---|---|---|
| 1 | Real LLM generation in codegraph-api (Section 2) | None — highest priority, do first |
| 2 | Repo-keyed graph store, replacing global state (3.1) | None — can be done in parallel with step 1 |
| 3 | Worker integration — parse call + Artifact storage (3.2) | Steps 1–2 |
| 4 | Deployment wiring (3.4) | Step 3, needed to actually reach the service from the worker |
| 5 | Frontend port into `apps/web`, delete `codegraph-web` (3.3) | Step 4, needs a real backend to call |
| 6 | Validation harness (Section 4) | Step 5 — validate the integrated feature, not a disconnected prototype |

## 6. Acceptance Criteria

- Asking a real question against a real repo through the integrated Code Graph tab returns an LLM-generated answer with `cited_nodes` that highlight real nodes in the graph — verified by comparing to the eval set's expected nodes.
- Two different repos (or two different users' analyses) can each have their own graph loaded and queried concurrently without one overwriting the other.
- `docker compose up` starts codegraph-api alongside the other four Python services with no manual step.
- `apps/codegraph-web` no longer exists in the repo; its functionality is reachable from `apps/web`'s repo analysis page.
- `run_eval.py` produces a real, documented accuracy number against the committed sample repo.
