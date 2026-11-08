"""Staging password mode: one shared password replaces the email allowlist.

Uses a disposable local database. Staging is simulated by pointing
APP_PUBLIC_BASE_URL at staging.balancewhiz.com after the app loads. Does not
call Stripe, send email, or touch a hosted database. The test password is
local to this file.
"""

from __future__ import annotations

import sys
import time
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
_DB = smoke_db_path("balancewhiz-smoke-staging-access.db")
_DB.parent.mkdir(parents=True, exist_ok=True)
for _extra in (_DB, Path(str(_DB) + "-wal"), Path(str(_DB) + "-shm")):
    if _extra.exists():
        _extra.unlink()

apply_safe_environment(_DB)
assert_process_is_safe(_DB)

sys.path.insert(0, str(ROOT / "backend"))
import app.email_service as email_service  # noqa: E402
from app.main import (  # noqa: E402
    EmailVerification,
    PasswordResetToken,
    SessionLocal,
    User,
    _reset_staging_access_rate_limits,
    _reset_verification_rate_limits,
    _staging_email_recipient_allowed,
    _staging_pass_signing_key,
    app,
    jwt,
    select,
    settings,
)
from app.trial_ending_reminders import _allowlist_blocks  # noqa: E402
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
_GATE_PASSWORD = "local-test-gate-phrase"
_REQUIRED = "Enter the BalanceWhiz Staging password to continue."
_DENIED = "cannot sign in on the staging site"
_HEADER = "X-Staging-Access"


def _email() -> str:
    return f"bw-smoke-{uuid.uuid4().hex[:10]}@example.com"


@pytest.fixture(autouse=True)
def _fresh_limits():
    _reset_staging_access_rate_limits()
    _reset_verification_rate_limits()
    yield
    _reset_staging_access_rate_limits()
    _reset_verification_rate_limits()


@pytest.fixture
def welcome_sends(monkeypatch):
    sent: list[str] = []

    def fake_send_welcome_email(**kwargs):
        sent.append(kwargs["to_addr"])
        return "local-not-sent"

    monkeypatch.setattr(settings, "RESEND_API_KEY", "re_local_not_sent")
    monkeypatch.setattr(email_service, "send_welcome_email", fake_send_welcome_email)
    return sent


def _as_staging(monkeypatch, *, password: str = _GATE_PASSWORD, allowlist: str = "") -> None:
    monkeypatch.setattr(settings, "APP_PUBLIC_BASE_URL", _STAGING_URL)
    monkeypatch.setattr(settings, "STAGING_AUTH_EMAIL_ALLOWLIST", allowlist)
    monkeypatch.setattr(settings, "STAGING_ACCESS_PASSWORD", password)


def _unlock(client: TestClient, password: str = _GATE_PASSWORD, ip: str = "203.0.113.10"):
    return client.post("/api/staging/access", json={"password": password}, headers={"X-Forwarded-For": ip})


def _pass_for(client: TestClient) -> str:
    res = _unlock(client)
    assert res.status_code == 200, res.text
    return res.json()["pass"]


def _register(client: TestClient, email: str):
    return signup_verified(client, email=email, password=_PASSWORD, first_name="Staging", last_name="Tester")


def _login(client: TestClient, email: str):
    return client.post("/api/auth/login", json={"email": email, "password": _PASSWORD})


def _existing_user(email: str) -> dict:
    """Create the account outside staging mode. Returns the onboarding response."""
    with TestClient(app) as client:
        res = _register(client, email)
        assert res.status_code == 200, res.text
        return res.json()


def _assert_locked(res) -> None:
    assert res.status_code == 403, res.text
    assert res.json()["detail"] == _REQUIRED


def test_without_a_password_staging_keeps_the_allowlist(monkeypatch, welcome_sends):
    listed = _email()
    _as_staging(monkeypatch, password="", allowlist=listed)
    with TestClient(app) as client:
        assert client.get("/api/staging/access").json() == {"mode": "allowlist", "pass_valid": False}
        assert _unlock(client).status_code == 409
        assert _register(client, listed).status_code == 200
        assert client.get("/api/families").status_code == 200
        refused = _register(client, _email())
        assert refused.status_code == 403 and _DENIED in refused.json()["detail"]
    assert welcome_sends == [listed]


