"""Tests for parse_files: the in-memory parse entry point.

The worker (Node container) ships [{path, content}, ...] to the codegraph
service because the worker's clone path is invisible across containers on
Railway. parse_files must produce the same node/edge shapes parse_repo does
for an on-disk tree, keyed by repo-relative paths.
"""

from pathlib import Path

import pytest

from codegraph_parser import parse_files, parse_repo


def _files():
    return [
        {"path": "pkg/__init__.py", "content": ""},
        {"path": "pkg/helpers.py", "content": "def add(a, b):\n    return a + b\n"},
        {
            "path": "pkg/app.py",
            "content": "from pkg.helpers import add\n\n\ndef run():\n    return add(1, 2)\n",
        },
        # Non-python files must be ignored, not crash the parser.
        {"path": "README.md", "content": "# hello\n"},
    ]


def test_parse_files_returns_nodes_with_repo_relative_paths():
    graph = parse_files(_files())
    assert graph.nodes, "no nodes parsed from in-memory files"

    ids = {n.id for n in graph.nodes}
    assert "pkg/app.py::run" in ids
    assert "pkg/helpers.py::add" in ids

    files = {n.file for n in graph.nodes}
    assert "README.md" not in files, "non-python file produced nodes"
    assert all(not f.startswith("/") for f in files), "paths must stay repo-relative"


def test_parse_files_matches_parse_repo_output():
    """The in-memory path and the on-disk path must agree on node ids."""
    tmp = Path(__file__).parent / "_tmp_parse_files_repo"
    try:
        pkg = tmp / "pkg"
        pkg.mkdir(parents=True, exist_ok=True)
        (pkg / "__init__.py").write_text("")
        (pkg / "helpers.py").write_text("def add(a, b):\n    return a + b\n")
        (pkg / "app.py").write_text("from pkg.helpers import add\n\n\ndef run():\n    return add(1, 2)\n")

        on_disk = parse_repo(str(tmp))
    finally:
        import shutil

        shutil.rmtree(tmp, ignore_errors=True)

    in_memory = parse_files(_files())
    assert {n.id for n in on_disk.nodes} == {n.id for n in in_memory.nodes}


def test_parse_files_connects_imported_helpers():
    """app.py's use of add() must surface as a cross-file edge. Pre-existing
    parser behavior wires this through the "calls" edge (rewired to the
    defining node in _resolve_import_edges) rather than an "imports" edge —
    assert the connection, not the label.
    """
    graph = parse_files(_files())
    pairs = {(e.from_id, e.to_id) for e in graph.edges}
    assert ("pkg/app.py::run", "pkg/helpers.py::add") in pairs


def test_parse_files_skips_empty_and_malformed_entries():
    graph = parse_files(
        [
            {"path": "", "content": "x = 1"},
            {"path": "ok.py", "content": "def f():\n    pass\n"},
            # A missing content string parses as an empty (docstring-less)
            # module shell — harmless, must not raise.
            {"path": "no_content.py"},
        ]
    )
    ids = {n.id for n in graph.nodes}
    assert "ok.py::f" in ids
    assert "no_content.py::module" in ids


def test_parse_files_empty_input_yields_empty_graph():
    graph = parse_files([])
    assert graph.nodes == [] and graph.edges == []


@pytest.mark.parametrize(
    "bad_path",
    ["/abs/path/mod.py", "..\\escape\\mod.py", "a/../../b/mod.py"],
)
def test_parse_files_normalizes_hostile_paths(bad_path):
    graph = parse_files([{"path": bad_path, "content": "def f():\n    pass\n"}])
    assert graph.nodes, f"path {bad_path!r} was dropped entirely"
    for n in graph.nodes:
        assert not n.file.startswith("/")
        assert ".." not in n.file.split("/")
