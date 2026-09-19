import os
import re
from pathlib import Path

from .chunker import is_source_file

SKIP_DIRS = {"node_modules", ".git", "dist", "build", "venv", "__pycache__", ".next"}


def parse_repo(repo_path: str) -> tuple[list[dict], list[dict]]:
    """Walk the repo, group files into modules, extract symbols best-effort."""
    root = Path(repo_path)
    modules: list[dict] = []
    symbols: list[dict] = []

    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS and not d.startswith(".")]
        rel = Path(dirpath).relative_to(root)
        src = [Path(dirpath) / f for f in filenames if is_source_file(f)]
        if not src:
            continue

        name = "root" if not rel.parts else ":".join(rel.parts)
        line_count = 0
        files: list[str] = []
        for p in src:
            if p.stat().st_size > 2_000_000:
                continue
            files.append(str(p.relative_to(root)))
            line_count += len(p.read_text(errors="replace").splitlines())

        modules.append(
            {
                "name": name,
                "path": str(rel) if rel.parts else ".",
                "fileCount": len(files),
                "lineCount": line_count,
                "files": files,
            }
        )
        for p in src:
            symbols.extend(_parse_symbols(p))

    return modules, symbols


def _parse_symbols(path: Path) -> list[dict]:
    """Best-effort symbol extraction; swap with real tree-sitter queries per
    language to get exact signatures, line ranges, and dependency edges."""
    out: list[dict] = []
    try:
        lines = path.read_text(errors="replace").splitlines()
    except OSError:
        return out

    for i, line in enumerate(lines, 1):
        stripped = line.strip()
        symbol_type = None
        if _starts_any(stripped, ("def ", "class ", "async def ", "service ")):
            symbol_type = "class" if "class " in stripped else "function"
        elif _starts_any(stripped, ("export function", "export class", "function ", "class ")):
            symbol_type = "class" if "class " in stripped else "function"
        elif _starts_any(stripped, ("type ", "interface ", "enum ")):
            symbol_type = "type"
        if symbol_type is None:
            continue
        signature = stripped.split("#")[0].rstrip(":")
        out.append(
            {
                "symbolType": symbol_type,
                "name": _first_identifier(signature),
                "signature": signature,
                "filePath": str(path),
                "startLine": i,
                "endLine": i,
                "complexity": None,
                "dependencies": [],
                "docstring": None,
            }
        )
    return out


def _starts_any(line: str, prefixes: tuple[str, ...]) -> bool:
    return any(line.startswith(p) for p in prefixes)


def _first_identifier(line: str) -> str:
    cleaned = (
        line.replace("export ", "")
        .replace("async ", "")
        .split("(", 1)[0]
        .split("=", 1)[0]
        .strip()
    )
    for token in ("def ", "class ", "function ", "interface ", "type ", "enum "):
        cleaned = cleaned.replace(token, "")
    cleaned = cleaned.strip()
    m = re.search(r"[\w$][\w$.-]*", cleaned)
    return m.group(0) if m else cleaned