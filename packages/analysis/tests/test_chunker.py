"""Tests for source file chunking."""

import tempfile
from pathlib import Path

from analysis.chunker import chunk_source, is_source_file


def test_chunk_source_basic():
    with tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False) as f:
        f.write("line1\nline2\nline3\n")
        f.flush()
        chunks = chunk_source(f.name)
        assert len(chunks) == 1
        assert chunks[0]["startLine"] == 1
        assert chunks[0]["endLine"] == 3
        Path(f.name).unlink()


def test_chunk_source_empty():
    with tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False) as f:
        f.write("")
        f.flush()
        chunks = chunk_source(f.name)
        assert chunks == []
        Path(f.name).unlink()


def test_chunk_source_large():
    lines = "\n".join(f"line{i}" for i in range(300))
    with tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False) as f:
        f.write(lines)
        f.flush()
        chunks = chunk_source(f.name, max_lines=100)
        assert len(chunks) == 3
        Path(f.name).unlink()


def test_is_source_file():
    assert is_source_file("main.py") is True
    assert is_source_file("index.ts") is True
    assert is_source_file("readme.md") is False
    assert is_source_file("Dockerfile") is True
    assert is_source_file("Makefile") is True
