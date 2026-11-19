"""Financial integrity: one real payment produces one cashflow.

These checks use the local smoke SQLite database. They do not call Stripe,
send email, or connect to a staging or production database.

Each test refetches the calendar and the daily balances. A passing test means
the second read still shows the same amounts, so a refresh cannot bring a
duplicate back.
"""

from __future__ import annotations

import sys
from datetime import date
from decimal import Decimal
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

_DB = smoke_db_path("balancewhiz-smoke-integrity.db")
_DB.parent.mkdir(parents=True, exist_ok=True)
for _extra in (_DB, Path(str(_DB) + "-wal"), Path(str(_DB) + "-shm")):
    if _extra.exists():
        _extra.unlink()

apply_safe_environment(_DB)
assert_process_is_safe(_DB)

sys.path.insert(0, str(ROOT / "backend"))
from app.main import (  # noqa: E402
    ExpectedTransactionOverride,
    SessionLocal,
    TransactionKind,
    app,
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


def _money(value) -> Decimal:
    return Decimal(str(value)).quantize(Decimal("0.01"))


def _family(client: TestClient, email: str):
    created = signup_verified(
        client,
        email=email,
        password="SmokeOnly1!",
        first_name="Smoke",
        last_name="Integrity",
    )
    assert created.status_code == 200, created.text
    families = client.get("/api/families")
    assert families.status_code == 200, families.text
    family_id = families.json()[0]["id"]
    account = client.post(
        f"/api/families/{family_id}/accounts",
        json={
            "name": "Checking",
            "type": "checking",
            "starting_balance": "10000.00",
            "starting_balance_date": "2026-10-01",
        },
    )
    assert account.status_code == 200, account.text
    return family_id, account.json()["id"]


def _series(client, family_id, account_id, *, kind, amount, description, start, **extra):
    created = client.post(
        f"/api/families/{family_id}/expected-transactions",
        json={
            "account_id": account_id,
            "start_date": start,
            "recurrence": "monthly",
            "kind": kind,
            "amount": amount,
            "description": description,
            **extra,
        },
    )
    assert created.status_code == 200, created.text
    return created.json()["id"]


def _forecast(client, family_id, month):
    calendar = client.get(
        f"/api/families/{family_id}/expected-calendar",
        params={"month": month},
    )
    assert calendar.status_code == 200, calendar.text
    daily = client.get(
        f"/api/families/{family_id}/calendar-month-daily",
        params={"month": month},
    )
    assert daily.status_code == 200, daily.text
    days = {row["date"]: row for row in daily.json()["days"]}
    return calendar.json()["items"], days


def _refetch_matches(client, family_id, month):
    first_items, first_days = _forecast(client, family_id, month)
    second_items, second_days = _forecast(client, family_id, month)
    assert first_items == second_items
    compared = [
        (iso, _money(row["end"]), _money(row["tx_net"]))
        for iso, row in sorted(first_days.items())
    ]
    again = [
        (iso, _money(row["end"]), _money(row["tx_net"]))
        for iso, row in sorted(second_days.items())
    ]
    assert compared == again
    return first_items, first_days


def _on(items, day, description):
    return [it for it in items if it["date"] == day and it["description"] == description]


def _amounts(items, day, description):
    return sorted(_money(it["amount"]) for it in _on(items, day, description))


def _override(client, family_id, series_id, occurrence, **fields):
    payload = {"action": "update", **fields}
    saved = client.post(
        f"/api/families/{family_id}/expected-transactions/{series_id}/instances/{occurrence}",
        json=payload,
    )
    assert saved.status_code == 200, saved.text


@pytest.mark.parametrize(
    ("kind", "description", "email", "before_end", "after_end", "after_net"),
    [
        ("income", "Paycheck", "bw-smoke-integrity-pay@example.com", "13000.00", "13200.00", "3200.00"),
        ("expense", "Mortgage", "bw-smoke-integrity-bill@example.com", "7000.00", "6800.00", "-3200.00"),
    ],
)
def test_one_date_amount_edit_changes_that_day_by_the_difference_only(
    kind, description, email, before_end, after_end, after_net
):
    """$3,000 edited to $3,200 on one date counts once. Later dates stay $3,000."""
    with TestClient(app) as client:
        family_id, account_id = _family(client, email)
        series_id = _series(
            client,
            family_id,
            account_id,
            kind=kind,
            amount="3000.00",
            description=description,
            start="2026-11-15",
        )
        before_items, before_days = _forecast(client, family_id, "2026-11")
        assert _amounts(before_items, "2026-11-15", description) == [Decimal("3000.00")]
        assert _money(before_days["2026-11-15"]["end"]) == Decimal(before_end)

        _override(
            client,
            family_id,
            series_id,
            "2026-11-15",
            account_id=account_id,
            kind=kind,
            amount="3200.00",
            description=description,
        )

        items, days = _refetch_matches(client, family_id, "2026-11")
        # Only this occurrence must replace in place — never leave old + new on that date.
        assert _amounts(items, "2026-11-15", description) == [Decimal("3200.00")]
        assert Decimal("3000.00") not in _amounts(items, "2026-11-15", description)
        assert len(_on(items, "2026-11-15", description)) == 1
        assert _money(days["2026-11-15"]["tx_net"]) == Decimal(after_net)
        assert _money(days["2026-11-15"]["end"]) == Decimal(after_end)
        assert _money(days["2026-11-15"]["end"]) - _money(before_days["2026-11-15"]["end"]) == (
            Decimal("200.00") if kind == "income" else Decimal("-200.00")
        )

        later_items, later_days = _refetch_matches(client, family_id, "2026-12")
        assert _amounts(later_items, "2026-12-15", description) == [Decimal("3000.00")]
        later_net = Decimal("3000.00") if kind == "income" else Decimal("-3000.00")
        assert _money(later_days["2026-12-15"]["tx_net"]) == later_net

        series = client.get(f"/api/families/{family_id}/expected-transactions")
        assert series.status_code == 200, series.text
        rows = [row for row in series.json() if row["description"] == description]
        assert len(rows) == 1
        assert _money(rows[0]["amount"]) == Decimal("3000.00")
        posted = client.get(f"/api/families/{family_id}/transactions", params={"month": "2026-11"})
        assert posted.status_code == 200, posted.text
        assert posted.json()["items"] == []


def test_only_this_occurrence_amount_edit_never_leaves_old_and_new_amounts():
    """Regression for the prod bug: Only this occurrence amount edit must not duplicate the row.

    Editing $4,805.35 → $5,005.35 on one recurring date must leave exactly one row with the
    new amount. The series template stays unchanged for later dates.
    """
    with TestClient(app) as client:
        family_id, account_id = _family(client, "bw-smoke-integrity-only-occ@example.com")
        series_id = _series(
            client,
            family_id,
            account_id,
            kind="income",
            amount="4805.35",
            description="Holt Paycheck",
            start="2026-11-15",
        )
        _override(
            client,
            family_id,
            series_id,
            "2026-11-15",
            account_id=account_id,
            kind="income",
            amount="5005.35",
            description="Holt Paycheck",
        )

        items, days = _refetch_matches(client, family_id, "2026-11")
        on_day = _on(items, "2026-11-15", "Holt Paycheck")
        assert len(on_day) == 1, on_day
        assert _amounts(items, "2026-11-15", "Holt Paycheck") == [Decimal("5005.35")]
        assert Decimal("4805.35") not in _amounts(items, "2026-11-15", "Holt Paycheck")
        assert _money(days["2026-11-15"]["tx_net"]) == Decimal("5005.35")

        later_items, _later_days = _refetch_matches(client, family_id, "2026-12")
        assert _amounts(later_items, "2026-12-15", "Holt Paycheck") == [Decimal("4805.35")]
        series = client.get(f"/api/families/{family_id}/expected-transactions")
        assert series.status_code == 200, series.text
        rows = [row for row in series.json() if row["description"] == "Holt Paycheck"]
        assert len(rows) == 1
        assert _money(rows[0]["amount"]) == Decimal("4805.35")
        posted = client.get(f"/api/families/{family_id}/transactions", params={"month": "2026-11"})
        assert posted.status_code == 200, posted.text
        assert posted.json()["items"] == []


def test_only_this_occurrence_amount_edit_does_not_reveal_a_hidden_moved_copy():
    """A paycheck already parked on this day must not reappear when this date's amount changes.

    This is the stacked-copy path that looked like create-instead-of-update on production:
    move an earlier occurrence onto the same day (amounts match → one visible row), then edit
    Only this occurrence's amount. Without absorbing the moved copy, both old and new amounts
    appear on that date.
    """
    with TestClient(app) as client:
        family_id, account_id = _family(client, "bw-smoke-integrity-stacked@example.com")
        series_id = _series(
            client,
            family_id,
            account_id,
            kind="income",
            amount="4805.35",
            description="Holt Paycheck",
            start="2026-10-15",
        )
        _override(
            client,
            family_id,
            series_id,
            "2026-10-15",
            account_id=account_id,
            kind="income",
            amount="4805.35",
            description="Holt Paycheck",
            moved_to_date="2026-11-15",
        )
        before_items, _before_days = _forecast(client, family_id, "2026-11")
        assert _amounts(before_items, "2026-11-15", "Holt Paycheck") == [Decimal("4805.35")]

        _override(
            client,
            family_id,
            series_id,
            "2026-11-15",
            account_id=account_id,
            kind="income",
            amount="5005.35",
            description="Holt Paycheck",
        )

        items, days = _refetch_matches(client, family_id, "2026-11")
        on_day = _on(items, "2026-11-15", "Holt Paycheck")
        assert len(on_day) == 1, on_day
        assert _amounts(items, "2026-11-15", "Holt Paycheck") == [Decimal("5005.35")]
        assert Decimal("4805.35") not in _amounts(items, "2026-11-15", "Holt Paycheck")
        assert _money(days["2026-11-15"]["tx_net"]) == Decimal("5005.35")
        october_items, _october_days = _refetch_matches(client, family_id, "2026-10")
        assert _on(october_items, "2026-10-15", "Holt Paycheck") == []
        later_items, _later_days = _refetch_matches(client, family_id, "2026-12")
        assert _amounts(later_items, "2026-12-15", "Holt Paycheck") == [Decimal("4805.35")]


def test_only_this_occurrence_heals_pre_damaged_same_day_twin():
    """A later Only-this edit must clear a leftover series-template twin on that day.

    Pre-fix damage: Nov 15 already overridden to $5,000 while a moved Nov 30→15
    copy still sits at the series $4,800. A further Only-this amount edit used to
    keep both rows because absorb only matched the edited row's previous identity.
    """
    with TestClient(app) as client:
        family_id, account_id = _family(client, "bw-smoke-integrity-heal-twin@example.com")
        series_id = _series(
            client,
            family_id,
            account_id,
            kind="expense",
            amount="4800.00",
            description="Mortgage",
            start="2026-11-15",
            recurrence="twice_monthly",
            second_day_of_month=30,
        )
        # Simulate pre-fix damage via DB (bypass absorb): Nov 15 at $5,000 plus a
        # moved Nov 30→15 twin still at the series $4,800.
        with SessionLocal() as db:
            db.add(
                ExpectedTransactionOverride(
                    expected_transaction_id=series_id,
                    occurrence_date=date(2026, 11, 15),
                    cancelled=False,
                    account_id=account_id,
                    kind=TransactionKind.expense,
                    amount=Decimal("5000.00"),
                    description="Mortgage",
                )
            )
            db.add(
                ExpectedTransactionOverride(
                    expected_transaction_id=series_id,
                    occurrence_date=date(2026, 11, 30),
                    cancelled=False,
                    account_id=account_id,
                    kind=TransactionKind.expense,
                    amount=Decimal("4800.00"),
                    description="Mortgage",
                    moved_to_date=date(2026, 11, 15),
                )
            )
            db.commit()

        damaged_items, damaged_days = _forecast(client, family_id, "2026-11")
        assert _amounts(damaged_items, "2026-11-15", "Mortgage") == [
            Decimal("4800.00"),
            Decimal("5000.00"),
        ]
        assert _money(damaged_days["2026-11-15"]["tx_net"]) == Decimal("-9800.00")

        _override(
            client,
            family_id,
            series_id,
            "2026-11-15",
            account_id=account_id,
            kind="expense",
            amount="5100.00",
            description="Mortgage",
        )

        items, days = _refetch_matches(client, family_id, "2026-11")
        on_day = _on(items, "2026-11-15", "Mortgage")
        assert len(on_day) == 1, on_day
        assert _amounts(items, "2026-11-15", "Mortgage") == [Decimal("5100.00")]
        assert Decimal("4800.00") not in _amounts(items, "2026-11-15", "Mortgage")
        assert _money(days["2026-11-15"]["tx_net"]) == Decimal("-5100.00")
        assert _on(items, "2026-11-30", "Mortgage") == []


def test_only_this_occurrence_twice_monthly_amount_edit_updates_in_place():
    """Twice-monthly Only this occurrence amount edit must not leave old + new on that day."""
    with TestClient(app) as client:
        family_id, account_id = _family(client, "bw-smoke-integrity-twice-mo@example.com")
        series_id = _series(
            client,
            family_id,
            account_id,
            kind="expense",
            amount="4800.00",
            description="Mortgage",
            start="2026-11-15",
            recurrence="twice_monthly",
            second_day_of_month=30,
        )
        _override(
            client,
            family_id,
            series_id,
            "2026-11-15",
            account_id=account_id,
            kind="expense",
            amount="5000.00",
            description="Mortgage",
        )

        items, days = _refetch_matches(client, family_id, "2026-11")
        on_day = _on(items, "2026-11-15", "Mortgage")
        assert len(on_day) == 1, on_day
        assert _amounts(items, "2026-11-15", "Mortgage") == [Decimal("5000.00")]
        assert Decimal("4800.00") not in _amounts(items, "2026-11-15", "Mortgage")
        assert _money(days["2026-11-15"]["tx_net"]) == Decimal("-5000.00")
        # The other twice-monthly date keeps the series amount.
        assert _amounts(items, "2026-11-30", "Mortgage") == [Decimal("4800.00")]
        later_items, _later_days = _refetch_matches(client, family_id, "2026-12")
        assert _amounts(later_items, "2026-12-15", "Mortgage") == [Decimal("4800.00")]
        assert _amounts(later_items, "2026-12-30", "Mortgage") == [Decimal("4800.00")]


def test_series_amount_edit_updates_future_dates_without_a_second_payment():
    with TestClient(app) as client:
        family_id, account_id = _family(client, "bw-smoke-integrity-series@example.com")
        paycheck = _series(
            client, family_id, account_id, kind="income", amount="3000.00", description="Paycheck", start="2026-10-15"
        )
        mortgage = _series(
            client, family_id, account_id, kind="expense", amount="1000.00", description="Mortgage", start="2026-10-15"
        )
        applied = client.post(
            f"/api/families/{family_id}/expected-transactions/{paycheck}/apply-from-occurrence/2026-11-15",
            json={
                "account_id": account_id,
                "kind": "income",
                "amount": "3200.00",
                "description": "Paycheck",
                "recurrence": "monthly",
            },
        )
        assert applied.status_code == 200, applied.text

        october_items, october_days = _refetch_matches(client, family_id, "2026-10")
        assert _amounts(october_items, "2026-10-15", "Paycheck") == [Decimal("3000.00")]
        assert _amounts(october_items, "2026-10-15", "Mortgage") == [Decimal("1000.00")]
        assert _money(october_days["2026-10-15"]["tx_net"]) == Decimal("2000.00")

        november_items, november_days = _refetch_matches(client, family_id, "2026-11")
        assert _amounts(november_items, "2026-11-15", "Paycheck") == [Decimal("3200.00")]
        assert _amounts(november_items, "2026-11-15", "Mortgage") == [Decimal("1000.00")]
        assert _money(november_days["2026-11-15"]["tx_net"]) == Decimal("2200.00")

        december_items, _december_days = _refetch_matches(client, family_id, "2026-12")
        assert _amounts(december_items, "2026-12-15", "Paycheck") == [Decimal("3200.00")]
        assert _amounts(december_items, "2026-12-15", "Mortgage") == [Decimal("1000.00")]
        assert mortgage


def test_deleting_one_occurrence_leaves_the_other_dates():
    with TestClient(app) as client:
        family_id, account_id = _family(client, "bw-smoke-integrity-skip@example.com")
        paycheck = _series(
            client, family_id, account_id, kind="income", amount="3000.00", description="Paycheck", start="2026-10-15"
        )
        _series(
            client, family_id, account_id, kind="expense", amount="1000.00", description="Mortgage", start="2026-10-15"
        )
        skipped = client.post(
            f"/api/families/{family_id}/expected-transactions/{paycheck}/instances/2026-11-15",
            json={"action": "cancel"},
        )
        assert skipped.status_code == 200, skipped.text

        october_items, _october_days = _refetch_matches(client, family_id, "2026-10")
        assert _amounts(october_items, "2026-10-15", "Paycheck") == [Decimal("3000.00")]
        november_items, november_days = _refetch_matches(client, family_id, "2026-11")
        assert _amounts(november_items, "2026-11-15", "Paycheck") == []
        assert _amounts(november_items, "2026-11-15", "Mortgage") == [Decimal("1000.00")]
        assert _money(november_days["2026-11-15"]["tx_net"]) == Decimal("-1000.00")
        december_items, _december_days = _refetch_matches(client, family_id, "2026-12")
        assert _amounts(december_items, "2026-12-15", "Paycheck") == [Decimal("3000.00")]


def test_deleting_this_date_forward_keeps_earlier_dates_and_the_other_series():
    with TestClient(app) as client:
        family_id, account_id = _family(client, "bw-smoke-integrity-end@example.com")
        paycheck = _series(
            client, family_id, account_id, kind="income", amount="3000.00", description="Paycheck", start="2026-10-15"
        )
        _series(
            client, family_id, account_id, kind="expense", amount="1000.00", description="Mortgage", start="2026-10-15"
        )
        ended = client.post(
            f"/api/families/{family_id}/expected-transactions/{paycheck}/end-from-occurrence/2026-11-15"
        )
        assert ended.status_code == 200, ended.text

        october_items, october_days = _refetch_matches(client, family_id, "2026-10")
        assert _amounts(october_items, "2026-10-15", "Paycheck") == [Decimal("3000.00")]
        assert _money(october_days["2026-10-15"]["tx_net"]) == Decimal("2000.00")
        november_items, november_days = _refetch_matches(client, family_id, "2026-11")
        assert _amounts(november_items, "2026-11-15", "Paycheck") == []
        assert _amounts(november_items, "2026-11-15", "Mortgage") == [Decimal("1000.00")]
        assert _money(november_days["2026-11-15"]["tx_net"]) == Decimal("-1000.00")
        december_items, _december_days = _refetch_matches(client, family_id, "2026-12")
        assert _amounts(december_items, "2026-12-15", "Paycheck") == []
        assert _amounts(december_items, "2026-12-15", "Mortgage") == [Decimal("1000.00")]


def test_deleting_one_series_does_not_remove_the_other():
    with TestClient(app) as client:
        family_id, account_id = _family(client, "bw-smoke-integrity-drop@example.com")
        paycheck = _series(
            client, family_id, account_id, kind="income", amount="3000.00", description="Paycheck", start="2026-11-15"
        )
        _series(
            client, family_id, account_id, kind="expense", amount="1000.00", description="Mortgage", start="2026-11-15"
        )
        deleted = client.delete(f"/api/families/{family_id}/expected-transactions/{paycheck}")
        assert deleted.status_code == 200, deleted.text

        items, days = _refetch_matches(client, family_id, "2026-11")
        assert _amounts(items, "2026-11-15", "Paycheck") == []
        assert _amounts(items, "2026-11-15", "Mortgage") == [Decimal("1000.00")]
        assert _money(days["2026-11-15"]["tx_net"]) == Decimal("-1000.00")
        later_items, later_days = _refetch_matches(client, family_id, "2026-12")
        assert _amounts(later_items, "2026-12-15", "Paycheck") == []
        assert _amounts(later_items, "2026-12-15", "Mortgage") == [Decimal("1000.00")]
        assert _money(later_days["2026-12-15"]["tx_net"]) == Decimal("-1000.00")


@pytest.mark.parametrize(
    ("kind", "description", "email", "moved_net", "later_end"),
    [
        ("income", "Paycheck", "bw-smoke-integrity-move-in@example.com", "3000.00", "16000.00"),
        ("expense", "Mortgage", "bw-smoke-integrity-move-out@example.com", "-3000.00", "4000.00"),
    ],
)
def test_moving_one_occurrence_removes_it_from_the_old_date(kind, description, email, moved_net, later_end):
    with TestClient(app) as client:
        family_id, account_id = _family(client, email)
        series_id = _series(
            client,
            family_id,
            account_id,
            kind=kind,
            amount="3000.00",
            description=description,
            start="2026-11-15",
        )
        _override(
            client,
            family_id,
            series_id,
            "2026-11-15",
            account_id=account_id,
            kind=kind,
            amount="3000.00",
            description=description,
            moved_to_date="2026-11-20",
        )

        items, days = _refetch_matches(client, family_id, "2026-11")
        assert _amounts(items, "2026-11-15", description) == []
        assert _amounts(items, "2026-11-20", description) == [Decimal("3000.00")]
        assert _money(days["2026-11-15"]["tx_net"]) == Decimal("0.00")
        assert _money(days["2026-11-20"]["tx_net"]) == Decimal(moved_net)
        later_items, later_days = _refetch_matches(client, family_id, "2026-12")
        assert _amounts(later_items, "2026-12-15", description) == [Decimal("3000.00")]
        assert _amounts(later_items, "2026-12-20", description) == []
        assert _money(later_days["2026-12-15"]["end"]) == Decimal(later_end)


def test_posted_actual_matching_the_expected_payment_is_not_counted_twice():
    with TestClient(app) as client:
        family_id, account_id = _family(client, "bw-smoke-integrity-actual@example.com")
        _series(
            client, family_id, account_id, kind="income", amount="3000.00", description="Paycheck", start="2026-11-15"
        )
        _series(
            client, family_id, account_id, kind="expense", amount="1000.00", description="Mortgage", start="2026-11-15"
        )
        posted = client.post(
            f"/api/families/{family_id}/transactions",
            json={"date": "2026-11-15", "kind": "income", "amount": "3000.00", "description": "Paycheck"},
        )
        assert posted.status_code == 200, posted.text
        posted_bill = client.post(
            f"/api/families/{family_id}/transactions",
            json={"date": "2026-11-15", "kind": "expense", "amount": "1000.00", "description": "Mortgage"},
        )
        assert posted_bill.status_code == 200, posted_bill.text

        _items, days = _refetch_matches(client, family_id, "2026-11")
        assert _money(days["2026-11-15"]["tx_net"]) == Decimal("2000.00")
        assert _money(days["2026-11-15"]["end"]) == Decimal("12000.00")


def test_balance_adjustment_does_not_add_the_paycheck_again():
    with TestClient(app) as client:
        family_id, account_id = _family(client, "bw-smoke-integrity-adjust@example.com")
        _series(
            client, family_id, account_id, kind="income", amount="3000.00", description="Paycheck", start="2026-11-15"
        )
        _series(
            client, family_id, account_id, kind="expense", amount="1000.00", description="Mortgage", start="2026-11-15"
        )
        adjusted = client.post(
            f"/api/families/{family_id}/verified-balances",
            json={"date": "2026-11-15", "amount": "9000.00"},
        )
        assert adjusted.status_code == 200, adjusted.text
        again = client.post(
            f"/api/families/{family_id}/verified-balances",
            json={"date": "2026-11-15", "amount": "9100.00"},
        )
        assert again.status_code == 200, again.text

        items, days = _refetch_matches(client, family_id, "2026-11")
        assert _amounts(items, "2026-11-15", "Paycheck") == [Decimal("3000.00")]
        assert _amounts(items, "2026-11-15", "Mortgage") == [Decimal("1000.00")]
        assert _money(days["2026-11-15"]["tx_net"]) == Decimal("2000.00")
        assert _money(days["2026-11-15"]["end"]) == Decimal("9100.00")
        assert _money(days["2026-11-16"]["end"]) == Decimal("9100.00")
        assert _money(days["2026-11-16"]["tx_net"]) == Decimal("0.00")
