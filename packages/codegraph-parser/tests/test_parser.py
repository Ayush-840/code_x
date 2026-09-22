"""Parser regression tests.

These pin the three bug classes that produced a corrupted/empty graph in
production:
1. byte-vs-str source slicing (tree-sitter reports byte offsets),
2. method ids (must be final at creation, edges must reference them),
3. edge resolution (calls/imports rewired to real nodes, deduped, no dangling).
"""

import sys
import textwrap
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from codegraph_parser.parser import (  # noqa: E402
    _extract_function,
    _txt,
    parse_repo,
)


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    """A tiny repo exercising every extractor: multibyte comments, classes,
    methods, free functions, calls, relative imports, base64 blobs."""
    (tmp_path / ".gitignore").write_text("")
    (tmp_path / "pkg").mkdir()
    (tmp_path / "pkg" / "__init__.py").write_text("")
    # em-dash and CJK in comments: any str-index slicing bug corrupts the
    # identifiers extracted AFTER these characters.
    (tmp_path / "pkg" / "store.py").write_text(
        textwrap.dedent(
            '''\
            """Store — the graph store. 中文注释 too."""
            from .nodes import make_node  # relative import → imports edge


            class GraphStore:
                """Holds the — graph."""

                def get_neighbors(self, node_id: str, depth: int = 1) -> list[str]:
                    """Return — neighbors up to depth."""
                    seen = set()
                    current = make_node(node_id)
                    return sorted(seen | current)

                def _short(self, x: str) -> str:
                    return make_node(x)


            def standalone(payload: bytes) -> int:
                logo = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ"
                return len(payload) + len(logo)
            '''
        )
    )
    (tmp_path / "pkg" / "nodes.py").write_text(
        "def make_node(x):\n    return x\n"
    )
    return tmp_path


# --------------------------------------------------------------- byte slicing


def test_txt_decodes_byte_offsets_with_multibyte_source():
    from tree_sitter import Language, Parser
    import tree_sitter_python as tspython

    src = 'x = "日本語"  # em—dash\ny = after_multibyte_identifier'.encode()
    parser = Parser()
    parser.language = Language(tspython.language())
    tree = parser.parse(src)
    assign = tree.root_node.children[0]
    # A str-slice implementation would mis-index everything after 日本語.
    assert _txt(src, assign).startswith('x = "日本語"')


def test_names_survive_multibyte_comments(repo: Path):
    g = parse_repo(str(repo))
    names = {n.name for n in g.nodes}
    # Every identifier must be whole — no mid-token fragments like "t_subgraph(s".
    assert "get_neighbors" in names
    assert "standalone" in names
    assert "GraphStore" in names
    for n in g.nodes:
        assert "(" not in n.name and " " not in n.name


def test_docstrings_and_lines_survive_multibyte(repo: Path):
    g = parse_repo(str(repo))
    by_name = {n.name: n for n in g.nodes}
    assert "—" in by_name["GraphStore"].docstring
    assert by_name["get_neighbors"].docstring.startswith("Return")


# ---------------------------------------------------------------- method ids


def test_methods_get_class_qualified_ids(repo: Path):
    g = parse_repo(str(repo))
    ids = {n.id for n in g.nodes}
    store = "pkg/store.py::GraphStore"
    assert f"{store}.get_neighbors" in ids
    assert f"{store}._short" in ids
    # …and they are real method nodes, not just contains-edge labels.
    types = {n.id: n.type for n in g.nodes}
    assert types[f"{store}.get_neighbors"] == "function"


def test_method_node_has_signature_and_location(repo: Path):
    g = parse_repo(str(repo))
    node = next(
        n for n in g.nodes if n.id.endswith("GraphStore.get_neighbors")
    )
    assert node.signature.startswith("def get_neighbors")
    assert node.line_start > 1 and node.line_end >= node.line_start


# ------------------------------------------------------------ edge resolution


def _edges(g, kind):
    return [(e.from_id, e.to_id) for e in g.edges if e.type == kind]


def test_no_dangling_edges(repo: Path):
    g = parse_repo(str(repo))
    ids = {n.id for n in g.nodes}
    dangling = [
        e for e in g.edges if e.from_id not in ids or e.to_id not in ids
    ]
    assert dangling == []


def test_calls_resolve_to_defining_nodes(repo: Path):
    g = parse_repo(str(repo))
    calls = _edges(g, "calls")
    caller = "pkg/store.py::GraphStore.get_neighbors"
    assert ("pkg/store.py::GraphStore.get_neighbors", "pkg/nodes.py::make_node") in [
        (f, t) for f, t in calls if f == caller
    ] or any(t.endswith("::make_node") for f, t in calls if f == caller)


def test_relative_import_creates_imports_edge(repo: Path):
    g = parse_repo(str(repo))
    imports = _edges(g, "imports")
    assert any(t.endswith("::make_node") for _, t in imports)


def test_contains_wires_modules_classes_methods(repo: Path):
    g = parse_repo(str(repo))
    contains = _edges(g, "contains")
    module = "pkg/store.py::module"
    cls = "pkg/store.py::GraphStore"
    assert (module, cls) in contains
    # Methods hang off their class, not the module.
    assert (cls, "pkg/store.py::GraphStore._short") in contains
    assert (module, "pkg/store.py::GraphStore._short") not in contains


def test_edges_are_deduped(repo: Path):
    g = parse_repo(str(repo))
    keys = [(e.from_id, e.to_id, e.type) for e in g.edges]
    assert len(keys) == len(set(keys))


def test_builtin_calls_are_pruned_not_dangling(repo: Path):
    g = parse_repo(str(repo))
    targets = {t for _, t in _edges(g, "calls")}
    # `sorted`/`set`/`len` have no defining node in the repo — they must not
    # appear as (dangling) edge targets.
    assert "sorted" not in targets and "len" not in targets


def test_base64_blob_does_not_break_extraction(repo: Path):
    g = parse_repo(str(repo))
    node = next(n for n in g.nodes if n.name == "standalone")
    assert node.line_end >= node.line_start


def test_extract_function_ids_are_final_before_edges():
    """The old bug: edges referenced pre-rename ids. Build a method directly
    and verify its contains-edge points at the final id."""
    from tree_sitter import Language, Parser
    import tree_sitter_python as tspython

    src = textwrap.dedent(
        """\
        class C:
            def m(self):
                helper()
        """
    ).encode()
    parser = Parser()
    parser.language = Language(tspython.language())
    tree = parser.parse(src)
    cls = tree.root_node.children[0]
    body = cls.child_by_field_name("body")
    method = body.children[0]
    node, edges = _extract_function(method, src, "f.py", "f.py::module", "f.py::C")
    assert node.id == "f.py::C.m"
    assert ("f.py::module", "f.py::C.m") in [(e.from_id, e.to_id) for e in edges]
    assert all(e.to_id != "m" for e in edges)
