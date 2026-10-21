"""New signups confirm an email link before an account, family, or trial exists.

Uses a disposable local database. The mail sender is patched, so no email is sent.
Confirmation tokens are not printed.
"""

from __future__ import annotations

import sys
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "e2e"))

from smoke_guard import (  # noqa: E402
    apply_safe_environment,
    assert_loaded_settings,
    assert_process_is_safe,
    smoke_db_path,
)
from verified_signup import signup_verified  # noqa: E402

_DB = smoke_db_path("balancewhiz-smoke-email-verify.db")
_DB.parent.mkdir(parents=True, exist_ok=True)
for _extra in (_DB, Path(str(_DB) + "-wal"), Path(str(_DB) + "-shm")):
    if _extra.exists():
        _extra.unlink()

apply_safe_environment(_DB)
assert_process_is_safe(_DB)

sys.path.insert(0, str(ROOT / "backend"))
from app.main import (  # noqa: E402
    Account,
    EmailVerification,
    Family,
    FamilyMember,
    PasswordResetToken,
    SessionLocal,
    User,
    _EMAIL_VERIFIED_BACKFILL_KEY,
    _ensure_user_email_verification_columns,
    _reset_verification_rate_limits,
    engine,
    app,
    select,
    settings,
)
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


def _email() -> str:
    return f"bw-smoke-{uuid.uuid4().hex[:10]}@example.com"


def _shape(body: dict) -> tuple:
    token = body.get("change_token")
    return (body.get("ok") is True, tuple(sorted(body)), isinstance(token, str) and len(token) >= 20)


def _link_token(url: str) -> str:
    return parse_qs(urlparse(url).query).get("verify", [""])[0]


@pytest.fixture(autouse=True)
def _clear_limits():
    _reset_verification_rate_limits()
    yield
    _reset_verification_rate_limits()


def _start(client: TestClient, email: str, password: str = _PASSWORD, **extra):
    captured: list[dict] = []

    def fake_deliver(**kwargs):
        captured.append(dict(kwargs))
        return "local-not-sent"

    from unittest.mock import patch

    body = {"email": email, "password": password, "first_name": "Verify", "last_name": "Tester"}
    body.update(extra)
    with patch("app.main._deliver_account_email", fake_deliver):
        res = client.post("/api/auth/verification/start", json=body)
    return res, captured


def _user_count(email: str) -> int:
    with SessionLocal() as db:
        return len(db.execute(select(User.id).where(User.email == email)).all())


def _family_count(user_id: int) -> int:
    with SessionLocal() as db:
        return len(
            db.execute(
                select(FamilyMember.family_id).where(
                    FamilyMember.user_id == int(user_id),
                    FamilyMember.is_family_owner.is_(True),
                )
            ).all()
        )


def test_link_creates_a_session_without_a_family_or_welcome_email(monkeypatch):
    sent: list[str] = []
    monkeypatch.setattr(settings, "RESEND_API_KEY", "re_local_not_sent")
    monkeypatch.setattr("app.email_service.send_welcome_email", lambda **kwargs: sent.append(kwargs["to_addr"]))
    email = _email()
    with TestClient(app) as client:
        res, captured = _start(client, email)
        assert res.status_code == 200
        assert _shape(res.json())[0] is True
        assert _user_count(email) == 0
        token = _link_token(captured[0]["confirm_url"])
        verified = client.post("/api/auth/verify-email", json={"token": token})
        assert verified.status_code == 200
        body = verified.json()
        assert body["trial_started"] is False
        assert body["user"]["email"] == email
        assert client.get("/api/families").json() == []
        assert client.get("/api/auth/me").status_code == 200
    assert sent == []
    with SessionLocal() as db:
        user = db.execute(select(User).where(User.email == email)).scalar_one()
        assert user.email_verified_at is not None
        assert int(user.session_version or 0) == 0
        assert user.welcome_email_sent_at is None
        row = db.execute(select(EmailVerification).where(EmailVerification.email_normalized == email)).scalar_one()
        assert row.consumed_at is not None
        assert row.password_hash == ""
        assert row.token_hash != token


