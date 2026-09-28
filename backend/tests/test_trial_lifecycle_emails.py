"""Scheduled lifecycle emails on a disposable local database.

No Resend call, no Stripe API call, and no hosted database. The send
functions and Stripe subscription read are replaced in memory.
"""

from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "e2e"))

from smoke_guard import (  # noqa: E402
    apply_safe_environment,
    assert_loaded_settings,
    assert_process_is_safe,
    smoke_db_path,
)

_DB = smoke_db_path("balancewhiz-smoke-lifecycle.db")
_DB.parent.mkdir(parents=True, exist_ok=True)
for _extra in (_DB, Path(str(_DB) + "-wal"), Path(str(_DB) + "-shm")):
    if _extra.exists():
        _extra.unlink()

apply_safe_environment(_DB)
assert_process_is_safe(_DB)

sys.path.insert(0, str(ROOT / "backend"))
from app.billing_catalog import LOOKUP_ANNUAL, LOOKUP_MONTHLY  # noqa: E402
from app.billing_entitlement import (  # noqa: E402
    annual_renewal_reminder_facts,
    family_billing_payload,
    trial_ending_reminder_applies,
    trial_expired_email_applies,
)
from app.main import (  # noqa: E402
    Base,
    BillingSubscription,
    Family,
    FamilyMember,
    LifecycleEmailSend,
    SessionLocal,
    User,
    engine,
    select,
    settings,
)
from app.trial_ending_reminders import ANNUAL_RENEWAL_KIND, REMINDER_KIND, TRIAL_EXPIRED_KIND  # noqa: E402

assert_loaded_settings(
    database_url=settings.DATABASE_URL,
    env=settings.ENV,
    stripe_key=settings.STRIPE_SECRET_KEY,
    resend_key=settings.RESEND_API_KEY,
    smtp_host=settings.CONTACT_SMTP_HOST,
    db_filename=_DB.name,
)

Base.metadata.create_all(bind=engine)


class _Ns:
    def __init__(self, **kwargs):
        self.__dict__.update(kwargs)


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _annual_stripe(period_end: datetime, *, status: str = "active", cancel: bool = False, trial_end=None, lookup: str = LOOKUP_ANNUAL, cents: int = 5999, interval: str = "year"):
    return _Ns(
        status=status,
        cancel_at_period_end=cancel,
        trial_end=trial_end,
        current_period_end=period_end,
        items=_Ns(
            data=[
                _Ns(
                    price=_Ns(
                        lookup_key=lookup,
                        unit_amount=cents,
                        recurring=_Ns(interval=interval),
                    )
                )
            ]
        ),
    )


def test_annual_reminder_is_seven_days_before_a_renewing_annual_plan():
    now = _now()
    end = now + timedelta(days=7)
    facts = annual_renewal_reminder_facts(_annual_stripe(end), now=now)
    assert facts is not None
    assert facts["amount_display"] == "$59.99"
    assert annual_renewal_reminder_facts(_annual_stripe(now + timedelta(days=6)), now=now) is None
    assert annual_renewal_reminder_facts(_annual_stripe(now + timedelta(days=8)), now=now) is None
    assert annual_renewal_reminder_facts(_annual_stripe(end, cancel=True), now=now) is None
    assert (
        annual_renewal_reminder_facts(
            _annual_stripe(end, lookup=LOOKUP_MONTHLY, cents=599, interval="month"),
            now=now,
        )
        is None
    )
    assert annual_renewal_reminder_facts(_annual_stripe(end, trial_end=now + timedelta(days=1)), now=now) is None


def _account(db, email: str, created_at: datetime, *, complimentary: bool = False) -> Family:
    user = User(
        email=email,
        password_hash="not-used",
        first_name="Smoke",
        platform_role="subscriber",
        complimentary_access=complimentary,
        complimentary_access_expires_at=None,
    )
    db.add(user)
    db.flush()
    family = Family(name="Smoke", created_at=created_at)
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


def _plan(db, family: Family, *, sub_id: str, status: str, lookup: str, period_end: datetime, cancel: bool = False, trial_end: datetime | None = None) -> None:
    stamp = _now()
    db.add(
        BillingSubscription(
            family_id=family.id,
            stripe_subscription_id=sub_id,
            status=status,
            lookup_key=lookup,
            cancel_at_period_end=cancel,
            current_period_end=period_end,
            trial_end=trial_end,
            created_at=stamp,
            updated_at=stamp,
        )
    )
    db.commit()


