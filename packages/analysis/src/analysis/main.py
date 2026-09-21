from fastapi import FastAPI
from pydantic import BaseModel, Field
from pathlib import Path
import shutil
import tempfile

from .parser import parse_repo
from .chunker import chunk_source

app = FastAPI(title="Vibe Coder Analysis Service")


class AnalyzeRequest(BaseModel):
    jobId: str
    repoId: str
    # Local-dev mode: a path to the cloned repo on a shared filesystem.
    repoPath: str | None = None
    # Hosted mode: the worker ships file contents over HTTP, because the
    # analysis service runs in a different container and cannot see the
    # worker's local /tmp clone.
    files: list["FileEntry"] | None = None
    language: str = "auto"


class FileEntry(BaseModel):
    path: str
    content: str


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
    tmp_dir: str | None = None
    if req.files is not None:
        tmp_dir = tempfile.mkdtemp(prefix="vibecoder-")
        root = Path(tmp_dir).resolve()
        for f in req.files:
            target = (root / f.path).resolve()
            if not str(target).startswith(str(root)):
                continue  # path traversal guard
            target.parent.mkdir(parents=True, exist_ok=True)
            try:
                target.write_text(f.content)
            except OSError:
                continue
        repo_path = tmp_dir
    elif req.repoPath is not None:
        repo_path = req.repoPath
    else:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="Provide either repoPath or files")

    try:
        modules, symbols = parse_repo(repo_path)
        repo_root = Path(repo_path)
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
    finally:
        if tmp_dir:
            shutil.rmtree(tmp_dir, ignore_errors=True)
