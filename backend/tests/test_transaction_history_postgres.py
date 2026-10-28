"""History writes, rollback, and billing locks on the disposable CI Postgres.

This runs only when TEST_POSTGRES_URL names localhost and the database
balancewhiz_history. It creates that database if needed. It refuses every
other host, including production and staging.
"""

from __future__ import annotations

import json
import os
import sys
from datetime import datetime
from pathlib import Path
from unittest.mock import patch
from urllib.parse import urlparse

import pytest

ROOT = Path(__file__).resolve().parents[2]
_URL = (os.environ.get("TEST_POSTGRES_URL") or "").strip()
_HISTORY_DB = "balancewhiz_history"
_FORBIDDEN = (
    "neon.tech",
    "ep-ancient-union",
    "ep-polished",
    "balancewhiz.com",
    "render.com",
)

if not _URL:
    pytest.skip("TEST_POSTGRES_URL is not set", allow_module_level=True)

_parsed = urlparse(_URL)
if _parsed.hostname not in ("localhost", "127.0.0.1"):
    raise SystemExit("Refusing: transaction history Postgres test must use localhost.")
if (_parsed.path or "").strip("/") != _HISTORY_DB:
    raise SystemExit("Refusing: transaction history Postgres test must use balancewhiz_history.")
_lowered = _URL.lower()
for _bit in _FORBIDDEN:
    if _bit in _lowered:
        raise SystemExit("Refusing: transaction history Postgres test must not use a hosted database.")


def _prepare_history_database() -> None:
    import psycopg

    try:
        admin = psycopg.connect(
            host=_parsed.hostname,
            port=_parsed.port or 5432,
            user=_parsed.username or "",
            password=_parsed.password or "",
            dbname="postgres",
            autocommit=True,
            connect_timeout=5,
        )
    except Exception as exc:
        raise SystemExit(f"Local Postgres setup failed: {type(exc).__name__}") from None
    try:
        exists = admin.execute("SELECT 1 FROM pg_database WHERE datname = %s", (_HISTORY_DB,)).fetchone()
        if not exists:
            admin.execute("CREATE DATABASE balancewhiz_history")
    except Exception as exc:
        raise SystemExit(f"Local history database setup failed: {type(exc).__name__}") from None
    finally:
        admin.close()

    try:
        check = psycopg.connect(
            host=_parsed.hostname,
            port=_parsed.port or 5432,
            user=_parsed.username or "",
            password=_parsed.password or "",
            dbname=_HISTORY_DB,
            connect_timeout=5,
        )
    except Exception as exc:
        raise SystemExit(f"Local history database connection failed: {type(exc).__name__}") from None
    try:
        names = [row[0] for row in check.execute("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")]
        if names:
            raise SystemExit("Refusing: balancewhiz_history already has tables.")
    finally:
        check.close()


_prepare_history_database()

sys.path.insert(0, str(ROOT / "e2e"))
from smoke_guard import apply_safe_environment, smoke_db_path  # noqa: E402

apply_safe_environment(smoke_db_path("balancewhiz-smoke-postgres-unused.db"))
os.environ["DATABASE_URL"] = _URL

sys.path.insert(0, str(ROOT / "backend"))
import app.main as main  # noqa: E402
from app.transaction_history import TransactionHistory  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import func, select, text  # noqa: E402
from verified_signup import signup_verified  # noqa: E402

assert main.settings.DATABASE_URL.startswith("postgresql+psycopg://")
assert urlparse(main.settings.DATABASE_URL.replace("+psycopg", "", 1)).hostname in ("localhost", "127.0.0.1")
assert main.settings.DATABASE_URL.rstrip("/").endswith("/" + _HISTORY_DB)
assert not main.settings.STRIPE_SECRET_KEY
assert not main.settings.RESEND_API_KEY
assert not main.settings.CONTACT_SMTP_HOST


def _blocked(response) -> None:
    assert response.status_code == 403, response.text
    detail = response.json()["detail"]
    assert detail["code"] == "billing_not_entitled"


