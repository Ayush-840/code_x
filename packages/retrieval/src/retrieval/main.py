from fastapi import FastAPI
from pydantic import BaseModel, Field

from .indexing import index_chunks
from .search import hybrid_search

app = FastAPI(title="Vibe Coder Retrieval Service")


class IndexReq(BaseModel):
    jobId: str
    repoId: str
    chunks: list[dict]


class SearchReq(BaseModel):
    repoId: str
    query: str
    top_k: int = Field(default=8, ge=1, le=50)


@app.get("/health")
def health() -> dict:
    return {"ok": True, "service": "retrieval"}


@app.post("/index")
def index(req: IndexReq) -> dict:
    count = index_chunks(req.repoId, req.chunks)
    return {"indexed": count}


@app.post("/search")
def search(req: SearchReq) -> dict:
    return hybrid_search(req.repoId, req.query, req.top_k)