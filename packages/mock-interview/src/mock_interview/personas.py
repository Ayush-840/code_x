"""Interviewer personas (Platform Description §3.4)."""


def persona_for(name: str) -> dict:
    return {
        "friendly-senior": {
            "name": "Friendly Senior",
            "tone": "Encouraging, chatty, curious.",
            "style": "Open questions, follows interesting threads, gives gentle hints.",
        },
        "hiring-manager": {
            "name": "Rigorous Hiring Manager",
            "tone": "Direct, probing, time-boxed.",
            "style": "Challenges claims, asks for trade-offs, insists on specifics.",
        },
        "system-design": {
            "name": "Systems Specialist",
            "tone": "Analytical, quantitative.",
            "style": "Drills into scale, failure modes, and architecture trade-offs.",
        },
        "random": {
            "name": "Randomized",
            "tone": "Unpredictable.",
            "style": "Blends the above personas question by question.",
        },
    }.get(
        name,
        {"name": name, "tone": "Neutral.", "style": "Standard interview pace."},
    )