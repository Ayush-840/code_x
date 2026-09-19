"""Interview question bank artifact (Platform Description §3.3)."""


def build_question_bank(repo_id: str, modules: list[dict]) -> dict:
    module_names = [m["name"].replace(":", "/") for m in modules[:12]] or ["the entry module"]

    questions = [
        *architecture_questions(module_names),
        *logic_questions(module_names),
        *tradeoff_questions(module_names),
        *debug_questions(module_names),
        *data_questions(module_names),
    ]

    return {
        "repoId": repo_id,
        "categories": ["architecture", "data-modeling", "api-design", "security", "performance", "testing", "devops"],
        "difficulties": ["junior", "mid-level", "senior"],
        "questions": questions,
    }


def _q(category: str, difficulty: str, qtype: str, question: str, model_answer: str) -> dict:
    return {
        "category": category,
        "difficulty": difficulty,
        "type": qtype,
        "question": question,
        "modelAnswer": model_answer,
        "evaluates": "Can the candidate explain real decisions they made and defend trade-offs.",
    }


def architecture_questions(modules: list[str]) -> list[dict]:
    return [
        _q(
            "architecture", "junior", "exploratory",
            "Walk me through the overall architecture of this project.",
            "Explain the module boundaries (" + ", ".join(modules[:4]) + "), how requests ",
        ),
        _q(
            "architecture", "mid-level", "adversarial",
            "Why did you structure the modules this way instead of a monolith?",
            "Describe the boundaries you drew, the coupling you avoided, and what would ",
        ),
        _q(
            "architecture", "senior", "trade-off",
            "What would you change if traffic increased 100x?",
            "Identify statelessness, caching opportunities, queue depth, and replication ",
        ),
    ]


def logic_questions(modules: list[str]) -> list[dict]:
    return [
        _q(
            "api-design", "mid-level", "exploratory",
            "Walk me through the core business logic and where it lives.",
            "Point to the main service modules (" + ", ".join(modules[:3]) + ") and narrate ",
        ),
    ]


def tradeoff_questions(modules: list[str]) -> list[dict]:
    return [
        _q(
            "performance", "senior", "trade-off",
            "What are the performance bottlenecks in this code, and how would you fix them?",
            "Call out O(n) scans, chatty DB calls, missing indexes, and where caching ",
        ),
        _q(
            "security", "mid-level", "adversarial",
            "How would you attack this application, and how is it defended?",
            "Walk through auth handling, input validation, and dependency exposure ",
        ),
    ]


def debug_questions(modules: list[str]) -> list[dict]:
    return [
        _q(
            "devops", "senior", "debugging",
            "The API intermittently returns 500s in production. Walk me through your investigation.",
            "Check error logs for stack traces, trace request ids, inspect the failing ",
        ),
    ]


def data_questions(modules: list[str]) -> list[dict]:
    return [
        _q(
            "data-modeling", "junior", "exploratory",
            "How is data modeled in this project and why?",
            "Describe the entities, their relationships, and the storage choice ",
        ),
    ]