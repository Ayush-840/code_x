import os

import httpx

from fastapi import FastAPI
from pydantic import BaseModel

from .llm import complete
from .architecture import build_architecture
from .modules import build_module_explanations
from .questions import build_question_bank

app = FastAPI(title="Vibe Coder Generation Service")

RETRIEVAL_URL = os.getenv("RETRIEVAL_SERVICE_URL", "http://localhost:8200")


class GenerateReq(BaseModel):
    jobId: str
    repoId: str
    modules: list[dict]


class ChatReq(BaseModel):
    repoId: str
    query: str


class QuestionsReq(BaseModel):
    jobId: str
    repoId: str
    modules: list[dict]


@app.get("/health")
def health() -> dict:
    return {"ok": True, "service": "generation"}


@app.post("/generate")
def generate_artifacts(req: GenerateReq) -> list[dict]:
    return [
        {"type": "architecture", "content": build_architecture(req.repoId, req.modules)},
        {"type": "modules", "content": build_module_explanations(req.repoId, req.modules)},
        {"type": "questions", "content": build_question_bank(req.repoId, req.modules)},
        {"type": "dependency-graph", "content": build_dependency_graph(req.modules)},
    ]


@app.post("/questions")
def generate_question_bank(req: QuestionsReq) -> dict:
    return build_question_bank(req.repoId, req.modules)


@app.post("/chat")
def chat(req: ChatReq) -> dict:
    """RAG call: retrieve relevant chunks, then answer with inline citations."""
    hits = _retrieve(req.repoId, req.query)
    answer, citations, is_demo = complete(req.query, hits)
    return {
        "message": answer,
        "citations": citations,
        "isDemo": is_demo,
        "modelUsed": "gpt-4o-demo" if is_demo else "gpt-4o",
    }


def _retrieve(repo_id: str, query: str, top_k: int = 8) -> list[dict]:
    try:
        with httpx.Client(timeout=5.0) as client:
            resp = client.post(
                f"{RETRIEVAL_URL}/search",
                json={"repoId": repo_id, "query": query, "top_k": top_k},
            )
            if resp.status_code == 200:
                data = resp.json()
                return data.get("hits", [])
    except Exception as exc:  # pragma: no cover
        print(f"[generation] retrieval unavailable: {exc}")
    return []


def build_dependency_graph(modules: list[dict]) -> dict:
    nodes = []
    edges = []
    for i, mod in enumerate(modules):
        nodes.append({"id": mod["name"], "label": mod["name"], "files": mod["fileCount"]})
        if i > 0:
            edges.append({"source": modules[i - 1]["name"], "target": mod["name"], "weight": 1})
    return {"nodes": nodes, "edges": edges}