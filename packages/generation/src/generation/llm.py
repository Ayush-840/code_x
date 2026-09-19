"""LLM completion with an offline demo mode. Every answer is grounded in the
retrieved chunks via the ^[cite:FilePath:startLine-endLine]^ marker convention
so the frontend can render citations."""

import os
import re

_SYSTEM_PROMPT = (
    "You are Vibe Coder, a senior engineer preparing a candidate to explain their "
    "own codebase in a technical interview. Answer precisely, reference real file "
    "paths and line ranges from the provided code, never invent APIs that do not "
    "exist in the code. Whenever you reference a location in the code, append a "
    "citation marker ^[cite:FilePath:startLine-endLine]^."
)


def complete(query: str, hits: list[dict]) -> tuple[str, list[dict], bool]:
    """Returns (answer, citations, isDemo)."""
    if not os.getenv("OPENAI_API_KEY"):
        return _demo_complete(query, hits)
    return _openai_complete(query, hits)


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


def _openai_complete(query: str, hits: list[dict]) -> tuple[str, list[dict], bool]:
    from openai import OpenAI

    client = OpenAI()
    context = "\n\n".join(
        "^^^ {filePath}:{startLine}-{endLine} ^^^\n{text}".format(**h) for h in hits
    )
    resp = client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": _SYSTEM_PROMPT},
            {
                "role": "user",
                "content": f"Relevant code:\n{context}\n\nQuestion: {query}",
            },
        ],
    )
    text = resp.choices[0].message.content or ""
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
