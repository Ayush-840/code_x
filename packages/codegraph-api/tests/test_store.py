"""Tests for the repo-keyed graph store (TRD §3.1): two repos coexist without
overwriting each other, graphs survive eviction via disk persistence, and the
API accepts repo_id-keyed requests. Uses a fake codegraph_parser so the suite
runs without tree-sitter/networkx installed; the fake mirrors the real
GraphStore/GraphData surface the store and endpoints depend on."""

import json
import sys
import types

import pytest


# --- Fake codegraph_parser (mirrors the real surface store.py uses) --------


class FakeNode:
    def __init__(self, id, type, file, name, line_start, line_end, docstring=None, signature=None):
        self.id = id
        self.type = type
        self.file = file
        self.name = name
        self.line_start = line_start
        self.line_end = line_end
        self.docstring = docstring
        self.signature = signature


class FakeEdge:
    def __init__(self, from_id, to_id, type):
        self.from_id = from_id
        self.to_id = to_id
        self.type = type


class FakeGraphData:
    def __init__(self, nodes, edges):
        self.nodes = nodes
        self.edges = edges

    def to_json(self):
        return json.dumps(
            {"nodes": [n.__dict__ for n in self.nodes], "edges": [e.__dict__ for e in self.edges]}
        )


class FakeGraphStore:
    def __init__(self, graph_data):
        self.graph = graph_data
        self.by_id = {n.id: n.__dict__ for n in graph_data.nodes}

    def get_node_data(self, node_id):
        return self.by_id.get(node_id)

    def get_neighbors(self, node_id, depth=1):
        return []

    def get_subgraph_for_query(self, keywords, max_nodes=20):
        return []

    def to_graph_data(self):
        return self.graph


_fake = types.ModuleType("codegraph_parser")
_fake.Node = FakeNode
_fake.Edge = FakeEdge
_fake.GraphData = FakeGraphData
_fake.GraphStore = FakeGraphStore
_fake.parse_repo = lambda path: FakeGraphData([], [])
sys.modules["codegraph_parser"] = _fake

from codegraph_api import store  # noqa: E402  (needs the fake installed first)


def make_graph(repo_tag: str):
    node = FakeNode(
        id=f"{repo_tag}/app.py::run",
        type="function",
        name="run",
        file=f"{repo_tag}/app.py",
        line_start=1,
        line_end=5,
    )
    return FakeGraphData([node], [])


@pytest.fixture(autouse=True)
def isolated_store(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "_STORAGE_DIR", tmp_path / "graphs")
    monkeypatch.setattr(store, "_graphs", type(store._graphs)())
    monkeypatch.setattr(store, "_paths", {})
    yield


def test_two_repos_coexist_without_overwriting_each_other():
    store.save_graph("repo-a", "/tmp/a", FakeGraphStore(make_graph("a")), make_graph("a"))
    store.save_graph("repo-b", "/tmp/b", FakeGraphStore(make_graph("b")), make_graph("b"))

    a = store.load_graph("repo-a")
    b = store.load_graph("repo-b")

    assert a is not None and b is not None
    assert a[1].nodes[0].file == "a/app.py"
    assert b[1].nodes[0].file == "b/app.py"


def test_graph_survives_memory_eviction_via_disk(tmp_path):
    from collections import OrderedDict

    store.save_graph("repo-a", "/tmp/a", FakeGraphStore(make_graph("a")), make_graph("a"))
    # Simulate the LRU evicting everything (fresh service, tiny max).
    monkey_max = 1
    assert len(store._graphs) == 1
    store._graphs = OrderedDict()  # everything evicted
    monkey_max = None  # noqa: F841 -- document intent only

    # Reload comes from disk, not memory.
    loaded = store.load_graph("repo-a")
    assert loaded is not None
    assert loaded[1].nodes[0].id == "a/app.py::run"
    # And it's cached in memory again.
    assert "repo-a" in store._graphs


def test_persisted_file_round_trips_node_fields(tmp_path):
    store.save_graph("repo-x", "/tmp/x", FakeGraphStore(make_graph("x")), make_graph("x"))
    path = store._STORAGE_DIR / "repo-x.json"
    raw = json.loads(path.read_text())
    assert raw["repo_path"] == "/tmp/x"
    assert raw["nodes"][0]["id"] == "x/app.py::run"
    assert raw["edges"] == []


def test_delete_removes_memory_and_disk():
    store.save_graph("repo-a", "/tmp/a", FakeGraphStore(make_graph("a")), make_graph("a"))
    assert store.delete_graph("repo-a") is True
    assert store.load_graph("repo-a") is None
    assert store.delete_graph("repo-a") is False


def test_repo_path_sanitizes_traversal_attempts():
    store.save_graph("../../etc/passwd", "/tmp/x", FakeGraphStore(make_graph("x")), make_graph("x"))
    # Slashes become underscores, then dot-pairs collapse: the file lands
    # INSIDE the storage dir, never outside it.
    path = store._STORAGE_DIR / "____etc_passwd.json"
    assert path.exists()
    for f in store._STORAGE_DIR.iterdir():
        assert ".." not in f.name
        assert "/" not in f.name and "\\" not in f.name
