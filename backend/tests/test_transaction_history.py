"""Transaction history is recorded with the financial change and does not alter the forecast.

Uses a local sqlite file. This file must not be pointed at a hosted database.
"""

from __future__ import annotations

import sys
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from unittest.mock import patch

import pytest
from sqlalchemy import func, select

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "e2e"))

from smoke_guard import (  # noqa: E402
    apply_safe_environment,
    assert_loaded_settings,
    assert_process_is_safe,
    smoke_db_path,
)
from verified_signup import signup_verified  # noqa: E402

_DB = smoke_db_path("balancewhiz-smoke-history-pytest.db")
_DB.parent.mkdir(parents=True, exist_ok=True)
for _extra in (_DB, Path(str(_DB) + "-wal"), Path(str(_DB) + "-shm")):
    if _extra.exists():
        _extra.unlink()

apply_safe_environment(_DB)
assert_process_is_safe(_DB)

sys.path.insert(0, str(ROOT / "backend"))
from app.main import (  # noqa: E402
    BillingSubscription,
    ExpectedTransaction,
    Family,
    FamilyMember,
    Recurrence,
    SessionLocal,
    Transaction,
    TransactionKind,
    app,
    settings,
)
from app.transaction_history import TransactionHistory  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

assert_loaded_settings(
    database_url=settings.DATABASE_URL,
    env=settings.ENV,
    stripe_key=settings.STRIPE_SECRET_KEY,
    resend_key=settings.RESEND_API_KEY,
    smtp_host=settings.CONTACT_SMTP_HOST,
    db_filename=_DB.name,
)


def _money(value) -> Decimal:
    return Decimal(str(value)).quantize(Decimal("0.01"))


def _signup(client: TestClient, email: str, *, first: str = "Smoke", last: str = "History") -> tuple[int, int]:
    created = signup_verified(client, email=email, password="SmokeOnly1!", first_name=first, last_name=last)
    assert created.status_code == 200, created.text
    families = client.get("/api/families")
    assert families.status_code == 200, families.text
    me = client.get("/api/auth/me")
    assert me.status_code == 200, me.text
    return families.json()[0]["id"], me.json()["user"]["id"]


def _account(client: TestClient, family_id: int, *, balance: str = "1000.00", on: str = "2026-09-01") -> int:
    account = client.post(
        f"/api/families/{family_id}/accounts",
        json={"name": "Checking", "type": "checking", "starting_balance": balance, "starting_balance_date": on},
    )
    assert account.status_code == 200, account.text
    return account.json()["id"]


def _series(client: TestClient, family_id: int, account_id: int, **extra) -> dict:
    body = {
        "account_id": account_id,
        "start_date": "2026-09-10",
        "recurrence": "monthly",
        "kind": "expense",
        "amount": "200.00",
        "description": "Cash",
    }
    body.update(extra)
    created = client.post(f"/api/families/{family_id}/expected-transactions", json=body)
    assert created.status_code == 200, created.text
    return created.json()


def _history(client: TestClient, family_id: int, subject_type: str, subject_id: int, occurrence_date: str | None = None):
    params = {"subject_type": subject_type, "subject_id": subject_id}
    if occurrence_date:
        params["occurrence_date"] = occurrence_date
    return client.get(f"/api/families/{family_id}/transaction-history", params=params)


def _change(events: list[dict], field: str, action: str | None = None) -> dict:
    for event in events:
        if action and event["action"] != action:
            continue
        for change in event["changes"]:
            if change["field"] == field:
                return change
    raise AssertionError(f"missing {field} in {events}")


def test_recurrence_edit_records_before_and_after():
    with TestClient(app) as client:
        family_id, _user_id = _signup(client, "bw-smoke-histrepeat@example.com")
        account_id = _account(client, family_id)
        series = _series(client, family_id, account_id)
        updated = client.put(
            f"/api/families/{family_id}/expected-transactions/{series['id']}",
            json={
                "account_id": account_id,
                "start_date": "2026-09-10",
                "recurrence": "weekly",
                "kind": "expense",
                "amount": "200.00",
                "description": "Cash",
            },
        )
        assert updated.status_code == 200, updated.text
        history = _history(client, family_id, "expected_series", series["id"])
        assert history.status_code == 200, history.text
        body = history.json()
        assert "@" not in history.text
        assert body["events"][0]["actor_label"] == "Smoke History"
        change = _change(body["events"], "recurrence", "updated")
        assert change["before"] == "monthly"
        assert change["after"] == "weekly"
        assert body["earlier_edits_note"] is None


