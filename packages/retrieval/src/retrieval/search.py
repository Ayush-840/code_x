"""Hybrid search: dense (embedding cosine) + sparse (BM25), fused via RRF.

The demo uses a local character n-gram embedding and rank-bm25 so retrieval
works fully offline; swapping in OpenAI + Pinecone only changes the `_dense`
function.
"""

import hashlib
import math
import os
import re
import unicodedata

from rank_bm25 import BM25Okapi

from .indexing import get_chunks
from .rrf import reciprocal_rank_fusion

_TOKEN_RE = re.compile(r"[a-zA-Z_][a-zA-Z0-9_]*")


def _tokenize(text: str) -> list[str]:
    text = unicodedata.normalize("NFKC", text).lower()
    return _TOKEN_RE.findall(text)


def _ngrams(tokens: list[str], n: int = 2) -> list[str]:
    ngrams = ["#".join(tokens[i : i + n]) for i in range(len(tokens) - n + 1)]
    return ngrams or tokens


class _LocalDenseEmbedder:
    """Deterministic hashed n-gram embedding — no external dependencies."""

    def __init__(self, dim: int = 256) -> None:
        self.dim = dim

    def embed(self, text: str) -> list[float]:
        vec = [0.0] * self.dim
        for token in _ngrams(_tokenize(text)):
            idx = int(hashlib_sha1(token)) % self.dim
            vec[idx] += 1.0
        norm = math.sqrt(sum(v * v for v in vec)) or 1.0
        return [v / norm for v in vec]


def hashlib_sha1(token: str) -> int:
    return int(hashlib.sha1(token.encode("utf-8")).hexdigest()[:8], 16)


def _cosine(a: list[float], b: list[float]) -> float:
    return sum(x * y for x, y in zip(a, b))


def _dense_search(repo_id: str, query: str, top_k: int) -> list[dict]:
    chunks = get_chunks(repo_id)
    if not chunks:
        return []
    embedder = _LocalDenseEmbedder()
    q = embedder.embed(query)
    scored = [(c, _cosine(q, embedder.embed(c["text"]))) for c in chunks]
    scored.sort(key=lambda kv: kv[1], reverse=True)
    return [
        {"id": c["id"], **{k: c[k] for k in ("filePath", "startLine", "endLine", "text")}, "score": s}
        for c, s in scored[:top_k]
    ]


def _sparse_search(repo_id: str, query: str, top_k: int) -> list[dict]:
    chunks = get_chunks(repo_id)
    if not chunks:
        return []
    corpus = [_tokenize(c["text"]) for c in chunks]
    if not any(corpus):
        return []
    bm25 = BM25Okapi(corpus)
    scores = bm25.get_scores(_tokenize(query))
    ranked = sorted(range(len(chunks)), key=lambda i: scores[i], reverse=True)
    return [
        {
            "id": chunks[i]["id"],
            **{k: chunks[i][k] for k in ("filePath", "startLine", "endLine", "text")},
            "score": float(scores[i]),
        }
        for i in ranked[:top_k]
        if scores[i] > 0
    ]


def hybrid_search(repo_id: str, query: str, top_k: int) -> dict:
    dense = _dense_search(repo_id, query, top_k)
    sparse = _sparse_search(repo_id, query, top_k)

    # If both signals agree but sparse is empty, fall back to dense alone.
    if not sparse:
        hits = dense
        fused = False
    elif not dense:
        hits = sparse
        fused = False
    else:
        hits = reciprocal_rank_fusion([dense, sparse])[:top_k]
        fused = True

    return {"hits": hits, "fused": fused, "repoId": repo_id}


def _openai_dense_search(repo_id: str, query: str, top_k: int) -> list[dict]:  # pragma: no cover
    """Production dense path — requires OPENAI_API_KEY + Pinecone."""
    from openai import OpenAI

    client = OpenAI()
    resp = client.embeddings.create(model="text-embedding-3-small", input=query)
    vector = resp.data[0].embedding
    from pinecone import Pinecone

    pc = Pinecone(api_key=os.getenv("PINECONE_API_KEY", ""))
    idx = pc.Index(os.getenv("PINECONE_INDEX", "vibecoder"))
    result = idx.query(vector=vector, top_k=top_k, namespace=repo_id, include_metadata=True)
    return [
        {
            "id": m.id,
            "filePath": m.metadata.get("filePath", ""),
            "startLine": m.metadata.get("startLine", 1),
            "endLine": m.metadata.get("endLine", 1),
            "text": m.metadata.get("text", ""),
            "score": m.score or 0.0,
        }
        for m in result.matches
    ]