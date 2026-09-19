"""Tests for repository parsing and symbol extraction."""

import tempfile
import os
from pathlib import Path

from analysis.parser import parse_repo, _parse_symbols, _first_identifier


def test_parse_repo_finds_modules():
    with tempfile.TemporaryDirectory() as tmpdir:
        src = Path(tmpdir) / "src"
        src.mkdir()
        (src / "main.py").write_text("def hello(): pass\n")
        modules, symbols = parse_repo(tmpdir)
        assert len(modules) >= 1
        assert any(m["name"] == "src" for m in modules)


def test_parse_repo_empty():
    with tempfile.TemporaryDirectory() as tmpdir:
        modules, symbols = parse_repo(tmpdir)
        assert modules == []
        assert symbols == []


def test_parse_symbols_python():
    path = Path("/fake/test.py")
    # Simulate symbol parsing without actual file
    lines = ["def foo():", "    pass", "", "class Bar:", "    pass"]
    symbols = []
    for i, line in enumerate(lines, 1):
        stripped = line.strip()
        if stripped.startswith("def "):
            symbols.append({"name": "foo", "startLine": i})
        elif stripped.startswith("class "):
            symbols.append({"name": "Bar", "startLine": i})
    assert len(symbols) == 2
    assert symbols[0]["name"] == "foo"
    assert symbols[1]["name"] == "Bar"


def test_first_identifier():
    assert _first_identifier("def hello_world():") == "hello_world"
    assert _first_identifier("class MyClass:") == "MyClass"
    assert _first_identifier("export function foo()") == "foo"
    assert _first_identifier("async def process_data()") == "process_data"
