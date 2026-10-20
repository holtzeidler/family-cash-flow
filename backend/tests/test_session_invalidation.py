"""A password change ends that user's existing sessions, including 30-day ones.

Uses a disposable local database. Does not call Stripe, send email, or print tokens.
"""

from __future__ import annotations

import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import unquote

import pytest
from jose import jwt

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "e2e"))

from smoke_guard import (  # noqa: E402
    apply_safe_environment,
    assert_loaded_settings,
    assert_process_is_safe,
    smoke_db_path,
)

_DB = smoke_db_path("balancewhiz-smoke-session-version.db")
_DB.parent.mkdir(parents=True, exist_ok=True)
for _extra in (_DB, Path(str(_DB) + "-wal"), Path(str(_DB) + "-shm")):
    if _extra.exists():
        _extra.unlink()

apply_safe_environment(_DB)
assert_process_is_safe(_DB)

sys.path.insert(0, str(ROOT / "backend"))
from app.main import app, engine, settings, _decode_user_id_from_token_optional  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import text  # noqa: E402

assert_loaded_settings(
    database_url=settings.DATABASE_URL,
    env=settings.ENV,
    stripe_key=settings.STRIPE_SECRET_KEY,
    resend_key=settings.RESEND_API_KEY,
    smtp_host=settings.CONTACT_SMTP_HOST,
    db_filename=_DB.name,
)

_PASSWORD = "SmokeOnly1!"
_NEW_PASSWORD = "SmokeOnly2!"
_DAY = 24 * 60 * 60


def _email() -> str:
    return f"bw-smoke-{uuid.uuid4().hex[:12]}@example.com"


def _register(client: TestClient, email: str, password: str = _PASSWORD) -> None:
    res = client.post(
        "/api/auth/register",
        json={"email": email, "password": password, "first_name": "Session", "last_name": "Tester"},
    )
    assert res.status_code == 201, res.text
    client.cookies.clear()


def _login(client: TestClient, email: str, password: str, *, keep: bool) -> str:
    client.cookies.clear()
    res = client.post(
        "/api/auth/login",
        json={"email": email, "password": password, "keep_me_logged_in": keep},
    )
    assert res.status_code == 200, res.text
    token = res.json()["access_token"]
    client.cookies.clear()
    return token


def _me(client: TestClient, token: str, *, cookie: bool) -> int:
    client.cookies.clear()
    if cookie:
        client.cookies.set("access_token", token)
        res = client.get("/api/auth/me")
    else:
        res = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    client.cookies.clear()
    return res.status_code


def _claims(token: str) -> dict:
    return jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])


def _utc_clock(timestamp: int) -> datetime:
    """Same UTC recovery as the login-persistence lifetime check."""
    return datetime.fromtimestamp(int(timestamp)).replace(tzinfo=timezone.utc)


def _lifetime(token: str) -> int:
    payload = _claims(token)
    issued = _utc_clock(payload["iat"])
    expires = _utc_clock(payload["exp"])
    return int((expires - issued).total_seconds())


def _assert_lifetime(token: str, seconds: int) -> None:
    lifetime = _lifetime(token)
    assert abs(lifetime - seconds) < 5, lifetime


def _reset_password(client: TestClient, monkeypatch: pytest.MonkeyPatch, email: str, new_password: str) -> None:
    sent: dict[str, str] = {}

    def _capture(**kwargs: str) -> None:
        sent.update(kwargs)

    monkeypatch.setattr("app.main._invite_email_delivery_configured", lambda: True)
    monkeypatch.setattr("app.main._send_password_reset_email_sync", _capture)
    requested = client.post("/api/public/password-reset/request", json={"email": email})
    assert requested.status_code == 200, requested.text
    body = sent.get("text_body") or ""
    marker = "reset="
    assert marker in body
    raw = unquote(body.split(marker, 1)[1].split()[0].strip())
    completed = client.post(
        "/api/public/password-reset/complete",
        json={"token": raw, "new_password": new_password},
    )
    assert completed.status_code == 200, completed.text
    assert "access_token" not in completed.json()


