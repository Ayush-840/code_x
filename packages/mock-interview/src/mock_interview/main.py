from fastapi import FastAPI
from pydantic import BaseModel

from .personas import persona_for
from .scoring import score_answer
from .sessions import create_session, next_question_for, save_answer

app = FastAPI(title="Vibe Coder Mock-Interview Service")


class StartReq(BaseModel):
    repoId: str
    persona: str = "friendly-senior"
    difficulty: str = "junior"


class AnswerReq(BaseModel):
    sessionId: str
    questionId: str
    answer: str
    timeSpentSec: int = 0


class ScoreReq(BaseModel):
    answer: str


class NextReq(BaseModel):
    sessionId: str


@app.get("/health")
def health() -> dict:
    return {"ok": True, "service": "mock-interview"}


@app.post("/score")
def score(req: ScoreReq) -> dict:
    scores, feedback = score_answer(req.answer)
    return {"scores": scores, "feedback": feedback}


@app.post("/sessions")
def start_session(req: StartReq) -> dict:
    return create_session(req.repoId, persona_for(req.persona), req.difficulty)


@app.post("/sessions/{session_id}/answer")
def submit_answer(session_id: str, req: AnswerReq) -> dict:
    scores, feedback = score_answer(req.answer)
    save_answer(session_id, req.questionId, req.answer, req.timeSpentSec, scores, feedback)
    return {"questionId": req.questionId, "scores": scores, "feedback": feedback}


@app.post("/sessions/{session_id}/next")
def next_question(session_id: str, _req: NextReq) -> dict:
    return next_question_for(session_id)