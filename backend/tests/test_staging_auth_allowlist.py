"""Staging admits only allowlisted test addresses, and fails closed when the list is empty.

Uses a disposable local database. Staging is simulated by pointing
APP_PUBLIC_BASE_URL at staging.balancewhiz.com after the app loads. Does not
call Stripe, send email, or touch a hosted database.
"""

from __future__ import annotations

import sys
import uuid
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
from verified_signup import signup_verified  # noqa: E402

# "staging" in the filename lets the staging write guard treat this database as staging.
_DB = smoke_db_path("balancewhiz-smoke-staging-auth.db")
_DB.parent.mkdir(parents=True, exist_ok=True)
for _extra in (_DB, Path(str(_DB) + "-wal"), Path(str(_DB) + "-shm")):
    if _extra.exists():
        _extra.unlink()

apply_safe_environment(_DB)
assert_process_is_safe(_DB)

sys.path.insert(0, str(ROOT / "backend"))
import app.email_service as email_service  # noqa: E402
from app.main import (  # noqa: E402
    Family,
    FamilyMember,
    PasswordResetToken,
    SessionLocal,
    User,
    _send_signup_welcome_email,
    app,
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

_PASSWORD = "SmokeOnly1!"
_STAGING_URL = "https://staging.balancewhiz.com"
_DENIED = "cannot sign in on the staging site"


def _email() -> str:
    return f"bw-smoke-{uuid.uuid4().hex[:10]}@example.com"


def _register(client: TestClient, email: str):
    return signup_verified(client, email=email, password=_PASSWORD, first_name="Staging", last_name="Tester")


def _login(client: TestClient, email: str):
    return client.post("/api/auth/login", json={"email": email, "password": _PASSWORD})


def _existing_user(email: str) -> str:
    """Create the account outside staging mode and return its access token."""
    with TestClient(app) as client:
        res = _register(client, email)
        assert res.status_code == 200
        return res.json()["access_token"]


@pytest.fixture
def welcome_sends(monkeypatch):
    sent: list[str] = []

    def fake_send_welcome_email(**kwargs):
        sent.append(kwargs["to_addr"])
        return "local-not-sent"

    monkeypatch.setattr(settings, "RESEND_API_KEY", "re_local_not_sent")
    monkeypatch.setattr(email_service, "send_welcome_email", fake_send_welcome_email)
    return sent


def _as_staging(monkeypatch, allowlist: str) -> None:
    monkeypatch.setattr(settings, "APP_PUBLIC_BASE_URL", _STAGING_URL)
    monkeypatch.setattr(settings, "STAGING_AUTH_EMAIL_ALLOWLIST", allowlist)


def test_listed_tester_can_register_log_in_and_keep_a_session(monkeypatch, welcome_sends):
    tester = _email()
    _as_staging(monkeypatch, f"other@example.com, {tester.upper()}")
    with TestClient(app) as client:
        created = _register(client, tester)
        assert created.status_code == 200
        assert client.get("/api/families").status_code == 200
        token = created.json()["access_token"]
        client.post("/api/auth/logout")
        assert _login(client, tester).status_code == 200
        assert client.get("/api/auth/me").status_code == 200
    with TestClient(app) as bearer_only:
        res = bearer_only.get("/api/families", headers={"Authorization": f"Bearer {token}"})
        assert res.status_code == 200, res.text
    assert welcome_sends == [tester]


def test_existing_cookie_session_for_unlisted_user_is_refused(monkeypatch):
    outsider = _email()
    with TestClient(app) as client:
        assert _register(client, outsider).status_code == 200
        assert client.get("/api/families").status_code == 200
        _as_staging(monkeypatch, _email())
        for path in ("/api/families", "/api/auth/me"):
            res = client.get(path)
            assert res.status_code == 401, (path, res.text)
            assert _DENIED in res.json()["detail"]


def test_existing_bearer_session_for_unlisted_user_is_refused(monkeypatch):
    token = _existing_user(_email())
    _as_staging(monkeypatch, _email())
    with TestClient(app) as client:
        res = client.get("/api/families", headers={"Authorization": f"Bearer {token}"})
        assert res.status_code == 401, res.text
        assert _DENIED in res.json()["detail"]


def test_unlisted_address_cannot_log_in_or_register(monkeypatch, welcome_sends):
    outsider = _email()
    _existing_user(outsider)
    welcome_sends.clear()
    newcomer = _email()
    _as_staging(monkeypatch, _email())
    with TestClient(app) as client:
        login = _login(client, outsider)
        assert login.status_code == 403 and _DENIED in login.json()["detail"]
        register = _register(client, newcomer)
        assert register.status_code == 403 and _DENIED in register.json()["detail"]
    with SessionLocal() as db:
        assert db.execute(select(User.id).where(User.email == newcomer)).first() is None
    assert welcome_sends == []


@pytest.mark.parametrize("allowlist", ["", " , "])
def test_empty_allowlist_fails_closed_on_staging(monkeypatch, welcome_sends, allowlist):
    existing = _email()
    token = _existing_user(existing)
    welcome_sends.clear()
    _as_staging(monkeypatch, allowlist)
    with TestClient(app) as client:
        assert _login(client, existing).status_code == 403
        assert _register(client, _email()).status_code == 403
        assert client.get("/api/families", headers={"Authorization": f"Bearer {token}"}).status_code == 401
        assert client.post("/api/auth/check-email", json={"email": existing}).json() == {"exists": False}
        config = client.get("/api/debug/public-config").json()
    assert config["staging_auth_restricted"] is True
    assert config["staging_auth_allowlist_configured"] is False
    assert welcome_sends == []


def test_check_email_only_answers_for_listed_addresses(monkeypatch):
    listed = _email()
    unlisted = _email()
    _existing_user(listed)
    _existing_user(unlisted)
    _as_staging(monkeypatch, listed)
    with TestClient(app) as client:
        assert client.post("/api/auth/check-email", json={"email": listed}).json() == {"exists": True}
        assert client.post("/api/auth/check-email", json={"email": unlisted}).json() == {"exists": False}


def test_password_reset_request_creates_nothing_for_unlisted_users(monkeypatch):
    unlisted = _email()
    _existing_user(unlisted)
    _as_staging(monkeypatch, "")
    with TestClient(app) as client:
        res = client.post("/api/public/password-reset/request", json={"email": unlisted})
        assert res.status_code == 200 and res.json() == {"ok": True}
    with SessionLocal() as db:
        user_id = db.execute(select(User.id).where(User.email == unlisted)).scalar_one()
        assert db.execute(select(PasswordResetToken.id).where(PasswordResetToken.user_id == user_id)).first() is None


@pytest.mark.parametrize("allowlist", ["", "someone-else@example.com"])
def test_welcome_email_never_goes_to_unlisted_staging_addresses(monkeypatch, welcome_sends, allowlist):
    """The send itself checks the allowlist, even if a caller skips the registration check."""
    outsider = _email()
    _existing_user(outsider)
    welcome_sends.clear()
    _as_staging(monkeypatch, allowlist)
    with SessionLocal() as db:
        user = db.execute(select(User).where(User.email == outsider)).scalar_one()
        family = db.execute(
            select(Family).join(FamilyMember, FamilyMember.family_id == Family.id).where(FamilyMember.user_id == user.id)
        ).scalar_one()
        _send_signup_welcome_email(user=user, family=family)
    assert welcome_sends == []


def test_listed_platform_admin_keeps_the_staging_console(monkeypatch):
    admin = _email()
    _existing_user(admin)
    _as_staging(monkeypatch, admin)
    monkeypatch.setattr(settings, "PLATFORM_ADMIN_EMAILS", admin)
    with TestClient(app) as client:
        assert _login(client, admin).status_code == 200
        overview = client.get("/api/platform/overview")
        assert overview.status_code == 200, overview.text
        assert overview.json()["staging_auth_restricted"] is True
        assert overview.json()["deployment"] == "staging"
        assert client.get("/api/platform/users").status_code == 200


def test_production_behavior_is_unchanged_without_an_allowlist(monkeypatch, welcome_sends):
    monkeypatch.setattr(settings, "STAGING_AUTH_EMAIL_ALLOWLIST", "")
    email = _email()
    with TestClient(app) as client:
        assert _register(client, email).status_code == 200
        assert client.post("/api/auth/check-email", json={"email": email}).json() == {"exists": True}
        token = client.post("/api/auth/login", json={"email": email, "password": _PASSWORD}).json()["access_token"]
    with TestClient(app) as bearer_only:
        assert bearer_only.get("/api/families", headers={"Authorization": f"Bearer {token}"}).status_code == 200
        config = bearer_only.get("/api/debug/public-config").json()
    assert config["staging_auth_restricted"] is False
    assert welcome_sends == [email]
