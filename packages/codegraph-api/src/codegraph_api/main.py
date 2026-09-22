from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from pathlib import Path
import os
import json

from codegraph_parser import parse_repo, GraphStore, GraphData

app = FastAPI(title="CodeGraph API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

GRAPH_STORE: GraphStore | None = None
GRAPH_DATA: GraphData | None = None
REPO_PATH: str | None = None


class ParseRequest(BaseModel):
    repo_path: str


class ChatRequest(BaseModel):
    question: str


class ExplainRequest(BaseModel):
    node_id: str


@app.get("/health")
def health() -> dict:
    return {"ok": True, "service": "codegraph-api"}


@app.post("/parse")
def parse_repo_endpoint(req: ParseRequest) -> dict:
    global GRAPH_STORE, GRAPH_DATA, REPO_PATH

    repo_path = Path(req.repo_path).resolve()
    if not repo_path.exists():
        raise HTTPException(status_code=400, detail=f"Path does not exist: {repo_path}")

    REPO_PATH = str(repo_path)
    graph_data = parse_repo(str(repo_path))
    GRAPH_DATA = graph_data
    GRAPH_STORE = GraphStore(graph_data)

    graph_data.save("graph.json")

    return {
        "nodes": len(graph_data.nodes),
        "edges": len(graph_data.edges),
        "repo_path": str(repo_path),
    }


@app.get("/graph")
def get_graph() -> dict:
    if GRAPH_DATA is None:
        raise HTTPException(status_code=400, detail="No graph loaded. Call /parse first.")
    return json.loads(GRAPH_DATA.to_json())


@app.post("/explain")
def explain_node_endpoint(req: ExplainRequest) -> dict:
    """POST variant: node ids contain "/" (e.g. src/app/page.tsx::Home), which
    GET path params can't carry reliably."""
    return _explain(req.node_id)


@app.get("/node/{node_id:path}/explain")
def explain_node_get(node_id: str) -> dict:
    """:path converter so ids with slashes still match."""
    return _explain(node_id)


def _explain(node_id: str) -> dict:
    if GRAPH_STORE is None:
        raise HTTPException(status_code=400, detail="No graph loaded. Call /parse first.")

    node_data = GRAPH_STORE.get_node_data(node_id)
    if not node_data:
        raise HTTPException(status_code=404, detail=f"Node not found: {node_id}")

    neighbors = GRAPH_STORE.get_neighbors(node_id, depth=1)
    neighbor_data = [GRAPH_STORE.get_node_data(n) for n in neighbors if GRAPH_STORE.get_node_data(n)]

    explanation = _generate_explanation(node_data, neighbor_data)

    return {
        "node_id": node_id,
        "explanation": explanation,
        "neighbors": neighbors,
    }


@app.post("/chat")
def chat(req: ChatRequest) -> dict:
    if GRAPH_STORE is None or GRAPH_DATA is None:
        raise HTTPException(status_code=400, detail="No graph loaded. Call /parse first.")

    keywords = _extract_keywords(req.question)
    relevant_nodes = GRAPH_STORE.get_subgraph_for_query(keywords)

    # "module" nodes exist for every file; don't let them crowd out real hits.
    real_count = sum(1 for n in GRAPH_DATA.nodes if n.type != "module")
    if not relevant_nodes or real_count == 0:
        return {
            "answer": "This repository contains no parseable code — the graph only has file shells.",
            "cited_nodes": [],
            "relevant_nodes": relevant_nodes,
        }

    node_data = [GRAPH_STORE.get_node_data(n) for n in relevant_nodes if GRAPH_STORE.get_node_data(n)]

    answer, cited_nodes = _generate_chat_answer(req.question, node_data)

    return {
        "answer": answer,
        "cited_nodes": cited_nodes,
        "relevant_nodes": relevant_nodes,
    }


def _generate_explanation(node_data: dict, neighbors: list[dict]) -> str:
    name = node_data.get("name", "unknown")
    node_type = node_data.get("type", "unknown")
    file = node_data.get("file", "unknown")
    docstring = node_data.get("docstring")
    signature = node_data.get("signature")

    lines = [f"**{name}** ({node_type}) in `{file}`"]

    if signature:
        lines.append(f"\n```python\n{signature}\n```")

    if docstring:
        lines.append(f"\n{docstring}")

    if neighbors:
        lines.append("\n**Relationships:**")
        for n in neighbors:
            n_type = n.get("type", "unknown")
            n_name = n.get("name", "unknown")
            n_file = n.get("file", "unknown")
            n_start = n.get("line_start")
            loc = f"`{n_file}:{n_start}`" if n_start else f"`{n_file}`"
            lines.append(f"- {n_name} ({n_type}) at {loc}")

    return "\n".join(lines)


def _generate_chat_answer(question: str, nodes: list[dict]) -> tuple[str, list[str]]:
    if not nodes:
        return "I couldn't find any relevant code for your question.", []

    cited = [n["id"] for n in nodes[:5]]

    lines = [f"Based on the codebase, here's what I found for: *{question}*\n"]
    for n in nodes[:5]:
        name = n.get("name", "unknown")
        node_type = n.get("type", "unknown")
        file = n.get("file", "unknown")
        line_start = n.get("line_start")
        loc = f"{file}:{line_start}" if line_start else file
        docstring = (n.get("docstring") or "").strip()
        lines.append(f"- **{name}** ({node_type}) at `{loc}`")
        if docstring:
            lines.append(f"  {docstring}")

    return "\n".join(lines), cited


def _extract_keywords(question: str) -> list[str]:
    stopwords = {"the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for", "of", "with", "how", "what", "does", "do", "is", "are", "it", "this", "that", "i", "you", "we", "they"}
    words = question.lower().replace("?", "").replace(".", "").split()
    return [w for w in words if w not in stopwords and len(w) > 2]
