"""Post-session debrief report aggregation (Platform Description §3.4)."""


def build_report(answers: list[dict]) -> dict:
    if not answers:
        return {
            "overallScore": 0,
            "questionBreakdown": [],
            "strengths": [],
            "gaps": ["Answer a few questions to unlock your report"],
            "studySuggestions": [],
        }

    breakdown = [
        {
            "questionId": a["questionId"],
            "score": a["scores"].get("overall", 0),
            "feedback": a["feedback"],
        }
        for a in answers
    ]
    overall = round(sum(b["score"] for b in breakdown) / len(breakdown))
    average_specificity = round(
        sum(a["scores"].get("specificity", 0) for a in answers) / len(answers)
    )
    average_depth = round(sum(a["scores"].get("depth", 0) for a in answers) / len(answers))

    strengths = ["Consistent answer structure"]
    gains = []
    if average_specificity >= 60:
        strengths.append("Specific file-level references")
    else:
        gains.append("Practice naming real files, functions, and line ranges")
    if average_depth >= 60:
        strengths.append("Visible trade-off reasoning")
    else:
        gains.append("Add the alternatives you rejected and why")

    return {
        "overallScore": overall,
        "questionBreakdown": breakdown,
        "strengths": strengths,
        "gaps": gains,
        "studySuggestions": [
            "Re-read the architecture artifact before your phone screen",
            "Rehearse one STAR-format answer per module",
        ],
    }