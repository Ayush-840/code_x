import json
from pathlib import Path
from typing import Optional
from dataclasses import dataclass, asdict
from tree_sitter import Language, Parser, Node as TSNode
import tree_sitter_python as tspython
import pathspec


PY_LANGUAGE = Language(tspython.language())


@dataclass
class Node:
    id: str
    type: str
    file: str
    name: str
    line_start: int
    line_end: int
    docstring: Optional[str] = None
    signature: Optional[str] = None


@dataclass
class Edge:
    from_id: str
    to_id: str
    type: str


@dataclass
class GraphData:
    nodes: list[Node]
    edges: list[Edge]

    def to_json(self) -> str:
        return json.dumps(
            {
                "nodes": [asdict(n) for n in self.nodes],
                "edges": [asdict(e) for e in self.edges],
            },
            indent=2,
        )

    def save(self, path: str) -> None:
        Path(path).write_text(self.to_json(), encoding="utf-8")


def parse_repo(repo_path: str) -> GraphData:
    parser = Parser()
    parser.language = PY_LANGUAGE

    root = Path(repo_path).resolve()
    spec = _load_gitignore(root)

    nodes: list[Node] = []
    edges: list[Edge] = []
    file_imports: dict[str, list[str]] = {}

    for py_file in _walk_python_files(root, spec):
        rel_path = py_file.relative_to(root).as_posix()
        try:
            raw = py_file.read_bytes()
        except Exception:
            continue

        tree = parser.parse(raw)
        file_nodes, file_edges, imports = _extract_from_file(tree, raw, rel_path)
        nodes.extend(file_nodes)
        edges.extend(file_edges)
        if imports:
            file_imports[rel_path] = imports

    _resolve_import_edges(nodes, edges, file_imports, root)

    return GraphData(nodes=nodes, edges=edges)


def _normalize_rel_path(raw: str) -> str:
    """Normalize a worker-supplied path to a clean repo-relative POSIX path.

    These strings become node ids (never filesystem paths), but consistent
    normalization keeps ids identical to what parse_repo would emit for the
    same tree: no leading slash, forward slashes, '.'/'..' segments resolved.
    """
    parts: list[str] = []
    for seg in raw.replace("\\", "/").split("/"):
        if seg in ("", "."):
            continue
        if seg == "..":
            if parts:  # climbing above the root just clamps
                parts.pop()
            continue
        parts.append(seg)
    return "/".join(parts)


def parse_files(files: list[dict]) -> GraphData:
    """Parse an in-memory file list instead of a filesystem path.

    The worker (Node container) and this service (Python container) are separate
    containers in production: a cloned-repo path in the worker is invisible
    here, which is why /parse with repo_path 400'd on every hosted analysis and
    no graph was ever generated. The worker already ships file contents to the
    analysis service for the same reason — accept the same shape
    ([{path, content}, ...]) and parse it directly. Only *.py entries are
    meaningful to the tree-sitter-python grammar; everything else is ignored,
    and paths are normalized so node ids match what parse_repo would emit.
    """
    parser = Parser()
    parser.language = PY_LANGUAGE

    nodes: list[Node] = []
    edges: list[Edge] = []
    file_imports: dict[str, list[str]] = {}

    for entry in files:
        rel_path = _normalize_rel_path(str(entry.get("path", "")))
        if not rel_path or not rel_path.endswith(".py"):
            continue
        try:
            raw = str(entry.get("content", "")).encode("utf-8")
        except Exception:
            continue

        tree = parser.parse(raw)
        file_nodes, file_edges, imports = _extract_from_file(tree, raw, rel_path)
        nodes.extend(file_nodes)
        edges.extend(file_edges)
        if imports:
            file_imports[rel_path] = imports

    _resolve_import_edges(nodes, edges, file_imports, Path("."))

    return GraphData(nodes=nodes, edges=edges)


def _load_gitignore(root: Path) -> pathspec.PathSpec:
    gitignore_path = root / ".gitignore"
    patterns = []
    if gitignore_path.exists():
        patterns = gitignore_path.read_text(encoding="utf-8").splitlines()
    patterns.extend(["__pycache__", "*.pyc", ".git", "venv", "env", ".venv"])
    return pathspec.PathSpec.from_lines("gitwildmatch", patterns)


def _walk_python_files(root: Path, spec: pathspec.PathSpec) -> list[Path]:
    files = []
    for path in root.rglob("*.py"):
        try:
            rel = path.relative_to(root)
            if not spec.match_file(rel.as_posix()):
                files.append(path)
        except Exception:
            pass
    return files