def test_occurrence_skip_move_override_and_restore():
    with TestClient(app) as client:
        family_id, _user_id = _signup(client, "bw-smoke-histocc@example.com")
        account_id = _account(client, family_id)
        series = _series(client, family_id, account_id, start_date="2026-09-10")

        skipped = client.post(
            f"/api/families/{family_id}/expected-transactions/{series['id']}/instances/2026-11-10",
            json={"action": "cancel"},
        )
        assert skipped.status_code == 200, skipped.text
        skip_history = _history(client, family_id, "expected_occurrence", series["id"], "2026-11-10")
        assert skip_history.status_code == 200, skip_history.text
        skip_body = skip_history.json()
        assert skip_body["occurrence_events"][0]["action"] == "skipped"
        assert skip_body["occurrence_events"][0]["actor_kind"] == "user"
        cancelled = _change(skip_body["occurrence_events"], "cancelled")
        assert cancelled["before"] is False
        assert cancelled["after"] is True

        restored = client.delete(
            f"/api/families/{family_id}/expected-transactions/{series['id']}/instances/2026-11-10"
        )
        assert restored.status_code == 200, restored.text
        restore_history = _history(client, family_id, "expected_occurrence", series["id"], "2026-11-10")
        assert restore_history.json()["occurrence_events"][0]["action"] == "restored"

        overridden = client.post(
            f"/api/families/{family_id}/expected-transactions/{series['id']}/instances/2026-12-10",
            json={
                "action": "update",
                "account_id": account_id,
                "kind": "expense",
                "amount": "75.00",
                "description": "Cash",
            },
        )
        assert overridden.status_code == 200, overridden.text
        override_history = _history(client, family_id, "expected_occurrence", series["id"], "2026-12-10")
        amount = _change(override_history.json()["occurrence_events"], "amount", "updated")
        assert amount["before"] is None
        assert amount["after"] == "75.00"

        moved = client.post(
            f"/api/families/{family_id}/expected-transactions/{series['id']}/instances/2026-09-10",
            json={
                "action": "update",
                "account_id": account_id,
                "kind": "expense",
                "amount": "200.00",
                "moved_to_date": "2026-10-10",
            },
        )
        assert moved.status_code == 200, moved.text
        move_history = _history(client, family_id, "expected_occurrence", series["id"], "2026-09-10")
        moved_to = _change(move_history.json()["occurrence_events"], "moved_to_date", "updated")
        assert moved_to["after"] == "2026-10-10"
        automatic = _history(client, family_id, "expected_occurrence", series["id"], "2026-10-10")
        assert automatic.status_code == 200, automatic.text
        auto_events = automatic.json()["occurrence_events"]
        assert auto_events[0]["action"] == "skipped"
        assert auto_events[0]["actor_kind"] == "system"
        assert auto_events[0]["actor_label"] == "Automatic"

        db = SessionLocal()
        try:
            rows = list(
                db.execute(
                    select(TransactionHistory).where(
                        TransactionHistory.family_id == family_id,
                        TransactionHistory.subject_id == series["id"],
                        TransactionHistory.action.in_(("updated", "skipped")),
                        TransactionHistory.occurrence_date.in_((date(2026, 9, 10), date(2026, 10, 10))),
                    )
                ).scalars()
            )
            batches = {row.occurrence_date: row.batch_id for row in rows}
            assert batches[date(2026, 9, 10)] == batches[date(2026, 10, 10)]
        finally:
            db.close()


