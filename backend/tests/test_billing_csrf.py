"""Billing changes require a BalanceWhiz page, not only the session cookie.

Uses a disposable local database and stand-in Stripe objects. Does not call
Stripe, send email, or touch a hosted billing record.
"""

from __future__ import annotations

import sys
import uuid
from pathlib import Path
from types import SimpleNamespace

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "e2e"))

from smoke_guard import (  # noqa: E402
    apply_safe_environment,
    assert_loaded_settings,
    assert_process_is_safe,
    smoke_db_path,
)

_DB = smoke_db_path("balancewhiz-smoke-csrf.db")
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

_PASSWORD = "SmokeOnly1!"
_EVIL_ORIGIN = "https://evil.example"
_HEADER = {"X-BalanceWhiz-Request": "1"}


def _site_headers(*, origin: str | None = None, header: bool = True, bearer: str | None = None) -> dict:
    headers: dict[str, str] = {}
    if header:
        headers.update(_HEADER)
    if origin is not None:
        headers["Origin"] = origin
    if bearer:
        headers["Authorization"] = f"Bearer {bearer}"
    headers["Accept"] = "application/json"
    return headers


def _register_and_login(client: TestClient, *, keep: bool) -> tuple[str, int]:
    email = f"bw-smoke-csrf-{uuid.uuid4().hex[:10]}@example.com"
    created = client.post(
        "/api/auth/register",
        json={"email": email, "password": _PASSWORD, "first_name": "Csrf", "last_name": "Tester"},
    )
    assert created.status_code == 201, created.text
    client.post("/api/auth/logout")
    logged = client.post(
        "/api/auth/login",
        json={"email": email, "password": _PASSWORD, "keep_me_logged_in": keep},
    )
    assert logged.status_code == 200, logged.text
    families = client.get("/api/families")
    assert families.status_code == 200, families.text
    return logged.json()["access_token"], int(families.json()[0]["id"])


def _checkout(client: TestClient, family_id: int, lookup: str, headers: dict):
    return client.post(
        "/create-checkout-session",
        data={"family_id": str(family_id), "lookup_key": lookup},
        headers=headers,
    )


def test_cross_site_form_cannot_start_checkout_or_change_a_subscription():
    with TestClient(app) as client:
        _token, family_id = _register_and_login(client, keep=True)
        form_attacks = [
            ("/create-checkout-session", {"family_id": str(family_id), "lookup_key": "cash_forecast_monthly"}),
            ("/switch-billing-interval", {"family_id": str(family_id), "target_lookup": "cash_forecast_annual"}),
            ("/schedule-subscription-cancel", {"family_id": str(family_id)}),
            ("/resume-subscription", {"family_id": str(family_id)}),
        ]
        for path, form in form_attacks:
            missing = client.post(path, data=form, headers={"Origin": _EVIL_ORIGIN, "Accept": "application/json"})
            assert missing.status_code == 403, path
            forged = client.post(
                path,
                data=form,
                headers={"Origin": _EVIL_ORIGIN, "Accept": "application/json", **_HEADER},
            )
            assert forged.status_code == 403, path
            blank = client.post(path, data=form, headers={"Accept": "application/json", **_HEADER})
            assert blank.status_code == 403, path


def test_stripe_webhook_is_not_subject_to_the_billing_page_check():
    with TestClient(app) as client:
        rejected = client.post("/webhook", content=b"{}", headers={"Origin": _EVIL_ORIGIN})
        assert rejected.status_code == 503
        assert "BalanceWhiz" not in rejected.text


def test_keep_me_logged_in_cookie_can_start_monthly_and_annual_checkout(monkeypatch):
    created = {}

    def _customer_create(**_kwargs):
        return SimpleNamespace(id="cus_unit_csrf")

    def _price_list(**_kwargs):
        return SimpleNamespace(data=[SimpleNamespace(id="price_unit_csrf")])

    def _session_create(**kwargs):
        created.update(kwargs)
        return SimpleNamespace(url="https://checkout.stripe.test/c/unit-csrf")

    import app.stripe_billing as billing

    monkeypatch.setattr(settings, "STRIPE_SECRET_KEY", "unit-csrf-not-a-stripe-key")
    monkeypatch.setattr(billing.stripe.Customer, "create", _customer_create)
    monkeypatch.setattr(billing.stripe.Price, "list", _price_list)
    monkeypatch.setattr(billing.stripe.checkout.Session, "create", _session_create)

    with TestClient(app) as client:
        token, family_id = _register_and_login(client, keep=True)
        cookie_only = TestClient(app)
        cookie_only.cookies.set("access_token", client.cookies.get("access_token"))
        for lookup in ("cash_forecast_monthly", "cash_forecast_annual"):
            created.clear()
            res = _checkout(
                cookie_only,
                family_id,
                lookup,
                _site_headers(origin=settings.APP_PUBLIC_BASE_URL),
            )
            assert res.status_code == 200, res.text
            body = res.json()
            assert body["url"] == "https://checkout.stripe.test/c/unit-csrf"
            assert body["lookup_key"] == lookup
            assert "checkout=canceled" in created["cancel_url"]
            assert "checkout=success" in created["success_url"]

        bearer_only = TestClient(app)
        res = _checkout(
            bearer_only,
            family_id,
            "cash_forecast_monthly",
            _site_headers(origin=settings.APP_PUBLIC_BASE_URL, bearer=token),
        )
        assert res.status_code == 200, res.text
    monkeypatch.undo()


@pytest.mark.parametrize(
    ("path", "form", "detail"),
    [
        (
            "/switch-billing-interval",
            {"target_lookup": "cash_forecast_annual"},
            "No Stripe subscription is on file to switch",
        ),
        (
            "/schedule-subscription-cancel",
            {},
            "No Stripe subscription is on file to cancel.",
        ),
        (
            "/resume-subscription",
            {},
            "No Stripe subscription is on file to resume.",
        ),
    ],
)
def test_signed_in_billing_changes_still_reach_the_existing_checks(path, form, detail, monkeypatch):
    monkeypatch.setattr(settings, "STRIPE_SECRET_KEY", "unit-csrf-not-a-stripe-key")
    with TestClient(app) as client:
        _token, family_id = _register_and_login(client, keep=False)
        payload = {"family_id": str(family_id), **form}
        res = client.post(
            path,
            data=payload,
            headers=_site_headers(origin=settings.APP_PUBLIC_BASE_URL),
        )
        assert res.status_code == 400, res.text
        assert detail in res.text
        assert "BalanceWhiz" not in res.text
    monkeypatch.undo()
