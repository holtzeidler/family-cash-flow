"""First paid subscription is recorded for analytics without a new table.

Uses a disposable local database. Does not call Stripe or send email.
"""

from __future__ import annotations

import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "e2e"))

from smoke_guard import (  # noqa: E402
    apply_safe_environment,
    assert_loaded_settings,
    assert_process_is_safe,
    smoke_db_path,
)
from verified_signup import signup_verified  # noqa: E402

_DB = smoke_db_path("balancewhiz-smoke-ga-purchase.db")
_DB.parent.mkdir(parents=True, exist_ok=True)
for _extra in (_DB, Path(str(_DB) + "-wal"), Path(str(_DB) + "-shm")):
    if _extra.exists():
        _extra.unlink()

apply_safe_environment(_DB)
assert_process_is_safe(_DB)

sys.path.insert(0, str(ROOT / "backend"))
from app.billing_catalog import LOOKUP_ANNUAL, LOOKUP_MONTHLY  # noqa: E402
from app.billing_entitlement import (  # noqa: E402
    ANALYTICS_PURCHASE_KIND,
    family_billing_payload,
    record_first_paid_subscription_invoice,
)
from app.main import (  # noqa: E402
    Base,
    Family,
    FamilyMember,
    LifecycleEmailSend,
    SessionLocal,
    User,
    app,
    engine,
    select,
    settings,
)
from fastapi.testclient import TestClient  # noqa: E402

assert_loaded_settings(
    database_url=settings.DATABASE_URL,
    env=settings.ENV,
    stripe_key=settings.STRIPE_SECRET_KEY,
    resend_key=settings.RESEND_API_KEY,
    smtp_host=settings.CONTACT_SMTP_HOST,
    db_filename=_DB.name,
)

Base.metadata.create_all(bind=engine)

INVOICE = "in_1AaBbCcDdEeFfGgHh"


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _family(db) -> Family:
    user = User(
        email=f"bw-smoke-ga-{uuid.uuid4().hex[:10]}@example.com",
        password_hash="not-used",
        first_name="Smoke",
        platform_role="subscriber",
    )
    db.add(user)
    db.flush()
    family = Family(name="Smoke", created_at=_now())
    db.add(family)
    db.flush()
    db.add(
        FamilyMember(
            family_id=family.id,
            user_id=user.id,
            role="owner",
            is_family_owner=True,
            access_mode="edit",
        )
    )
    db.commit()
    db.refresh(family)
    return family


def _invoice(**overrides):
    data = {
        "id": INVOICE,
        "billing_reason": "subscription_cycle",
        "currency": "usd",
        "amount_paid": 599,
        "lines": {
            "data": [
                {
                    "price": {
                        "lookup_key": LOOKUP_MONTHLY,
                        "recurring": {"interval": "month"},
                    }
                }
            ]
        },
    }
    data.update(overrides)
    return data


def test_zero_trial_invoice_is_not_a_purchase():
    db = SessionLocal()
    try:
        family = _family(db)
        saved = record_first_paid_subscription_invoice(
            db,
            family_id=family.id,
            lookup_key=LOOKUP_MONTHLY,
            invoice=_invoice(amount_paid=0, billing_reason="subscription_create"),
        )
        assert saved is False
        payload = family_billing_payload(db, family_id=family.id)
        assert "analytics_purchase" not in payload
    finally:
        db.close()


def test_first_paid_invoice_uses_the_public_price_and_ignores_renewals():
    db = SessionLocal()
    try:
        family = _family(db)
        saved = record_first_paid_subscription_invoice(
            db,
            family_id=family.id,
            lookup_key=LOOKUP_MONTHLY,
            invoice=_invoice(amount_paid=1234),
        )
        assert saved is True
        renewal = record_first_paid_subscription_invoice(
            db,
            family_id=family.id,
            lookup_key=LOOKUP_MONTHLY,
            invoice=_invoice(id="in_2RenewalInvoiceAbcdef", amount_paid=599),
        )
        assert renewal is False
        ignored = record_first_paid_subscription_invoice(
            db,
            family_id=family.id,
            lookup_key=LOOKUP_MONTHLY,
            invoice=_invoice(id="cs_live_checkoutsession", billing_reason="manual", amount_paid=5999),
        )
        assert ignored is False
        rows = db.execute(
            select(LifecycleEmailSend).where(
                LifecycleEmailSend.family_id == family.id,
                LifecycleEmailSend.kind == ANALYTICS_PURCHASE_KIND,
            )
        ).scalars().all()
        assert len(rows) == 1
        assert rows[0].trial_end_key == f"{INVOICE}|m"
        payload = family_billing_payload(db, family_id=family.id)
        purchase = payload["analytics_purchase"]
        assert purchase == {
            "transaction_id": INVOICE,
            "plan": "monthly",
            "value": 5.99,
            "currency": "USD",
        }
        assert "email" not in purchase
        assert 12.34 not in purchase.values()
    finally:
        db.close()


def test_annual_invoice_stores_the_annual_public_price():
    db = SessionLocal()
    try:
        family = _family(db)
        saved = record_first_paid_subscription_invoice(
            db,
            family_id=family.id,
            lookup_key=LOOKUP_ANNUAL,
            invoice=_invoice(
                id="in_3AnnualInvoiceAbcdefg",
                billing_reason="subscription_create",
                amount_paid=5999,
                lines={
                    "data": [
                        {
                            "price": {
                                "lookup_key": LOOKUP_ANNUAL,
                                "recurring": {"interval": "year"},
                            }
                        }
                    ]
                },
            ),
        )
        assert saved is True
        purchase = family_billing_payload(db, family_id=family.id)["analytics_purchase"]
        assert purchase["plan"] == "annual"
        assert purchase["value"] == 59.99
        assert purchase["transaction_id"] == "in_3AnnualInvoiceAbcdefg"
    finally:
        db.close()


def test_complimentary_access_is_not_reported_as_a_paid_subscription():
    db = SessionLocal()
    try:
        family = _family(db)
        member = db.execute(
            select(FamilyMember).where(FamilyMember.family_id == family.id)
        ).scalar_one()
        owner = db.get(User, int(member.user_id))
        owner.complimentary_access = True
        db.commit()
        saved = record_first_paid_subscription_invoice(
            db,
            family_id=family.id,
            lookup_key=LOOKUP_MONTHLY,
            invoice=_invoice(amount_paid=599),
        )
        assert saved is True
        payload = family_billing_payload(db, family_id=family.id)
        assert payload["complimentary_access_active"] is True
        assert "analytics_purchase" not in payload
    finally:
        db.close()


def test_register_reports_trial_started_without_adding_it_to_analytics():
    with TestClient(app) as client:
        res = signup_verified(
            client,
            email=f"bw-smoke-ga-{uuid.uuid4().hex[:10]}@example.com",
            password="SmokeOnly1!",
            first_name="Trial",
            last_name="Starter",
        )
    assert res.status_code == 200
    body = res.json()
    assert body["trial_started"] is True
    assert "analytics_purchase" not in body
