from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from pathlib import Path
import json
import os

from codegraph_parser import parse_repo, GraphStore

from codegraph_api.llm import generate_chat_answer, generate_explanation
from codegraph_api import store

app = FastAPI(title="CodeGraph API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ParseRequest(BaseModel):
    repo_path: str
    repo_id: str | None = None


class ChatRequest(BaseModel):
    question: str
    repo_id: str | None = None


class ExplainRequest(BaseModel):
    node_id: str
    repo_id: str | None = None


@app.get("/health")
def health() -> dict:
    return {"ok": True, "service": "codegraph-api"}


def _require_repo_id(req_repo_id: str | None) -> str:
    repo_id = (req_repo_id or "").strip()
    if not repo_id:
        raise HTTPException(
            status_code=400,
            detail="repo_id is required: graphs are keyed per repo, not globally.",
        )
    return repo_id


@app.post("/parse")
def parse_repo_endpoint(req: ParseRequest) -> dict:
    repo_id = _require_repo_id(req.repo_id)
    repo_path = Path(req.repo_path).resolve()
    if not repo_path.exists():
        raise HTTPException(status_code=400, detail=f"Path does not exist: {repo_path}")

    graph_data = parse_repo(str(repo_path))
    graph_store = GraphStore(graph_data)

    store.save_graph(repo_id, str(repo_path), graph_store, graph_data)

    return {
        "repo_id": repo_id,
        "nodes": len(graph_data.nodes),
        "edges": len(graph_data.edges),
        "repo_path": str(repo_path),
    }


@app.get("/graph")
def get_graph(repo_id: str) -> dict:
    loaded = store.load_graph(repo_id)
    if loaded is None:
        raise HTTPException(status_code=400, detail=f"No graph for repo {repo_id}. Call /parse first.")
    _store, graph = loaded
    return json.loads(graph.to_json())


@app.post("/explain")
def explain_node_endpoint(req: ExplainRequest) -> dict:
    """POST variant: node ids contain "/" (e.g. src/app/page.tsx::Home), which
    GET path params can't carry reliably."""
    return _explain(req.repo_id, req.node_id)


@app.get("/node/{node_id:path}/explain")
def explain_node_get(node_id: str, repo_id: str) -> dict:
    """:path converter so ids with slashes still match."""
    return _explain(repo_id, node_id)


def _explain(repo_id: str, node_id: str) -> dict:
    loaded = store.load_graph(repo_id)
    if loaded is None:
        raise HTTPException(status_code=400, detail=f"No graph for repo {repo_id}. Call /parse first.")
    graph_store, _graph = loaded

    node_data = graph_store.get_node_data(node_id)
    if not node_data:
        raise HTTPException(status_code=404, detail=f"Node not found: {node_id}")

    neighbors = graph_store.get_neighbors(node_id, depth=1)
    neighbor_data = [graph_store.get_node_data(n) for n in neighbors if graph_store.get_node_data(n)]

    explanation = generate_explanation(node_data, neighbor_data)

    return {
        "node_id": node_id,
        "explanation": explanation,
        "neighbors": neighbors,
    }


@app.post("/chat")
def chat(req: ChatRequest) -> dict:
    repo_id = _require_repo_id(req.repo_id)
    loaded = store.load_graph(repo_id)
    if loaded is None:
        raise HTTPException(400, detail=f"No graph for repo {repo_id}. Call /parse first.")
    graph_store, graph = loaded

    keywords = _extract_keywords(req.question)
    relevant_nodes = graph_store.get_subgraph_for_query(keywords)

    # "module" nodes exist for every file; don't let them crowd out real hits.
    real_count = sum(1 for n in graph.nodes if n.type != "module")
    if not relevant_nodes or real_count == 0:
        return {
            "answer": "This repository contains no parseable code — the graph only has file shells.",
            "cited_nodes": [],
            "relevant_nodes": relevant_nodes,
        }

    node_data = [graph_store.get_node_data(n) for n in relevant_nodes if graph_store.get_node_data(n)]

    answer, cited_nodes = generate_chat_answer(req.question, node_data)

    return {
        "answer": answer,
        "cited_nodes": cited_nodes,
        "relevant_nodes": relevant_nodes,
    }


def _extract_keywords(question: str) -> list[str]:
    stopwords = {"the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for", "of", "with", "how", "what", "does", "do", "is", "are", "it", "this", "that", "i", "you", "we", "they"}
    words = question.lower().replace("?", "").replace(".", "").split()
    return [w for w in words if w not in stopwords and len(w) > 2]