def test_finishing_onboarding_creates_one_family_and_one_welcome_email(monkeypatch):
    sent: list[str] = []
    monkeypatch.setattr(settings, "RESEND_API_KEY", "re_local_not_sent")
    monkeypatch.setattr("app.email_service.send_welcome_email", lambda **kwargs: sent.append(kwargs["to_addr"]) or "local")
    email = _email()
    with TestClient(app) as client:
        created = signup_verified(
            client,
            email=email,
            password=_PASSWORD,
            first_name="Verify",
            last_name="Tester",
            onboarding_goals=["keep_in_savings"],
        )
        assert created.status_code == 200
        created_body = created.json()
        assert created_body["trial_started"] is True
        families = client.get("/api/families").json()
        assert len(families) == 1
        assert created_body["family_id"] == families[0]["id"]
        with SessionLocal() as db:
            user = db.execute(select(User).where(User.email == email)).scalar_one()
            fam = db.execute(
                select(Family)
                .join(FamilyMember, FamilyMember.family_id == Family.id)
                .where(FamilyMember.user_id == int(user.id), FamilyMember.is_family_owner.is_(True))
            ).scalar_one()
            trial_started_at = fam.created_at
            welcome_at = user.welcome_email_sent_at
            assert welcome_at is not None
        again = client.post("/api/auth/onboarding/complete", json={})
        assert again.status_code == 200
        assert again.json()["trial_started"] is False
        assert again.json()["family_id"] == created_body["family_id"]
        assert len(client.get("/api/families").json()) == 1
        assert again.json()["user"]["onboarding_goals"] == ["keep_in_savings"]
        with SessionLocal() as db:
            user = db.execute(select(User).where(User.email == email)).scalar_one()
            fam = db.execute(
                select(Family)
                .join(FamilyMember, FamilyMember.family_id == Family.id)
                .where(FamilyMember.user_id == int(user.id), FamilyMember.is_family_owner.is_(True))
            ).scalar_one()
            assert fam.created_at == trial_started_at
            assert user.welcome_email_sent_at == welcome_at
    assert sent == [email]


def test_account_setup_uses_the_completed_family_without_creating_another(monkeypatch):
    """A failed or empty family list must not lead to a second family or a new trial."""
    monkeypatch.setattr(settings, "RESEND_API_KEY", "re_local_not_sent")
    monkeypatch.setattr("app.email_service.send_welcome_email", lambda **kwargs: "local")
    email = _email()
    with TestClient(app) as client:
        created = signup_verified(client, email=email, password=_PASSWORD)
        assert created.status_code == 200
        body = created.json()
        family_id = int(body["family_id"])
        assert body["trial_started"] is True
        account = client.post(
            f"/api/families/{family_id}/accounts",
            json={
                "name": "Checking",
                "type": "checking",
                "starting_balance": "1000.00",
                "starting_balance_date": "2026-10-01",
            },
        )
        assert account.status_code == 200, account.text
        with SessionLocal() as db:
            user = db.execute(select(User).where(User.email == email)).scalar_one()
            owned = db.execute(
                select(Family)
                .join(FamilyMember, FamilyMember.family_id == Family.id)
                .where(FamilyMember.user_id == int(user.id), FamilyMember.is_family_owner.is_(True))
            ).scalars().all()
            assert [int(row.id) for row in owned] == [family_id]
            trial_started_at = owned[0].created_at
        again = client.post("/api/auth/onboarding/complete", json={})
        assert again.status_code == 200
        assert again.json()["trial_started"] is False
        assert int(again.json()["family_id"]) == family_id
        with SessionLocal() as db:
            user = db.execute(select(User).where(User.email == email)).scalar_one()
            owned = db.execute(
                select(Family)
                .join(FamilyMember, FamilyMember.family_id == Family.id)
                .where(FamilyMember.user_id == int(user.id), FamilyMember.is_family_owner.is_(True))
            ).scalars().all()
            assert [int(row.id) for row in owned] == [family_id]
            assert owned[0].created_at == trial_started_at
            assert int(db.get(Account, account.json()["id"]).family_id) == family_id


def test_register_endpoint_does_not_create_an_account():
    email = _email()
    with TestClient(app) as client:
        res = client.post(
            "/api/auth/register",
            json={"email": email, "password": _PASSWORD, "first_name": "No", "last_name": "Account"},
        )
        assert res.status_code == 400
        assert "Confirm your email" in res.json()["detail"]
    assert _user_count(email) == 0


