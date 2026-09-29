"""Login session length is 24 hours unless the user opts in for 30 days.

Uses a disposable local database. Does not call Stripe or send email.
"""

from __future__ import annotations

import sys
import uuid
from pathlib import Path

from jose import jwt

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "e2e"))

from smoke_guard import (  # noqa: E402
    apply_safe_environment,
    assert_loaded_settings,
    assert_process_is_safe,
    smoke_db_path,
)

_DB = smoke_db_path("balancewhiz-smoke-login.db")
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
_DAY = 24 * 60 * 60


def _register(client: TestClient) -> str:
    email = f"bw-smoke-login-{uuid.uuid4().hex[:10]}@example.com"
    res = client.post(
        "/api/auth/register",
        json={
            "email": email,
            "password": _PASSWORD,
            "first_name": "Login",
            "last_name": "Tester",
        },
    )
    assert res.status_code == 201, res.text
    client.post("/api/auth/logout")
    return email


def _lifetime_seconds(token: str) -> int:
    payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
    return int(payload["exp"]) - int(payload["iat"])


def _set_cookie(res) -> str:
    return res.headers.get("set-cookie") or ""


def test_login_without_keep_me_is_a_one_day_session_cookie():
    with TestClient(app) as client:
        email = _register(client)
        res = client.post("/api/auth/login", json={"email": email, "password": _PASSWORD})
        assert res.status_code == 200, res.text
        cookie = _set_cookie(res)
        assert "Max-Age" not in cookie
        assert abs(_lifetime_seconds(res.json()["access_token"]) - settings.ACCESS_TOKEN_MINUTES * 60) < 5
        me = client.get("/api/auth/me")
        assert me.status_code == 200


def test_login_with_keep_me_expires_in_thirty_days_and_does_not_slide():
    with TestClient(app) as client:
        email = _register(client)
        res = client.post(
            "/api/auth/login",
            json={"email": email, "password": _PASSWORD, "keep_me_logged_in": True},
        )
        assert res.status_code == 200, res.text
        cookie = _set_cookie(res)
        assert f"Max-Age={settings.KEEP_ME_LOGGED_IN_DAYS * _DAY}" in cookie
        assert "Secure" not in cookie
        lifetime = _lifetime_seconds(res.json()["access_token"])
        assert abs(lifetime - settings.KEEP_ME_LOGGED_IN_DAYS * _DAY) < 5
        first_exp = jwt.decode(res.json()["access_token"], settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])["exp"]
        again = client.get("/api/auth/me")
        assert again.status_code == 200
        assert "set-cookie" not in {k.lower() for k in again.headers.keys()} or "access_token" not in (again.headers.get("set-cookie") or "")
        assert first_exp == jwt.decode(
            client.cookies.get("access_token"),
            settings.JWT_SECRET,
            algorithms=[settings.JWT_ALGORITHM],
        )["exp"]


def test_bad_password_does_not_start_a_session_and_logout_clears_it():
    with TestClient(app) as client:
        email = _register(client)
        bad = client.post("/api/auth/login", json={"email": email, "password": "wrong-password"})
        assert bad.status_code == 401
        assert "access_token" not in (bad.headers.get("set-cookie") or "")
        assert client.get("/api/auth/me").status_code == 401

        ok = client.post(
            "/api/auth/login",
            json={"email": email, "password": _PASSWORD, "keep_me_logged_in": True},
        )
        assert ok.status_code == 200
        logged_out = client.post("/api/auth/logout")
        assert logged_out.status_code == 200
        cleared = _set_cookie(logged_out).lower()
        assert "access_token" in cleared
        assert "max-age=0" in cleared
        assert client.get("/api/auth/me").status_code == 401
