"""Tests for CodeGraph LLM generation (PRD-G01): real LLM output grounded in
retrieved graph nodes, programmatic citation extraction, provider fallback,
and honest structural degradation when providers are unavailable."""

from unittest import mock

from codegraph_api import llm

NODE = {
    "id": "src/app.py::handle_request",
    "type": "function",
    "name": "handle_request",
    "file": "src/app.py",
    "line_start": 10,
    "signature": "def handle_request(req):",
    "docstring": "Dispatches an incoming request.",
}

NEIGHBOR = {
    "id": "src/db.py::save",
    "type": "function",
    "name": "save",
    "file": "src/db.py",
    "line_start": 42,
}


class FakeRotator:
    """Stands in for shared_python's KeyRotator: same surface llm.py uses."""

    def __init__(self, *, has_keys=True, openrouter=False, fail=False, content="ok"):
        self._has_keys = has_keys
        self._openrouter = openrouter
        self._fail = fail
        self._content = content

    @property
    def has_keys(self):
        return self._has_keys

    def has_openrouter_fallback(self):
        return self._openrouter

    def execute_with_provider_fallback(self, func):
        if self._fail:
            raise RuntimeError("all keys exhausted")
        return self._content, "primary"


def rotator(**kw):
    return mock.patch.object(llm, "_rotator", return_value=FakeRotator(**kw))


# --- Chat: real LLM path ---------------------------------------------------


def test_chat_returns_llm_answer_and_filters_citations():
    raw = (
        '{"answer": "handle_request dispatches to save.", '
        '"cited_nodes": ["src/app.py::handle_request", "made-up::id", '
        '"src/db.py::save", "src/db.py::save"]}'
    )
    with rotator(content=raw):
        answer, cited = llm.generate_chat_answer("what handles requests?", [NODE, NEIGHBOR])

    assert answer == "handle_request dispatches to save."
    # Hallucinated ids dropped, duplicates deduped, order preserved.
    assert cited == ["src/app.py::handle_request", "src/db.py::save"]


def test_chat_falls_back_structurally_when_providers_fail():
    with rotator(fail=True):
        answer, cited = llm.generate_chat_answer("what handles requests?", [NODE, NEIGHBOR])

    assert "handle_request" in answer
    assert cited == [NODE["id"], NEIGHBOR["id"]]


def test_chat_uses_structural_answer_when_no_providers_configured():
    with rotator(has_keys=False, openrouter=False):
        answer, cited = llm.generate_chat_answer("what handles requests?", [NODE])

    assert "handle_request" in answer
    assert cited == [NODE["id"]]


def test_chat_with_no_nodes_never_touches_the_rotator():
    with mock.patch.object(llm, "_rotator") as m:
        answer, cited = llm.generate_chat_answer("anything", [])
    m.assert_not_called()
    assert answer == "I couldn't find any relevant code for your question."
    assert cited == []


def test_chat_empty_llm_answer_falls_back_structurally():
    with rotator(content='{"answer": "", "cited_nodes": []}'):
        answer, cited = llm.generate_chat_answer("q", [NODE])
    assert "handle_request" in answer
    assert cited == [NODE["id"]]


# --- Chat: JSON tolerance --------------------------------------------------


def test_parse_chat_json_tolerates_fences():
    raw = '```json\n{"answer": "a", "cited_nodes": ["x"]}\n```'
    assert llm._parse_chat_json(raw) == {"answer": "a", "cited_nodes": ["x"]}


def test_parse_chat_json_salvages_object_from_prose():
    raw = 'Sure! Here is the JSON: {"answer": "a", "cited_nodes": []} hope that helps'
    assert llm._parse_chat_json(raw)["answer"] == "a"


def test_parse_chat_json_returns_empty_for_garbage():
    assert llm._parse_chat_json("not json at all") == {}
    assert llm._parse_chat_json("[1, 2, 3]") == {}


def test_filter_citations_caps_at_five_and_ignores_non_strings():
    known = [f"n{i}" for i in range(8)]
    cited = ["n0", 5, None, "n1", "n2", "n3", "n4", "n5", "n0"]
    assert llm._filter_citations(cited, known) == ["n0", "n1", "n2", "n3", "n4"]
    assert llm._filter_citations("nope", known) == []
    assert llm._filter_citations(None, known) == []


# --- Explain: real LLM path ------------------------------------------------


def test_explanation_uses_llm_when_available():
    with rotator(content="An LLM-written explanation of handle_request."):
        out = llm.generate_explanation(NODE, [NEIGHBOR])
    assert out == "An LLM-written explanation of handle_request."


def test_explanation_falls_back_structurally_when_llm_fails():
    with rotator(fail=True):
        out = llm.generate_explanation(NODE, [NEIGHBOR])
    # The structural summary is faithful to the graph facts, not a refusal.
    assert "**handle_request** (function) in `src/app.py`" in out
    assert "def handle_request(req):" in out
    assert "- save (function) at `src/db.py:42`" in out


def test_explanation_uses_structural_summary_when_no_providers():
    with rotator(has_keys=False):
        out = llm.generate_explanation(NODE, [])
    assert "**handle_request** (function) in `src/app.py`" in out
    assert "RELATIONSHIPS" not in out


# --- Prompt grounding (the point of PRD-G01) -------------------------------


def test_chat_prompt_injects_question_and_verbatim_node_ids():
    prompt = llm.build_chat_prompt("how does auth work?", [NODE, NEIGHBOR])
    assert "QUESTION: how does auth work?" in prompt
    assert NODE["id"] in prompt
    assert NEIGHBOR["id"] in prompt
    assert "src/app.py:10" in prompt
    # The model is told to answer only from these nodes.
    assert "only" in prompt


def test_explain_prompt_injects_node_and_relationships():
    prompt = llm.build_explain_prompt(NODE, [NEIGHBOR])
    assert "NODE:" in prompt
    assert "RELATIONSHIPS" in prompt
    assert "handle_request" in prompt
    assert "def handle_request(req):" in prompt
    assert "save" in prompt


def test_explain_prompt_handles_isolated_node():
    prompt = llm.build_explain_prompt(NODE, [])
    assert "none in the parsed graph" in prompt
