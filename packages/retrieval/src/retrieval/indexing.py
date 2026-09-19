"""Indexing: persistent chunk storage with file-based persistence.

Chunks are stored in JSON files per repo, surviving restarts.
Embeddings are computed on-demand using the configured embedder.
"""

import hashlib
import json
import os
from pathlib import Path

# Storage directory for persisted chunks
_STORAGE_DIR = Path(os.getenv("RETRIEVAL_STORAGE_DIR", "/tmp/vibecoder-retrieval"))


def _ensure_storage_dir() -> None:
    _STORAGE_DIR.mkdir(parents=True, exist_ok=True)


def _repo_file(repo_id: str) -> Path:
    return _STORAGE_DIR / f"{repo_id}.json"


def _chunk_id(repo_id: str, file_path: str, start_line: int) -> str:
    return hashlib.sha1(f"{repo_id}:{file_path}:{start_line}".encode()).hexdigest()[:16]


def index_chunks(repo_id: str, chunks: list[dict]) -> int:
    """Index chunks for a repo so `search` can retrieve them. Idempotent:
    re-indexing the same repo upserts by a deterministic chunk id."""
    _ensure_storage_dir()

    records: list[dict] = []
    for i, chunk in enumerate(chunks):
        start = int(chunk.get("startLine", 1))
        file_path = str(chunk.get("filePath", f"chunk-{i}"))
        cid = _chunk_id(repo_id, file_path, start)
        records.append(
            {
                "id": cid,
                "repoId": repo_id,
                "filePath": file_path,
                "startLine": start,
                "endLine": int(chunk.get("endLine", start)),
                "text": str(chunk.get("text", "")),
            }
        )

    # Load existing chunks and merge (upsert by id)
    existing = {r["id"]: r for r in _load_chunks(repo_id)}
    existing.update({r["id"]: r for r in records})
    all_chunks = list(existing.values())

    # Persist to disk
    _save_chunks(repo_id, all_chunks)

    return len(records)


def _load_chunks(repo_id: str) -> list[dict]:
    """Load chunks from disk for a repo."""
    path = _repo_file(repo_id)
    if not path.exists():
        return []
    try:
        with open(path, "r") as f:
            return json.load(f)
    except (json.JSONDecodeError, IOError):
        return []


def _save_chunks(repo_id: str, chunks: list[dict]) -> None:
    """Save chunks to disk for a repo."""
    path = _repo_file(repo_id)
    with open(path, "w") as f:
        json.dump(chunks, f, indent=2)


def get_chunks(repo_id: str) -> list[dict]:
    """Get all chunks for a repo."""
    return _load_chunks(repo_id)


def delete_repo_chunks(repo_id: str) -> bool:
    """Delete all chunks for a repo. Returns True if files existed."""
    path = _repo_file(repo_id)
    if path.exists():
        path.unlink()
        return True
    return False
