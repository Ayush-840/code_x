from fastapi import FastAPI
from pydantic import BaseModel
from pathlib import Path

from .parser import parse_repo
from .chunker import chunk_source

app = FastAPI(title="Vibe Coder Analysis Service")


class AnalyzeRequest(BaseModel):
    jobId: str
    repoId: str
    repoPath: str
    language: str = "auto"


class Chunk(BaseModel):
    text: str
    filePath: str
    startLine: int
    endLine: int


@app.get("/health")
def health() -> dict:
    return {"ok": True, "service": "analysis"}


@app.post("/analyze")
def analyze(req: AnalyzeRequest) -> dict:
    modules, symbols = parse_repo(req.repoPath)
    repo_root = Path(req.repoPath)
    chunks: list[Chunk] = []
    for mod in modules:
        for rel_path in mod["files"]:
            full_path = str(repo_root / rel_path)
            chunks.extend(Chunk(**c) for c in chunk_source(full_path))
    return {
        "modules": [
            {
                "name": mod["name"],
                "path": mod["path"],
                "fileCount": mod["fileCount"],
                "lineCount": mod["lineCount"],
            }
            for mod in modules
        ],
        "symbols": symbols,
        "chunks": [c.model_dump() for c in chunks],
    }