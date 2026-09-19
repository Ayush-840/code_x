def score_answer(answer: str) -> tuple[dict, str]:
    indicators = {
        "clarity": ["first", "then", "because", "for example"],
        "depth": ["trade-off", "edge case", "complexity", "constraint"],
        "specificity": ["file", "function", "module", "endpoint", "route"],
        "confidence": ["i would", "we chose", "compared to", "i decided"],
    }
    text = answer.lower()
    scores = {
        key: min(100, sum(1 for w in words if w in text) * 20)
        for key, words in indicators.items()
    }
    overall = round(sum(scores.values()) / len(scores))
    if scores["specificity"] < 60:
        feedback = (
            "Strong structure — now ground your claims with specific file names, "
            "functions, or line ranges so the interviewer can verify you."
        )
    elif scores["depth"] < 60:
        feedback = (
            "Good specific references — add the trade-offs you considered so it "
            "reads as senior-level reasoning."
        )
    else:
        feedback = "Excellent. Concrete, specific, and trade-off aware."
    return {"overall": overall, **scores}, feedback