"""LLM generation for CodeGraph explain/chat (PRD-G01, PRD-G02).

Replaces the template-string formatters that previously stood in for the AI
layer (the gap the PRD calls the single highest-value fix). Every prompt
injects the real retrieved graph nodes and relationships; the chat path
forces a JSON response so cited node ids are extracted programmatically,
never hallucinated out of prose.

Provider chain mirrors packages/generation exactly (PRD-G02: reuse the
rotation infrastructure, don't build a second one): NVIDIA NIM keys rotated
via shared_python's KeyRotator, then OpenRouter's free-tier fallback node.
When no keys exist at all, generation degrades to the honest structural
summary instead of raising — the API layer never 500s on a missing env var.
"""

import json
import logging
import os
import sys

# Same pattern packages/generation/src/generation/llm.py uses to reach
# shared_python without a packaging dependency between the two trees.
sys.path.insert(
    0, os.path.join(os.path.dirname(__file__), "..", "..", "..", "shared_python", "src")
)

from shared.key_rotation import get_generation_rotator

logger = logging.getLogger(__name__)

# Small/cheap model for single-node explanations (per §2.4c of the original
# spec), stronger tier for multi-node chat synthesis.
EXPLAIN_MODEL = os.getenv("CODEGRAPH_EXPLAIN_MODEL", "meta/llama-3.1-8b-instruct")
CHAT_MODEL = os.getenv("CODEGRAPH_CHAT_MODEL", "meta/llama-3.1-70b-instruct")

_EXPLAIN_SYSTEM_PROMPT = (
    "You are CodeGraph, a tool that explains code from a parsed dependency "
    "graph. You are given one node (a file, function, or class) and its "
    "graph neighbors. Explain what the node does and how it relates to its "
    "neighbors using ONLY the provided facts — never invent files, symbols, "
    "or behavior that is not shown. Be concise: 2-5 short paragraphs "
    "maximum, markdown allowed."
)

_CHAT_SYSTEM_PROMPT = (
    "You are CodeGraph, answering questions about a codebase using ONLY the "
    "graph nodes and relationships provided in the prompt. If the provided "
    "nodes do not contain the answer, say so explicitly instead of guessing. "
    "Respond with a single JSON object, no prose outside it, shaped exactly "
    'like: {"answer": "<markdown answer>", "cited_nodes": ["<node_id>", ...]}. '
    "Every cited node id MUST be copied verbatim from the provided nodes; "
    "cite at most 5, only nodes you actually relied on."
)


def _node_brief(node: dict) -> str:
    """One compact block describing a graph node for prompt injection."""
    parts = [f"- id: {node.get('id', 'unknown')}"]
    parts.append(f"  type: {node.get('type', 'unknown')}")
    parts.append(f"  name: {node.get('name', 'unknown')}")
    file = node.get("file")
    if file:
        loc = f"{file}:{node['line_start']}" if node.get("line_start") else file
        parts.append(f"  location: {loc}")
    if node.get("signature"):
        parts.append(f"  signature: {node['signature']}")
    if node.get("docstring"):
        doc = " ".join(str(node["docstring"]).split())
        parts.append(f"  docstring: {doc[:300]}")
    return "\n".join(parts)


def build_explain_prompt(node_data: dict, neighbors: list[dict]) -> str:
    """Injection format per §2.4b of the original spec: the node, then its
    relationships, nothing else."""
    lines = ["NODE:", _node_brief(node_data)]
    if neighbors:
        lines.append("\nRELATIONSHIPS (depth-1 graph neighbors):")
        for n in neighbors:
            lines.append(_node_brief(n))
    else:
        lines.append("\nRELATIONSHIPS: none in the parsed graph.")
    lines.append(
        "\nExplain this node: what it does, and how it connects to its "
        "neighbors. Ground every claim in the facts above."
    )
    return "\n".join(lines)


def build_chat_prompt(question: str, nodes: list[dict]) -> str:
    """Relevant nodes + relationships, per §2.4b. Node ids are shown so the
    model can cite them verbatim."""
    lines = [f"QUESTION: {question}", "", "RELEVANT GRAPH NODES:"]
    for n in nodes:
        lines.append(_node_brief(n))
    lines.append(
        "\nAnswer the question using only these nodes. Reply with the JSON "
        'object {"answer": ..., "cited_nodes": [...]} — cited_nodes must be '
        "verbatim ids from the list above."
    )
    return "\n".join(lines)


def _rotator():
    return get_generation_rotator()


def _providers_ready(rotator) -> bool:
    return rotator.has_keys or rotator.has_openrouter_fallback()


def _complete(messages: list[dict], model: str, *, json_mode: bool) -> str:
    """One completion across the provider chain: NVIDIA keys rotated, then
    the OpenRouter fallback. execute_with_provider_fallback re-raises the
    primary error if OpenRouter also fails, which callers turn into the
    structural fallback."""

    def _nvidia_call(client, _key):
        kwargs = {
            "model": model,
            "messages": messages,
        }
        if json_mode:
            kwargs["response_format"] = {"type": "json_object"}
        resp = client.chat.completions.create(**kwargs)
        return resp.choices[0].message.content or ""

    rotator = _rotator()
    result, _provider = rotator.execute_with_provider_fallback(_nvidia_call)
    return result


