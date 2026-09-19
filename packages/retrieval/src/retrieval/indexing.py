"""Indexing: dense embeddings (OpenAI/Pinecone or a local fallback) plus a
sparse BM25 corpus stored in-memory (and optionally mirrored to OpenSearch)."""

import hashlib
import os

# artifact id -> chunk metadata + text, per repo
_CHUNKS: dict[str, list[dict]] = {}

_OPENSEARCH_URL = os.getenv("OPENSEARCH_URL", "http://localhost:9200")
_INDEX_NAME = "code_chunks"


def _chunk_id(repo_id: str, file_path: str, start_line: int) -> str:
    return hashlib.sha1(f"{repo_id}:{file_path}:{start_line}".encode()).hexdigest()[:16]


def index_chunks(repo_id: str, chunks: list[dict]) -> int:
    """Index chunks for a repo so `search` can retrieve them. Idempotent:
    re-indexing the same repo upserts by a deterministic chunk id."""
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

    existing = {r["id"]: r for r in _CHUNKS.get(repo_id, [])}
    existing.update({r["id"]: r for r in records})
    _CHUNKS[repo_id] = list(existing.values())

    _mirror_to_opensearch(repo_id, records)
    return len(records)


def _mirror_to_opensearch(repo_id: str, records: list[dict]) -> None:
    """Best-effort mirror to OpenSearch. Swallows errors so the demo keeps
    working without it."""
    try:
        import httpx

        body = ""
        for r in records:
            body += (
                '{"index": {"_index": "%s"}}\n'
                '{"id": "%s", "repoId": "%s", "filePath": "%s", '
                '"startLine": %d, "endLine": %d, "text": %s}\n'
                % (
                    _INDEX_NAME,
                    r["id"],
                    r["repoId"],
                    r["filePath"].replace('"', '\\"'),
                    r["startLine"],
                    r["endLine"],
                    _json_escape(r["text"]),
                )
            )
        if body:
            # create index if missing, then bulk
            with httpx.Client(timeout=5.0) as client:
                try:
                    client.put(f"{_OPENSEARCH_URL}/{_INDEX_NAME}")
                except Exception:
                    pass
                client.post(
                    f"{_OPENSEARCH_URL}/_bulk",
                    content=body,
                    headers={"Content-Type": "application/x-ndjson"},
                )
    except Exception as exc:  # pragma: no cover
        print(f"[retrieval] OpenSearch mirror skipped: {exc}")


def _json_escape(text: str) -> str:
    import json

    return json.dumps(text, ensure_ascii=False)


def get_chunks(repo_id: str) -> list[dict]:
    return _CHUNKS.get(repo_id, [])