def _stamp() -> dict:
    db = main.SessionLocal()
    try:
        series = []
        for row in db.execute(select(main.ExpectedTransaction).order_by(main.ExpectedTransaction.id)).scalars():
            series.append(
                (
                    row.id,
                    str(row.amount),
                    row.description,
                    row.recurrence.value,
                    row.start_date.isoformat(),
                )
            )
        transactions = db.execute(select(func.count()).select_from(main.Transaction)).scalar_one()
        subscriptions = db.execute(select(func.count()).select_from(main.BillingSubscription)).scalar_one()
        families = [
            (row.id, row.created_at)
            for row in db.execute(select(main.Family).order_by(main.Family.id)).scalars()
        ]
        history = db.execute(select(func.count()).select_from(TransactionHistory)).scalar_one()
        return {
            "series": series,
            "transactions": transactions,
            "subscriptions": subscriptions,
            "families": families,
            "history": history,
        }
    finally:
        db.close()


def test_postgres_history_round_trip_rollback_and_entitlement():
    main.startup_populate_schema()
    with main.engine.connect() as conn:
        assert conn.execute(text("SELECT current_database()")).scalar_one() == _HISTORY_DB
        columns = {
            row[0]: row[1]
            for row in conn.execute(
                text(
                    "SELECT column_name, data_type FROM information_schema.columns "
                    "WHERE table_schema = 'public' AND table_name = 'transaction_history'"
                )
            )
        }
        indexes = {
            row[0]
            for row in conn.execute(
                text("SELECT indexname FROM pg_indexes WHERE tablename = 'transaction_history'")
            )
        }
    assert columns["changes_json"] == "text"
    assert columns["created_at"] == "timestamp without time zone"
    assert {"ix_transaction_history_subject", "ix_transaction_history_lineage"} <= indexes

    with TestClient(app) as client:
        created = signup_verified(
            client,
            email="bw-smoke-histpg@example.com",
            password="SmokeOnly1!",
            first_name="Smoke",
            last_name="Postgres",
        )
        assert created.status_code == 200, created.text
        family_id = client.get("/api/families").json()[0]["id"]
        account = client.post(
            f"/api/families/{family_id}/accounts",
            json={
                "name": "Checking",
                "type": "checking",
                "starting_balance": "1000.00",
                "starting_balance_date": "2026-09-01",
            },
        )
        assert account.status_code == 200, account.text
        account_id = account.json()["id"]
        series = client.post(
            f"/api/families/{family_id}/expected-transactions",
            json={
                "account_id": account_id,
                "start_date": "2026-09-10",
                "recurrence": "monthly",
                "kind": "expense",
                "amount": "200.00",
                "description": "Rent",
            },
        )
        assert series.status_code == 200, series.text
        series_id = series.json()["id"]

        history = client.get(
            f"/api/families/{family_id}/transaction-history",
            params={"subject_type": "expected_series", "subject_id": series_id},
        )
        assert history.status_code == 200, history.text
        assert history.json()["events"][0]["action"] == "created"
        assert history.json()["events"][0]["actor_label"] == "Smoke Postgres"

        edited = client.put(
            f"/api/families/{family_id}/expected-transactions/{series_id}",
            json={
                "account_id": account_id,
                "start_date": "2026-09-10",
                "recurrence": "weekly",
                "kind": "expense",
                "amount": "50.00",
                "description": 'Rent "north" & south',
            },
        )
        assert edited.status_code == 200, edited.text
        history = client.get(
            f"/api/families/{family_id}/transaction-history",
            params={"subject_type": "expected_series", "subject_id": series_id},
        )
        assert history.status_code == 200, history.text
        changes = {item["field"]: item for item in history.json()["events"][0]["changes"]}
        assert changes["amount"]["before"] == "200.00"
        assert changes["amount"]["after"] == "50.00"
        assert changes["recurrence"]["before"] == "monthly"
        assert changes["recurrence"]["after"] == "weekly"
        assert changes["description"]["after"] == 'Rent "north" & south'

        with main.engine.connect() as conn:
            stored_json, stored_at = conn.execute(
                text(
                    "SELECT changes_json, created_at FROM transaction_history "
                    "WHERE family_id = :family_id AND action = 'updated'"
                ),
                {"family_id": family_id},
            ).one()
        stored = json.loads(stored_json)
        by_field = {item["field"]: item for item in stored}
        assert by_field["amount"]["before"] == "200.00"
        assert by_field["amount"]["after"] == "50.00"
        assert by_field["description"]["after"] == 'Rent "north" & south'
        assert isinstance(stored_at, datetime)

        before_read = _stamp()
        reread = client.get(
            f"/api/families/{family_id}/transaction-history",
            params={"subject_type": "expected_series", "subject_id": series_id},
        )
        assert reread.status_code == 200, reread.text
        assert _stamp() == before_read
        assert before_read["subscriptions"] == 0

        with patch("app.transaction_history.append_history", side_effect=RuntimeError("history failed")):
            with pytest.raises(RuntimeError, match="history failed"):
                client.put(
                    f"/api/families/{family_id}/expected-transactions/{series_id}",
                    json={
                        "account_id": account_id,
                        "start_date": "2026-09-10",
                        "recurrence": "weekly",
                        "kind": "expense",
                        "amount": "75.00",
                        "description": 'Rent "north" & south',
                    },
                )
        assert _stamp() == before_read
        listed = client.get(f"/api/families/{family_id}/expected-transactions")
        assert listed.json()[0]["amount"] == "50.00"

        db = main.SessionLocal()
        try:
            family = db.get(main.Family, family_id)
            family.created_at = datetime(2020, 1, 15, 12, 0, 0)
            db.commit()
            expired_at = family.created_at
        finally:
            db.close()

        def _assert_writes_blocked() -> None:
            stamp = _stamp()
            created_tx = client.post(
                f"/api/families/{family_id}/transactions",
                json={"date": "2026-09-12", "kind": "expense", "amount": "10.00", "description": "Blocked"},
            )
            _blocked(created_tx)
            edited_tx = client.put(
                f"/api/families/{family_id}/expected-transactions/{series_id}",
                json={
                    "account_id": account_id,
                    "start_date": "2026-09-10",
                    "recurrence": "monthly",
                    "kind": "expense",
                    "amount": "10.00",
                    "description": "Blocked",
                },
            )
            _blocked(edited_tx)
            removed = client.delete(f"/api/families/{family_id}/expected-transactions/{series_id}")
            _blocked(removed)
            added = client.post(
                f"/api/families/{family_id}/expected-transactions",
                json={
                    "account_id": account_id,
                    "start_date": "2026-09-10",
                    "recurrence": "monthly",
                    "kind": "expense",
                    "amount": "10.00",
                    "description": "Blocked",
                },
            )
            _blocked(added)
            after = _stamp()
            assert after["series"] == stamp["series"]
            assert after["transactions"] == stamp["transactions"]
            assert after["subscriptions"] == stamp["subscriptions"]
            assert after["history"] == stamp["history"]
            assert after["families"] == [(family_id, expired_at)]

        _assert_writes_blocked()

        db = main.SessionLocal()
        try:
            db.add(
                main.BillingSubscription(
                    family_id=family_id,
                    stripe_subscription_id="sub_hist_pg_canceled",
                    status="canceled",
                    lookup_key="cash_forecast_monthly",
                    current_period_end=datetime(2020, 2, 1, 0, 0, 0),
                    cancel_at_period_end=False,
                    created_at=datetime(2020, 1, 20, 0, 0, 0),
                    updated_at=datetime(2020, 2, 1, 0, 0, 0),
                )
            )
            db.commit()
        finally:
            db.close()

        _assert_writes_blocked()
        ended = _stamp()
        assert ended["subscriptions"] == 1
        assert ended["series"][0][1:] == ("50.00", 'Rent "north" & south', "weekly", "2026-09-10")