def test_password_reset_ends_remember_me_cookie_and_bearer_sessions(monkeypatch):
    with TestClient(app) as client:
        owner = _email()
        bystander = _email()
        _register(client, owner)
        _register(client, bystander)
        old_keep = _login(client, owner, _PASSWORD, keep=True)
        old_day = _login(client, owner, _PASSWORD, keep=False)
        other = _login(client, bystander, _PASSWORD, keep=True)

        _assert_lifetime(old_keep, settings.KEEP_ME_LOGGED_IN_DAYS * _DAY)
        _assert_lifetime(old_day, settings.ACCESS_TOKEN_MINUTES * 60)
        assert _claims(old_keep)["sv"] == 0
        assert _me(client, old_keep, cookie=True) == 200
        assert _me(client, old_keep, cookie=False) == 200

        _reset_password(client, monkeypatch, owner, _NEW_PASSWORD)

        assert _me(client, old_keep, cookie=True) == 401
        assert _me(client, old_keep, cookie=False) == 401
        assert _me(client, old_day, cookie=False) == 401
        assert _decode_user_id_from_token_optional(old_keep) is None
        assert _me(client, other, cookie=True) == 200
        assert _me(client, other, cookie=False) == 200

        fresh = _login(client, owner, _NEW_PASSWORD, keep=True)
        assert _claims(fresh)["sv"] == 1
        assert _decode_user_id_from_token_optional(fresh) is not None
        _assert_lifetime(fresh, settings.KEEP_ME_LOGGED_IN_DAYS * _DAY)
        assert _me(client, fresh, cookie=True) == 200
        assert _me(client, fresh, cookie=False) == 200
        assert _me(client, old_keep, cookie=False) == 401
        old_password = client.post("/api/auth/login", json={"email": owner, "password": _PASSWORD})
        assert old_password.status_code == 401


def test_admin_password_change_signs_out_only_that_user(monkeypatch):
    with TestClient(app) as client:
        admin_email = _email()
        target_email = _email()
        other_email = _email()
        monkeypatch.setattr(settings, "PLATFORM_ADMIN_EMAILS", admin_email)
        _register(client, admin_email)
        _register(client, target_email)
        _register(client, other_email)
        admin_token = _login(client, admin_email, _PASSWORD, keep=True)
        target_keep = _login(client, target_email, _PASSWORD, keep=True)
        target_day = _login(client, target_email, _PASSWORD, keep=False)
        other_token = _login(client, other_email, _PASSWORD, keep=False)
        target_id = client.get("/api/auth/me", headers={"Authorization": f"Bearer {target_day}"}).json()["user"]["id"]

        changed = client.post(
            f"/api/platform/users/{target_id}/password",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"new_password": _NEW_PASSWORD},
        )
        assert changed.status_code == 200, changed.text
        assert changed.json() == {"ok": True}

        assert _me(client, target_keep, cookie=True) == 401
        assert _me(client, target_keep, cookie=False) == 401
        assert _me(client, target_day, cookie=False) == 401
        assert _me(client, admin_token, cookie=False) == 200
        assert _me(client, other_token, cookie=True) == 200

        fresh = _login(client, target_email, _NEW_PASSWORD, keep=False)
        assert _claims(fresh)["sv"] == 1
        _assert_lifetime(fresh, settings.ACCESS_TOKEN_MINUTES * 60)
        assert _me(client, fresh, cookie=True) == 200
        assert _me(client, admin_token, cookie=False) == 200
        assert _claims(admin_token)["sv"] == 0


def test_legacy_token_without_sv_works_until_the_password_changes(monkeypatch):
    with TestClient(app) as client:
        email = _email()
        _register(client, email)
        current = _login(client, email, _PASSWORD, keep=True)
        user_id = int(_claims(current)["sub"])
        now = datetime.utcnow()
        legacy = jwt.encode(
            {
                "sub": str(user_id),
                "iat": int(now.timestamp()),
                "exp": int((now + timedelta(days=30)).timestamp()),
            },
            settings.JWT_SECRET,
            algorithm=settings.JWT_ALGORITHM,
        )
        assert "sv" not in _claims(legacy)
        assert _me(client, legacy, cookie=True) == 200
        assert _me(client, legacy, cookie=False) == 200

        _reset_password(client, monkeypatch, email, _NEW_PASSWORD)

        # Issued for the same second as a later login would use, but still generation 0.
        later = int(datetime.utcnow().timestamp()) + 30
        stale = jwt.encode(
            {"sub": str(user_id), "iat": later, "exp": later + _DAY, "sv": 0},
            settings.JWT_SECRET,
            algorithm=settings.JWT_ALGORITHM,
        )
        assert _me(client, legacy, cookie=False) == 401
        assert _me(client, stale, cookie=True) == 401
        assert _me(client, stale, cookie=False) == 401

        fresh = _login(client, email, _NEW_PASSWORD, keep=True)
        assert _me(client, fresh, cookie=False) == 200
        assert _claims(fresh)["sv"] == 1


def test_existing_accounts_gain_session_version_zero_without_losing_the_column():
    from app.main import _ensure_user_session_version_column

    with TestClient(app) as client:
        email = _email()
        _register(client, email)
        token = _login(client, email, _PASSWORD, keep=False)
        try:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE users DROP COLUMN session_version"))
            _ensure_user_session_version_column()
            _ensure_user_session_version_column()
            with engine.begin() as conn:
                names = {str(row[1]) for row in conn.execute(text("PRAGMA table_info(users)")).fetchall()}
                version = conn.execute(
                    text("SELECT session_version FROM users WHERE email = :email"),
                    {"email": email},
                ).scalar_one()
            assert "session_version" in names
            assert int(version) == 0
            assert _me(client, token, cookie=False) == 200
        finally:
            _ensure_user_session_version_column()
