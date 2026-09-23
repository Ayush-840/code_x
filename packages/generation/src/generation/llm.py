"""LLM completion with an offline demo mode. Every answer is grounded in the
retrieved chunks via the ^[cite:FilePath:startLine-endLine]^ marker convention
so the frontend can render citations.

Uses NVIDIA NIM API (OpenAI-compatible) with automatic key rotation.
Falls back to demo mode when no API keys are configured.
"""

import os
import re
import sys
import logging

# Add shared_python to path for key_rotation import
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "..", "shared_python", "src"))

from shared.key_rotation import get_generation_rotator

logger = logging.getLogger(__name__)

_SYSTEM_PROMPT = (
    "You are Vibe Coder, a senior engineer preparing a candidate to explain their "
    "own codebase in a technical interview. Answer precisely, reference real file "
    "paths and line ranges from the provided code, never invent APIs that do not "
    "exist in the code. Whenever you reference a location in the code, append a "
    "citation marker ^[cite:FilePath:startLine-endLine]^."
)

# NVIDIA NIM models (primary provider)
NVIDIA_CHAT_MODEL = os.getenv("NVIDIA_CHAT_MODEL", "meta/llama-3.1-70b-instruct")

# OpenRouter fallback node (free tier) — used only when every primary key
# fails, so outages degrade to a slower answer instead of a demo mode stub.
OPENROUTER_CHAT_MODEL = os.getenv(
    "OPENROUTER_CHAT_MODEL", "nvidia/nemotron-3-ultra-550b-a55b:free"
)


def complete(query: str, hits: list[dict]) -> tuple[str, list[dict], bool]:
    """Returns (answer, citations, isDemo).

    Provider chain: NVIDIA keys (rotated) -> OpenRouter free-tier fallback ->
    demo mode. Demo is the last resort, so a total provider outage degrades
    honestly instead of raising into the API layer.
    """
    rotator = get_generation_rotator()
    if not rotator.has_keys and not rotator.has_openrouter_fallback():
        return _demo_complete(query, hits)
    try:
        text, _provider = _complete_via_providers(query, hits, rotator)
    except Exception as e:
        logger.error(f"[generation] All providers failed: {e}")
        return _demo_complete(query, hits)
    return text, [c for c in _citations_from(text)], False


def model_used() -> str:
    """Report which provider/model would answer right now (for /chat metadata)."""
    rotator = get_generation_rotator()
    if rotator.has_keys:
        return NVIDIA_CHAT_MODEL
    if rotator.has_openrouter_fallback():
        return OPENROUTER_CHAT_MODEL
    return "demo"


def _build_user_content(query: str, hits: list[dict]) -> str:
    context = "\n\n".join(
        "^^^ {filePath}:{startLine}-{endLine} ^^^\n{text}".format(**h) for h in hits
    )
    return f"Relevant code:\n{context}\n\nQuestion: {query}"


def _complete_via_providers(
    query: str, hits: list[dict], rotator
) -> tuple[str, str]:
    """Try NVIDIA keys first, then the OpenRouter fallback node.

    Returns (text, provider) so callers can report which model answered.
    """
    user_content = _build_user_content(query, hits)

    def _call(client, key):
        resp = client.chat.completions.create(
            model=NVIDIA_CHAT_MODEL,
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": user_content},
            ],
        )
        return resp.choices[0].message.content or ""

    if rotator.has_keys:
        try:
            return rotator.execute_with_fallback(_call), "nvidia"
        except Exception as e:
            logger.warning(f"[generation] NVIDIA path failed: {e}")
            if not rotator.has_openrouter_fallback():
                raise

    def _openrouter_call(client):
        resp = client.chat.completions.create(
            model=OPENROUTER_CHAT_MODEL,
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": user_content},
            ],
        )
        return resp.choices[0].message.content or ""

    try:
        client = rotator.get_openrouter_client()
        logger.info(
            f"[generation] using OpenRouter fallback model {OPENROUTER_CHAT_MODEL}"
        )
        return _openrouter_call(client), "openrouter"
    except Exception as e:
        logger.error(f"[generation] OpenRouter fallback failed: {e}")
        raise


def _demo_complete(query: str, hits: list[dict]) -> tuple[str, list[dict], bool]:
    if not hits:
        return (
            "[demo] No code chunks are indexed for this repo yet. Run an analysis "
            "first, then ask again.",
            [],
            True,
        )
    relevant = hits[0]
    top = "\n".join(
        f"{h['filePath']}\n{h['text'][:180]}" for h in hits[:2]
    )
    marker = (
        f"^[cite:{relevant['filePath']}:"
        f"{relevant['startLine']}-{relevant['endLine']}]^"
    )
    answer = (
        f"[demo answer] Here is how this project addresses your question about "
        f"'{query}':\n\n"
        f"The most relevant code lives in {relevant['filePath']} "
        f"(lines {relevant['startLine']}-{relevant['endLine']}), which is grounded "
        f"in the interview study guide as follows:\n\n"
        f"> {relevant['text'][:400]}\n"
        f"{marker}\n\n"
        f"Referenced context:\n{top}"
    )
    return answer, [c for c in _citations_from(answer)], True


def _nvidia_complete(
    query: str, hits: list[dict], rotator
) -> tuple[str, list[dict], bool]:
    """Backwards-compatible wrapper: NVIDIA-only, degrades to demo on failure."""
    if not rotator.has_keys:
        return _demo_complete(query, hits)
    try:
        text, _provider = _complete_via_providers(query, hits, rotator)
    except Exception as e:
        logger.error(f"[generation] All NVIDIA keys failed: {e}")
        return _demo_complete(query, hits)
    return text, [c for c in _citations_from(text)], False


def _citations_from(answer: str) -> list[dict]:
    citations: list[dict] = []
    for m in re.finditer(r"\^\[cite:([^\]]+)\]\^", answer):
        file_path, _, range_part = m.group(1).partition(":")
        start_s, _, end_s = range_part.partition("-")
        try:
            start_line = int(start_s)
            end_line = int(end_s) if end_s else start_line
        except ValueError:
            continue
        citations.append(
            {
                "filePath": file_path,
                "startLine": start_line,
                "endLine": end_line,
                "snippet": "",
            }
        )
    return citations


def citations_from_answer(answer: str) -> list[dict]:
    return list(_citations_from(answer))
