"""Tests for the file-tree builder added for the File Graph feature (PRD-G01)."""

from analysis.main import build_file_tree


def _files_by_path(tree: dict) -> dict:
    out = {}

    def walk(node: dict) -> None:
        if node["kind"] == "file":
            out[node["path"]] = node
        for c in node["children"]:
            walk(c)

    walk(tree)
    return out


def test_empty_modules_produce_root_only_tree():
    tree = build_file_tree([])
    assert tree["kind"] == "dir"
    assert tree["children"] == []


def test_simple_nesting():
    modules = [
        {"name": "root", "files": ["main.py", "README.md"]},
        {"name": "src", "files": ["src/app.py", "src/util/helpers.py"]},
    ]
    tree = build_file_tree(modules)
    files = _files_by_path(tree)
    assert set(files.keys()) == {"main.py", "README.md", "src/app.py", "src/util/helpers.py"}
    assert files["src/app.py"]["kind"] == "file"


def test_dirs_come_before_files_and_are_sorted():
    modules = [{"name": "root", "files": ["b.py", "a_dir/x.py", "a.py"]}]
    tree = build_file_tree(modules)
    names = [c["name"] for c in tree["children"]]
    assert names == ["a_dir", "a.py", "b.py"]


def test_file_under_dir_shared_name_keeps_dir():
    # "src" as a directory must not be clobbered by a file named "src"
    modules = [
        {"name": "root", "files": ["src/app.py", "src"]},
    ]
    tree = build_file_tree(modules)
    children = {c["name"]: c for c in tree["children"]}
    assert children["src"]["kind"] == "dir"
    assert any(c["name"] == "app.py" for c in children["src"]["children"])


def test_intermediate_dirs_are_created():
    modules = [{"name": "root", "files": ["a/b/c/deep.py"]}]
    tree = build_file_tree(modules)
    a = next(c for c in tree["children"] if c["name"] == "a")
    b = next(c for c in a["children"] if c["name"] == "b")
    c = next(c for c in b["children"] if c["name"] == "c")
    assert c["children"][0]["name"] == "deep.py"


def test_root_paths_are_correct():
    modules = [{"name": "root", "files": ["main.py"]}]
    tree = build_file_tree(modules)
    child = tree["children"][0]
    assert child["path"] == "main.py"
    assert child["kind"] == "file"
