"""Google Gemini API client with multi-key rotation (same pattern as NVIDIA)."""

import os
import json
import logging
import threading
import time

import httpx

logger = logging.getLogger(__name__)

GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta"


class GeminiKeyRotator:
    """Rotates through multiple Gemini API keys with cooldown on failure."""

    def __init__(
        self,
        env_var: str = "GEMINI_API_KEYS",
        cooldown_seconds: int = 60,
    ):
        self.cooldown_seconds = cooldown_seconds
        self._lock = threading.Lock()
        self._failures: dict[str, float] = {}

        raw = os.getenv(env_var, "")
        if raw:
            self._keys = [k.strip() for k in raw.split(",") if k.strip()]
        else:
            single = os.getenv("GEMINI_API_KEY", "")
            self._keys = [single] if single else []

        self._index = 0
        logger.info(f"[gemini] Loaded {len(self._keys)} keys from ${env_var}")

    @property
    def has_keys(self) -> bool:
        return len(self._keys) > 0

    def _is_cooled_down(self, key: str) -> bool:
        fail_time = self._failures.get(key)
        if fail_time is None:
            return True
        return (time.time() - fail_time) > self.cooldown_seconds

    def _next_key(self) -> str | None:
        if not self._keys:
            return None
        with self._lock:
            start = self._index
            for _ in range(len(self._keys)):
                key = self._keys[self._index]
                self._index = (self._index + 1) % len(self._keys)
                if self._is_cooled_down(key):
                    return key
        with self._lock:
            self._failures.clear()
            key = self._keys[self._index]
            self._index = (self._index + 1) % len(self._keys)
            return key

    def report_failure(self, key: str) -> None:
        with self._lock:
            self._failures[key] = time.time()
            logger.warning(f"[gemini] Key ...{key[-6:]} failed, cooling down {self.cooldown_seconds}s")

    def report_success(self, key: str) -> None:
        with self._lock:
            self._failures.pop(key, None)


# Singleton
_gemini_rotator: GeminiKeyRotator | None = None


def get_gemini_rotator() -> GeminiKeyRotator:
    global _gemini_rotator
    if _gemini_rotator is None:
        _gemini_rotator = GeminiKeyRotator()
    return _gemini_rotator


def gemini_generate(prompt: str, model: str = "gemini-2.5-flash") -> str | None:
    """Call Gemini API with key rotation. Returns text response or None."""
    rotator = get_gemini_rotator()
    if not rotator.has_keys:
        logger.warning("[gemini] No GEMINI_API_KEYS configured")
        return None

    url = f"{GEMINI_BASE_URL}/models/{model}:generateContent"
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.7,
            "maxOutputTokens": 8192,
        },
    }

    tried = 0
    last_error = None
    while tried < len(rotator._keys):
        key = rotator._next_key()
        if key is None:
            break
        try:
            headers = {
                "x-goog-api-key": key,
                "content-type": "application/json",
            }
            with httpx.Client(timeout=60.0) as client:
                resp = client.post(url, json=payload, headers=headers)
                resp.raise_for_status()
                data = resp.json()
                candidates = data.get("candidates", [])
                if candidates:
                    parts = candidates[0].get("content", {}).get("parts", [])
                    if parts:
                        rotator.report_success(key)
                        return parts[0].get("text", "")
            logger.warning(f"[gemini] Key ...{key[-6:]} returned empty response")
            rotator.report_failure(key)
        except Exception as e:
            last_error = e
            rotator.report_failure(key)
            logger.warning(f"[gemini] Key ...{key[-6:]} failed: {e}")
        tried += 1

    if last_error:
        logger.error(f"[gemini] All {len(rotator._keys)} keys failed. Last: {last_error}")
    return None


def gemini_generate_json(prompt: str, model: str = "gemini-2.5-flash") -> dict | None:
    """Call Gemini and parse JSON from the response."""
    raw = gemini_generate(prompt, model)
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
        logger.error(f"[gemini] Failed to parse JSON: {cleaned[:200]}")
        return None