def test_a_browser_without_a_pass_is_refused_at_every_entry_point(monkeypatch):
    existing = _email()
    _existing_user(existing)
    newcomer = _email()
    _as_staging(monkeypatch)
    with TestClient(app) as client:
        assert client.get("/api/staging/access").json() == {"mode": "password", "pass_valid": False}
        _assert_locked(client.post("/api/auth/check-email", json={"email": existing}))
        _assert_locked(_login(client, existing))
        _assert_locked(_register(client, newcomer))
        _assert_locked(client.post("/api/auth/verify-email", json={"token": "x" * 40}))
        _assert_locked(client.post("/api/public/password-reset/request", json={"email": existing}))
        _assert_locked(client.get("/api/public/password-reset/validate", params={"token": "x" * 40}))
        _assert_locked(
            client.post("/api/public/password-reset/complete", json={"token": "x" * 40, "new_password": "NewSmoke1!"})
        )
        _assert_locked(client.post("/api/public/contact", json={"name": "A", "email": newcomer, "subject": "Hi", "message": "Hello there"}))
        _assert_locked(client.get("/api/families"))
        assert client.get("/api/health").status_code == 200
    with SessionLocal() as db:
        assert db.execute(select(EmailVerification.id).where(EmailVerification.email_normalized == newcomer)).first() is None
        user_id = db.execute(select(User.id).where(User.email == existing)).scalar_one()
        assert db.execute(select(PasswordResetToken.id).where(PasswordResetToken.user_id == user_id)).first() is None


def test_any_new_email_can_sign_up_after_unlocking(monkeypatch, welcome_sends):
    newcomer = _email()
    _as_staging(monkeypatch, allowlist="someone-else@example.com")
    with TestClient(app) as client:
        client.headers[_HEADER] = _pass_for(client)
        assert client.get("/api/staging/access").json() == {"mode": "password", "pass_valid": True}
        assert client.post("/api/auth/check-email", json={"email": newcomer}).json() == {"exists": False}
        created = _register(client, newcomer)
        assert created.status_code == 200, created.text
        assert client.get("/api/families").status_code == 200
        assert client.post("/api/auth/check-email", json={"email": newcomer}).json() == {"exists": True}
    assert welcome_sends == [newcomer]


def test_an_existing_account_logs_in_after_unlocking(monkeypatch):
    existing = _email()
    _existing_user(existing)
    _as_staging(monkeypatch)
    with TestClient(app) as client:
        _assert_locked(_login(client, existing))
        client.headers[_HEADER] = _pass_for(client)
        assert _login(client, existing).status_code == 200
        assert client.get("/api/auth/me").status_code == 200


def test_an_earlier_session_cannot_skip_the_gate(monkeypatch):
    existing = _email()
    token = _existing_user(existing)["access_token"]
    with TestClient(app) as cookie_client:
        assert _login(cookie_client, existing).status_code == 200
        _as_staging(monkeypatch)
        for path in ("/api/families", "/api/auth/me"):
            _assert_locked(cookie_client.get(path))
        _assert_locked(cookie_client.get("/api/families", headers={"Authorization": f"Bearer {token}"}))
        staging_pass = _pass_for(cookie_client)
        assert cookie_client.get("/api/families", headers={_HEADER: staging_pass}).status_code == 200
        bearer = cookie_client.get("/api/auth/me", headers={_HEADER: staging_pass, "Authorization": f"Bearer {token}"})
        assert bearer.status_code == 200


