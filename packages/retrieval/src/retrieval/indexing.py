"""Indexing: persistent chunk storage with file-based persistence.

Chunks are stored in JSON files per repo, surviving restarts.
Embeddings are computed once at index time and persisted alongside each chunk.
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


def _text_hash(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()[:16]


def index_chunks(repo_id: str, chunks: list[dict]) -> int:
    """Index chunks for a repo so `search` can retrieve them. Idempotent:
    re-indexing the same repo upserts by a deterministic chunk id.
    Embeddings are computed once and persisted; unchanged chunks reuse their stored vector."""
    _ensure_storage_dir()

    # Import embedder lazily to avoid circular imports
    from .search import _get_embedder

    embedder = _get_embedder()

    # Load existing chunks for reuse of unchanged embeddings
    existing = {r["id"]: r for r in _load_chunks(repo_id)}

    records: list[dict] = []
    new_or_changed = 0
    for i, chunk in enumerate(chunks):
        start = int(chunk.get("startLine", 1))
        file_path = str(chunk.get("filePath", f"chunk-{i}"))
        text = str(chunk.get("text", ""))
        cid = _chunk_id(repo_id, file_path, start)
        th = _text_hash(text)

        # Reuse existing embedding if text hasn't changed
        if cid in existing and existing[cid].get("textHash") == th and "embedding" in existing[cid]:
            records.append(existing[cid])
        else:
            # Compute and persist embedding
            embedding = embedder.embed(text)
            records.append(
                {
                    "id": cid,
                    "repoId": repo_id,
                    "filePath": file_path,
                    "startLine": start,
                    "endLine": int(chunk.get("endLine", start)),
                    "text": text,
                    "textHash": th,
                    "embedding": embedding,
                }
            )
            new_or_changed += 1

    # Persist to disk
    _save_chunks(repo_id, records)

    return new_or_changed


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
