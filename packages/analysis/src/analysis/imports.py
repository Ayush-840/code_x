"""Best-effort import extraction -> repo-relative file-to-file edges.

Cheap regex pass per language (no tree-sitter dependency) run over the same
file list parse_repo walks. Only edges whose target resolves to a known source
file are kept — stdlib, third-party, and aliased imports drop out silently.
"""

from __future__ import annotations

import posixpath
import re
from pathlib import Path

JS_LIKE = {".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"}
JS_INDEX_EXTENSIONS = (".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py")

_PY_FROM = re.compile(r"^\s*from\s+([.\w]+)\s+import\s+([^\n]*)")
_PY_IMPORT = re.compile(r"^\s*import\s+([^\n#]+)")
_PY_IDENT = re.compile(r"[\w]+")

_JS_PATTERNS = (
    re.compile(r"\bfrom\s*['\"]([^'\"]+)['\"]"),
    re.compile(r"\brequire\s*\(\s*['\"]([^'\"]+)['\"]\s*\)"),
    re.compile(r"\bimport\s*\(\s*['\"]([^'\"]+)['\"]\s*\)"),
    re.compile(r"^\s*import\s+['\"]([^'\"]+)['\"]", re.M),
)


def _py_specs(text: str) -> list[str]:
    """Raw import specs from Python source: module paths, dot-notation."""
    specs: list[str] = []
    for line in text.splitlines():
        m = _PY_FROM.match(line)
        if m:
            mod = m.group(1)
            specs.append(mod)
            rest = (m.group(2) or "").strip()
            if rest and not rest.startswith("("):
                for chunk in rest.split(","):
                    ident = _PY_IDENT.match(chunk.strip())
                    if ident and ident.group(0) != "*":
                        name = ident.group(0)
                        specs.append(f"{mod}{name}" if mod.endswith(".") else f"{mod}.{name}")
            continue
        m2 = _PY_IMPORT.match(line)
        if m2:
            for chunk in m2.group(1).split(","):
                name = chunk.strip().split(" as ")[0].strip()
                if name and re.fullmatch(r"[\w.]+", name):
                    specs.append(name)
    return specs


def _py_candidates(spec: str, importer: str) -> list[str]:
    """Resolve a dotted spec to candidate repo-relative file paths."""
    if spec.startswith("."):
        dots = len(spec) - len(spec.lstrip("."))
        rel = spec.lstrip(".")
        base = posixpath.dirname(importer)
        for _ in range(max(dots - 1, 0)):
            base = posixpath.dirname(base)
        prefix = rel.replace(".", "/")
        stem = posixpath.join(base, prefix) if prefix else base
    else:
        stem = spec.replace(".", "/")
    stem = stem.strip("/")
    if not stem or stem.startswith(".."):
        return []
    return [f"{stem}.py", posixpath.join(stem, "__init__.py")]


def _js_specs(text: str) -> list[str]:
    specs: list[str] = []
    for pat in _JS_PATTERNS:
        specs.extend(pat.findall(text))
    return specs


def _js_candidates(spec: str, importer: str) -> list[str]:
    """Resolve a JS/TS specifier to candidate repo-relative file paths."""
    if spec.startswith("."):
        joined = posixpath.join(posixpath.dirname(importer), spec)
        base = posixpath.normpath(joined)
        bases = [base]
    elif spec.startswith("@/"):
        raw = posixpath.normpath(spec[2:])
        # `@/x` maps to `x` in some configs and `src/x` in others — try both.
        bases = [raw, posixpath.normpath(posixpath.join("src", raw))]
    else:
        return []  # bare specifier -> node_modules / unresolvable package
    out: list[str] = []
    for b in bases:
        if b.startswith(".."):
            continue
        if posixpath.splitext(b)[1]:
            out.append(b)  # explicit extension: './x.css', './x.json'
        for ext in JS_INDEX_EXTENSIONS:
            out.append(f"{b}{ext}")
            out.append(posixpath.join(b, f"index{ext}"))
    return out


def extract_file_edges(root: Path, rel_files: list[str]) -> list[dict]:
    """Every import/require edge between known repo files.

    Returns [{"from": rel_path, "to": rel_path, "type": "import"}, ...],
    deduped, first-resolving candidate wins per (from, to) pair.
    """
    files = {posixpath.normpath(f.replace("\\", "/").lstrip("/")) for f in rel_files}
    edges: list[dict] = []
    seen: set[tuple[str, str]] = set()

    for rel in sorted(files):
        path = root / rel
        try:
            text = path.read_text(errors="replace")
        except OSError:
            continue
        ext = path.suffix.lower()
        if ext == ".py":
            specs, resolver = _py_specs(text), _py_candidates
        elif ext in JS_LIKE:
            specs, resolver = _js_specs(text), _js_candidates
        else:
            continue
        for spec in specs:
            for target in resolver(spec, rel):
                t = posixpath.normpath(target)
                if t == rel or t not in files or (rel, t) in seen:
                    continue
                seen.add((rel, t))
                edges.append({"from": rel, "to": t, "type": "import"})
                break
    return edges
