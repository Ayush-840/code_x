from fastapi import FastAPI
from pydantic import BaseModel, Field
from pathlib import Path
import shutil
import tempfile
from typing import Any

from .parser import parse_repo
from .chunker import chunk_source
from .imports import extract_file_edges

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


def build_file_tree(modules: list[dict]) -> dict[str, Any]:
    """Nest the flat per-module file lists into a {name, path, kind, children}
    tree so the frontend can render a real file graph without another LLM call.
    Directories come first (sorted), then files (sorted) — stable ordering.
    """
    root: dict[str, Any] = {"name": "/", "path": "", "kind": "dir", "children": {}}
    for mod in modules:
        for rel_path in mod.get("files", []):
            parts = [p for p in Path(rel_path).parts if p not in ("/", "")]
            if not parts:
                continue
            node = root
            for i, part in enumerate(parts):
                is_file = i == len(parts) - 1
                children: dict[str, Any] = node["children"]
                if part not in children:
                    children[part] = {
                        "name": part,
                        "path": "/".join(parts[: i + 1]),
                        "kind": "file" if is_file else "dir",
                        "children": {},
                    }
                elif is_file and children[part]["kind"] == "dir":
                    # A directory and a file share a name (rare) — keep the dir.
                    continue
                node = children[part]

    def to_list(node: dict[str, Any]) -> dict[str, Any]:
        out = {"name": node["name"], "path": node["path"], "kind": node["kind"]}
        kids = list(node["children"].values())
        kids.sort(key=lambda c: (c["kind"] != "dir", c["name"].lower()))
        out["children"] = [to_list(c) for c in kids]
        return out

    tree = to_list(root)
    tree["name"] = "/"
    tree["path"] = ""
    return tree


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
        # Import edges between repo files — the data behind the connected-files
        # graph (selected file -> its imports / importers).
        rel_files = [f for mod in modules for f in mod["files"]]
        file_edges = extract_file_edges(repo_root, rel_files)
        chunks: list[Chunk] = []
        for mod in modules:
            for rel_path in mod["files"]:
                full_path = str(repo_root / rel_path)
                for c in chunk_source(full_path):
                    # chunk_source sees the absolute path; re-tag chunks with
                    # the repo-relative path so retrieval, citations, and the
                    # per-file explain endpoint all key on the same identity.
                    c["filePath"] = rel_path
                    chunks.append(Chunk(**c))
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
            "fileTree": build_file_tree(modules),
            "fileEdges": file_edges,
        }
    finally:
        if tmp_dir:
            shutil.rmtree(tmp_dir, ignore_errors=True)
