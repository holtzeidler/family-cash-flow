"""Optional custom names reuse the existing description column.

Unnamed records keep an empty description. Recurring overrides can rename
one occurrence without changing the rest of the series.
"""

from __future__ import annotations

import sys
import uuid
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

_DB = smoke_db_path("balancewhiz-smoke-tx-name.db")
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


def _family(client):
    email = f"bw-smoke-txname{uuid.uuid4().hex[:8]}@example.com"
    created = signup_verified(client, email=email, password="SmokeOnly1!", first_name="Name", last_name="Test")
    assert created.status_code == 200, created.text
    family_id = int(created.json()["family_id"])
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
    cats = client.get(f"/api/families/{family_id}/categories")
    assert cats.status_code == 200, cats.text
    category_id = cats.json()[0]["id"]
    return family_id, account.json()["id"], category_id


def test_named_unnamed_and_existing_transactions_round_trip():
    with TestClient(app) as client:
        family_id, _account_id, category_id = _family(client)

        named = client.post(
            f"/api/families/{family_id}/transactions",
            json={
                "date": "2026-03-01",
                "kind": "expense",
                "amount": "80.00",
                "description": "ComEd",
                "notes": "Account 4412",
                "category_id": category_id,
            },
        )
        assert named.status_code == 200, named.text
        assert named.json()["description"] == "ComEd"
        assert named.json()["notes"] == "Account 4412"
        assert named.json()["category_id"] == category_id

        unnamed = client.post(
            f"/api/families/{family_id}/transactions",
            json={
                "date": "2026-03-02",
                "kind": "expense",
                "amount": "40.00",
                "description": "",
                "category_id": category_id,
            },
        )
        assert unnamed.status_code == 200, unnamed.text
        assert unnamed.json()["description"] == ""
        assert unnamed.json()["notes"] is None

        listed = client.get(f"/api/families/{family_id}/transactions", params={"month": "2026-03"})
        assert listed.status_code == 200, listed.text
        by_id = {row["id"]: row for row in listed.json()["items"]}
        assert by_id[named.json()["id"]]["description"] == "ComEd"
        assert by_id[unnamed.json()["id"]]["description"] == ""

        updated = client.put(
            f"/api/families/{family_id}/transactions/{unnamed.json()['id']}",
            json={
                "date": "2026-03-02",
                "kind": "expense",
                "amount": "40.00",
                "description": "",
                "notes": "Still not a name",
                "category_id": category_id,
            },
        )
        assert updated.status_code == 200, updated.text
        assert updated.json()["description"] == ""
        assert updated.json()["notes"] == "Still not a name"


def test_recurring_custom_name_and_occurrence_override():
    with TestClient(app) as client:
        family_id, account_id, category_id = _family(client)
        series = client.post(
            f"/api/families/{family_id}/expected-transactions",
            json={
                "account_id": account_id,
                "start_date": "2026-03-01",
                "recurrence": "monthly",
                "kind": "expense",
                "amount": "120.00",
                "description": "Cell Phone",
                "category_id": category_id,
            },
        )
        assert series.status_code == 200, series.text
        series_id = series.json()["id"]
        assert series.json()["description"] == "Cell Phone"

        cal = client.get(f"/api/families/{family_id}/expected-calendar", params={"month": "2026-03"})
        assert cal.status_code == 200, cal.text
        march = [row for row in cal.json()["items"] if row["expected_transaction_id"] == series_id]
        assert march
        assert all(row["description"] == "Cell Phone" for row in march)

        occ = client.post(
            f"/api/families/{family_id}/expected-transactions/{series_id}/instances/2026-04-01",
            json={
                "action": "update",
                "account_id": account_id,
                "kind": "expense",
                "amount": "120.00",
                "description": "April Verizon",
                "category_id": category_id,
            },
        )
        assert occ.status_code == 200, occ.text

        april = client.get(f"/api/families/{family_id}/expected-calendar", params={"month": "2026-04"})
        assert april.status_code == 200, april.text
        april_rows = [row for row in april.json()["items"] if row["expected_transaction_id"] == series_id]
        assert april_rows
        assert april_rows[0]["description"] == "April Verizon"

        may = client.get(f"/api/families/{family_id}/expected-calendar", params={"month": "2026-05"})
        assert may.status_code == 200, may.text
        may_rows = [row for row in may.json()["items"] if row["expected_transaction_id"] == series_id]
        assert may_rows
        assert may_rows[0]["description"] == "Cell Phone"

        listed = client.get(f"/api/families/{family_id}/expected-transactions")
        assert listed.status_code == 200, listed.text
        stored = next(row for row in listed.json() if row["id"] == series_id)
        assert stored["description"] == "Cell Phone"
