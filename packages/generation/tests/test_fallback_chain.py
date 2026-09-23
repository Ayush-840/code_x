"""Tests for the NVIDIA -> OpenRouter fallback node -> demo provider chain."""

from types import SimpleNamespace

from generation import llm
from generation.files import build_file_explanation
from shared import key_rotation


# ---------------------------------------------------------------- helpers


class _FakeCompletions:
    def __init__(self, content="ok"):
        self._content = content
        self.model_seen = None

    def create(self, *, model, messages, **kwargs):
        self.model_seen = model
        return SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content=self._content))]
        )


def _fake_client(content="ok"):
    completions = _FakeCompletions(content)
    return SimpleNamespace(chat=SimpleNamespace(completions=completions)), completions


class _FakeRotator:
    """Rotator stub with configurable primary/OpenRouter availability."""

    def __init__(self, primary=True, openrouter=True, fail_primary=False):
        self._openrouter = openrouter
        self._fail_primary = fail_primary
        self.openrouter_used = False
        if primary:
            self._client, self._completions = _fake_client("primary answer")
        if openrouter:
            self._or_client, self._or_completions = _fake_client("fallback answer")

    @property
    def has_keys(self):
        return hasattr(self, "_client")

    def has_openrouter_fallback(self):
        return self._openrouter

    def execute_with_fallback(self, func):
        if self._fail_primary:
            raise RuntimeError("All 1 API keys exhausted. Last error: boom")
        return func(self._client, "k1")

    def get_openrouter_client(self):
        self.openrouter_used = True
        return self._or_client


# ------------------------------------------------------- llm.complete()


def test_complete_demo_when_no_providers(monkeypatch):
    monkeypatch.setattr(
        llm, "get_generation_rotator", lambda: _FakeRotator(primary=False, openrouter=False)
    )
    hits = [{"filePath": "src/a.py", "startLine": 1, "endLine": 5, "text": "x"}]
    answer, _, is_demo = llm.complete("q", hits)
    assert is_demo is True
    assert "demo" in answer.lower()


def test_complete_primary_success(monkeypatch):
    rot = _FakeRotator(primary=True, openrouter=True)
    monkeypatch.setattr(llm, "get_generation_rotator", lambda: rot)
    answer, _, is_demo = llm.complete("q", [])
    assert is_demo is False
    assert answer == "primary answer"
    assert rot.openrouter_used is False


def test_complete_falls_back_to_openrouter(monkeypatch):
    rot = _FakeRotator(primary=True, openrouter=True, fail_primary=True)
    monkeypatch.setattr(llm, "get_generation_rotator", lambda: rot)
    answer, _, is_demo = llm.complete("q", [])
    assert is_demo is False
    assert answer == "fallback answer"
    assert rot.openrouter_used is True


def test_complete_openrouter_only_no_primary(monkeypatch):
    rot = _FakeRotator(primary=False, openrouter=True)
    monkeypatch.setattr(llm, "get_generation_rotator", lambda: rot)
    answer, _, is_demo = llm.complete("q", [])
    assert is_demo is False
    assert answer == "fallback answer"


def test_complete_degrades_to_demo_when_all_fail(monkeypatch):
    rot = _FakeRotator(primary=True, openrouter=False, fail_primary=True)
    monkeypatch.setattr(llm, "get_generation_rotator", lambda: rot)
    answer, _, is_demo = llm.complete("q", [])
    assert is_demo is True
    assert "demo" in answer.lower()


def test_complete_fallback_uses_openrouter_model_slug(monkeypatch):
    rot = _FakeRotator(primary=True, openrouter=True, fail_primary=True)
    monkeypatch.setattr(llm, "get_generation_rotator", lambda: rot)
    llm.complete("q", [])
    assert rot._or_completions.model_seen == llm.OPENROUTER_CHAT_MODEL
    assert "nemotron" in rot._or_completions.model_seen


def test_model_used_reporting(monkeypatch):
    monkeypatch.setattr(llm, "get_generation_rotator", lambda: _FakeRotator(primary=True))
    assert llm.model_used() == llm.NVIDIA_CHAT_MODEL
    monkeypatch.setattr(
        llm, "get_generation_rotator", lambda: _FakeRotator(primary=False, openrouter=True)
    )
    assert llm.model_used() == llm.OPENROUTER_CHAT_MODEL
    monkeypatch.setattr(
        llm, "get_generation_rotator", lambda: _FakeRotator(primary=False, openrouter=False)
    )
    assert llm.model_used() == "demo"


