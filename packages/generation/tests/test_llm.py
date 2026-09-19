"""Tests for citation parsing in LLM responses."""

from generation.llm import _citations_from, _demo_complete


def test_citations_basic():
    answer = "Look at src/main.py ^[cite:src/main.py:10-20]^ for details."
    citations = _citations_from(answer)
    assert len(citations) == 1
    assert citations[0]["filePath"] == "src/main.py"
    assert citations[0]["startLine"] == 10
    assert citations[0]["endLine"] == 20


def test_citations_multiple():
    answer = "See ^[cite:src/a.py:1-5]^ and ^[cite:src/b.py:10-15]^"
    citations = _citations_from(answer)
    assert len(citations) == 2
    paths = {c["filePath"] for c in citations}
    assert "src/a.py" in paths
    assert "src/b.py" in paths


def test_citations_no_citations():
    answer = "This is a plain answer with no citations."
    citations = _citations_from(answer)
    assert citations == []


def test_citations_malformed():
    answer = "Bad marker ^[cite:broken]^ here."
    citations = _citations_from(answer)
    assert citations == []


def test_demo_complete_empty_hits():
    answer, citations, is_demo = _demo_complete("test", [])
    assert is_demo is True
    assert "No code chunks" in answer or "demo" in answer.lower()


def test_demo_complete_with_hits():
    hits = [
        {
            "filePath": "src/main.py",
            "startLine": 1,
            "endLine": 10,
            "text": "def hello(): pass",
        }
    ]
    answer, citations, is_demo = _demo_complete("what does hello do", hits)
    assert is_demo is True
    assert "src/main.py" in answer
    assert len(citations) >= 1
