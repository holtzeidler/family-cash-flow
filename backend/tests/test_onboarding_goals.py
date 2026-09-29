"""Onboarding goals are stored on the new account and left alone for everyone else.

Uses a disposable local database. Does not call Stripe or send email.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "e2e"))

from smoke_guard import (  # noqa: E402
    apply_safe_environment,
    assert_loaded_settings,
    assert_process_is_safe,
    smoke_db_path,
)

_DB = smoke_db_path("balancewhiz-smoke-goals.db")
_DB.parent.mkdir(parents=True, exist_ok=True)
for _extra in (_DB, Path(str(_DB) + "-wal"), Path(str(_DB) + "-shm")):
    if _extra.exists():
        _extra.unlink()

apply_safe_environment(_DB)
assert_process_is_safe(_DB)

sys.path.insert(0, str(ROOT / "backend"))
from app.main import SessionLocal, User, app, settings  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

assert_loaded_settings(
    database_url=settings.DATABASE_URL,
    env=settings.ENV,
    stripe_key=settings.STRIPE_SECRET_KEY,
    resend_key=settings.RESEND_API_KEY,
    smtp_host=settings.CONTACT_SMTP_HOST,
    db_filename=_DB.name,
)


def _register(client: TestClient, email: str, **extra):
    body = {
        "email": email,
        "password": "SmokeOnly1!",
        "first_name": "Goal",
        "last_name": "Tester",
    }
    body.update(extra)
    res = client.post("/api/auth/register", json=body)
    assert res.status_code == 201, res.text
    return res.json()


def _db_user(email: str) -> User:
    with SessionLocal() as db:
        user = db.query(User).filter(User.email == email).one()
        db.expunge(user)
        return user


def test_omitted_goals_stay_null_and_do_not_touch_access_or_billing():
    with TestClient(app) as client:
        created = _register(client, "bw-smoke-goals-none@example.com")
        assert created["user"]["onboarding_goals"] is None
        assert created["user"]["onboarding_goal_other"] is None
        me = client.get("/api/auth/me")
        assert me.status_code == 200, me.text
        assert me.json()["user"]["onboarding_goals"] is None
        families = client.get("/api/families")
        assert families.status_code == 200 and len(families.json()) == 1

    row = _db_user("bw-smoke-goals-none@example.com")
    assert row.onboarding_goals is None
    assert row.onboarding_goal_other is None
    assert row.complimentary_access is False
    assert row.complimentary_access_expires_at is None


def test_one_goal_multiple_goals_empty_selection_and_savings_id():
    with TestClient(app) as client:
        one = _register(
            client,
            "bw-smoke-goals-one@example.com",
            onboarding_goals=["keep_in_savings"],
        )
        assert one["user"]["onboarding_goals"] == ["keep_in_savings"]

    with TestClient(app) as client:
        many = _register(
            client,
            "bw-smoke-goals-many@example.com",
            onboarding_goals=["avoid_overdrafts", "upcoming_bills", "keep_in_savings"],
            onboarding_goal_other="ignored unless other is selected",
        )
        assert many["user"]["onboarding_goals"] == [
            "avoid_overdrafts",
            "upcoming_bills",
            "keep_in_savings",
        ]
        assert many["user"]["onboarding_goal_other"] is None

    with TestClient(app) as client:
        none = _register(client, "bw-smoke-goals-empty@example.com", onboarding_goals=[])
        assert none["user"]["onboarding_goals"] == []
        me = client.get("/api/auth/me")
        assert me.json()["user"]["onboarding_goals"] == []


def test_display_label_is_rejected_and_old_id_maps_to_keep_in_savings():
    with TestClient(app) as client:
        rejected = client.post(
            "/api/auth/register",
            json={
                "email": "bw-smoke-goals-label@example.com",
                "password": "SmokeOnly1!",
                "first_name": "Goal",
                "last_name": "Tester",
                "onboarding_goals": ["Keep more money in savings"],
            },
        )
        assert rejected.status_code == 422, rejected.text

        mapped = _register(
            client,
            "bw-smoke-goals-alias@example.com",
            onboarding_goals=["maximize_interest", "maximize_interest"],
        )
        assert mapped["user"]["onboarding_goals"] == ["keep_in_savings"]


def test_other_note_is_stored_and_profile_edit_does_not_clear_goals():
    with TestClient(app) as client:
        created = _register(
            client,
            "bw-smoke-goals-other@example.com",
            onboarding_goals=["other", "money_anxiety"],
            onboarding_goal_other="Save for camp",
        )
        assert created["user"]["onboarding_goals"] == ["other", "money_anxiety"]
        assert created["user"]["onboarding_goal_other"] == "Save for camp"

        patched = client.patch(
            "/api/auth/me",
            json={"first_name": "Updated", "last_name": "Name"},
        )
        assert patched.status_code == 200, patched.text
        body = patched.json()
        assert body["first_name"] == "Updated"
        assert body["onboarding_goals"] == ["other", "money_anxiety"]
        assert body["onboarding_goal_other"] == "Save for camp"

        row = _db_user("bw-smoke-goals-other@example.com")
        assert row.complimentary_access is False


def test_unauthenticated_me_does_not_reveal_goals():
    with TestClient(app) as client:
        _register(
            client,
            "bw-smoke-goals-private@example.com",
            onboarding_goals=["safe_to_move"],
        )
        client.cookies.clear()
        hidden = client.get("/api/auth/me")
        assert hidden.status_code == 401
        assert "safe_to_move" not in hidden.text
