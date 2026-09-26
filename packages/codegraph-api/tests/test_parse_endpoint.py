"""Tests for the files-based /parse flow (cross-container worker support).

On Railway the worker ships file contents because its clone path is invisible
to this container; /parse must key the resulting graph by repo_id and serve it
back through GET /graph — the exact request sequence the API's codegraph proxy
makes.
"""

import sys
from pathlib import Path

import pytest

# packages/codegraph-api/tests/ -> repo root
REPO_ROOT = Path(__file__).resolve().parents[3]
PARSER_SRC = REPO_ROOT / "packages" / "codegraph-parser" / "src"
API_SRC = REPO_ROOT / "packages" / "codegraph-api" / "src"

for _src in (PARSER_SRC, API_SRC):
    if str(_src) not in sys.path:
        sys.path.insert(0, str(_src))


def _real_parser_deps_available() -> bool:
    try:
        import networkx  # noqa: F401
        import tree_sitter  # noqa: F401
        import tree_sitter_python  # noqa: F401
    except ImportError:
        return False
    return True


pytestmark = pytest.mark.skipif(
    not _real_parser_deps_available(),
    reason="real codegraph_parser deps (tree-sitter, networkx) not installed",
)


@pytest.fixture()
def real_parser_modules():
    """Evict the fake codegraph_parser so the real package is imported fresh;
    restore prior state afterwards (same pattern as the real-parser suite)."""
    prefix_real = ("codegraph_parser", "codegraph_api")
    saved: dict[str, object] = {}

    def _evict() -> None:
        for key in list(sys.modules):
            if key.startswith(prefix_real):
                saved[key] = sys.modules.pop(key)

    _evict()
    try:
        yield
    finally:
        for key in list(sys.modules):
            if key.startswith(prefix_real):
                del sys.modules[key]
        sys.modules.update(saved)  # type: ignore[arg-type]


FILES = [
    {"path": "pkg/__init__.py", "content": ""},
    {"path": "pkg/helpers.py", "content": "def add(a, b):\n    return a + b\n"},
    {
        "path": "pkg/app.py",
        "content": "from pkg.helpers import add\n\n\ndef run():\n    return add(1, 2)\n",
    },
]


@pytest.fixture()
def client(real_parser_modules, tmp_path, monkeypatch):
    from fastapi.testclient import TestClient

    from codegraph_api import store
    from codegraph_api.main import app

    monkeypatch.setattr(store, "_STORAGE_DIR", tmp_path / "graphs")
    monkeypatch.setattr(store, "_graphs", type(store._graphs)())
    monkeypatch.setattr(store, "_paths", {})
    return TestClient(app)


def test_parse_with_files_keys_graph_by_repo_and_serves_it(client):
    resp = client.post(
        "/parse", json={"repo_id": "worker-repo-1", "files": FILES}
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["repo_id"] == "worker-repo-1"
    assert body["nodes"] > 0, "no nodes parsed from shipped files"

    # The proxy reads the graph back with GET /graph?repo_id=...
    graph = client.get("/graph", params={"repo_id": "worker-repo-1"})
    assert graph.status_code == 200, graph.text
    data = graph.json()
    ids = {n["id"] for n in data["nodes"]}
    assert "pkg/app.py::run" in ids


def test_parse_without_files_or_path_is_400(client):
    resp = client.post("/parse", json={"repo_id": "worker-repo-2"})
    assert resp.status_code == 400
    assert "files" in resp.json()["detail"]


def test_parse_with_nonexistent_path_still_400s(client):
    resp = client.post(
        "/parse",
        json={"repo_id": "worker-repo-3", "repo_path": "/definitely/not/here"},
    )
    assert resp.status_code == 400
    assert "Path does not exist" in resp.json()["detail"]


def test_parse_files_missing_repo_id_is_400(client):
    resp = client.post("/parse", json={"files": FILES})
    assert resp.status_code == 400
