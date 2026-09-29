"""The smoke guard must refuse hosted databases and live services without importing the app."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "e2e"))

from smoke_guard import apply_safe_environment, assert_bot_email, assert_process_is_safe, smoke_db_path  # noqa: E402


def test_local_smoke_database_is_accepted():
    db_path = smoke_db_path("balancewhiz-smoke-guard.db")
    apply_safe_environment(db_path)
    assert_process_is_safe(db_path)


def test_hosted_database_url_is_refused(monkeypatch):
    monkeypatch.setenv(
        "DATABASE_URL",
        "postgresql://example.ep-ancient-union-and21kx9-pooler.neon.tech/app",
    )
    with pytest.raises(SystemExit):
        assert_process_is_safe(smoke_db_path())


def test_live_stripe_key_is_refused(monkeypatch):
    db_path = smoke_db_path()
    apply_safe_environment(db_path)
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_live_example")
    with pytest.raises(SystemExit):
        assert_process_is_safe(db_path)


def test_personal_mailbox_is_refused():
    with pytest.raises(SystemExit):
        assert_bot_email("tracy@balancewhiz.com")


def test_lifecycle_scheduler_production_is_separate_from_staging():
    text = (Path(__file__).resolve().parents[2] / "render.yaml").read_text(encoding="utf-8")
    assert text.count("python -m app.trial_ending_reminders") == 2
    staging = text.split("family-cash-flow-trial-reminders-staging", 1)[1].split("- type:", 1)[0]
    assert "branch: staging" in staging
    assert "TRIAL_ENDING_REMINDERS_ALLOW_PRODUCTION" not in staging
    production = text.split("family-cash-flow-trial-reminders-production", 1)[1].split("- type:", 1)[0]
    assert "branch: main" in production
    assert production.count("TRIAL_ENDING_REMINDERS_ALLOW_PRODUCTION") == 1