def test_this_and_future_split_shares_lineage_and_end_records_history():
    with TestClient(app) as client:
        family_id, _user_id = _signup(client, "bw-smoke-histsplit@example.com")
        account_id = _account(client, family_id, on="2026-01-01")
        series = _series(client, family_id, account_id, start_date="2026-01-10", description="Rent")
        split = client.post(
            f"/api/families/{family_id}/expected-transactions/{series['id']}/apply-from-occurrence/2026-03-10",
            json={"account_id": account_id, "kind": "expense", "amount": "50.00", "description": "Rent"},
        )
        assert split.status_code == 200, split.text
        assert split.json()["mode"] == "split"
        new_id = split.json()["future_series_id"]
        listed = client.get(f"/api/families/{family_id}/expected-transactions")
        old = next(item for item in listed.json() if item["id"] == series["id"])
        assert old["end_date"] == "2026-02-10"
        history = _history(client, family_id, "expected_series", series["id"])
        assert history.status_code == 200, history.text
        actions = {event["action"] for event in history.json()["events"]}
        assert "split" in actions
        assert "created" in actions
        end_change = _change(history.json()["events"], "end_date", "split")
        assert end_change["after"] == "2026-02-10"
        amount_change = _change(history.json()["events"], "amount", "created")
        assert amount_change["after"] == "50.00"

        ended = client.post(
            f"/api/families/{family_id}/expected-transactions/{new_id}/end-from-occurrence/2026-04-10"
        )
        assert ended.status_code == 200, ended.text
        ended_history = _history(client, family_id, "expected_series", new_id)
        assert _change(ended_history.json()["events"], "end_date", "ended")["after"] == "2026-03-10"

        db = SessionLocal()
        try:
            rows = list(
                db.execute(select(TransactionHistory).where(TransactionHistory.family_id == family_id)).scalars()
            )
            split_row = next(row for row in rows if row.action == "split" and row.subject_id == series["id"])
            created_row = next(row for row in rows if row.action == "created" and row.subject_id == new_id)
            assert split_row.lineage_id == created_row.lineage_id
            assert split_row.related_subject_id == new_id
            assert created_row.related_subject_id == series["id"]
        finally:
            db.close()


def test_one_time_edit_and_history_survives_deletion():
    with TestClient(app) as client:
        family_id, _user_id = _signup(client, "bw-smoke-histonce@example.com")
        created = client.post(
            f"/api/families/{family_id}/transactions",
            json={"date": "2026-09-01", "kind": "expense", "amount": "125.00", "description": "Groceries"},
        )
        assert created.status_code == 200, created.text
        transaction_id = created.json()["id"]
        edited = client.put(
            f"/api/families/{family_id}/transactions/{transaction_id}",
            json={"date": "2026-09-01", "kind": "expense", "amount": "80.00", "description": "Groceries"},
        )
        assert edited.status_code == 200, edited.text
        deleted = client.delete(f"/api/families/{family_id}/transactions/{transaction_id}")
        assert deleted.status_code == 200, deleted.text
        missing = client.get(f"/api/families/{family_id}/transactions")
        assert all(item["id"] != transaction_id for item in missing.json()["items"])
        history = _history(client, family_id, "transaction", transaction_id)
        assert history.status_code == 200, history.text
        body = history.json()
        assert body["events"][0]["action"] == "deleted"
        amount = _change(body["events"], "amount", "updated")
        assert amount["before"] == "125.00"
        assert amount["after"] == "80.00"
        assert "@" not in history.text


def test_existing_series_without_history_does_not_invent_values():
    with TestClient(app) as client:
        family_id, user_id = _signup(client, "bw-smoke-histlegacy@example.com")
        account_id = _account(client, family_id)
        db = SessionLocal()
        try:
            row = ExpectedTransaction(
                family_id=family_id,
                account_id=account_id,
                created_by_user_id=user_id,
                start_date=date(2026, 9, 10),
                recurrence=Recurrence.monthly,
                description="DoNotInventValues",
                kind=TransactionKind.expense,
                amount=Decimal("200.00"),
                created_at=datetime(2026, 9, 9, 14, 22, 27),
            )
            db.add(row)
            db.commit()
            series_id = row.id
        finally:
            db.close()
        history = _history(client, family_id, "expected_series", series_id)
        assert history.status_code == 200, history.text
        body = history.json()
        assert body["events"][0]["recorded"] is False
        assert body["events"][0]["action"] == "created"
        assert body["events"][0]["changes"] == []
        assert body["events"][0]["actor_label"] == "Smoke History"
        assert body["earlier_edits_note"] == "Changes before history was turned on were not recorded."
        assert "DoNotInventValues" not in history.text
        assert "200.00" not in history.text
        assert "@" not in history.text


