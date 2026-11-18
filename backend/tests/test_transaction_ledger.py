"""All-time transaction ledger: search, overrides, pagination.

Safe smoke DB only — no Stripe/email.
"""

from __future__ import annotations

import sys
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "e2e"))

from smoke_guard import (  # noqa: E402
    apply_safe_environment,
    assert_loaded_settings,
    assert_process_is_safe,
    smoke_db_path,
)
from verified_signup import signup_verified  # noqa: E402

_DB = smoke_db_path("balancewhiz-smoke-tx-ledger.db")
_DB.parent.mkdir(parents=True, exist_ok=True)
for _extra in (_DB, Path(str(_DB) + "-wal"), Path(str(_DB) + "-shm")):
    if _extra.exists():
        _extra.unlink()

apply_safe_environment(_DB)
assert_process_is_safe(_DB)

sys.path.insert(0, str(ROOT / "backend"))
from app.main import OPEN_SERIES_FORWARD_YEARS, app, settings  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

assert_loaded_settings(
    database_url=settings.DATABASE_URL,
    env=settings.ENV,
    stripe_key=settings.STRIPE_SECRET_KEY,
    resend_key=settings.RESEND_API_KEY,
    smtp_host=settings.CONTACT_SMTP_HOST,
    db_filename=_DB.name,
)


def _signup(client, email: str):
    created = signup_verified(
        client,
        email=email,
        password="SmokeOnly1!",
        first_name="Ledger",
        last_name="Test",
    )
    assert created.status_code == 200, created.text
    families = client.get("/api/families")
    assert families.status_code == 200, families.text
    family_id = families.json()[0]["id"]
    return family_id


def _account(client, family_id: int, start: str = "2020-01-01"):
    account = client.post(
        f"/api/families/{family_id}/accounts",
        json={
            "name": "Checking",
            "type": "checking",
            "starting_balance": "1000.00",
            "starting_balance_date": start,
        },
    )
    assert account.status_code == 200, account.text
    return account.json()["id"]


def test_ledger_all_time_search_finds_old_posted_and_recurring():
    with TestClient(app) as client:
        family_id = _signup(client, "bw-ledger-alltime@example.com")
        account_id = _account(client, family_id, "2020-01-01")

        old = client.post(
            f"/api/families/{family_id}/transactions",
            json={
                "date": "2020-02-15",
                "kind": "expense",
                "amount": "42.50",
                "description": "Ancient Widget",
                "notes": "deep history note",
            },
        )
        assert old.status_code == 200, old.text

        series = client.post(
            f"/api/families/{family_id}/expected-transactions",
            json={
                "account_id": account_id,
                "start_date": "2020-01-10",
                "recurrence": "yearly",
                "kind": "expense",
                "amount": "99.00",
                "description": "Annual Dues Unique",
            },
        )
        assert series.status_code == 200, series.text

        by_desc = client.get(
            f"/api/families/{family_id}/transaction-ledger",
            params={"q": "Ancient Widget", "when": "all", "limit": 20},
        )
        assert by_desc.status_code == 200, by_desc.text
        body = by_desc.json()
        assert body["history_start"] == "2020-01-01"
        assert body["open_series_horizon_years"] == OPEN_SERIES_FORWARD_YEARS
        assert any(i["description"] == "Ancient Widget" and i["row_type"] == "actual" for i in body["items"])

        by_notes = client.get(
            f"/api/families/{family_id}/transaction-ledger",
            params={"q": "deep history", "when": "past", "limit": 20},
        )
        assert by_notes.status_code == 200, by_notes.text
        assert any(i["description"] == "Ancient Widget" for i in by_notes.json()["items"])

        by_amt = client.get(
            f"/api/families/{family_id}/transaction-ledger",
            params={"q": "42.50", "when": "all", "limit": 20},
        )
        assert by_amt.status_code == 200, by_amt.text
        assert any(i["description"] == "Ancient Widget" for i in by_amt.json()["items"])

        dues = client.get(
            f"/api/families/{family_id}/transaction-ledger",
            params={"q": "Annual Dues Unique", "when": "all", "limit": 50},
        )
        assert dues.status_code == 200, dues.text
        dues_items = [i for i in dues.json()["items"] if i["description"] == "Annual Dues Unique"]
        assert any(i["date"].startswith("2020-") for i in dues_items), dues_items
        assert all(i["row_type"] == "expected" for i in dues_items)


def test_ledger_recurring_override_move_and_cancel_no_duplicate():
    with TestClient(app) as client:
        family_id = _signup(client, "bw-ledger-override@example.com")
        account_id = _account(client, family_id, "2024-01-01")

        series = client.post(
            f"/api/families/{family_id}/expected-transactions",
            json={
                "account_id": account_id,
                "start_date": "2024-01-05",
                "recurrence": "monthly",
                "kind": "expense",
                "amount": "25.00",
                "description": "Override Rent",
            },
        )
        assert series.status_code == 200, series.text
        sid = series.json()["id"]

        moved = client.post(
            f"/api/families/{family_id}/expected-transactions/{sid}/instances/2024-03-05",
            json={
                "action": "update",
                "moved_to_date": "2024-03-12",
                "account_id": account_id,
                "kind": "expense",
                "amount": "30.00",
            },
        )
        assert moved.status_code == 200, moved.text

        cancelled = client.post(
            f"/api/families/{family_id}/expected-transactions/{sid}/instances/2024-04-05",
            json={"action": "cancel"},
        )
        assert cancelled.status_code == 200, cancelled.text

        res = client.get(
            f"/api/families/{family_id}/transaction-ledger",
            params={"q": "Override Rent", "when": "past", "limit": 100},
        )
        assert res.status_code == 200, res.text
        items = res.json()["items"]
        march = [i for i in items if i["date"].startswith("2024-03-")]
        assert len(march) == 1, march
        assert march[0]["date"] == "2024-03-12"
        assert float(march[0]["amount"]) == 30.0
        assert march[0]["occurrence_date"] == "2024-03-05"
        assert not any(i["date"] == "2024-03-05" for i in items)
        assert not any(i["date"] == "2024-04-05" for i in items)


