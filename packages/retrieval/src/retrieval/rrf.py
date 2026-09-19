def reciprocal_rank_fusion(ranked_lists: list[list[dict]], k: int = 60) -> list[dict]:
    """Fuse multiple ranked lists by reciprocal rank.

    Each input list is [{'id': ..., ...}, ...] ordered best-first. k = 60 per
    the Technical Spec §6.2.
    """
    scores: dict[str, float] = {}
    meta: dict[str, dict] = {}
    for ranked in ranked_lists:
        for rank, item in enumerate(ranked):
            cid = item["id"]
            scores[cid] = scores.get(cid, 0.0) + 1.0 / (k + rank + 1)
            meta.setdefault(cid, item)
    fused = sorted(scores.items(), key=lambda kv: kv[1], reverse=True)
    return [{**meta[cid], "rrfScore": round(score, 6)} for cid, score in fused]