def generate_explanation(node_data: dict, neighbors: list[dict]) -> str:
    """LLM explanation for one node, grounded in its graph neighborhood.

    Falls back to the structural summary when no provider is configured or
    every provider call fails — explain must degrade, never 500.
    """
    if not _providers_ready(_rotator()):
        logger.warning("[codegraph] no LLM keys configured; using structural explanation")
        return structural_explanation(node_data, neighbors)
    prompt = build_explain_prompt(node_data, neighbors)
    try:
        text = _complete(
            [
                {"role": "system", "content": _EXPLAIN_SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
            EXPLAIN_MODEL,
            json_mode=False,
        )
        return text.strip() or structural_explanation(node_data, neighbors)
    except Exception as e:
        logger.error(f"[codegraph] explanation generation failed: {e}")
        return structural_explanation(node_data, neighbors)


def generate_chat_answer(question: str, nodes: list[dict]) -> tuple[str, list[str]]:
    """Returns (answer, cited_nodes).

    The model must answer only from the provided nodes and cite their ids
    verbatim; citations are filtered to ids that actually exist in the
    retrieved set so a hallucinated id can never reach the UI. Falls back to
    the keyword-match summary when providers are unavailable.
    """
    if not nodes:
        return "I couldn't find any relevant code for your question.", []
    known_ids = [n.get("id", "") for n in nodes]
    if not _providers_ready(_rotator()):
        logger.warning("[codegraph] no LLM keys configured; using structural chat answer")
        return structural_chat_answer(question, nodes)
    prompt = build_chat_prompt(question, nodes)
    try:
        raw = _complete(
            [
                {"role": "system", "content": _CHAT_SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
            CHAT_MODEL,
            json_mode=True,
        )
        parsed = _parse_chat_json(raw)
        answer = (parsed.get("answer") or "").strip()
        if not answer:
            return structural_chat_answer(question, nodes)
        cited = _filter_citations(parsed.get("cited_nodes"), known_ids)
        return answer, cited
    except Exception as e:
        logger.error(f"[codegraph] chat generation failed: {e}")
        return structural_chat_answer(question, nodes)


def _parse_chat_json(raw: str) -> dict:
    """Tolerant JSON extraction: models occasionally wrap JSON in fences or
    lead with prose despite response_format; salvage the object either way."""
    text = (raw or "").strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.startswith("json"):
            text = text[4:]
        text = text.strip()
    try:
        obj = json.loads(text)
        return obj if isinstance(obj, dict) else {}
    except json.JSONDecodeError:
        start, end = text.find("{"), text.rfind("}")
        if start != -1 and end > start:
            try:
                obj = json.loads(text[start : end + 1])
                return obj if isinstance(obj, dict) else {}
            except json.JSONDecodeError:
                return {}
    return {}


def _filter_citations(cited: object, known_ids: list[str]) -> list[str]:
    """Only ids present in the retrieved node set pass — verbatim-match
    enforcement is programmatic, per PRD-G01."""
    if not isinstance(cited, list):
        return []
    known = set(known_ids)
    out: list[str] = []
    for c in cited:
        if isinstance(c, str) and c in known and c not in out:
            out.append(c)
    return out[:5]


# --- Structural fallbacks (honest degradation, not demo slop) ------------


def structural_explanation(node_data: dict, neighbors: list[dict]) -> str:
    """The previous template formatter, kept as the no-provider fallback:
    it is a faithful summary of real graph facts, which is the right thing
    to show when the LLM path is unavailable."""
    name = node_data.get("name", "unknown")
    node_type = node_data.get("type", "unknown")
    file = node_data.get("file", "unknown")

    lines = [f"**{name}** ({node_type}) in `{file}`"]

    if node_data.get("signature"):
        lines.append(f"\n```python\n{node_data['signature']}\n```")

    if node_data.get("docstring"):
        lines.append(f"\n{node_data['docstring']}")

    if neighbors:
        lines.append("\n**Relationships:**")
        for n in neighbors:
            n_type = n.get("type", "unknown")
            n_name = n.get("name", "unknown")
            n_file = n.get("file", "unknown")
            n_start = n.get("line_start")
            loc = f"`{n_file}:{n_start}`" if n_start else f"`{n_file}`"
            lines.append(f"- {n_name} ({n_type}) at {loc}")

    return "\n".join(lines)


def structural_chat_answer(question: str, nodes: list[dict]) -> tuple[str, list[str]]:
    if not nodes:
        return "I couldn't find any relevant code for your question.", []

    cited = [n["id"] for n in nodes[:5] if n.get("id")]

    lines = [f"Based on the codebase, here's what I found for: *{question}*\n"]
    for n in nodes[:5]:
        name = n.get("name", "unknown")
        node_type = n.get("type", "unknown")
        file = n.get("file", "unknown")
        line_start = n.get("line_start")
        loc = f"{file}:{line_start}" if line_start else file
        docstring = (n.get("docstring") or "").strip()
        lines.append(f"- **{name}** ({node_type}) at `{loc}`")
        if docstring:
            lines.append(f"  {docstring}")

    return "\n".join(lines), cited