def test_one_pass_covers_every_request_until_it_expires(monkeypatch):
    existing = _email()
    _existing_user(existing)
    _as_staging(monkeypatch)
    with TestClient(app) as client:
        unlocked = _unlock(client)
        body = unlocked.json()
        assert set(body) == {"pass", "expires_at"}
        days_left = (time.mktime(time.strptime(body["expires_at"], "%Y-%m-%dT%H:%M:%SZ")) - time.mktime(time.gmtime())) / 86400
        assert 29.9 < days_left <= 30.01
        client.headers[_HEADER] = body["pass"]
        assert _login(client, existing).status_code == 200
        for _ in range(5):
            for path in ("/api/auth/me", "/api/families"):
                assert client.get(path).status_code == 200
        expired = jwt.encode(
            {"typ": "staging_access", "iat": int(time.time()) - 100, "exp": int(time.time()) - 10},
            _staging_pass_signing_key(),
            algorithm="HS256",
        )
        _assert_locked(client.get("/api/auth/me", headers={_HEADER: expired}))


def test_wrong_passwords_are_refused_and_rate_limited(monkeypatch):
    _as_staging(monkeypatch)
    with TestClient(app) as client:
        for guess in ("wrong", "", _GATE_PASSWORD.upper(), "x" * 600):
            res = _unlock(client, guess)
            assert res.status_code == 401
            assert res.json() == {"detail": "That password isn't right."}
        assert client.post("/api/staging/access", content=b"not json", headers={"X-Forwarded-For": "203.0.113.10"}).status_code == 401
        for _ in range(5):
            assert _unlock(client, "wrong").status_code == 401
        blocked = _unlock(client)
        assert blocked.status_code == 429
        assert _GATE_PASSWORD not in blocked.text
        assert _unlock(client, ip="203.0.113.99").status_code == 200


def test_failures_across_many_addresses_hit_a_shared_cap(monkeypatch):
    _as_staging(monkeypatch)
    with TestClient(app) as client:
        for n in range(100):
            assert _unlock(client, "wrong", ip=f"198.51.100.{n}").status_code == 401
        assert _unlock(client, ip="192.0.2.1").status_code == 429


def test_the_password_never_appears_in_responses(monkeypatch):
    _as_staging(monkeypatch)
    with TestClient(app) as client:
        responses = [
            _unlock(client),
            _unlock(client, "wrong"),
            client.get("/api/staging/access"),
            client.get("/api/debug/public-config"),
        ]
    for res in responses:
        assert _GATE_PASSWORD not in res.text


def test_changing_the_password_ends_existing_passes(monkeypatch):
    existing = _email()
    _existing_user(existing)
    _as_staging(monkeypatch)
    with TestClient(app) as client:
        old_pass = _pass_for(client)
        client.headers[_HEADER] = old_pass
        assert _login(client, existing).status_code == 200
        assert client.get("/api/auth/me").status_code == 200
        monkeypatch.setattr(settings, "STAGING_ACCESS_PASSWORD", "a-different-gate-phrase")
        _assert_locked(client.get("/api/auth/me"))
        assert client.get("/api/staging/access").json() == {"mode": "password", "pass_valid": False}
        assert _unlock(client).status_code == 401
        client.headers[_HEADER] = _pass_for_password(client, "a-different-gate-phrase")
        assert client.get("/api/auth/me").status_code == 200


def _pass_for_password(client: TestClient, password: str) -> str:
    res = _unlock(client, password)
    assert res.status_code == 200, res.text
    return res.json()["pass"]


def test_passes_and_session_tokens_are_not_interchangeable(monkeypatch):
    existing = _email()
    token = _existing_user(existing)["access_token"]
    _as_staging(monkeypatch)
    with TestClient(app) as client:
        _assert_locked(client.get("/api/auth/me", headers={_HEADER: token, "Authorization": f"Bearer {token}"}))
        forged = jwt.encode(
            {"typ": "staging_access", "iat": int(time.time()), "exp": int(time.time()) + 3600},
            settings.JWT_SECRET,
            algorithm="HS256",
        )
        _assert_locked(client.get("/api/auth/me", headers={_HEADER: forged, "Authorization": f"Bearer {token}"}))
        staging_pass = _pass_for(client)
        as_session = client.get("/api/auth/me", headers={_HEADER: staging_pass, "Authorization": f"Bearer {staging_pass}"})
        assert as_session.status_code == 401


