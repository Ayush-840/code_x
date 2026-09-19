"""Tests for chunk indexing and persistence."""

import json
import os
import tempfile
from pathlib import Path
from unittest.mock import patch

from retrieval.indexing import (
    _chunk_id,
    _text_hash,
    index_chunks,
    _load_chunks,
    delete_repo_chunks,
)


def test_chunk_id_deterministic():
    cid1 = _chunk_id("repo1", "src/main.py", 10)
    cid2 = _chunk_id("repo1", "src/main.py", 10)
    assert cid1 == cid2


def test_chunk_id_differs_by_file():
    cid1 = _chunk_id("repo1", "src/main.py", 10)
    cid2 = _chunk_id("repo1", "src/other.py", 10)
    assert cid1 != cid2


def test_chunk_id_differs_by_line():
    cid1 = _chunk_id("repo1", "src/main.py", 10)
    cid2 = _chunk_id("repo1", "src/main.py", 20)
    assert cid1 != cid2


def test_text_hash():
    h1 = _text_hash("hello world")
    h2 = _text_hash("hello world")
    h3 = _text_hash("different text")
    assert h1 == h2
    assert h1 != h3


def test_index_chunks_returns_count():
    with tempfile.TemporaryDirectory() as tmpdir:
        with patch("retrieval.indexing._STORAGE_DIR", Path(tmpdir)):
            count = index_chunks(
                "repo1",
                [
                    {"filePath": "a.py", "startLine": 1, "endLine": 10, "text": "hello"},
                    {"filePath": "b.py", "startLine": 5, "endLine": 15, "text": "world"},
                ],
            )
            assert count == 2


def test_index_chunks_persists():
    with tempfile.TemporaryDirectory() as tmpdir:
        with patch("retrieval.indexing._STORAGE_DIR", Path(tmpdir)):
            index_chunks(
                "repo1",
                [{"filePath": "a.py", "startLine": 1, "endLine": 10, "text": "hello"}],
            )
            chunks = _load_chunks("repo1")
            assert len(chunks) == 1
            assert chunks[0]["filePath"] == "a.py"


def test_index_chunks_upserts():
    with tempfile.TemporaryDirectory() as tmpdir:
        with patch("retrieval.indexing._STORAGE_DIR", Path(tmpdir)):
            index_chunks(
                "repo1",
                [{"filePath": "a.py", "startLine": 1, "endLine": 10, "text": "v1"}],
            )
            index_chunks(
                "repo1",
                [{"filePath": "a.py", "startLine": 1, "endLine": 10, "text": "v2"}],
            )
            chunks = _load_chunks("repo1")
            assert len(chunks) == 1
            assert chunks[0]["text"] == "v2"


def test_delete_repo_chunks():
    with tempfile.TemporaryDirectory() as tmpdir:
        with patch("retrieval.indexing._STORAGE_DIR", Path(tmpdir)):
            index_chunks(
                "repo1",
                [{"filePath": "a.py", "startLine": 1, "endLine": 10, "text": "hello"}],
            )
            assert delete_repo_chunks("repo1") is True
            assert _load_chunks("repo1") == []
            assert delete_repo_chunks("repo1") is False
