"""The app builds its full schema on an empty PostgreSQL database, and a second start changes nothing.

Runs only when TEST_POSTGRES_URL points at a local, empty database (CI uses a
throwaway postgres service). Refuses any other host and any database that
already has tables. Email, Stripe, and SMTP are switched off before import.
"""

from __future__ import annotations

import os
import sys
import uuid
from pathlib import Path
from urllib.parse import urlparse

import pytest

ROOT = Path(__file__).resolve().parents[2]
_URL = (os.environ.get("TEST_POSTGRES_URL") or "").strip()

if not _URL:
    pytest.skip("TEST_POSTGRES_URL is not set", allow_module_level=True)
if urlparse(_URL).hostname not in ("localhost", "127.0.0.1"):
    raise SystemExit("Refusing: TEST_POSTGRES_URL must be a local database.")

sys.path.insert(0, str(ROOT / "e2e"))
from smoke_guard import apply_safe_environment, smoke_db_path  # noqa: E402
from verified_signup import signup_verified  # noqa: E402

apply_safe_environment(smoke_db_path("balancewhiz-smoke-postgres-unused.db"))
os.environ["DATABASE_URL"] = _URL

sys.path.insert(0, str(ROOT / "backend"))
import app.main as main  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import inspect, text  # noqa: E402

assert main.settings.DATABASE_URL.startswith("postgresql+psycopg://")
assert urlparse(main.settings.DATABASE_URL.replace("+psycopg", "")).hostname in ("localhost", "127.0.0.1")
assert not main.settings.RESEND_API_KEY and not main.settings.STRIPE_SECRET_KEY
assert not main.settings.CONTACT_SMTP_HOST

_RAW_SQL_INDEXES = {
    "billing_customers": {"ix_billing_customers_user_id", "ix_billing_customers_stripe_customer_id"},
    "billing_subscriptions": {"ix_billing_subscriptions_status"},
    "feedback": {"ix_feedback_created_at", "ix_feedback_kind", "ix_feedback_status"},
    "family_invites": {"ix_family_invites_family", "ix_family_invites_family_email"},
    "platform_admin_audit_log": {"ix_platform_admin_audit_target", "ix_platform_admin_audit_created"},
}


def _schema():
    insp = inspect(main.engine)
    tables = set(insp.get_table_names())
    columns = {t: {c["name"] for c in insp.get_columns(t)} for t in tables}
    indexes = {t: {i["name"] for i in insp.get_indexes(t)} for t in tables}
    return tables, columns, indexes


@pytest.fixture(scope="module")
def started():
    if inspect(main.engine).get_table_names():
        raise SystemExit("Refusing: TEST_POSTGRES_URL already has tables. Use an empty database.")
    main.startup_populate_schema()
    first = _schema()
    main.startup_populate_schema()
    return first, _schema()


def test_every_model_table_and_column_exists(started):
    (tables, columns, _), _ = started
    for name, table in main.Base.metadata.tables.items():
        assert name in tables, name
        missing = {c.name for c in table.columns} - columns[name]
        assert not missing, (name, missing)


def test_startup_migrations_and_indexes_exist(started):
    (_, columns, indexes), _ = started
    assert {"pending_lookup_key", "pending_change_on"} <= columns["billing_subscriptions"]
    assert {
        "platform_role",
        "complimentary_access",
        "first_name",
        "onboarding_goals",
        "session_version",
        "email_verified_at",
        "welcome_email_sent_at",
        "onboarding_completed_at",
    } <= columns["users"]
    for table, expected in _RAW_SQL_INDEXES.items():
        assert expected <= indexes[table], (table, expected - indexes[table])


def test_second_start_changes_nothing(started):
    first, second = started
    assert first == second


def test_recurrence_enum_has_every_label(started):
    with main.engine.connect() as conn:
        labels = {
            row[0]
            for row in conn.execute(
                text(
                    "SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid "
                    "WHERE t.typname = (SELECT t2.typname FROM pg_type t2 JOIN pg_enum e2 "
                    "ON t2.oid = e2.enumtypid WHERE e2.enumlabel = 'monthly' LIMIT 1)"
                )
            )
        }
    assert {"monthly", "weekly", "twice_monthly", "biweekly", "quarterly", "bimonthly"} <= labels