def _txt(src: bytes, node: TSNode) -> str:
    """Decode a tree-sitter node's source text.

    tree-sitter reports BYTE offsets; slicing a str with them silently
    corrupts every extraction after the first multi-byte character (an
    em-dash in a comment is enough). Always slice bytes, then decode.
    """
    return src[node.start_byte : node.end_byte].decode("utf-8", errors="replace")


def _extract_from_file(
    tree, src: bytes, rel_path: str
) -> tuple[list[Node], list[Edge], list[str]]:
    nodes: list[Node] = []
    edges: list[Edge] = []
    imports: list[str] = []

    content = src.decode("utf-8", errors="replace")
    lines = content.splitlines()
    module_node = Node(
        id=f"{rel_path}::module",
        type="module",
        file=rel_path,
        name=rel_path,
        line_start=1,
        line_end=max(len(lines), 1),
        docstring=_get_module_docstring(tree, src),
    )
    nodes.append(module_node)

    for node in tree.root_node.children:
        if node.type == "import_statement":
            imports.extend(_extract_imports(node, src))
        elif node.type == "import_from_statement":
            imports.extend(_extract_from_imports(node, src))
        elif node.type in ("function_definition", "async_function_definition"):
            func_node, func_edges = _extract_function(node, src, rel_path, module_node.id)
            nodes.append(func_node)
            edges.extend(func_edges)
        elif node.type == "class_definition":
            class_nodes, class_edges = _extract_class(node, src, rel_path, module_node.id)
            nodes.extend(class_nodes)
            edges.extend(class_edges)

    return nodes, edges, imports


def _get_module_docstring(tree, src: bytes) -> Optional[str]:
    if not tree.root_node.children:
        return None
    first = tree.root_node.children[0]
    if first.type == "expression_statement":
        child = first.child(0)
        if child and child.type == "string":
            return _strip_docstring(_txt(src, child))
    return None


def _extract_imports(node: TSNode, src: bytes) -> list[str]:
    imports = []
    for child in node.children:
        if child.type == "dotted_name":
            imports.append(_txt(src, child))
        elif child.type == "aliased_import":
            for c in child.children:
                if c.type == "dotted_name":
                    imports.append(_txt(src, c))
    return imports


def _extract_from_imports(node: TSNode, src: bytes) -> list[str]:
    """Extract imports from `from X import a, b` statements, positional on the
    tree: module = children before the `import` keyword, imported names =
    after. Handles the single-name case where there is no `import_list` node
    (a bare `dotted_name` sits directly after `import`)."""
    imports: list[str] = []
    module_parts: list[str] = []
    names: list[str] = []
    seen_import_kw = False
    for child in node.children:
        if child.type == "import":
            seen_import_kw = True
            continue
        if child.type == "relative_import":
            module_parts.append(_txt(src, child).replace(".", "").strip())
            continue
        if not seen_import_kw and child.type == "dotted_name":
            module_parts.append(_txt(src, child))
        elif seen_import_kw and child.type in ("dotted_name", "identifier"):
            names.append(_txt(src, child))
    module = "".join(module_parts)
    for name in names:
        imports.append(f"{module}.{name}" if module else name)
    return imports


def _extract_function(
    node: TSNode, src: bytes, rel_path: str, container_id: str, class_id: Optional[str] = None
) -> tuple[Node, list[Edge]]:
    name_node = node.child_by_field_name("name")
    name = _txt(src, name_node) if name_node else "unknown"

    docstring = _get_function_docstring(node, src)
    signature = _get_signature(node, src)

    # Decide the id at creation (methods nest under their class, free
    # functions under their module) so edges can reference the final id.
    func_id = f"{class_id}.{name}" if class_id else f"{rel_path}::{name}"
    func_node = Node(
        id=func_id,
        type="function",
        file=rel_path,
        name=name,
        line_start=node.start_point[0] + 1,
        line_end=node.end_point[0] + 1,
        docstring=docstring,
        signature=signature,
    )

    edges = [Edge(from_id=container_id, to_id=func_id, type="contains")]

    # TreeCursor (Node.walk()) is not iterable in py-tree-sitter — traverse
    # the subtree manually to collect call sites.
    for descendant in _iter_descendants(node):
        if descendant.type == "call":
            call_name = _get_call_name(descendant, src)
            if call_name:
                edges.append(Edge(from_id=func_id, to_id=call_name, type="calls"))

    return func_node, edges