def test_households_stay_separate_in_password_mode(monkeypatch):
    _as_staging(monkeypatch)
    with TestClient(app) as owner, TestClient(app) as other:
        owner.headers[_HEADER] = _pass_for(owner)
        other.headers[_HEADER] = _pass_for(other)
        owner_family = _register(owner, _email()).json()["family_id"]
        other_family = _register(other, _email()).json()["family_id"]
        assert owner.get(f"/api/families/{owner_family}/accounts").status_code == 200
        res = other.get(f"/api/families/{owner_family}/accounts")
        assert res.status_code in (403, 404), res.text
        assert res.json()["detail"] != _REQUIRED
        assert other.get(f"/api/families/{other_family}/accounts").status_code == 200


def test_platform_admin_permissions_are_unchanged(monkeypatch):
    admin = _email()
    member = _email()
    _existing_user(admin)
    _existing_user(member)
    _as_staging(monkeypatch)
    monkeypatch.setattr(settings, "PLATFORM_ADMIN_EMAILS", admin)
    with TestClient(app) as admin_client, TestClient(app) as member_client:
        _assert_locked(admin_client.get("/api/platform/overview"))
        admin_client.headers[_HEADER] = _pass_for(admin_client)
        member_client.headers[_HEADER] = _pass_for(member_client)
        assert _login(admin_client, admin).status_code == 200
        assert _login(member_client, member).status_code == 200
        overview = admin_client.get("/api/platform/overview")
        assert overview.status_code == 200, overview.text
        assert overview.json()["staging_access_mode"] == "password"
        assert admin_client.get("/api/platform/users").status_code == 200
        refused = member_client.get("/api/platform/overview")
        assert refused.status_code == 403 and refused.json()["detail"] != _REQUIRED


def test_email_sending_limits_still_apply_after_unlocking(monkeypatch):
    existing = _email()
    _existing_user(existing)
    _as_staging(monkeypatch)
    with TestClient(app) as client:
        client.headers[_HEADER] = _pass_for(client)
        address = _email()
        for _ in range(5):
            res = client.post(
                "/api/auth/verification/start",
                json={"email": address, "password": _PASSWORD, "first_name": "A", "last_name": "B"},
            )
            assert res.status_code in (200, 503), res.text
        limited = client.post(
            "/api/auth/verification/start",
            json={"email": address, "password": _PASSWORD, "first_name": "A", "last_name": "B"},
        )
        assert limited.status_code == 429
        assert client.post("/api/auth/verification/resend", json={"email": address, "change_token": "x" * 30}).status_code == 429
        for _ in range(5):
            assert client.post("/api/public/password-reset/request", json={"email": existing}).status_code == 200
        assert client.post("/api/public/password-reset/request", json={"email": existing}).status_code == 429


def test_lifecycle_email_recipients_follow_the_active_gate(monkeypatch):
    listed = _email()
    _as_staging(monkeypatch, password="", allowlist=listed)
    assert _staging_email_recipient_allowed(listed) is True
    assert _staging_email_recipient_allowed(_email()) is False
    assert _allowlist_blocks(_email()) is True
    _as_staging(monkeypatch, password="", allowlist="")
    assert _staging_email_recipient_allowed(listed) is False
    _as_staging(monkeypatch)
    assert _staging_email_recipient_allowed(_email()) is True
    assert _allowlist_blocks(_email()) is False


def test_production_ignores_the_staging_password(monkeypatch, welcome_sends):
    monkeypatch.setattr(settings, "STAGING_ACCESS_PASSWORD", _GATE_PASSWORD)
    monkeypatch.setattr(settings, "STAGING_AUTH_EMAIL_ALLOWLIST", "")
    email = _email()
    with TestClient(app) as client:
        assert client.get("/api/staging/access").status_code == 404
        assert _unlock(client).status_code == 404
        assert _register(client, email).status_code == 200
        assert client.post("/api/auth/check-email", json={"email": email}).json() == {"exists": True}
        token = _login(client, email).json()["access_token"]
        config = client.get("/api/debug/public-config").json()
    with TestClient(app) as bearer_only:
        assert bearer_only.get("/api/families", headers={"Authorization": f"Bearer {token}"}).status_code == 200
    assert "staging_access_mode" not in config
    assert config["staging_auth_restricted"] is False
    assert welcome_sends == [email]
