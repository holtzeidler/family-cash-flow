"""A second family shares the owner's existing trial. It does not start another 14 days.

Uses a disposable local database. Does not call Stripe or send email.
"""

from __future__ import annotations

import sys
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "e2e"))

from smoke_guard import (  # noqa: E402
    apply_safe_environment,
    assert_loaded_settings,
    assert_process_is_safe,
    smoke_db_path,
)

_DB = smoke_db_path("balancewhiz-smoke-one-trial.db")
_DB.parent.mkdir(parents=True, exist_ok=True)
for _extra in (_DB, Path(str(_DB) + "-wal"), Path(str(_DB) + "-shm")):
    if _extra.exists():
        _extra.unlink()

apply_safe_environment(_DB)
assert_process_is_safe(_DB)

sys.path.insert(0, str(ROOT / "backend"))
from app.billing_catalog import LOOKUP_MONTHLY  # noqa: E402
from app.main import BillingSubscription, Family, SessionLocal, User, app, settings  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

assert_loaded_settings(
    database_url=settings.DATABASE_URL,
    env=settings.ENV,
    stripe_key=settings.STRIPE_SECRET_KEY,
    resend_key=settings.RESEND_API_KEY,
    smtp_host=settings.CONTACT_SMTP_HOST,
    db_filename=_DB.name,
)


def _register(client: TestClient, email: str) -> None:
    res = client.post(
        "/api/auth/register",
        json={
            "email": email,
            "password": "SmokeOnly1!",
            "first_name": "Trial",
            "last_name": "Owner",
        },
    )
    assert res.status_code == 201, res.text


def _family_ids(client: TestClient) -> list[int]:
    res = client.get("/api/families")
    assert res.status_code == 200, res.text
    return [int(row["id"]) for row in res.json()]


def _billing(client: TestClient, family_id: int) -> dict:
    res = client.get(f"/api/families/{family_id}/billing-status")
    assert res.status_code == 200, res.text
    return res.json()


def _set_created(family_id: int, created_at: datetime) -> None:
    with SessionLocal() as db:
        family = db.get(Family, family_id)
        assert family is not None
        family.created_at = created_at
        db.commit()


def _set_complimentary(email: str) -> None:
    with SessionLocal() as db:
        user = db.query(User).filter(User.email == email).one()
        user.complimentary_access = True
        user.complimentary_access_expires_at = None
        db.commit()


def _add_subscription(family_id: int, *, status: str, sub_id: str) -> None:
    now = datetime.utcnow()
    with SessionLocal() as db:
        db.add(
            BillingSubscription(
                family_id=family_id,
                stripe_subscription_id=sub_id,
                status=status,
                lookup_key=LOOKUP_MONTHLY,
                current_period_end=now + timedelta(days=20),
                trial_end=now + timedelta(days=4) if status == "trialing" else None,
                cancel_at_period_end=False,
                created_at=now,
                updated_at=now,
            )
        )
        db.commit()


def test_expired_owner_does_not_get_another_trial_on_a_new_family():
    email = "bw-smoke-onetrial-expired@example.com"
    with TestClient(app) as client:
        _register(client, email)
        first_id = _family_ids(client)[0]
        _set_created(first_id, datetime(2020, 1, 15, 12, 0, 0))
        created = client.post("/api/families", json={"name": "Second household"})
        assert created.status_code == 200, created.text
        second_id = int(created.json()["id"])
        assert second_id != first_id
        first = _billing(client, first_id)
        second = _billing(client, second_id)

    assert first["phase"] == "expired"
    assert first["entitled"] is False
    assert second["phase"] == "expired"
    assert second["entitled"] is False
    assert second["in_app_trial"] is False
    assert second["trial_days_remaining"] == 0
    assert second["trial_ends_at"] == first["trial_ends_at"]
    assert second["trial_days_remaining"] != 14


def test_new_family_during_an_open_trial_keeps_the_same_end():
    email = "bw-smoke-onetrial-open@example.com"
    started = datetime.utcnow().replace(microsecond=0) - timedelta(days=10)
    with TestClient(app) as client:
        _register(client, email)
        first_id = _family_ids(client)[0]
        _set_created(first_id, started)
        created = client.post("/api/families", json={"name": "Second household"})
        assert created.status_code == 200, created.text
        second_id = int(created.json()["id"])
        first = _billing(client, first_id)
        second = _billing(client, second_id)

    assert first["in_app_trial"] is True
    assert second["in_app_trial"] is True
    assert second["entitled"] is True
    assert second["trial_ends_at"] == first["trial_ends_at"]
    assert second["trial_days_remaining"] == first["trial_days_remaining"]
    assert second["trial_days_remaining"] < 14


def test_complimentary_owner_stays_entitled_on_a_new_family():
    email = "bw-smoke-onetrial-comp@example.com"
    with TestClient(app) as client:
        _register(client, email)
        first_id = _family_ids(client)[0]
        _set_created(first_id, datetime(2020, 1, 15, 12, 0, 0))
        _set_complimentary(email)
        created = client.post("/api/families", json={"name": "Second household"})
        assert created.status_code == 200, created.text
        second = _billing(client, int(created.json()["id"]))
        first = _billing(client, first_id)

    assert first["phase"] == "complimentary"
    assert first["entitled"] is True
    assert first["complimentary_access_active"] is True
    assert second["phase"] == "complimentary"
    assert second["entitled"] is True
    assert second["complimentary_access_active"] is True
    assert second["in_app_trial"] is False


def test_paid_and_trialing_subscriptions_are_unchanged_by_a_new_family():
    paid_email = "bw-smoke-onetrial-paid@example.com"
    trialing_email = "bw-smoke-onetrial-stripe@example.com"
    with TestClient(app) as client:
        _register(client, paid_email)
        paid_id = _family_ids(client)[0]
        _set_created(paid_id, datetime(2020, 1, 15, 12, 0, 0))
        _add_subscription(paid_id, status="active", sub_id="sub_one_trial_paid")
        before = _billing(client, paid_id)
        created = client.post("/api/families", json={"name": "Second household"})
        assert created.status_code == 200, created.text
        after = _billing(client, paid_id)
        second = _billing(client, int(created.json()["id"]))

    assert before["phase"] == "active"
    assert before["entitled"] is True
    assert before["stripe_subscription_id"] == "sub_one_trial_paid"
    assert after == before
    assert second["phase"] == "expired"
    assert second["entitled"] is False
    assert second["stripe_subscription_id"] is None

    with TestClient(app) as client:
        _register(client, trialing_email)
        trialing_id = _family_ids(client)[0]
        _add_subscription(trialing_id, status="trialing", sub_id="sub_one_trial_stripe")
        before = _billing(client, trialing_id)
        created = client.post("/api/families", json={"name": "Second household"})
        assert created.status_code == 200, created.text
        after = _billing(client, trialing_id)
        second = _billing(client, int(created.json()["id"]))

    assert before["status"] == "trialing"
    assert before["entitled"] is True
    assert before["stripe_subscription_id"] == "sub_one_trial_stripe"
    assert after["status"] == "trialing"
    assert after["entitled"] is True
    assert after["stripe_subscription_id"] == "sub_one_trial_stripe"
    assert after["trial_ends_at"] == before["trial_ends_at"]
    assert second["in_app_trial"] is True
    assert second["trial_ends_at"] == before["trial_ends_at"]
    assert second["stripe_subscription_id"] is None