def _extract_class(
    node: TSNode, src: bytes, rel_path: str, module_id: str
) -> tuple[list[Node], list[Edge]]:
    name_node = node.child_by_field_name("name")
    name = _txt(src, name_node) if name_node else "unknown"

    docstring = _get_class_docstring(node, src)

    class_id = f"{rel_path}::{name}"
    class_node = Node(
        id=class_id,
        type="class",
        file=rel_path,
        name=name,
        line_start=node.start_point[0] + 1,
        line_end=node.end_point[0] + 1,
        docstring=docstring,
    )

    nodes_out: list[Node] = [class_node]
    edges: list[Edge] = [Edge(from_id=module_id, to_id=class_id, type="contains")]

    for child in node.children:
        if child.type == "block":
            for item in child.children:
                if item.type in ("function_definition", "async_function_definition"):
                    # Methods nest under their CLASS (contains edge from the
                    # class, id qualified by it) — and are actually collected.
                    method_node, method_edges = _extract_function(
                        item, src, rel_path, class_id, class_id
                    )
                    nodes_out.append(method_node)
                    edges.extend(method_edges)

    return nodes_out, edges


def _iter_descendants(root: TSNode):
    stack = [root]
    while stack:
        n = stack.pop()
        yield n
        stack.extend(n.children)


def _strip_docstring(raw: str) -> str:
    return raw.strip().strip("\"'").strip()


def _get_function_docstring(node: TSNode, src: bytes) -> Optional[str]:
    body = node.child_by_field_name("body")
    if not body or not body.children:
        return None
    first = body.children[0]
    if first.type == "expression_statement":
        child = first.child(0)
        if child and child.type == "string":
            return _strip_docstring(_txt(src, child))
    return None


def _get_class_docstring(node: TSNode, src: bytes) -> Optional[str]:
    return _get_function_docstring(node, src)


def _get_signature(node: TSNode, src: bytes) -> str:
    body = node.child_by_field_name("body")
    if body:
        return _txt(src, node).rsplit(":", 1)[0].strip()
    return _txt(src, node).strip()


def _get_call_name(node: TSNode, src: bytes) -> Optional[str]:
    func = node.child_by_field_name("function")
    if not func:
        return None
    if func.type == "identifier":
        return _txt(src, func)
    if func.type == "attribute":
        attr = func.child_by_field_name("attribute")
        if attr:
            return _txt(src, attr)
    return None


def _resolve_import_edges(
    nodes: list[Node], edges: list[Edge], file_imports: dict[str, list[str]], root: Path
) -> None:
    # Index every node under its bare name and its qualified tail so imports
    # and calls resolve to real nodes.
    node_by_name: dict[str, Node] = {}
    for n in nodes:
        node_by_name.setdefault(n.name, n)
        node_by_name.setdefault(n.id.split("::")[-1], n)
        if n.type == "module":
            # Index modules by stem and path so `from .nodes import x` and
            # `from pkg import nodes` can resolve to the module node.
            stem = Path(n.file).stem
            node_by_name.setdefault(stem, n)
            node_by_name.setdefault(n.file, n)
            node_by_name.setdefault(n.file.removesuffix(".py"), n)
        elif n.type in ("function", "class"):
            # Composite keys so `from .nodes import make_node` resolves to the
            # symbol itself, not just its module.
            stem = Path(n.file).stem
            node_by_name.setdefault(f"{stem}.{n.name}", n)
            node_by_name.setdefault(f"{n.file.removesuffix('.py')}.{n.name}", n)

    existing = {(e.from_id, e.to_id, e.type) for e in edges}
    resolved: list[Edge] = []
    node_ids = {n.id for n in nodes}

    def add(edge: Edge) -> None:
        key = (edge.from_id, edge.to_id, edge.type)
        # Gate on the ID SET: import targets are node ids, not name-index keys.
        if edge.to_id in node_ids and key not in existing:
            existing.add(key)
            resolved.append(edge)

    # imports: file-level import statements → edges from that file's symbols
    for file_path, imports in file_imports.items():
        for imp in imports:
            parts = imp.split(".")
            for i in range(len(parts), 0, -1):
                candidate = ".".join(parts[:i])
                if candidate in node_by_name:
                    for n in nodes:
                        if n.file == file_path and n.type in ("function", "class"):
                            add(Edge(from_id=n.id, to_id=node_by_name[candidate].id, type="imports"))
                    break

    # calls: "calls" edges point at bare/attribute names — rewire them to the
    # defining node's id so they connect instead of dangling. Compare against
    # the ID SET, not the name index: a bare call name like `_txt` is a key in
    # node_by_name while not being any node's id.
    for e in edges:
        if e.type == "calls" and e.to_id not in node_ids:
            target = node_by_name.get(e.to_id) or node_by_name.get(e.to_id.split(".")[-1])
            if target and target.id != e.from_id:
                e.to_id = target.id

    edges.extend(resolved)

    # Prune edges that still reference non-existent nodes (builtin/stdlib
    # calls like `append` or `len` have no defining node here) so the served
    # graph is always internally consistent.
    edges[:] = [e for e in edges if e.from_id in node_ids and e.to_id in node_ids]
