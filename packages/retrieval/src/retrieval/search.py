"""Hybrid search: dense (embedding cosine) + sparse (BM25), fused via RRF.

Uses NVIDIA NIM embeddings (OpenAI-compatible) when API keys are set,
otherwise falls back to a deterministic hashed n-gram embedding for
offline/demo mode.
"""

import hashlib
import math
import os
import re
import sys
import unicodedata
import logging

from rank_bm25 import BM25Okapi

from .indexing import get_chunks
from .rrf import reciprocal_rank_fusion

# Add shared_python to path for key_rotation import
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "..", "shared_python", "src"))

from shared.key_rotation import get_embedding_rotator

logger = logging.getLogger(__name__)

_TOKEN_RE = re.compile(r"[a-zA-Z_][a-zA-Z0-9_]*")

# NVIDIA NIM embedding model
NVIDIA_EMBED_MODEL = os.getenv("NVIDIA_EMBED_MODEL", "nvidia/nv-embedqa-e5-v5")


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


def _get_embedder():
    """Get the appropriate embedder based on environment."""
    rotator = get_embedding_rotator()
    if rotator.has_keys:
        return _NvidiaEmbedder(rotator)
    return _LocalDenseEmbedder()


class _NvidiaEmbedder:
    """Production embedding using NVIDIA NIM API with key rotation."""

    def __init__(self, rotator) -> None:
        self.rotator = rotator
        self.dim = 2048  # nemotron-3-embed-1b dimension

    def embed(self, text: str) -> list[float]:
        truncated = text[:8000]

        def _call(client, key):
            resp = client.embeddings.create(
                model=NVIDIA_EMBED_MODEL,
                input=truncated,
            )
            return resp.data[0].embedding

        return self.rotator.execute_with_fallback(_call)


def _dense_search(repo_id: str, query: str, top_k: int) -> list[dict]:
    chunks = get_chunks(repo_id)
    if not chunks:
        return []
    embedder = _get_embedder()
    q = embedder.embed(query)
    # Use stored embeddings when available, otherwise compute on the fly
    scored = []
    for c in chunks:
        stored_emb = c.get("embedding")
        if stored_emb:
            vec = stored_emb
        else:
            vec = embedder.embed(c["text"])
        scored.append((c, _cosine(q, vec)))
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
