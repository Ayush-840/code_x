"""Interview question bank artifact — powered by Gemini + Claude AI.

Uses Google Gemini (NotebookLM) for architecture/module analysis questions
and Claude AI for behavioral/trade-off questions. Falls back to static
questions when API keys are not configured.
"""

import json
import logging
import os
import sys
from pathlib import Path

# Add shared_python to path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "shared_python" / "src"))

from shared.gemini_client import gemini_generate_json
from shared.claude_client import claude_generate_json

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = (
    "You are a senior tech interviewer creating interview questions for a candidate's "
    "codebase. Generate questions that are specific to the actual code structure, not "
    "generic questions. Reference real module names and file patterns from the provided "
    "context. Return valid JSON only."
)


def build_question_bank(repo_id: str, modules: list[dict]) -> dict:
    """Generate interview questions using Gemini + Claude AI with static fallback."""
    module_names = [m.get("name", "unknown").replace(":", "/") for m in modules[:12]] or ["the project"]
    module_details = _format_modules(modules)

    # Try Gemini for architecture + module questions
    gemini_questions = _generate_gemini_questions(module_names, module_details)

    # Try Claude for trade-off + behavioral questions
    claude_questions = _generate_claude_questions(module_names, module_details)

    # Merge, deduplicate, and fill gaps with static questions
    all_questions = _merge_questions(gemini_questions, claude_questions, module_names)

    return {
        "repoId": repo_id,
        "categories": ["architecture", "data-modeling", "api-design", "security", "performance", "testing", "devops"],
        "difficulties": ["junior", "mid-level", "senior"],
        "questions": all_questions,
    }


def _format_modules(modules: list[dict]) -> str:
    lines = []
    for m in modules[:15]:
        name = m.get("name", "?").replace(":", "/")
        files = m.get("fileCount", 0)
        lines_count = m.get("lineCount", 0)
        path = m.get("path", "")
        lines.append(f"- {name} ({path}): {files} files, {lines_count} lines")
    return "\n".join(lines)


def _generate_gemini_questions(module_names: list[str], module_details: str) -> list[dict]:
    """Use Google Gemini to generate architecture and module-specific questions."""
    prompt = f"""Generate 8 interview questions for a candidate who built this codebase.

Modules:
{module_details}

Generate questions across these categories: architecture, api-design, security, data-modeling.
Mix difficulties: junior, mid-level, senior.

Return a JSON array where each object has:
- "category": one of architecture/api-design/security/data-modeling
- "difficulty": junior/mid-level/senior
- "type": exploratory/adversarial/debugging/trade-off
- "question": the question text (reference specific module names from above)
- "modelAnswer": a model answer (2-3 sentences)
- "interviewerTip": what to listen for in a good answer

Return ONLY the JSON array, no markdown fences."""

    try:
        result = gemini_generate_json(prompt)
        if isinstance(result, list):
            validated = [_validate_question(q) for q in result if _validate_question(q)]
            logger.info(f"[gemini] Generated {len(validated)} questions")
            return validated
        logger.warning("[gemini] Response was not a list")
    except Exception as e:
        logger.error(f"[gemini] Question generation failed: {e}")
    return []


def _generate_claude_questions(module_names: list[str], module_details: str) -> list[dict]:
    """Use Claude AI to generate trade-off and behavioral questions."""
    prompt = f"""Generate 6 interview questions for a candidate who built this codebase.

Modules:
{module_details}

Focus on trade-offs, debugging scenarios, and performance analysis.
Mix difficulties: mid-level and senior.

Return a JSON array where each object has:
- "category": one of performance/devops/architecture/security
- "difficulty": mid-level/senior
- "type": trade-off/debugging/adversarial
- "question": the question text (reference specific module names from above)
- "modelAnswer": a model answer (2-3 sentences)
- "interviewerTip": what to listen for in a good answer

Return ONLY the JSON array, no markdown fences."""

    try:
        result = claude_generate_json(prompt, system=SYSTEM_PROMPT)
        if isinstance(result, list):
            validated = [_validate_question(q) for q in result if _validate_question(q)]
            logger.info(f"[claude] Generated {len(validated)} questions")
            return validated
        logger.warning("[claude] Response was not a list")
    except Exception as e:
        logger.error(f"[claude] Question generation failed: {e}")
    return []


def _validate_question(q: dict) -> dict | None:
    """Validate a question dict has required fields."""
    if not isinstance(q, dict):
        return None
    if not q.get("question") or not q.get("category"):
        return None
    q.setdefault("difficulty", "mid-level")
    q.setdefault("type", "exploratory")
    q.setdefault("modelAnswer", "")
    q.setdefault("interviewerTip", "")
    q.setdefault("citations", [])
    return q


def _merge_questions(
    gemini_qs: list[dict],
    claude_qs: list[dict],
    module_names: list[str],
) -> list[dict]:
    """Merge questions from both sources, add static fallbacks if needed."""
    seen = set()
    merged = []

    for q in gemini_qs + claude_qs:
        key = q["question"][:80].lower()
        if key not in seen:
            seen.add(key)
            merged.append(q)

    # If AI generated fewer than 5 questions, supplement with static ones
    if len(merged) < 5:
        merged.extend(_static_fallback(module_names))

    return merged[:20]  # Cap at 20 questions


def _static_fallback(modules: list[str]) -> list[dict]:
    """Fallback questions when AI APIs are unavailable."""
    mod_str = ", ".join(modules[:4]) or "the entry module"
    return [
        {
            "category": "architecture",
            "difficulty": "junior",
            "type": "exploratory",
            "question": "Walk me through the overall architecture of this project.",
            "modelAnswer": f"Explain the module boundaries ({mod_str}), how requests flow between them, and the technology choices.",
            "interviewerTip": "Look for awareness of module separation and data flow.",
            "citations": [],
        },
        {
            "category": "architecture",
            "difficulty": "mid-level",
            "type": "adversarial",
            "question": "Why did you structure the modules this way instead of a monolith?",
            "modelAnswer": "Describe the boundaries you drew, the coupling you avoided, and what would change if traffic increased.",
            "interviewerTip": "Listen for reasoning about trade-offs, not just 'it's cleaner'.",
            "citations": [],
        },
        {
            "category": "performance",
            "difficulty": "senior",
            "type": "trade-off",
            "question": "What are the performance bottlenecks in this code, and how would you fix them?",
            "modelAnswer": "Call out O(n) scans, chatty DB calls, missing indexes, and where caching could help.",
            "interviewerTip": "Strong answers reference specific files and line ranges.",
            "citations": [],
        },
        {
            "category": "security",
            "difficulty": "mid-level",
            "type": "adversarial",
            "question": "How would you attack this application, and how is it defended?",
            "modelAnswer": "Walk through auth handling, input validation, and dependency exposure.",
            "interviewerTip": "Look for awareness of OWASP Top 10 and practical mitigations.",
            "citations": [],
        },
        {
            "category": "devops",
            "difficulty": "senior",
            "type": "debugging",
            "question": "The API intermittently returns 500s in production. Walk me through your investigation.",
            "modelAnswer": "Check error logs for stack traces, trace request ids, inspect the failing service health.",
            "interviewerTip": "Look for systematic debugging, not random guessing.",
            "citations": [],
        },
    ]