def test_ledger_pagination_partitions_without_gaps_or_dupes():
    with TestClient(app) as client:
        family_id = _signup(client, "bw-ledger-pages@example.com")
        account_id = _account(client, family_id, "2023-01-01")

        for i in range(12):
            day = date(2023, 1, 1) + timedelta(days=i * 3)
            r = client.post(
                f"/api/families/{family_id}/transactions",
                json={
                    "date": day.isoformat(),
                    "kind": "expense",
                    "amount": f"{10 + i}.00",
                    "description": f"PageItem {i}",
                },
            )
            assert r.status_code == 200, r.text

        page1 = client.get(
            f"/api/families/{family_id}/transaction-ledger",
            params={"q": "PageItem", "when": "past", "limit": 5},
        )
        assert page1.status_code == 200, page1.text
        body1 = page1.json()
        assert len(body1["items"]) == 5
        assert body1["next_cursor"]

        page2 = client.get(
            f"/api/families/{family_id}/transaction-ledger",
            params={"q": "PageItem", "when": "past", "limit": 5, "cursor": body1["next_cursor"]},
        )
        assert page2.status_code == 200, page2.text
        body2 = page2.json()
        assert len(body2["items"]) == 5

        page3 = client.get(
            f"/api/families/{family_id}/transaction-ledger",
            params={"q": "PageItem", "when": "past", "limit": 5, "cursor": body2["next_cursor"]},
        )
        assert page3.status_code == 200, page3.text
        body3 = page3.json()
        assert len(body3["items"]) == 2
        assert body3["next_cursor"] is None

        ids = [i["id"] for i in body1["items"] + body2["items"] + body3["items"]]
        assert len(ids) == 12
        assert len(set(ids)) == 12
        dates = [i["date"] for i in body1["items"] + body2["items"] + body3["items"]]
        assert dates == sorted(dates, reverse=True)


def test_ledger_distinguishes_planned_past_from_day_reconciled():
    with TestClient(app) as client:
        family_id = _signup(client, "bw-ledger-recon@example.com")
        account_id = _account(client, family_id, "2024-06-01")

        series = client.post(
            f"/api/families/{family_id}/expected-transactions",
            json={
                "account_id": account_id,
                "start_date": "2024-06-10",
                "recurrence": "monthly",
                "kind": "expense",
                "amount": "15.00",
                "description": "Planned Only Bill",
            },
        )
        assert series.status_code == 200, series.text

        recon = client.post(
            f"/api/families/{family_id}/reconciled-days",
            json={"date": "2024-07-10", "reconciled": True},
        )
        assert recon.status_code == 200, recon.text

        res = client.get(
            f"/api/families/{family_id}/transaction-ledger",
            params={"q": "Planned Only Bill", "when": "past", "limit": 50},
        )
        assert res.status_code == 200, res.text
        july = next(i for i in res.json()["items"] if i["date"] == "2024-07-10")
        assert july["row_type"] == "expected"
        assert july["day_reconciled"] is True
        # Still planned — day flag must not imply the occurrence was a posted payment.
        assert july["id"] is None


def test_ledger_horizon_metadata_caps_open_ended_future():
    with TestClient(app) as client:
        family_id = _signup(client, "bw-ledger-horizon@example.com")
        account_id = _account(client, family_id, "2025-01-01")
        series = client.post(
            f"/api/families/{family_id}/expected-transactions",
            json={
                "account_id": account_id,
                "start_date": "2025-01-02",
                "recurrence": "monthly",
                "kind": "expense",
                "amount": "8.00",
                "description": "Forever Tiny",
            },
        )
        assert series.status_code == 200, series.text

        res = client.get(
            f"/api/families/{family_id}/transaction-ledger",
            params={"q": "Forever Tiny", "when": "upcoming", "limit": 5},
        )
        assert res.status_code == 200, res.text
        body = res.json()
        today = date.fromisoformat(body["today"])
        horizon = date.fromisoformat(body["horizon_end"])
        assert horizon.year == today.year + OPEN_SERIES_FORWARD_YEARS
        assert body["next_cursor"]
        # Walk pages; no occurrence may land past horizon_end.
        cursor = body["next_cursor"]
        seen = 0
        for _ in range(40):
            page = client.get(
                f"/api/families/{family_id}/transaction-ledger",
                params={"q": "Forever Tiny", "when": "upcoming", "limit": 50, "cursor": cursor},
            )
            assert page.status_code == 200, page.text
            pj = page.json()
            for item in pj["items"]:
                assert item["date"] <= body["horizon_end"], item
                seen += 1
            cursor = pj["next_cursor"]
            if not cursor:
                break
        assert seen > 0