def test_view_only_member_can_read_history_and_outsiders_cannot():
    with TestClient(app) as owner, TestClient(app) as viewer, TestClient(app) as stranger:
        family_id, _owner_id = _signup(owner, "bw-smoke-histowner@example.com", last="Owner")
        account_id = _account(owner, family_id)
        series = _series(owner, family_id, account_id)
        _viewer_family, viewer_id = _signup(viewer, "bw-smoke-histviewer@example.com", last="Viewer")
        _stranger_family, _stranger_id = _signup(stranger, "bw-smoke-histstranger@example.com", last="Stranger")
        db = SessionLocal()
        try:
            db.add(
                FamilyMember(
                    family_id=family_id,
                    user_id=viewer_id,
                    role="member",
                    is_family_owner=False,
                    access_mode="view",
                )
            )
            db.commit()
        finally:
            db.close()

        allowed = _history(viewer, family_id, "expected_series", series["id"])
        assert allowed.status_code == 200, allowed.text
        assert allowed.json()["events"][0]["actor_label"] == "Smoke Owner"
        denied_write = viewer.put(
            f"/api/families/{family_id}/expected-transactions/{series['id']}",
            json={
                "account_id": account_id,
                "start_date": "2026-09-10",
                "recurrence": "weekly",
                "kind": "expense",
                "amount": "200.00",
                "description": "Cash",
            },
        )
        assert denied_write.status_code == 403, denied_write.text
        blocked = _history(stranger, family_id, "expected_series", series["id"])
        assert blocked.status_code == 403, blocked.text


def test_history_failure_rolls_back_the_financial_change():
    with TestClient(app) as client:
        family_id, _user_id = _signup(client, "bw-smoke-histroll@example.com", last="Rollback")
        with patch("app.transaction_history.append_history", side_effect=RuntimeError("history failed")):
            with pytest.raises(RuntimeError, match="history failed"):
                client.post(
                    f"/api/families/{family_id}/transactions",
                    json={"date": "2026-09-01", "kind": "expense", "amount": "40.00", "description": "Should roll back"},
                )
        db = SessionLocal()
        try:
            transactions = db.execute(
                select(func.count()).select_from(Transaction).where(Transaction.family_id == family_id)
            ).scalar_one()
            history_rows = db.execute(
                select(func.count()).select_from(TransactionHistory).where(TransactionHistory.family_id == family_id)
            ).scalar_one()
        finally:
            db.close()
        assert transactions == 0
        assert history_rows == 0


def test_history_does_not_change_forecast_billing_or_trial_date():
    with TestClient(app) as client:
        family_id, _user_id = _signup(client, "bw-smoke-histcast@example.com", last="Forecast")
        _account(client, family_id, balance="1000.00", on="2026-09-01")
        db = SessionLocal()
        try:
            created_at = db.get(Family, family_id).created_at
        finally:
            db.close()
        expense = client.post(
            f"/api/families/{family_id}/transactions",
            json={"date": "2026-09-01", "kind": "expense", "amount": "125.00", "description": "Known expense"},
        )
        assert expense.status_code == 200, expense.text
        calendar = client.get(f"/api/families/{family_id}/calendar-month-daily", params={"month": "2026-09"})
        assert calendar.status_code == 200, calendar.text
        by_date = {row["date"]: row for row in calendar.json()["days"]}
        assert _money(by_date["2026-09-01"]["end"]) == Decimal("875.00")
        db = SessionLocal()
        try:
            family = db.get(Family, family_id)
            assert family.created_at == created_at
            subscriptions = db.execute(
                select(func.count()).select_from(BillingSubscription).where(BillingSubscription.family_id == family_id)
            ).scalar_one()
        finally:
            db.close()
        assert subscriptions == 0
        history = _history(client, family_id, "transaction", expense.json()["id"])
        assert history.status_code == 200, history.text
        assert history.json()["events"][0]["action"] == "created"
