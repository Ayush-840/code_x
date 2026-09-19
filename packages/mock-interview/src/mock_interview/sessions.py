"""Session state and deterministic question delivery for the demo.
Production uses Redis-back session state (per the deployment guide)."""

from __future__ import annotations

from dataclasses import dataclass, field

QUESTION_BANK = [
    ("architecture", "Walk me through the overall architecture of this project."),
    ("data-modeling", "How is data modeled and how do the entities relate?"),
    ("api-design", "Walk me through the main API surface and its design choices."),
    ("security", "How does authentication and authorization work here?"),
    ("performance", "What performance bottlenecks do you see and how would you fix them?"),
    ("devops", "How would you debug a production incident in this system?"),
]


@dataclass
class Session:
    session_id: str
    repo_id: str
    difficulty: str
    question_number: int = 0


_SESSIONS: dict[str, Session] = {}


def create_session(repo_id: str, persona: dict, difficulty: str) -> dict:
    session_id = f"interv_{repo_id[:8]}"
    _SESSIONS[session_id] = Session(session_id=session_id, repo_id=repo_id, difficulty=difficulty)
    return {
        "sessionId": session_id,
        "persona": persona,
        "difficulty": difficulty,
        "totalQuestions": len(QUESTION_BANK),
        "currentQuestion": {
            "questionId": "q-1",
            "questionText": QUESTION_BANK[0][1],
            "category": QUESTION_BANK[0][0],
            "questionNumber": 1,
        },
    }


def next_question_for(session_id: str) -> dict:
    session = _SESSIONS.get(session_id)
    if not session:
        return {"error": "Unknown session"}
    session.question_number += 1
    index = session.question_number
    if index >= len(QUESTION_BANK):
        return {"done": True}
    category, text = QUESTION_BANK[index]
    return {
        "questionId": f"q-{index + 1}",
        "questionText": text,
        "category": category,
        "questionNumber": index + 1,
        "totalQuestions": len(QUESTION_BANK),
    }


def save_answer(
    session_id: str,
    question_id: str,
    answer: str,
    time_spent_sec: int,
    scores: dict,
    feedback: str,
) -> None:
    # In production this writes a MockInterviewQuestion row; the demo keeps it
    # in memory and lets `report.py` aggregate it.
    session = _SESSIONS.get(session_id)
    if session:
        session.__dict__.setdefault("answers", []).append(
            {"questionId": question_id, "answer": answer, "scores": scores, "feedback": feedback}
        )