"""Tests for the per-file explanation builder (PRD-G02/G06)."""

from generation.files import build_file_explanation, _parse_json


def test_no_chunks_returns_honest_empty_state():
    result = build_file_explanation("ghost.py", [])
    assert result["isDemo"] is True
    assert "No indexed code chunks" in result["summary"]
    assert result["questions"] == []


def test_demo_mode_marks_output_and_cites_chunks():
    chunks = [
        {"filePath": "src/app.py", "startLine": 1, "endLine": 20, "text": "def main(): ..."},
        {"filePath": "src/app.py", "startLine": 21, "endLine": 40, "text": "class App: ..."},
    ]
    result = build_file_explanation("src/app.py", chunks)
    assert result["isDemo"] is True
    assert result["filePath"] == "src/app.py"
    assert result["citations"][0]["startLine"] == 1
    assert len(result["questions"]) >= 1
    # Summary must reference the real chunk count — grounded, not hallucinated.
    assert "2 indexed chunk" in result["summary"]


def test_parse_json_plain():
    assert _parse_json('{"summary": "ok"}') == {"summary": "ok"}


def test_parse_json_fenced():
    text = 'Here is the explanation:\n```json\n{"summary": "fenced"}\n```\nDone.'
    assert _parse_json(text) == {"summary": "fenced"}


def test_parse_json_with_prose():
    text = 'Sure! {"summary": "wrapped"} hope that helps'
    assert _parse_json(text) == {"summary": "wrapped"}


def test_parse_json_invalid_returns_none():
    assert _parse_json("no json here at all") is None
