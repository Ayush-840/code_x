"""Module-by-module explanations artifact (Platform Description §3.2)."""


def build_module_explanations(repo_id: str, modules: list[dict]) -> dict:
    return {
        "repoId": repo_id,
        "modules": [
            {
                "name": m["name"],
                "path": m["path"],
                "purpose": _purpose(m["name"], m["path"]),
                "abstractions": _abstractions(m["name"]),
                "walkthrough": _walkthrough(m["name"]),
                "failureModes": _failure_modes(m["path"]),
                "talkingPoints": _talking_points(m["name"], m["fileCount"], m["lineCount"]),
            }
            for m in modules[:60]
        ],
    }


def _purpose(name: str, path: str) -> str:
    friendly = name.replace(":", "/")
    return f"Groups the logic living under `{friendly}` — " + _infer_purpose(path)


def _infer_purpose(path: str) -> str:
    low = path.lower()
    if not low or low == ".":
        return "entry-level wiring, configuration, and the app bootstrap."
    if "api" in low or "route" in low or "controller" in low:
        return "HTTP surface: request parsing, auth checks, and routing to services."
    if "service" in low or "use_case" in low:
        return "business rules and orchestration that the API layer delegates to."
    if "model" in low or "schema" in low or "entity" in low or "model" in low:
        return "data shapes, persistence, and validation."
    if "util" in low or "helper" in low or "lib" in low:
        return "shared helpers reused across other modules."
    if "test" in low or "spec" in low:
        return "automated verification of behavior in other modules."
    if "config" in low or "env" in low:
        return "configuration values and environment setup."
    return "application-specific functionality."


def _abstractions(name: str) -> list[str]:
    return [
        f"{name}.module",
        f"{name}.config",
        f"{name}.public_api",
    ]


def _walkthrough(name: str) -> list[str]:
    return [
        f"1. Inputs enter {name} through its public surface.",
        "2. The module pre-processes and validates them.",
        "3. Core logic executes against its key abstractions.",
        "4. Results are shaped for the caller and returned.",
    ]


def _failure_modes(path: str) -> list[str]:
    low = path.lower()
    modes = ["Missing or malformed input causes early-return paths."]
    if "api" in low:
        modes.append("Unhandled exceptions surface as 500s unless the error middleware maps them.")
    if "service" in low:
        modes.append("Downstream dependencies (DB/queues) can fail mid-operation; retries are needed.")
    return modes


def _talking_points(name: str, file_count: int, line_count: int) -> list[str]:
    friendly = name.replace(":", "/")
    return [
        f"I can walk through the `{friendly}` module end to end.",
        f"It spans {file_count} file(s) and roughly {line_count} lines.",
        "I chose this boundary to keep coupling low and the public API small.",
        "The main failure mode I watch for is … and the code handles it by …",
    ]