from pathlib import Path


def chunk_source(path: Path | str, max_lines: int = 120) -> list[dict]:
    """Chunk a source file into ~120-line windows."""
    text = Path(path).read_text(errors="replace").splitlines()
    if not text:
        return []
    chunks: list[dict] = []
    start = 0
    while start < len(text):
        end = min(start + max_lines, len(text))
        chunks.append(
            {
                "text": "\n".join(text[start:end]),
                "filePath": str(path),
                "startLine": start + 1,
                "endLine": end,
            }
        )
        start = end
    return chunks


SOURCE_EXTENSIONS = (
    ".py",
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".go",
    ".rs",
    ".java",
    ".rb",
    ".php",
    ".cs",
    ".c",
    ".cpp",
    ".h",
    ".hpp",
    ".swift",
    ".kt",
    ".scala",
    ".sh",
    ".yml",
    ".yaml",
    ".json",
    ".toml",
    ".css",
    ".html",
)


def is_source_file(name: str) -> bool:
    return name.endswith(SOURCE_EXTENSIONS) or name in {
        "Dockerfile",
        "Makefile",
        "Procfile",
    }