def _created_for_days_left(days: int, now: datetime) -> datetime:
    return (now + timedelta(days=days)) - timedelta(days=14)


def test_scheduler_sends_each_lifecycle_email_once_and_skips_the_rest(monkeypatch):
    assert (monkeypatch.setenv("TRIAL_ENDING_REMINDERS_ENABLED", "1") or True)
    assert "TRIAL_ENDING_REMINDERS_ALLOW_PRODUCTION" not in __import__("os").environ or __import__("os").environ.get(
        "TRIAL_ENDING_REMINDERS_ALLOW_PRODUCTION"
    ) != "1"
    monkeypatch.setattr(settings, "RESEND_API_KEY", "re_local_not_sent")
    monkeypatch.setattr(settings, "STRIPE_SECRET_KEY", "local-not-a-stripe-key")
    monkeypatch.setattr("app.main._is_staging_deployment", lambda: True)

    now = _now()
    renewal = now + timedelta(days=7)
    emails = {
        "ending": "bw-smoke-life3@example.com",
        "monthly": "bw-smoke-lifemo@example.com",
        "annual_trial": "bw-smoke-lifeyr@example.com",
        "comp_trial": "bw-smoke-lifecomp@example.com",
        "comp_expired": "bw-smoke-lifecompx@example.com",
        "expired": "bw-smoke-lifeexp@example.com",
        "days7": "bw-smoke-life7@example.com",
        "days1": "bw-smoke-life1@example.com",
        "monthly_paid": "bw-smoke-lifemonth@example.com",
        "annual_paid": "bw-smoke-lifeann@example.com",
        "annual_cancel": "bw-smoke-lifeannx@example.com",
        "annual_comp": "bw-smoke-lifeannc@example.com",
    }
    monkeypatch.setattr("app.main._staging_auth_email_allowlist", lambda: set(emails.values()))

    with SessionLocal() as db:
        ending = _account(db, emails["ending"], _created_for_days_left(3, now))
        monthly = _account(db, emails["monthly"], _created_for_days_left(3, now))
        annual_trial = _account(db, emails["annual_trial"], _created_for_days_left(3, now))
        comp_trial = _account(db, emails["comp_trial"], _created_for_days_left(3, now), complimentary=True)
        comp_expired = _account(db, emails["comp_expired"], datetime(2020, 1, 1, 12, 0, 0), complimentary=True)
        expired = _account(db, emails["expired"], datetime(2020, 1, 1, 12, 0, 0))
        _account(db, emails["days7"], _created_for_days_left(7, now))
        _account(db, emails["days1"], _created_for_days_left(1, now))
        monthly_paid = _account(db, emails["monthly_paid"], datetime(2024, 1, 1, 12, 0, 0))
        annual_paid = _account(db, emails["annual_paid"], datetime(2024, 1, 1, 12, 0, 0))
        annual_cancel = _account(db, emails["annual_cancel"], datetime(2024, 1, 1, 12, 0, 0))
        annual_comp = _account(db, emails["annual_comp"], datetime(2024, 1, 1, 12, 0, 0), complimentary=True)

        trial_end = now + timedelta(days=3)
        _plan(db, monthly, sub_id="sub_life_mo", status="trialing", lookup=LOOKUP_MONTHLY, period_end=trial_end, trial_end=trial_end)
        _plan(db, annual_trial, sub_id="sub_life_yr", status="trialing", lookup=LOOKUP_ANNUAL, period_end=trial_end, trial_end=trial_end)
        _plan(db, monthly_paid, sub_id="sub_life_month", status="active", lookup=LOOKUP_MONTHLY, period_end=renewal)
        _plan(db, annual_paid, sub_id="sub_life_ann", status="active", lookup=LOOKUP_ANNUAL, period_end=renewal)
        _plan(db, annual_cancel, sub_id="sub_life_annx", status="active", lookup=LOOKUP_ANNUAL, period_end=renewal, cancel=True)
        _plan(db, annual_comp, sub_id="sub_life_annc", status="active", lookup=LOOKUP_ANNUAL, period_end=renewal)

        assert trial_ending_reminder_applies(family_billing_payload(db, family_id=ending.id))
        assert trial_ending_reminder_applies(family_billing_payload(db, family_id=monthly.id)) is False
        assert trial_ending_reminder_applies(family_billing_payload(db, family_id=annual_trial.id)) is False
        assert trial_ending_reminder_applies(family_billing_payload(db, family_id=comp_trial.id)) is False
        assert trial_expired_email_applies(family_billing_payload(db, family_id=comp_expired.id)) is False
        assert trial_expired_email_applies(family_billing_payload(db, family_id=expired.id))
        assert trial_expired_email_applies(family_billing_payload(db, family_id=monthly.id)) is False

    import stripe

    annual_remote = _annual_stripe(renewal)
    retrieved = []

    def retrieve(sub_id, expand=None):
        retrieved.append(sub_id)
        if sub_id == "sub_life_ann":
            return annual_remote
        return _annual_stripe(renewal, status="canceled", cancel=True)

    monkeypatch.setattr(stripe.Subscription, "retrieve", retrieve)

    sent = []

    def _record(kind):
        def _send(**kwargs):
            sent.append((kind, kwargs["to_addr"]))
            return "local-not-sent"

        return _send

    monkeypatch.setattr("app.email_service.send_trial_ending_email", _record(REMINDER_KIND))
    monkeypatch.setattr("app.email_service.send_trial_expired_email", _record(TRIAL_EXPIRED_KIND))
    monkeypatch.setattr("app.email_service.send_annual_renewal_email", _record(ANNUAL_RENEWAL_KIND))

    from app.trial_ending_reminders import run

    assert run(dry_run=False) == 0
    assert sorted(sent) == sorted(
        [
            (REMINDER_KIND, emails["ending"]),
            (TRIAL_EXPIRED_KIND, emails["expired"]),
            (ANNUAL_RENEWAL_KIND, emails["annual_paid"]),
        ]
    )
    assert emails["monthly"] not in {addr for _kind, addr in sent}
    assert emails["annual_trial"] not in {addr for _kind, addr in sent}
    assert emails["comp_trial"] not in {addr for _kind, addr in sent}
    assert emails["comp_expired"] not in {addr for _kind, addr in sent}
    assert emails["monthly_paid"] not in {addr for _kind, addr in sent}
    assert emails["annual_cancel"] not in {addr for _kind, addr in sent}
    assert emails["annual_comp"] not in {addr for _kind, addr in sent}
    assert retrieved == ["sub_life_ann"]

    first = list(sent)
    assert run(dry_run=False) == 0
    assert sent == first

    with SessionLocal() as db:
        rows = db.execute(select(LifecycleEmailSend.kind, LifecycleEmailSend.trial_end_key)).all()
    assert sorted(kind for kind, _key in rows) == sorted([REMINDER_KIND, TRIAL_EXPIRED_KIND, ANNUAL_RENEWAL_KIND])
    assert len({key for _kind, key in rows}) == 3


