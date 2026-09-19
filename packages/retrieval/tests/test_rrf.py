"""Tests for reciprocal rank fusion."""

from retrieval.rrf import reciprocal_rank_fusion


def test_rrf_single_list():
    items = [{"id": "a"}, {"id": "b"}, {"id": "c"}]
    result = reciprocal_rank_fusion([items])
    ids = [r["id"] for r in result]
    assert ids == ["a", "b", "c"]
    assert all("rrfScore" in r for r in result)


def test_rrf_fusion_merges_overlapping():
    list1 = [{"id": "a"}, {"id": "b"}, {"id": "c"}]
    list2 = [{"id": "b"}, {"id": "a"}, {"id": "d"}]
    result = reciprocal_rank_fusion([list1, list2])
    ids = [r["id"] for r in result]
    assert "a" in ids
    assert "b" in ids
    assert "d" in ids


def test_rrf_rank_preference():
    list1 = [{"id": "a"}, {"id": "b"}]
    list2 = [{"id": "b"}, {"id": "a"}]
    result = reciprocal_rank_fusion([list1, list2])
    scores = {r["id"]: r["rrfScore"] for r in result}
    # "a" is rank 0 in list1 and rank 1 in list2
    # "b" is rank 1 in list1 and rank 0 in list2
    # Both should tie
    assert abs(scores["a"] - scores["b"]) < 0.001


def test_rrf_empty_lists():
    result = reciprocal_rank_fusion([])
    assert result == []


def test_rrf_custom_k():
    items = [{"id": "a"}, {"id": "b"}]
    result = reciprocal_rank_fusion([items], k=10)
    assert len(result) == 2
    assert all("rrfScore" in r for r in result)
