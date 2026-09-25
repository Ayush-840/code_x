"""Tests for import-extraction file edges (PRD-G02 connected files)."""

from pathlib import Path

from analysis.imports import extract_file_edges


def _repo(tmp_path: Path, files: dict[str, str]) -> tuple[Path, list[str]]:
    for name, content in files.items():
        p = tmp_path / name
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content)
    return tmp_path, list(files)


def test_python_relative_absolute_and_stdlib(tmp_path):
    root, files = _repo(
        tmp_path,
        {
            "app.py": "from .util import helper\nimport os\nfrom lib import api\n",
            "util.py": "",
            "lib/api.py": "import util\n",
            "lib/__init__.py": "",
        },
    )
    edges = {(e["from"], e["to"]) for e in extract_file_edges(root, files)}

    assert ("app.py", "util.py") in edges          # from .util import helper
    assert ("app.py", "lib/api.py") in edges       # from lib import api
    assert ("lib/api.py", "util.py") in edges      # import util (resolved to root)
    # stdlib (`import os`) never resolves to a repo file.
    assert not any(t.endswith("os.py") for _, t in edges)


def test_python_multi_import_and_alias(tmp_path):
    root, files = _repo(
        tmp_path,
        {
            "main.py": "import a, b as c\nimport does_not_exist\n",
            "a.py": "",
            "b.py": "",
        },
    )
    edges = {(e["from"], e["to"]) for e in extract_file_edges(root, files)}
    assert ("main.py", "a.py") in edges
    assert ("main.py", "b.py") in edges
    assert len(edges) == 2


def test_js_relative_extensionless_and_explicit(tmp_path):
    root, files = _repo(
        tmp_path,
        {
            "src/main.ts": (
                "import { a } from './lib/util';\n"
                "import config from '../shared/config.js';\n"
                "import './styles.css';\n"
                "const x = require('../helpers/x');\n"
            ),
            "src/lib/util.ts": "",
            "src/styles.css": "",
            "shared/config.js": "",
            "helpers/x.ts": "",
        },
    )
    edges = {(e["from"], e["to"]) for e in extract_file_edges(root, files)}
    assert ("src/main.ts", "src/lib/util.ts") in edges
    assert ("src/main.ts", "shared/config.js") in edges
    assert ("src/main.ts", "src/styles.css") in edges
    assert ("src/main.ts", "helpers/x.ts") in edges


def test_js_at_alias_and_index_resolution(tmp_path):
    root, files = _repo(
        tmp_path,
        {
            "src/main.ts": "import x from '@/helpers/x';\nimport y from './lib';\n",
            "helpers/x.ts": "",
            "src/lib/index.ts": "",
        },
    )
    edges = {(e["from"], e["to"]) for e in extract_file_edges(root, files)}
    assert ("src/main.ts", "helpers/x.ts") in edges
    assert ("src/main.ts", "src/lib/index.ts") in edges


def test_bare_and_unknown_imports_are_dropped_and_edges_deduped(tmp_path):
    root, files = _repo(
        tmp_path,
        {
            "main.ts": (
                "import a from 'react';\n"
                "import b from './util';\n"
                "import c from './util';\n"
            ),
            "util.ts": "",
        },
    )
    edges = extract_file_edges(root, files)
    assert edges == [{"from": "main.ts", "to": "util.ts", "type": "import"}]


def test_self_import_skipped_config_targets_count(tmp_path):
    root, files = _repo(
        tmp_path,
        {
            "main.ts": "import './main';\nimport data from './data.json';\n",
            "data.json": "{}",
        },
    )
    edges = {(e["from"], e["to"]) for e in extract_file_edges(root, files)}
    # Self-imports never produce an edge; config/data files do (they are
    # source files per chunker.is_source_file, and real connections).
    assert not any(f == t for f, t in edges)
    assert ("main.ts", "data.json") in edges
