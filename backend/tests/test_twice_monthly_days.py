"""Twice-monthly days stay independent of the month being generated.

The safe environment is set before the app is imported. This test does not
call Stripe or send email, and it uses a disposable local database.
"""

from __future__ import annotations

import sys
import uuid
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "e2e"))

from smoke_guard import (  # noqa: E402
    apply_safe_environment,
    assert_loaded_settings,
    assert_process_is_safe,
    smoke_db_path,
)

_DB = smoke_db_path("balancewhiz-smoke-twice-monthly.db")
_DB.parent.mkdir(parents=True, exist_ok=True)
for _extra in (_DB, Path(str(_DB) + "-wal"), Path(str(_DB) + "-shm")):
    if _extra.exists():
        _extra.unlink()

apply_safe_environment(_DB)
assert_process_is_safe(_DB)

sys.path.insert(0, str(ROOT / "backend"))
from app.main import (  # noqa: E402
    Recurrence,
    _expected_occurrences_in_range,
    _iter_twice_monthly_occurrences,
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


def _month_dates(start: date, second_day: int, year: int, month: int) -> list[date]:
    begin = date(year, month, 1)
    end = date(year + 1, 1, 1) if month == 12 else date(year, month + 1, 1)
    return [
        d
        for d in _iter_twice_monthly_occurrences(start, None, start.day, second_day)
        if begin <= d < end
    ]


def test_february_clamps_30_and_31_without_a_duplicate_and_without_rewriting_inputs():
    """Occurrence generation clamps. The day arguments themselves are not written back."""
    start_30 = date(2026, 1, 30)
    feb_30 = _month_dates(start_30, 15, 2026, 2)
    assert feb_30 == [date(2026, 2, 15), date(2026, 2, 28)]
    assert start_30.day == 30

    start_31 = date(2026, 1, 15)
    feb_31 = _month_dates(start_31, 31, 2026, 2)
    assert feb_31 == [date(2026, 2, 15), date(2026, 2, 28)]

    april = _month_dates(start_31, 31, 2026, 4)
    september = _month_dates(start_31, 31, 2026, 9)
    november = _month_dates(start_31, 31, 2026, 11)
    assert april == [date(2026, 4, 15), date(2026, 4, 30)]
    assert september == [date(2026, 9, 15), date(2026, 9, 30)]
    assert november == [date(2026, 11, 15), date(2026, 11, 30)]

    both_clamp = _month_dates(date(2026, 1, 31), 30, 2026, 2)
    assert both_clamp == [date(2026, 2, 28)]


def _family(client):
    email = f"bw-smoke-twice{uuid.uuid4().hex[:8]}@example.com"
    created = client.post(
        "/api/auth/register",
        json={"email": email, "password": "SmokeOnly1!", "first_name": "Smoke", "last_name": "Twice"},
    )
    assert created.status_code == 201, created.text
    families = client.get("/api/families")
    assert families.status_code == 200, families.text
    family_id = families.json()[0]["id"]
    account = client.post(
        f"/api/families/{family_id}/accounts",
        json={
            "name": "Checking",
            "type": "checking",
            "starting_balance": "1000.00",
            "starting_balance_date": "2026-01-01",
        },
    )
    assert account.status_code == 200, account.text
    return family_id, account.json()["id"]


def _create(client, family_id, account_id, start: str, second: int, description: str, amount: str = "100.00"):
    created = client.post(
        f"/api/families/{family_id}/expected-transactions",
        json={
            "account_id": account_id,
            "start_date": start,
            "recurrence": "twice_monthly",
            "second_day_of_month": second,
            "kind": "income",
            "amount": amount,
            "description": description,
        },
    )
    assert created.status_code == 200, created.text
    return created.json()


def _rule_days(row):
    start_day = int(row["start_date"][8:10])
    first = row.get("day_of_month")
    rule_day = int(first) if first is not None else start_day
    second = row.get("second_day_of_month")
    return rule_day, (None if second is None else int(second))


def _stored(client, family_id, series_id):
    listed = client.get(f"/api/families/{family_id}/expected-transactions")
    assert listed.status_code == 200, listed.text
    row = next(item for item in listed.json() if item["id"] == series_id)
    return (*_rule_days(row), row)


def _occurrences(recurrence, start: date, until: date, *, day_of_month=None, second=None, second_month=None):
    return _expected_occurrences_in_range(
        start_date=start,
        end_date=None,
        recurrence=recurrence,
        range_start=start,
        range_end_exclusive=until,
        second_day_of_month=second,
        second_occurrence_month=second_month,
        day_of_month=day_of_month,
    )


def test_api_saves_and_reloads_15_30_1_15_and_15_31():
    with TestClient(app) as client:
        family_id, account_id = _family(client)
        pairs = (
            ("2026-03-15", 30, "Fifteen Thirty"),
            ("2026-03-01", 15, "First Fifteenth"),
            ("2026-03-15", 31, "Fifteen Last"),
        )
        for start, second, name in pairs:
            row = _create(client, family_id, account_id, start, second, name)
            assert _rule_days(row) == (int(start[8:10]), second)
            assert _stored(client, family_id, row["id"])[:2] == (int(start[8:10]), second)


def test_calendar_for_short_months_does_not_rewrite_a_31st_rule():
    with TestClient(app) as client:
        family_id, account_id = _family(client)
        row = _create(client, family_id, account_id, "2026-01-15", 31, "Stays Thirty One")
        series_id = row["id"]
        expected = {
            "2026-02": ["2026-02-15", "2026-02-28"],
            "2026-04": ["2026-04-15", "2026-04-30"],
            "2026-09": ["2026-09-15", "2026-09-30"],
            "2026-11": ["2026-11-15", "2026-11-30"],
        }
        for month, dates in expected.items():
            calendar = client.get(
                f"/api/families/{family_id}/expected-calendar",
                params={"month": month},
            )
            assert calendar.status_code == 200, calendar.text
            got = sorted(
                item["date"]
                for item in calendar.json()["items"]
                if item["expected_transaction_id"] == series_id
            )
            assert got == dates
            assert _stored(client, family_id, series_id)[:2] == (15, 31)

        also = _create(client, family_id, account_id, "2026-01-30", 15, "Thirty And Fifteen", amount="200.00")
        february = client.get(
            f"/api/families/{family_id}/expected-calendar",
            params={"month": "2026-02"},
        )
        assert february.status_code == 200, february.text
        got = sorted(
            item["date"]
            for item in february.json()["items"]
            if item["expected_transaction_id"] == also["id"]
        )
        assert got == ["2026-02-15", "2026-02-28"]
        assert _stored(client, family_id, also["id"])[:2] == (30, 15)


def test_month_end_clamping_is_stateless_for_monthly_twice_monthly_quarterly_and_yearly():
    assert _occurrences(Recurrence.monthly, date(2026, 1, 31), date(2026, 5, 1)) == [
        date(2026, 1, 31),
        date(2026, 2, 28),
        date(2026, 3, 31),
        date(2026, 4, 30),
    ]
    assert _occurrences(Recurrence.monthly, date(2024, 1, 31), date(2024, 5, 1)) == [
        date(2024, 1, 31),
        date(2024, 2, 29),
        date(2024, 3, 31),
        date(2024, 4, 30),
    ]
    assert _occurrences(Recurrence.monthly, date(2026, 1, 30), date(2026, 5, 1)) == [
        date(2026, 1, 30),
        date(2026, 2, 28),
        date(2026, 3, 30),
        date(2026, 4, 30),
    ]
    assert _occurrences(Recurrence.monthly, date(2024, 1, 29), date(2024, 5, 1)) == [
        date(2024, 1, 29),
        date(2024, 2, 29),
        date(2024, 3, 29),
        date(2024, 4, 29),
    ]
    assert _occurrences(Recurrence.monthly, date(2026, 1, 29), date(2026, 5, 1)) == [
        date(2026, 1, 29),
        date(2026, 2, 28),
        date(2026, 3, 29),
        date(2026, 4, 29),
    ]
    # A series that became effective on the clamped February date still means the 31st.
    assert _occurrences(
        Recurrence.monthly, date(2026, 2, 28), date(2026, 6, 1), day_of_month=31
    ) == [
        date(2026, 2, 28),
        date(2026, 3, 31),
        date(2026, 4, 30),
        date(2026, 5, 31),
    ]
    assert _occurrences(
        Recurrence.twice_monthly, date(2026, 1, 15), date(2026, 5, 1), second=31
    ) == [
        date(2026, 1, 15),
        date(2026, 1, 31),
        date(2026, 2, 15),
        date(2026, 2, 28),
        date(2026, 3, 15),
        date(2026, 3, 31),
        date(2026, 4, 15),
        date(2026, 4, 30),
    ]
    assert _occurrences(
        Recurrence.twice_monthly, date(2026, 1, 30), date(2026, 5, 1), second=15
    ) == [
        date(2026, 1, 30),
        date(2026, 2, 15),
        date(2026, 2, 28),
        date(2026, 3, 15),
        date(2026, 3, 30),
        date(2026, 4, 15),
        date(2026, 4, 30),
    ]
    assert _occurrences(Recurrence.quarterly, date(2026, 1, 31), date(2027, 2, 1)) == [
        date(2026, 1, 31),
        date(2026, 4, 30),
        date(2026, 7, 31),
        date(2026, 10, 31),
        date(2027, 1, 31),
    ]
    assert _occurrences(Recurrence.yearly, date(2024, 2, 29), date(2029, 3, 1)) == [
        date(2024, 2, 29),
        date(2025, 2, 28),
        date(2026, 2, 28),
        date(2027, 2, 28),
        date(2028, 2, 29),
        date(2029, 2, 28),
    ]


def _apply(client, family_id, series_id, occurrence, body):
    saved = client.post(
        f"/api/families/{family_id}/expected-transactions/{series_id}/apply-from-occurrence/{occurrence}",
        json=body,
    )
    assert saved.status_code == 200, saved.text
    return saved.json()


def _series_body(account_id, **extra):
    body = {
        "account_id": account_id,
        "kind": "income",
        "amount": "100.00",
        "description": "Rule",
        "recurrence": "monthly",
    }
    body.update(extra)
    return body


def _calendar_dates(client, family_id, series_id, month):
    calendar = client.get(f"/api/families/{family_id}/expected-calendar", params={"month": month})
    assert calendar.status_code == 200, calendar.text
    return sorted(
        item["date"] for item in calendar.json()["items"] if item["expected_transaction_id"] == series_id
    )


def test_non_schedule_edits_from_a_clamped_occurrence_keep_the_recurrence_rule():
    with TestClient(app) as client:
        family_id, account_id = _family(client)
        twice = _create(client, family_id, account_id, "2026-01-15", 31, "Fifteen Thirty One")
        saved = _apply(
            client,
            family_id,
            twice["id"],
            "2026-02-28",
            _series_body(
                account_id,
                recurrence="twice_monthly",
                second_day_of_month=31,
                notes="February save",
                description="Fifteen Thirty One",
            ),
        )
        future = _stored(client, family_id, saved["future_series_id"])
        assert future[:2] == (15, 31)
        assert future[2]["notes"] == "February save"
        assert _calendar_dates(client, family_id, saved["future_series_id"], "2026-03") == [
            "2026-03-15",
            "2026-03-31",
        ]

        thirty = _create(client, family_id, account_id, "2026-01-30", 15, "Thirty Fifteen", amount="80.00")
        saved = _apply(
            client,
            family_id,
            thirty["id"],
            "2026-02-28",
            _series_body(
                account_id,
                amount="250.00",
                recurrence="twice_monthly",
                second_day_of_month=15,
                description="Thirty Fifteen",
            ),
        )
        future = _stored(client, family_id, saved["future_series_id"])
        assert future[:2] == (30, 15)
        assert float(future[2]["amount"]) == 250.0
        assert _calendar_dates(client, family_id, saved["future_series_id"], "2026-03") == [
            "2026-03-15",
            "2026-03-30",
        ]

        monthly = client.post(
            f"/api/families/{family_id}/expected-transactions",
            json=_series_body(account_id, start_date="2026-01-31", description="Month Thirty One", amount="40.00"),
        )
        assert monthly.status_code == 200, monthly.text
        saved = _apply(
            client,
            family_id,
            monthly.json()["id"],
            "2026-02-28",
            _series_body(account_id, notes="Still the 31st", description="Month Thirty One", amount="40.00"),
        )
        future = _stored(client, family_id, saved["future_series_id"])
        assert future[:2] == (31, None)
        assert _calendar_dates(client, family_id, saved["future_series_id"], "2026-03") == ["2026-03-31"]
        assert _calendar_dates(client, family_id, saved["future_series_id"], "2026-04") == ["2026-04-30"]

        categories = client.get(f"/api/families/{family_id}/categories")
        assert categories.status_code == 200, categories.text
        category_id = categories.json()[0]["id"]
        thirtieth = client.post(
            f"/api/families/{family_id}/expected-transactions",
            json=_series_body(account_id, start_date="2026-01-30", description="Month Thirty", amount="40.00"),
        )
        assert thirtieth.status_code == 200, thirtieth.text
        saved = _apply(
            client,
            family_id,
            thirtieth.json()["id"],
            "2026-02-28",
            _series_body(
                account_id,
                description="Month Thirty",
                amount="40.00",
                category_id=category_id,
            ),
        )
        future = _stored(client, family_id, saved["future_series_id"])
        assert future[:2] == (30, None)
        assert future[2]["category_id"] == category_id
        assert _calendar_dates(client, family_id, saved["future_series_id"], "2026-03") == ["2026-03-30"]


def test_explicit_schedule_edits_change_only_the_edited_recurrence_day():
    with TestClient(app) as client:
        family_id, account_id = _family(client)
        series = _create(client, family_id, account_id, "2026-01-15", 31, "Editable")
        first = _apply(
            client,
            family_id,
            series["id"],
            "2026-03-15",
            _series_body(
                account_id,
                recurrence="twice_monthly",
                second_day_of_month=31,
                description="Editable",
                effective_start_date="2026-03-10",
            ),
        )
        assert _stored(client, family_id, first["future_series_id"])[:2] == (10, 31)

        second_series = _create(client, family_id, account_id, "2026-01-15", 31, "Second Editable", amount="60.00")
        second = _apply(
            client,
            family_id,
            second_series["id"],
            "2026-03-15",
            _series_body(
                account_id,
                amount="60.00",
                recurrence="twice_monthly",
                second_day_of_month=20,
                description="Second Editable",
            ),
        )
        assert _stored(client, family_id, second["future_series_id"])[:2] == (15, 20)
        assert _calendar_dates(client, family_id, second["future_series_id"], "2026-04") == [
            "2026-04-15",
            "2026-04-20",
        ]


def test_this_occurrence_only_and_unchanged_save_do_not_rewrite_the_rule():
    with TestClient(app) as client:
        family_id, account_id = _family(client)
        series = _create(client, family_id, account_id, "2026-01-15", 31, "Parent Rule")
        only = client.post(
            f"/api/families/{family_id}/expected-transactions/{series['id']}/instances/2026-02-28",
            json={"action": "update", "account_id": account_id, "kind": "income", "amount": "250.00", "description": "Parent Rule"},
        )
        assert only.status_code == 200, only.text
        parent = _stored(client, family_id, series["id"])
        assert parent[:2] == (15, 31)
        assert float(parent[2]["amount"]) == 100.0
        february = client.get(f"/api/families/{family_id}/expected-calendar", params={"month": "2026-02"})
        feb_28 = next(item for item in february.json()["items"] if item["date"] == "2026-02-28")
        assert float(feb_28["amount"]) == 250.0
        march = _calendar_dates(client, family_id, series["id"], "2026-03")
        assert march == ["2026-03-15", "2026-03-31"]

        untouched = _apply(
            client,
            family_id,
            series["id"],
            "2026-02-28",
            _series_body(
                account_id,
                recurrence="twice_monthly",
                second_day_of_month=31,
                description="Parent Rule",
            ),
        )
        assert _stored(client, family_id, untouched["future_series_id"])[:2] == (15, 31)
        assert _calendar_dates(client, family_id, untouched["future_series_id"], "2026-03") == [
            "2026-03-15",
            "2026-03-31",
        ]