def test_scheduler_refuses_to_run_outside_staging(monkeypatch):
    monkeypatch.setenv("TRIAL_ENDING_REMINDERS_ENABLED", "1")
    monkeypatch.delenv("TRIAL_ENDING_REMINDERS_ALLOW_PRODUCTION", raising=False)
    monkeypatch.setattr("app.main._is_staging_deployment", lambda: False)

    def _boom(**_kwargs):
        raise AssertionError("lifecycle email was sent outside staging")

    monkeypatch.setattr("app.email_service.send_trial_ending_email", _boom)
    monkeypatch.setattr("app.email_service.send_trial_expired_email", _boom)
    monkeypatch.setattr("app.email_service.send_annual_renewal_email", _boom)
    from app.trial_ending_reminders import run

    assert run(dry_run=False) == 1


def test_empty_staging_allowlist_sends_nobody(monkeypatch):
    monkeypatch.setenv("TRIAL_ENDING_REMINDERS_ENABLED", "1")
    monkeypatch.setattr(settings, "RESEND_API_KEY", "re_local_not_sent")
    monkeypatch.setattr(settings, "STRIPE_SECRET_KEY", "local-not-a-stripe-key")
    monkeypatch.setattr("app.main._is_staging_deployment", lambda: True)
    monkeypatch.setattr("app.main._staging_auth_email_allowlist", lambda: set())
    with SessionLocal() as db:
        _account(db, "bw-smoke-lifemiss@example.com", _created_for_days_left(3, _now()))
    sent = []
    monkeypatch.setattr(
        "app.email_service.send_trial_ending_email",
        lambda **kwargs: sent.append(kwargs["to_addr"]) or "local-not-sent",
    )
    monkeypatch.setattr("app.email_service.send_trial_expired_email", lambda **kwargs: sent.append(kwargs["to_addr"]))
    monkeypatch.setattr("app.email_service.send_annual_renewal_email", lambda **kwargs: sent.append(kwargs["to_addr"]))
    from app.trial_ending_reminders import run

    assert run(dry_run=False) == 0
    assert sent == []