def test_existing_and_new_addresses_get_the_same_response_shape():
    existing = _email()
    fresh = _email()
    with TestClient(app) as client:
        assert signup_verified(client, email=existing, password=_PASSWORD, finish=True).status_code == 200
        client.post("/api/auth/logout")
        _reset_verification_rate_limits()
        known, known_mail = _start(client, existing, password="Different1!")
        _reset_verification_rate_limits()
        new, new_mail = _start(client, fresh)
        assert known.status_code == 200 and new.status_code == 200
        assert _shape(known.json()) == _shape(new.json())
        assert "exists" not in known.json()
        assert known_mail[0]["kind"] == "existing"
        assert new_mail[0]["kind"] == "confirm"
        assert "confirm_url" not in known_mail[0] or not known_mail[0]["confirm_url"]
    with TestClient(app) as client:
        assert client.post("/api/auth/login", json={"email": existing, "password": _PASSWORD}).status_code == 200
        assert client.post("/api/auth/login", json={"email": existing, "password": "Different1!"}).status_code == 401


def test_delivery_failure_leaves_no_account_and_no_live_link():
    email = _email()

    def boom(**kwargs):
        raise RuntimeError("delivery failed")

    from unittest.mock import patch

    with TestClient(app) as client:
        with patch("app.main._deliver_account_email", boom):
            res = client.post(
                "/api/auth/verification/start",
                json={"email": email, "password": _PASSWORD, "first_name": "No", "last_name": "Mail"},
            )
        assert res.status_code == 503
        assert "delivery failed" not in res.text
    assert _user_count(email) == 0
    with SessionLocal() as db:
        live = db.execute(
            select(EmailVerification.id).where(
                EmailVerification.email_normalized == email,
                EmailVerification.consumed_at.is_(None),
            )
        ).first()
        assert live is None


def test_expired_invalid_and_used_links_have_recovery_messages():
    email = _email()
    with TestClient(app) as client:
        _res, captured = _start(client, email)
        token = _link_token(captured[0]["confirm_url"])
        with SessionLocal() as db:
            db.execute(
                text("UPDATE email_verifications SET expires_at = :ts WHERE email_normalized = :email"),
                {"ts": datetime.utcnow() - timedelta(minutes=5), "email": email},
            )
            db.commit()
        expired = client.post("/api/auth/verify-email", json={"token": token})
        assert expired.status_code == 400
        assert "expired" in expired.json()["detail"]
        assert _user_count(email) == 0
        with SessionLocal() as db:
            db.execute(
                text("UPDATE email_verifications SET expires_at = :ts WHERE email_normalized = :email"),
                {"ts": datetime.utcnow() + timedelta(minutes=30), "email": email},
            )
            db.commit()
        _reset_verification_rate_limits()
        used = client.post("/api/auth/verify-email", json={"token": token})
        assert used.status_code == 200
        again = client.post("/api/auth/verify-email", json={"token": token})
        assert again.status_code == 400
        assert "already been used" in again.json()["detail"]
        invalid = client.post("/api/auth/verify-email", json={"token": "a" * 32})
        assert invalid.status_code == 400
        assert "not valid" in invalid.json()["detail"]
    assert _user_count(email) == 1


def test_resend_cooldown_then_a_new_link_replaces_the_old_one():
    email = _email()
    with TestClient(app) as client:
        first, captured = _start(client, email)
        change_token = first.json()["change_token"]
        original = _link_token(captured[0]["confirm_url"])
        second, again = _start(client, email, change_token=change_token, previous_email=email)
        assert second.status_code == 200
        assert again == []
        assert second.json()["change_token"] == change_token
        cooled = client.post(
            "/api/auth/verification/resend",
            json={"email": email, "change_token": change_token},
        )
        assert cooled.status_code == 200
        with SessionLocal() as db:
            db.execute(
                text("UPDATE email_verifications SET created_at = :ts WHERE email_normalized = :email"),
                {"ts": datetime.utcnow() - timedelta(minutes=2), "email": email},
            )
            db.commit()
        _reset_verification_rate_limits()
        resent_calls: list[dict] = []

        def fake_deliver(**kwargs):
            resent_calls.append(dict(kwargs))
            return "local-not-sent"

        from unittest.mock import patch

        with patch("app.main._deliver_account_email", fake_deliver):
            resent = client.post(
                "/api/auth/verification/resend",
                json={"email": email, "change_token": change_token},
            )
        assert resent.status_code == 200
        assert len(resent_calls) == 1
        fresh = _link_token(resent_calls[0]["confirm_url"])
        old = client.post("/api/auth/verify-email", json={"token": original})
        assert old.status_code == 400
        new = client.post("/api/auth/verify-email", json={"token": fresh})
        assert new.status_code == 200
    assert _user_count(email) == 1


