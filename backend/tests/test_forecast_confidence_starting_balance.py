"""A setup balance counts as a recent checkpoint without changing the forecast.

The safe environment is set before the app is imported. This test does not
call Stripe or send email.
"""

from __future__ import annotations

import sys
from datetime import datetime, timedelta
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "e2e"))

from smoke_guard import (  # noqa: E402
    apply_safe_environment,
    assert_loaded_settings,
    assert_process_is_safe,
    smoke_db_path,
)

_DB = smoke_db_path("balancewhiz-smoke-confidence.db")
_DB.parent.mkdir(parents=True, exist_ok=True)
for _extra in (_DB, Path(str(_DB) + "-wal"), Path(str(_DB) + "-shm")):
    if _extra.exists():
        _extra.unlink()

apply_safe_environment(_DB)
assert_process_is_safe(_DB)

sys.path.insert(0, str(ROOT / "backend"))
from app.main import app, settings  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

assert_loaded_settings(
    database_url=settings.DATABASE_URL,
    env=settings.ENV,
    stripe_key=settings.STRIPE_SECRET_KEY,
    resend_key=settings.RESEND_API_KEY,
    smtp_host=settings.CONTACT_SMTP_HOST,
    db_filename=_DB.name,
)


def _today():
    return datetime.utcnow().date()


def _family(client: TestClient, email: str) -> int:
    created = client.post(
        "/api/auth/register",
        json={
            "email": email,
            "password": "SmokeOnly1!",
            "first_name": "Smoke",
            "last_name": "Confidence",
        },
    )
    assert created.status_code == 201, created.text
    families = client.get("/api/families")
    assert families.status_code == 200, families.text
    return families.json()[0]["id"]


def _account(client: TestClient, family_id: int, start) -> None:
    created = client.post(
        f"/api/families/{family_id}/accounts",
        json={
            "name": "Checking",
            "type": "checking",
            "starting_balance": "2500.00",
            "starting_balance_date": start.isoformat(),
        },
    )
    assert created.status_code == 200, created.text


def test_todays_starting_balance_is_a_fresh_checkpoint():
    today = _today()
    with TestClient(app) as client:
        family_id = _family(client, "bw-confidence-fresh@example.com")
        _account(client, family_id, today)
        confidence = client.get(f"/api/families/{family_id}/forecast-confidence")
        assert confidence.status_code == 200, confidence.text
        body = confidence.json()
        assert body["days_since_confirmed"] == 0
        assert body["confidence_level"] == "high"
        assert body["show_verify_cta"] is False
        assert body["last_confirmed_balance_date"] == today.isoformat()
        month = f"{today.year:04d}-{today.month:02d}"
        verified = client.get(f"/api/families/{family_id}/verified-balances?month={month}")
        assert verified.status_code == 200, verified.text
        assert verified.json()["items"] == []


def test_old_starting_balance_still_recommends_a_check():
    today = _today()
    start = today - timedelta(days=40)
    with TestClient(app) as client:
        family_id = _family(client, "bw-confidence-stale@example.com")
        _account(client, family_id, start)
        confidence = client.get(f"/api/families/{family_id}/forecast-confidence")
        assert confidence.status_code == 200, confidence.text
        body = confidence.json()
        assert body["days_since_confirmed"] == 40
        assert body["show_verify_cta"] is True
        assert body["last_confirmed_balance_date"] == start.isoformat()


@pytest.mark.parametrize(
    "age,recommend",
    [(0, False), (3, False), (6, False), (7, True), (14, True)],
)
def test_recommendation_follows_a_seven_day_calendar_threshold(age, recommend):
    today = _today()
    start = today - timedelta(days=age)
    with TestClient(app) as client:
        family_id = _family(client, f"bw-confidence-age-{age}@example.com")
        _account(client, family_id, start)
        confidence = client.get(f"/api/families/{family_id}/forecast-confidence")
        assert confidence.status_code == 200, confidence.text
        body = confidence.json()
        assert body["days_since_confirmed"] == age
        assert body["last_confirmed_balance_date"] == start.isoformat()
        assert body["show_verify_cta"] is recommend


def test_reconciling_today_clears_a_stale_recommendation():
    today = _today()
    start = today - timedelta(days=14)
    with TestClient(app) as client:
        family_id = _family(client, "bw-confidence-reconcile@example.com")
        _account(client, family_id, start)
        before = client.get(f"/api/families/{family_id}/forecast-confidence")
        assert before.json()["show_verify_cta"] is True
        saved = client.post(
            f"/api/families/{family_id}/reconciled-days",
            json={"date": today.isoformat(), "reconciled": True},
        )
        assert saved.status_code == 200, saved.text
        after = client.get(f"/api/families/{family_id}/forecast-confidence")
        assert after.status_code == 200, after.text
        body = after.json()
        assert body["days_since_confirmed"] == 0
        assert body["last_confirmed_balance_date"] == today.isoformat()
        assert body["show_verify_cta"] is False


def test_an_ordinary_transaction_does_not_refresh_the_checkpoint():
    today = _today()
    start = today - timedelta(days=14)
    with TestClient(app) as client:
        family_id = _family(client, "bw-confidence-tx@example.com")
        _account(client, family_id, start)
        created = client.post(
            f"/api/families/{family_id}/transactions",
            json={
                "date": today.isoformat(),
                "description": "Paycheck",
                "kind": "income",
                "amount": "1000.00",
            },
        )
        assert created.status_code == 200, created.text
        confidence = client.get(f"/api/families/{family_id}/forecast-confidence")
        assert confidence.status_code == 200, confidence.text
        body = confidence.json()
        assert body["days_since_confirmed"] == 14
        assert body["last_confirmed_balance_date"] == start.isoformat()
        assert body["show_verify_cta"] is True


def test_a_newer_verified_balance_still_wins_over_the_starting_date():
    today = _today()
    start = today - timedelta(days=40)
    with TestClient(app) as client:
        family_id = _family(client, "bw-confidence-verified@example.com")
        _account(client, family_id, start)
        saved = client.post(
            f"/api/families/{family_id}/verified-balances",
            json={"date": today.isoformat(), "amount": "2400.00"},
        )
        assert saved.status_code == 200, saved.text
        confidence = client.get(f"/api/families/{family_id}/forecast-confidence")
        assert confidence.status_code == 200, confidence.text
        body = confidence.json()
        assert body["days_since_confirmed"] == 0
        assert body["last_confirmed_balance_date"] == today.isoformat()
        assert body["show_verify_cta"] is False
