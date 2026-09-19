"""Architecture overview artifact (Platform Description §3.1)."""


def build_architecture(repo_id: str, modules: list[dict]) -> dict:
    stack = _detect_stack(modules)
    return {
        "repoId": repo_id,
        "summary": (
            "High-level system overview generated from the repository's module "
            "boundaries, entry points, and detected technology stack."
        ),
        "components": [
            {
                "name": m["name"],
                "role": _infer_role(m["path"]),
                "files": m["fileCount"],
                "lines": m["lineCount"],
            }
            for m in modules[:40]
        ],
        "entryPoints": [
            {"path": m["path"], "module": m["name"]}
            for m in modules
            if _looks_like_entry(m["path"], m["name"])
        ],
        "stack": stack,
    }


def _looks_like_entry(path: str, name: str) -> bool:
    low = f"{path}/{name}".lower()
    return any(k in low for k in ("index", "main", "app", "server", "entry"))


def _infer_role(path: str) -> str:
    low = path.lower()
    if "api" in low or "route" in low or "controller" in low:
        return "API / routing layer"
    if "model" in low or "schema" in low or "entity" in low:
        return "Data model layer"
    if "service" in low or "use_case" in low:
        return "Business logic"
    if "util" in low or "helper" in low or "lib" in low:
        return "Shared utilities"
    if "test" in low or "spec" in low:
        return "Tests"
    if "config" in low or "env" in low:
        return "Configuration"
    return "Application code"


def _detect_stack(modules: list[dict]) -> dict:
    extensions: dict[str, int] = {}
    for m in modules:
        for f in m.get("files", [])[:2000]:
            ext = f.rsplit(".", 1)[-1] if "." in f else ""
            extensions[ext] = extensions.get(ext, 0) + 1
        if not m.get("files"):
            extensions[m["name"].split(":")[-1]] = (
                extensions.get(m["name"].split(":")[-1], 0) + 1
            )

    framework_loves = {
        "next": "Next.js",
        "express": "Express",
        "fastapi": "FastAPI",
        "flask": "Flask",
        "django": "Django",
        "react": "React",
        "vue": "Vue",
    }
    names = " ".join(m["name"] for m in modules).lower()
    frameworks = [v for k, v in framework_loves.items() if k in names]

    return {
        "languages": dict(sorted(extensions.items(), key=lambda kv: kv[1], reverse=True)[:8]),
        "frameworks": frameworks,
        "detected": True,
    }