def test_concurrent_backfill_runs_once_and_legacy_inserts_stay_verified(started):
    """Several API processes can start together. The marker is written once.

    An insert that omits email_verified_at, as the previous registration
    statement does, is verified by the column default. An explicit NULL is not
    filled in on a later start, and the marker stays in place.
    """
    from concurrent.futures import ThreadPoolExecutor

    old_email = f"bw-before-{uuid.uuid4().hex[:8]}@example.com"
    kept_email = f"bw-kept-{uuid.uuid4().hex[:8]}@example.com"
    with main.engine.begin() as conn:
        conn.execute(text("ALTER TABLE users ALTER COLUMN email_verified_at DROP DEFAULT"))
        conn.execute(
            text(
                "INSERT INTO users (email, password_hash, session_version, platform_role, "
                "complimentary_access, created_at, email_verified_at) "
                "VALUES (:email, 'not-a-secret', 0, 'subscriber', false, "
                "'2020-01-02 03:04:05', NULL)"
            ),
            {"email": old_email},
        )
        conn.execute(
            text(
                "INSERT INTO users (email, password_hash, session_version, platform_role, "
                "complimentary_access, created_at, email_verified_at) "
                "VALUES (:email, 'not-a-secret', 0, 'subscriber', false, "
                "'2021-05-06 07:08:09', '2021-05-06 07:08:09')"
            ),
            {"email": kept_email},
        )
        conn.execute(
            text("DELETE FROM app_meta WHERE key = :key"),
            {"key": main._EMAIL_VERIFIED_BACKFILL_KEY},
        )

    errors: list[str] = []

    def run() -> None:
        try:
            main._ensure_user_email_verification_columns()
        except Exception as exc:
            errors.append(repr(exc))

    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(lambda _: run(), range(4)))
    assert errors == []

    legacy_email = f"bw-legacy-{uuid.uuid4().hex[:8]}@example.com"
    with main.engine.begin() as conn:
        old = conn.execute(
            text("SELECT email_verified_at, session_version FROM users WHERE email = :email"),
            {"email": old_email},
        ).one()
        kept = conn.execute(
            text("SELECT email_verified_at FROM users WHERE email = :email"),
            {"email": kept_email},
        ).scalar()
        markers = conn.execute(
            text("SELECT count(*) FROM app_meta WHERE key = :key"),
            {"key": main._EMAIL_VERIFIED_BACKFILL_KEY},
        ).scalar()
        column_default = conn.execute(
            text(
                "SELECT column_default FROM information_schema.columns "
                "WHERE table_schema = current_schema() AND table_name = 'users' "
                "AND column_name = 'email_verified_at'"
            )
        ).scalar()
        conn.execute(
            text(
                "INSERT INTO users (email, password_hash, session_version, platform_role, complimentary_access) "
                "VALUES (:email, 'not-a-secret', 0, 'subscriber', false)"
            ),
            {"email": legacy_email},
        )
        legacy = conn.execute(
            text("SELECT email_verified_at IS NOT NULL, session_version FROM users WHERE email = :email"),
            {"email": legacy_email},
        ).one()
        conn.execute(
            text("UPDATE users SET email_verified_at = NULL WHERE email = :email"),
            {"email": legacy_email},
        )
    main._ensure_user_email_verification_columns()
    with main.engine.connect() as conn:
        still_null = conn.execute(
            text("SELECT email_verified_at FROM users WHERE email = :email"),
            {"email": legacy_email},
        ).scalar()
        marker_after = conn.execute(
            text("SELECT count(*) FROM app_meta WHERE key = :key"),
            {"key": main._EMAIL_VERIFIED_BACKFILL_KEY},
        ).scalar()

    assert markers == 1
    assert marker_after == 1
    assert str(old[0]).startswith("2020-01-02")
    assert int(old[1]) == 0
    assert str(kept).startswith("2021-05-06")
    assert column_default and "current_timestamp" in str(column_default).lower()
    assert legacy[0] is True
    assert int(legacy[1]) == 0
    assert still_null is None


def test_a_new_account_can_register_and_sign_in(started):
    email = f"bw-smoke-{uuid.uuid4().hex[:10]}@example.com"
    password = "SmokeOnly1!"
    with TestClient(main.app) as client:
        reg = signup_verified(
            client,
            email=email,
            password=password,
            first_name="Empty",
            last_name="Postgres",
        )
        assert reg.status_code == 200
        login = client.post("/api/auth/login", json={"email": email, "password": password})
        assert login.status_code == 200, login.text
    with main.SessionLocal() as db:
        user = db.execute(main.select(main.User).where(main.User.email == email)).scalar_one()
        assert main._stored_platform_role(user) == "subscriber"
