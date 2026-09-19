"""API key rotation with automatic failover.

Loads multiple API keys from a comma-separated env var and cycles through
them on failure. Thread-safe. Works with any OpenAI-compatible API
(OpenAI, NVIDIA NIM, etc.).
"""

import os
import threading
import time
import logging
from typing import Optional

logger = logging.getLogger(__name__)

# Default NVIDIA NIM base URL (OpenAI-compatible)
DEFAULT_BASE_URL = "https://integrate.api.nvidia.com/v1"


class KeyRotator:
    """Rotates through a list of API keys, skipping failed ones temporarily.

    Usage:
        rotator = KeyRotator(env_var="NVIDIA_API_KEYS")
        with rotator.get_client() as client:
            resp = client.chat.completions.create(...)
    """

    def __init__(
        self,
        env_var: str = "NVIDIA_API_KEYS",
        base_url: str = DEFAULT_BASE_URL,
        cooldown_seconds: int = 60,
        single_key_var: str = "OPENAI_API_KEY",
    ):
        self.base_url = base_url
        self.cooldown_seconds = cooldown_seconds
        self._lock = threading.Lock()
        self._failures: dict[str, float] = {}  # key -> last failure timestamp

        # Load keys from comma-separated env var, fallback to single key var
        raw = os.getenv(env_var, "")
        if raw:
            self._keys = [k.strip() for k in raw.split(",") if k.strip()]
        else:
            single = os.getenv(single_key_var, "")
            self._keys = [single] if single else []

        self._index = 0
        logger.info(
            f"[key-rotation] Loaded {len(self._keys)} keys from ${env_var}"
        )

    @property
    def has_keys(self) -> bool:
        return len(self._keys) > 0

    def _is_cooled_down(self, key: str) -> bool:
        fail_time = self._failures.get(key)
        if fail_time is None:
            return True
        return (time.time() - fail_time) > self.cooldown_seconds

    def _next_key(self) -> Optional[str]:
        """Get the next available key. Returns None if all keys are exhausted."""
        if not self._keys:
            return None

        with self._lock:
            start = self._index
            for _ in range(len(self._keys)):
                key = self._keys[self._index]
                self._index = (self._index + 1) % len(self._keys)
                if self._is_cooled_down(key):
                    return key

        # All keys are cooled down — reset failures and try the first one
        with self._lock:
            self._failures.clear()
            key = self._keys[self._index]
            self._index = (self._index + 1) % len(self._keys)
            return key

    def report_failure(self, key: str) -> None:
        """Mark a key as failed so it's skipped for cooldown_seconds."""
        with self._lock:
            self._failures[key] = time.time()
            logger.warning(
                f"[key-rotation] Key ...{key[-6:]} marked failed, "
                f"cooling down for {self.cooldown_seconds}s"
            )

    def report_success(self, key: str) -> None:
        """Clear failure status for a key."""
        with self._lock:
            self._failures.pop(key, None)

    def get_client(self, key: Optional[str] = None):
        """Get an OpenAI client with the next available key.

        Returns (client, key) tuple so callers can report success/failure.
        """
        from openai import OpenAI

        if key is None:
            key = self._next_key()
        if key is None:
            raise RuntimeError("No API keys available")

        client = OpenAI(api_key=key, base_url=self.base_url)
        return client, key

    def execute_with_fallback(self, func):
        """Execute a function with automatic key rotation on failure.

        The function receives (client, key) as arguments and should raise
        on failure. On success, the key is marked good. On failure, the
        next key is tried.

        Returns the function's return value.
        """
        last_error = None
        tried = 0
        while tried < len(self._keys):
            key = self._next_key()
            if key is None:
                break
            try:
                client, _ = self.get_client(key)
                result = func(client, key)
                self.report_success(key)
                return result
            except Exception as e:
                last_error = e
                self.report_failure(key)
                tried += 1
                logger.warning(
                    f"[key-rotation] Key ...{key[-6:]} failed: {e}. "
                    f"Trying next ({tried}/{len(self._keys)})..."
                )

        raise RuntimeError(
            f"All {len(self._keys)} API keys exhausted. Last error: {last_error}"
        )


# Singleton rotators (lazy-initialized)
_generation_rotator: Optional[KeyRotator] = None
_embedding_rotator: Optional[KeyRotator] = None


def get_generation_rotator() -> KeyRotator:
    """Get or create the singleton rotator for LLM completions."""
    global _generation_rotator
    if _generation_rotator is None:
        _generation_rotator = KeyRotator(
            env_var="NVIDIA_API_KEYS",
            base_url=os.getenv("NVIDIA_BASE_URL", DEFAULT_BASE_URL),
            single_key_var="OPENAI_API_KEY",
        )
    return _generation_rotator


def get_embedding_rotator() -> KeyRotator:
    """Get or create the singleton rotator for embeddings."""
    global _embedding_rotator
    if _embedding_rotator is None:
        _embedding_rotator = KeyRotator(
            env_var="NVIDIA_API_KEYS",
            base_url=os.getenv("NVIDIA_BASE_URL", DEFAULT_BASE_URL),
            single_key_var="OPENAI_API_KEY",
        )
    return _embedding_rotator