def test_changing_the_email_invalidates_the_previous_link():
    first_email = _email()
    second_email = _email()
    with TestClient(app) as client:
        started, captured = _start(client, first_email)
        old_token = _link_token(captured[0]["confirm_url"])
        with SessionLocal() as db:
            db.execute(
                text("UPDATE email_verifications SET created_at = :ts WHERE email_normalized = :email"),
                {"ts": datetime.utcnow() - timedelta(minutes=2), "email": first_email},
            )
            db.commit()
        _reset_verification_rate_limits()
        moved, nxt = _start(
            client,
            second_email,
            previous_email=first_email,
            change_token=started.json()["change_token"],
        )
        assert moved.status_code == 200
        old = client.post("/api/auth/verify-email", json={"token": old_token})
        assert old.status_code == 400
        created = client.post("/api/auth/verify-email", json={"token": _link_token(nxt[0]["confirm_url"])})
        assert created.status_code == 200
        assert created.json()["user"]["email"] == second_email
    assert _user_count(first_email) == 0
    assert _user_count(second_email) == 1


def test_a_guessed_change_token_does_not_cancel_someone_elses_signup():
    victim = _email()
    other = _email()
    with TestClient(app) as client:
        _started, captured = _start(client, victim)
        token = _link_token(captured[0]["confirm_url"])
        with SessionLocal() as db:
            db.execute(text("UPDATE email_verifications SET created_at = :ts"), {"ts": datetime.utcnow() - timedelta(minutes=2)})
            db.commit()
        _reset_verification_rate_limits()
        _start(client, other, previous_email=victim, change_token="n" * 32)
        still = client.post("/api/auth/verify-email", json={"token": token})
        assert still.status_code == 200


def test_rate_limit_is_the_same_for_a_new_and_existing_address(monkeypatch):
    monkeypatch.setattr("app.main._VERIFY_MAX_PER_EMAIL_PER_HOUR", 2)
    existing = _email()
    with TestClient(app) as client:
        assert signup_verified(client, email=existing, finish=True).status_code == 200
        client.post("/api/auth/logout")
        _reset_verification_rate_limits()
        assert _start(client, existing)[0].status_code == 200
        assert _start(client, existing)[0].status_code == 200
        blocked_existing = _start(client, existing)[0]
        fresh = _email()
        _reset_verification_rate_limits()
        monkeypatch.setattr("app.main._VERIFY_MAX_PER_EMAIL_PER_HOUR", 1)
        first = _start(client, fresh)[0]
        second = _start(client, fresh)[0]
        assert first.status_code == 200
        assert second.status_code == 429
        assert blocked_existing.status_code == 429
        assert blocked_existing.json()["detail"] == second.json()["detail"]


def test_concurrent_redemption_creates_one_user():
    email = _email()
    with TestClient(app) as client:
        _res, captured = _start(client, email)
        token = _link_token(captured[0]["confirm_url"])

    def redeem() -> int:
        with TestClient(app) as client:
            return client.post("/api/auth/verify-email", json={"token": token}).status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        codes = list(pool.map(lambda _i: redeem(), (1, 2)))
    assert codes.count(200) == 1
    assert _user_count(email) == 1


def test_concurrent_onboarding_creates_one_family_and_one_welcome_email(monkeypatch):
    sent: list[str] = []
    monkeypatch.setattr(settings, "RESEND_API_KEY", "re_local_not_sent")
    monkeypatch.setattr("app.email_service.send_welcome_email", lambda **kwargs: sent.append(kwargs["to_addr"]) or "local")
    email = _email()
    with TestClient(app) as client:
        verified = signup_verified(client, email=email, finish=False)
        assert verified.status_code == 200
        access = verified.json()["access_token"]

    def finish() -> tuple[int, bool]:
        with TestClient(app) as client:
            res = client.post(
                "/api/auth/onboarding/complete",
                json={},
                headers={"Authorization": f"Bearer {access}"},
            )
            started = bool(res.json().get("trial_started")) if res.status_code == 200 else False
            return res.status_code, started

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _i: finish(), (1, 2)))
    assert sum(1 for status, started in results if status == 200 and started) == 1
    with SessionLocal() as db:
        user = db.execute(select(User).where(User.email == email)).scalar_one()
        families = db.execute(
            select(Family.id)
            .join(FamilyMember, FamilyMember.family_id == Family.id)
            .where(FamilyMember.user_id == user.id, FamilyMember.is_family_owner.is_(True))
        ).all()
        assert len(families) == 1
    assert sent == [email]


