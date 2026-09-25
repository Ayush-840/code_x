"""Integration tests against the REAL codegraph_parser package.

test_store.py installs a fake codegraph_parser into sys.modules (at collection
time, for the whole session) so its suite can run without tree-sitter/networkx.
That also means it can never catch a broken *real* import path: the
__init__-doesn't-export-Node/Edge bug shipped that way and only surfaced as a
crash on boot in the deployed image. These tests evict any fake from
sys.modules, import the actual package, and pin the exact import contract
store.py relies on (`from codegraph_parser import Edge, GraphData, GraphStore,
Node`), then run a parse -> persist -> reload -> query roundtrip through
codegraph_api.store backed by the real parser.

Skips cleanly when the real parser's dependencies (tree-sitter, networkx) are
not installed, so api-only unit environments are unaffected. CI installs the
deps and runs everything in one pytest session — the fake and the real module
coexist because these tests evict and restore sys.modules entries.
"""

import sys
from pathlib import Path

import pytest

# packages/codegraph-api/tests/ -> repo root
REPO_ROOT = Path(__file__).resolve().parents[3]
PARSER_SRC = REPO_ROOT / "packages" / "codegraph-parser" / "src"
API_SRC = REPO_ROOT / "packages" / "codegraph-api" / "src"

# Import resolution must not depend on how the suite was invoked (CI exports
# PYTHONPATH; a bare `pytest packages/codegraph-api` does not).
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
    """Evict the fake codegraph_parser (and modules imported against it) so
    the real package is imported fresh; restore prior state afterwards so the
    fake-based unit suites keep their isolated view."""
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
        # Drop anything imported during the test, then put back exactly what
        # was there before (the fake module, if test_store already ran).
        for key in list(sys.modules):
            if key.startswith(prefix_real):
                del sys.modules[key]
        sys.modules.update(saved)  # type: ignore[arg-type]


def _write_tiny_repo(root: Path) -> Path:
    root.mkdir(parents=True, exist_ok=True)
    pkg = root / "pkg"
    pkg.mkdir()
    (pkg / "__init__.py").write_text("")
    (pkg / "helpers.py").write_text(
        "def add(a, b):\n"
        "    return a + b\n"
    )
    (pkg / "app.py").write_text(
        "from pkg.helpers import add\n"
        "\n"
        "\n"
        "def run():\n"
        "    return add(1, 2)\n"
    )
    return root


def test_real_parser_exports_store_import_surface(real_parser_modules):
    """Pin the exact import store.py line 18 performs — the statement that
    broke when __init__.py forgot to export Node/Edge."""
    from codegraph_parser import Edge, GraphData, GraphStore, Node  # noqa: F401

    import codegraph_parser as real

    assert real.__file__ is not None
    # Guard against accidentally importing the fake from test_store.py: the
    # real package lives under packages/codegraph-parser/src.
    assert "codegraph-parser" in str(Path(real.__file__).resolve()), (
        f"expected the real codegraph_parser package, got {real.__file__}"
    )


def test_parse_persist_reload_roundtrip_with_real_parser(
    real_parser_modules, tmp_path, monkeypatch
):
    from codegraph_parser import GraphStore, parse_repo
    from codegraph_api import store

    repo = _write_tiny_repo(tmp_path / "repo-src")
    graph = parse_repo(str(repo))
    assert graph.nodes, "parser returned no nodes for a repo with functions"

    monkeypatch.setattr(store, "_STORAGE_DIR", tmp_path / "graphs")

    store.save_graph("integration-repo", str(repo), GraphStore(graph), graph)

    persisted = store._STORAGE_DIR / "integration-repo.json"
    assert persisted.exists(), "graph was not written to the storage dir"

    reloaded = store.load_graph("integration-repo")
    assert reloaded is not None
    reloaded_store, reloaded_graph = reloaded
    assert len(reloaded_graph.nodes) == len(graph.nodes)
    assert len(reloaded_graph.edges) == len(graph.edges)

    # The parser→store contract: every parsed node survives the roundtrip
    # and is queryable through the real GraphStore.
    by_id = {n.id: n for n in graph.nodes}
    for node_id, node in by_id.items():
        data = reloaded_store.get_node_data(node_id)
        assert data is not None, f"node {node_id} lost in persist/reload"
        assert data["name"] == node.name
        assert data["file"] == node.file

    # Disk-reload path (what happens after a service restart): evict the
    # in-memory entry, reload twice — the first goes to disk, the second must
    # hit the re-cached entry, which must still be a (store, graph) tuple.
    store._graphs.pop("integration-repo", None)
    first = store.load_graph("integration-repo")
    assert first is not None
    second = store.load_graph("integration-repo")
    assert second is not None
    reloaded_store2, reloaded_graph2 = second
    assert len(reloaded_graph2.nodes) == len(graph.nodes)
    assert reloaded_store2.get_node_data(next(iter(by_id))) is not None

    assert store.delete_graph("integration-repo") is True
    assert store.load_graph("integration-repo") is None