# --------------------------------- KeyRotator.execute_with_provider_fallback


def test_rotator_provider_fallback_reports_primary():
    rot = key_rotation.KeyRotator(env_var="TEST_KEYS_UNUSED")
    rot._keys = ["primary-key"]
    fake, _ = _fake_client("ok")
    rot.get_client = lambda key=None: (fake, key)

    def _call(c, k):
        return "done"

    result, provider = rot.execute_with_provider_fallback(_call)
    assert result == "done"
    assert provider == "primary"


def test_rotator_provider_fallback_switches_to_openrouter(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-test")
    rot = key_rotation.KeyRotator(env_var="TEST_KEYS_UNUSED")
    rot._keys = ["primary-key"]

    def _boom(c, k):
        raise RuntimeError("exhausted")

    fake, _ = _fake_client("ok")
    rot.get_openrouter_client = lambda: fake

    def _fb(c):
        return "saved"

    result, provider = rot.execute_with_provider_fallback(_boom, _fb)
    assert result == "saved"
    assert provider == "openrouter"


def test_rotator_provider_fallback_reraises_primary_without_key(monkeypatch):
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    rot = key_rotation.KeyRotator(env_var="TEST_KEYS_UNUSED")
    rot._keys = []

    def _boom(c, k):
        raise RuntimeError("no keys")

    try:
        rot.execute_with_provider_fallback(_boom)
        raised = False
    except RuntimeError:
        # Re-raises the primary error ("All 0 API keys exhausted...").
        raised = True
    assert raised


# ------------------------------------------------- files.build_file_explanation


_CHUNKS = [
    {"filePath": "src/app.py", "startLine": 1, "endLine": 10, "text": "def main(): ..."},
]


def _json_answer():
    return (
        '{"summary": "s", "sections": [], "questions": [], '
        '"citations": [{"filePath": "src/app.py", "startLine": 1, "endLine": 10}]}'
    )


def test_file_explain_primary_success(monkeypatch):
    rot = _FakeRotator(primary=True, openrouter=True)
    rot._client, rot._completions = _fake_client(_json_answer())
    monkeypatch.setattr("generation.files.get_generation_rotator", lambda: rot)
    result = build_file_explanation("src/app.py", _CHUNKS)
    assert result["filePath"] == "src/app.py"
    assert "isDemo" not in result or result.get("isDemo") is not True


def test_file_explain_falls_back_to_openrouter(monkeypatch):
    rot = _FakeRotator(primary=True, openrouter=True, fail_primary=True)
    rot._or_client, rot._or_completions = _fake_client(_json_answer())
    monkeypatch.setattr("generation.files.get_generation_rotator", lambda: rot)
    result = build_file_explanation("src/app.py", _CHUNKS)
    assert rot.openrouter_used is True
    assert result["citations"][0]["filePath"] == "src/app.py"
    assert result.get("isDemo") is not True


def test_file_explain_demo_when_all_fail(monkeypatch):
    rot = _FakeRotator(primary=True, openrouter=False, fail_primary=True)
    monkeypatch.setattr("generation.files.get_generation_rotator", lambda: rot)
    result = build_file_explanation("src/app.py", _CHUNKS)
    assert result["isDemo"] is True


def test_file_explain_bad_json_from_fallback_degrades_to_demo(monkeypatch):
    rot = _FakeRotator(primary=True, openrouter=True, fail_primary=True)
    rot._or_client, rot._or_completions = _fake_client("not json at all")
    monkeypatch.setattr("generation.files.get_generation_rotator", lambda: rot)
    result = build_file_explanation("src/app.py", _CHUNKS)
    assert result["isDemo"] is True


# ------------------------------------------------ env-var wiring


def test_fresh_rotator_reads_openrouter_env(monkeypatch):
    monkeypatch.delenv("NVIDIA_API_KEYS", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-env-test")
    rot = key_rotation.KeyRotator(env_var="NVIDIA_API_KEYS")
    assert rot.has_keys is False
    assert rot.has_openrouter_fallback() is True


def test_openrouter_default_base_url():
    assert key_rotation.OPENROUTER_BASE_URL == "https://openrouter.ai/api/v1"
    assert key_rotation.OPENROUTER_DEFAULT_MODEL == (
        "nvidia/nemotron-3-ultra-550b-a55b:free"
    )
