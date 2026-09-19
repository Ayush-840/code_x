"""Anthropic Claude API client."""

import os
import json
import logging

import httpx

logger = logging.getLogger(__name__)

CLAUDE_BASE_URL = "https://api.anthropic.com/v1"
CLAUDE_MODEL = "claude-sonnet-4-20250514"


def get_claude_key() -> str | None:
    return os.getenv("ANTHROPIC_API_KEY")


def claude_generate(
    prompt: str,
    system: str = "",
    model: str = CLAUDE_MODEL,
    max_tokens: int = 8192,
) -> str | None:
    """Call Claude API and return the text response. Returns None on failure."""
    api_key = get_claude_key()
    if not api_key:
        logger.warning("[claude] No ANTHROPIC_API_KEY configured")
        return None

    url = f"{CLAUDE_BASE_URL}/messages"
    headers = {
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }
    messages = [{"role": "user", "content": prompt}]
    payload: dict = {
        "model": model,
        "max_tokens": max_tokens,
        "messages": messages,
    }
    if system:
        payload["system"] = system

    try:
        with httpx.Client(timeout=60.0) as client:
            resp = client.post(url, json=payload, headers=headers)
            resp.raise_for_status()
            data = resp.json()
            content = data.get("content", [])
            if content:
                return content[0].get("text", "")
        logger.warning("[claude] Empty response from API")
        return None
    except Exception as e:
        logger.error(f"[claude] API call failed: {e}")
        return None


def claude_generate_json(
    prompt: str,
    system: str = "",
    model: str = CLAUDE_MODEL,
    max_tokens: int = 8192,
) -> dict | None:
    """Call Claude and parse JSON from the response."""
    raw = claude_generate(prompt, system, model, max_tokens)
    if not raw:
        return None
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        lines = cleaned.split("\n")
        lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        cleaned = "\n".join(lines)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        logger.error(f"[claude] Failed to parse JSON response: {cleaned[:200]}")
        return None
