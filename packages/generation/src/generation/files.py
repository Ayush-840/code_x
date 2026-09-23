"""Per-file explanation (PRD-G02 / PRD-G06): grounded in one file's actual
chunks, generated on demand, with 1–3 likely interview questions."""

import os
import re

from shared.key_rotation import get_generation_rotator

# OpenRouter fallback node (free tier) — same chain as llm.complete().
OPENROUTER_CHAT_MODEL = os.getenv(
    "OPENROUTER_CHAT_MODEL", "nvidia/nemotron-3-ultra-550b-a55b:free"
)


_SYSTEM_PROMPT = (
    "You are Vibe Coder, a senior engineer preparing a candidate to explain their "
    "own codebase in a technical interview. You are given the source of ONE file. "
    "Explain what this specific file does: its responsibility, its key "
    "functions/classes, how it connects to the rest of the codebase, and any "
    "notable design decisions or failure modes. Reference real line numbers. "
    "Never invent APIs that do not exist in the code. Then generate 1-3 likely "
    "interview questions specifically about this file, each with a strong "
    "grounded answer. "
    "Respond ONLY with JSON in this exact shape: "
    '{"summary": string, "sections": [{"heading": string, "text": string}], '
    '"questions": [{"question": string, "answer": string}], '
    '"citations": [{"filePath": string, "startLine": int, "endLine": int}]}'
)


def build_file_explanation(file_path: str, chunks: list[dict]) -> dict:
    """Grounded per-file explanation. Falls back to a demo summary built
    directly from the chunks when no LLM keys are configured."""
    context = "\n\n".join(
        "^^^ {filePath}:{startLine}-{endLine} ^^^\n{text}".format(**c) for c in chunks
    )

    try:
        rotator = get_generation_rotator()
        has_provider = rotator.has_keys or rotator.has_openrouter_fallback()
    except Exception:
        return _demo_file_explanation(file_path, chunks)
    if not has_provider:
        return _demo_file_explanation(file_path, chunks)

    try:
        from openai import OpenAI  # optional dep: live path only
    except ImportError:
        # Package installed without the openai extra — degrade to demo mode.
        return _demo_file_explanation(file_path, chunks)

    def _call(client: "OpenAI", key: str) -> str:
        resp = client.chat.completions.create(
            model=_model(),
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": f"File: {file_path}\n\nSource chunks:\n{context}\n\nExplain this file per the system instructions.",
                },
            ],
        )
        return resp.choices[0].message.content or ""

    def _openrouter_call(client: "OpenAI") -> str:
        resp = client.chat.completions.create(
            model=OPENROUTER_CHAT_MODEL,
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": f"File: {file_path}\n\nSource chunks:\n{context}\n\nExplain this file per the system instructions.",
                },
            ],
        )
        return resp.choices[0].message.content or ""

    def _finalize(text: str) -> dict:
        parsed = _parse_json(text)
        if parsed is None:
            raise ValueError("model did not return parseable JSON")
        parsed.setdefault("filePath", file_path)
        # Grounding guarantee: the explanation was generated from these exact
        # chunks, so if the model omits citations we cite those chunks anyway.
        if not parsed.get("citations"):
            parsed["citations"] = [
                {"filePath": c["filePath"], "startLine": c["startLine"], "endLine": c["endLine"]}
                for c in chunks[:5]
            ]
        return parsed

    # NVIDIA keys first; if they're exhausted/unavailable and an OpenRouter
    # fallback key exists, try the free-tier node before degrading to demo.
    if rotator.has_keys:
        try:
            text = rotator.execute_with_fallback(_call)
            return _finalize(text)
        except Exception as exc:
            if not rotator.has_openrouter_fallback():
                return _demo_file_explanation(file_path, chunks)
            print(
                f"[generation] NVIDIA path failed for file-explain ({exc}); "
                "trying OpenRouter fallback"
            )
    try:
        client = rotator.get_openrouter_client()
        text = _openrouter_call(client)
        return _finalize(text)
    except Exception as exc:
        print(f"[generation] OpenRouter fallback failed for file-explain: {exc}")
        return _demo_file_explanation(file_path, chunks)


def _model() -> str:
    import os

    return os.getenv("NVIDIA_CHAT_MODEL", "meta/llama-3.1-70b-instruct")


def _parse_json(text: str) -> dict | None:
    """Tolerant JSON extraction: models sometimes wrap JSON in prose/fences."""
    fenced = re.search(r"```(?:json)?\s*(\{.*\})\s*```", text, re.DOTALL)
    candidate = fenced.group(1) if fenced else text
    try:
        import json

        data = json.loads(candidate)
        return data if isinstance(data, dict) else None
    except (json.JSONDecodeError, ValueError):
        # Last resort: outermost-brace slice.
        start, end = candidate.find("{"), candidate.rfind("}")
        if start == -1 or end <= start:
            return None
        try:
            data = json.loads(candidate[start : end + 1])
            return data if isinstance(data, dict) else None
        except (json.JSONDecodeError, ValueError):
            return None


def _demo_file_explanation(file_path: str, chunks: list[dict]) -> dict:
    """No-LLM fallback: honest, grounded, obviously-marked demo output."""
    if not chunks:
        return {
            "filePath": file_path,
            "summary": (
                f"[demo] No indexed code chunks exist for `{file_path}`. "
                "This file may be empty, non-source, or excluded from indexing."
            ),
            "sections": [],
            "questions": [],
            "citations": [],
            "isDemo": True,
        }

    first = chunks[0]
    n_lines = sum(int(c.get("endLine", 0)) - int(c.get("startLine", 0)) + 1 for c in chunks)
    citations = [
        {"filePath": c["filePath"], "startLine": c["startLine"], "endLine": c["endLine"]}
        for c in chunks[:5]
    ]
    return {
        "filePath": file_path,
        "summary": (
            f"[demo] `{file_path}` spans roughly {n_lines} lines across "
            f"{len(chunks)} indexed chunk(s). It begins at line "
            f"{first['startLine']}; the excerpt below is the file's opening code."
        ),
        "sections": [
            {
                "heading": "Opening code",
                "text": first["text"][:600],
            }
        ],
        "questions": [
            {
                "question": f"What is the responsibility of `{file_path}` within this codebase?",
                "answer": (
                    "Grounded in its indexed chunks: it implements the logic shown "
                    f"at lines {first['startLine']}-{first['endLine']} (see citation)."
                ),
            }
        ],
        "citations": citations,
        "isDemo": True,
    }