def _null_verified_at(user_id: int) -> None:
    with SessionLocal() as db:
        db.execute(text("UPDATE users SET email_verified_at = NULL WHERE id = :id"), {"id": user_id})
        db.commit()


def test_existing_accounts_are_verified_once_and_later_nulls_stay_null():
    email = _email()
    with TestClient(app) as client:
        created = signup_verified(client, email=email, finish=True)
        token = created.json()["access_token"]
        with SessionLocal() as db:
            user = db.execute(select(User).where(User.email == email)).scalar_one()
            version = int(user.session_version or 0)
            user_id = int(user.id)
        _null_verified_at(user_id)
        family_id = None
        with SessionLocal() as db:
            family_id = db.execute(
                select(FamilyMember.family_id).where(FamilyMember.user_id == user_id)
            ).scalar_one()
        assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"}).status_code == 401
        billing = client.get(
            f"/api/families/{family_id}/billing-status",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert billing.status_code == 401
        _ensure_user_email_verification_columns()
        with SessionLocal() as db:
            user = db.execute(select(User).where(User.id == user_id)).scalar_one()
            assert user.email_verified_at is None
            assert int(user.session_version or 0) == version
        assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"}).status_code == 401

        with engine.begin() as conn:
            conn.execute(
                text("DELETE FROM app_meta WHERE key = :key"),
                {"key": _EMAIL_VERIFIED_BACKFILL_KEY},
            )
            conn.execute(text("ALTER TABLE users DROP COLUMN email_verified_at"))
        _ensure_user_email_verification_columns()
        assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"}).status_code == 200
        assert client.post("/api/auth/login", json={"email": email, "password": _PASSWORD}).status_code == 200
        with SessionLocal() as db:
            user = db.execute(select(User).where(User.id == user_id)).scalar_one()
            assert user.email_verified_at is not None
            assert int(user.session_version or 0) == version

        _null_verified_at(user_id)
        _ensure_user_email_verification_columns()
        with SessionLocal() as db:
            user = db.execute(select(User).where(User.id == user_id)).scalar_one()
            assert user.email_verified_at is None
            assert int(user.session_version or 0) == version
        assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"}).status_code == 401


def test_unlisted_staging_address_is_rejected_and_no_mail_is_sent(monkeypatch):
    listed = _email()
    outsider = _email()
    monkeypatch.setattr("app.main._is_staging_deployment", lambda: True)
    monkeypatch.setattr("app.main._database_looks_like_staging", lambda: True)
    monkeypatch.setattr(settings, "STAGING_AUTH_EMAIL_ALLOWLIST", listed)
    with TestClient(app) as client:
        blocked, blocked_mail = _start(client, outsider)
        assert blocked.status_code == 403
        assert blocked_mail == []
        allowed, allowed_mail = _start(client, listed)
        assert allowed.status_code == 200
        assert allowed_mail[0]["kind"] == "confirm"
        monkeypatch.setattr(settings, "STAGING_AUTH_EMAIL_ALLOWLIST", "")
        closed, closed_mail = _start(client, _email())
        assert closed.status_code == 403
        assert closed_mail == []
    assert _user_count(outsider) == 0
    assert _user_count(listed) == 0


def test_password_reset_and_invite_still_work_for_verified_users(monkeypatch):
    owner_email = _email()
    guest_email = _email()
    sent: dict[str, str] = {}

    def capture(**kwargs):
        sent.update(kwargs)

    monkeypatch.setattr("app.main._invite_email_delivery_configured", lambda: True)
    monkeypatch.setattr("app.main._send_password_reset_email_sync", capture)
    monkeypatch.setattr("app.main._send_family_invite_email_sync", lambda **kwargs: None)
    with TestClient(app) as owner:
        created = signup_verified(owner, email=owner_email, finish=True)
        assert created.status_code == 200
        family_id = owner.get("/api/families").json()[0]["id"]
        invited = owner.post(
            f"/api/families/{family_id}/invites",
            json={"email": guest_email, "access_mode": "view"},
        )
        assert invited.status_code == 200
        assert _user_count(guest_email) == 0
        invite_token = parse_qs(urlparse(invited.json()["accept_url"]).query).get("token", [""])[0]
        requested = owner.post("/api/public/password-reset/request", json={"email": owner_email})
        assert requested.status_code == 200
    with SessionLocal() as db:
        user_id = db.execute(select(User.id).where(User.email == owner_email)).scalar_one()
        assert db.execute(select(PasswordResetToken.id).where(PasswordResetToken.user_id == user_id)).first() is not None
    with TestClient(app) as guest:
        joined = signup_verified(guest, email=guest_email, finish=False)
        assert joined.status_code == 200
        accepted = guest.post("/api/invites/accept", json={"token": invite_token})
        assert accepted.status_code == 200
        families = guest.get("/api/families").json()
        assert any(int(row["id"]) == int(family_id) for row in families)


def _age_verification(email: str, *, minutes: int = 2, expired: bool = False) -> None:
    now = datetime.utcnow()
    values = {"created": now - timedelta(minutes=minutes), "email": email}
    sql = "UPDATE email_verifications SET created_at = :created"
    if expired:
        sql += ", expires_at = :expires"
        values["expires"] = now - timedelta(minutes=5)
    sql += " WHERE email_normalized = :email"
    with SessionLocal() as db:
        db.execute(text(sql), values)
        db.commit()


def test_a_failed_send_can_be_retried_and_does_not_block_the_address():
    email = _email()

    def boom(**kwargs):
        raise RuntimeError("delivery failed")

    from unittest.mock import patch

    with TestClient(app) as client:
        with patch("app.main._deliver_account_email", boom):
            failed = client.post(
                "/api/auth/verification/start",
                json={"email": email, "password": _PASSWORD, "first_name": "Retry", "last_name": "Later"},
            )
        assert failed.status_code == 503
        assert failed.json()["detail"] == "We couldn't send the confirmation email. Please try again. No account was created."
        started, captured = _start(client, email)
        assert started.status_code == 200
        verified = client.post("/api/auth/verify-email", json={"token": _link_token(captured[0]["confirm_url"])})
        assert verified.status_code == 200
    assert _user_count(email) == 1


def test_a_failed_replacement_keeps_the_previous_link():
    email = _email()

    def boom(**kwargs):
        raise RuntimeError("delivery failed")

    from unittest.mock import patch

    with TestClient(app) as client:
        _first, captured = _start(client, email)
        original = _link_token(captured[0]["confirm_url"])
        _age_verification(email)
        _reset_verification_rate_limits()
        with patch("app.main._deliver_account_email", boom):
            failed = client.post(
                "/api/auth/verification/start",
                json={"email": email, "password": _PASSWORD, "first_name": "Retry", "last_name": "Later"},
            )
        assert failed.status_code == 503
        kept = client.post("/api/auth/verify-email", json={"token": original})
        assert kept.status_code == 200
    assert _user_count(email) == 1


def test_a_failed_resend_keeps_the_previous_link_and_can_be_retried():
    email = _email()

    def boom(**kwargs):
        raise RuntimeError("delivery failed")

    from unittest.mock import patch

    with TestClient(app) as client:
        first, captured = _start(client, email)
        change_token = first.json()["change_token"]
        original = _link_token(captured[0]["confirm_url"])
        _age_verification(email)
        _reset_verification_rate_limits()
        with patch("app.main._deliver_account_email", boom):
            failed = client.post(
                "/api/auth/verification/resend",
                json={"email": email, "change_token": change_token},
            )
        assert failed.status_code == 503
        resent_calls: list[dict] = []

        def fake_deliver(**kwargs):
            resent_calls.append(dict(kwargs))
            return "local-not-sent"

        with patch("app.main._deliver_account_email", fake_deliver):
            resent = client.post(
                "/api/auth/verification/resend",
                json={"email": email, "change_token": change_token},
            )
        assert resent.status_code == 200
        assert len(resent_calls) == 1
        old = client.post("/api/auth/verify-email", json={"token": original})
        assert old.status_code == 400
        fresh = client.post("/api/auth/verify-email", json={"token": _link_token(resent_calls[0]["confirm_url"])})
        assert fresh.status_code == 200
    assert _user_count(email) == 1


def test_an_expired_link_can_be_replaced():
    email = _email()
    with TestClient(app) as client:
        first, captured = _start(client, email)
        change_token = first.json()["change_token"]
        original = _link_token(captured[0]["confirm_url"])
        _age_verification(email, expired=True)
        _reset_verification_rate_limits()
        resent_calls: list[dict] = []

        def fake_deliver(**kwargs):
            resent_calls.append(dict(kwargs))
            return "local-not-sent"

        from unittest.mock import patch

        with patch("app.main._deliver_account_email", fake_deliver):
            resent = client.post(
                "/api/auth/verification/resend",
                json={"email": email, "change_token": change_token},
            )
        assert resent.status_code == 200
        assert len(resent_calls) == 1
        old = client.post("/api/auth/verify-email", json={"token": original})
        assert old.status_code == 400
        assert _user_count(email) == 0
        created = client.post("/api/auth/verify-email", json={"token": _link_token(resent_calls[0]["confirm_url"])})
        assert created.status_code == 200
    assert _user_count(email) == 1


def test_send_failure_reads_the_same_for_an_existing_and_a_new_address():
    existing = _email()
    fresh = _email()

    def boom(**kwargs):
        raise RuntimeError("delivery failed")

    from unittest.mock import patch

    with TestClient(app) as client:
        assert signup_verified(client, email=existing, password=_PASSWORD, finish=True).status_code == 200
        client.post("/api/auth/logout")
        _reset_verification_rate_limits()
        with patch("app.main._deliver_account_email", boom):
            known = client.post(
                "/api/auth/verification/start",
                json={"email": existing, "password": "Different1!", "first_name": "Known", "last_name": "Person"},
            )
            _reset_verification_rate_limits()
            new = client.post(
                "/api/auth/verification/start",
                json={"email": fresh, "password": _PASSWORD, "first_name": "New", "last_name": "Person"},
            )
        assert known.status_code == 503 and new.status_code == 503
        assert known.json()["detail"] == new.json()["detail"]
        assert "exists" not in known.text
        assert "registered" not in known.text.lower()
        assert client.post("/api/auth/login", json={"email": existing, "password": _PASSWORD}).status_code == 200
        assert client.post("/api/auth/login", json={"email": existing, "password": "Different1!"}).status_code == 401
    assert _user_count(fresh) == 0


def test_ip_limit_blocks_further_starts(monkeypatch):
    monkeypatch.setattr("app.main._VERIFY_MAX_PER_IP_PER_HOUR", 2)
    with TestClient(app) as client:
        assert _start(client, _email())[0].status_code == 200
        assert _start(client, _email())[0].status_code == 200
        blocked = _start(client, _email())[0]
        assert blocked.status_code == 429
        assert blocked.json()["detail"] == "Too many requests. Please try again later."


def test_a_second_browser_finishes_onboarding_from_the_link(monkeypatch):
    sent: list[str] = []
    monkeypatch.setattr(settings, "RESEND_API_KEY", "re_local_not_sent")
    monkeypatch.setattr("app.email_service.send_welcome_email", lambda **kwargs: sent.append(kwargs["to_addr"]) or "local")
    email = _email()
    with TestClient(app) as browser_a:
        _started, captured = _start(browser_a, email)
        token = _link_token(captured[0]["confirm_url"])
    with TestClient(app) as browser_b:
        verified = browser_b.post("/api/auth/verify-email", json={"token": token})
        assert verified.status_code == 200
        assert browser_b.get("/api/families").json() == []
        done = browser_b.post("/api/auth/onboarding/complete", json={})
        assert done.status_code == 200
        assert done.json()["trial_started"] is True
        again = browser_b.post("/api/auth/onboarding/complete", json={})
        assert again.status_code == 200
        assert again.json()["trial_started"] is False
        assert browser_b.get("/api/auth/me").status_code == 200
        with SessionLocal() as db:
            user = db.execute(select(User).where(User.email == email)).scalar_one()
            user_id = int(user.id)
            assert int(user.session_version or 0) == 0
        assert _family_count(user_id) == 1
    with TestClient(app) as browser_a:
        assert browser_a.get("/api/auth/me").status_code == 401
    assert sent == [email]


def test_confirmation_link_is_not_written_to_the_log(caplog):
    email = _email()
    with TestClient(app) as client:
        _res, captured = _start(client, email)
        token = _link_token(captured[0]["confirm_url"])
        client.post("/api/auth/verify-email", json={"token": token})
    leaked = any("verify=" in record.getMessage() for record in caplog.records)
    assert leaked is False
