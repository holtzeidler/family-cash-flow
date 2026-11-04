"""Unused categories are those with no transaction, series, or occurrence reference.

The count is not limited to the month on screen. Uses a disposable local database.
"""

from __future__ import annotations

import sys
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

_DB = smoke_db_path("balancewhiz-smoke-category-usage.db")
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


def _category_id(tree: dict, name: str) -> int:
    for group in tree["groups"]:
        for category in group["categories"]:
            if category["name"] == name:
                return int(category["id"])
    raise AssertionError(f"missing category {name}")


def test_usage_counts_one_time_future_and_recurring_references():
    with TestClient(app) as client:
        created = signup_verified(
            client,
            email="bw-smoke-category-usage@example.com",
            password="SmokeOnly1!",
            first_name="Smoke",
            last_name="Usage",
        )
        assert created.status_code == 200, created.text
        family_id = int(created.json()["family_id"])

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
        account_id = account.json()["id"]

        tree = client.get(f"/api/families/{family_id}/categories/tree")
        assert tree.status_code == 200, tree.text
        body = tree.json()
        paycheck = _category_id(body, "Paycheck")
        rent = _category_id(body, "Mortgage / Rent")
        utilities = _category_id(body, "Utilities")
        other = _category_id(body, "Other Expense")

        one_time = client.post(
            f"/api/families/{family_id}/transactions",
            json={
                "date": "2026-10-02",
                "kind": "expense",
                "amount": "40.00",
                "description": "Groceries",
                "category_id": utilities,
            },
        )
        assert one_time.status_code == 200, one_time.text

        future = client.post(
            f"/api/families/{family_id}/transactions",
            json={
                "date": "2027-03-15",
                "kind": "income",
                "amount": "25.00",
                "description": "Future paycheck",
                "category_id": paycheck,
            },
        )
        assert future.status_code == 200, future.text

        series = client.post(
            f"/api/families/{family_id}/expected-transactions",
            json={
                "account_id": account_id,
                "start_date": "2027-01-01",
                "recurrence": "monthly",
                "kind": "expense",
                "amount": "1200.00",
                "description": "Rent",
                "category_id": rent,
            },
        )
        assert series.status_code == 200, series.text

        usage = client.get(f"/api/families/{family_id}/categories/usage-summary")
        assert usage.status_code == 200, usage.text
        by_id = usage.json()["by_category_id"]
        assert str(utilities) in by_id
        assert str(paycheck) in by_id
        assert str(rent) in by_id
        assert str(other) not in by_id
