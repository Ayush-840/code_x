"""Tests for interview personas."""

from mock_interview.personas import persona_for


def test_persona_friendly_senior():
    p = persona_for("friendly-senior")
    assert p["name"] == "Friendly Senior"
    assert "tone" in p
    assert "style" in p


def test_persona_hiring_manager():
    p = persona_for("hiring-manager")
    assert p["name"] == "Rigorous Hiring Manager"


def test_persona_system_design():
    p = persona_for("system-design")
    assert p["name"] == "Systems Specialist"


def test_persona_random():
    p = persona_for("random")
    assert p["name"] == "Randomized"


def test_persona_unknown():
    p = persona_for("unknown-persona")
    assert p["name"] == "unknown-persona"
    assert p["tone"] == "Neutral."
