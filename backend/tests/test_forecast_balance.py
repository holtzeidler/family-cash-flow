"""One forecast check: a known starting balance, income, and expense.

The safe environment is set before the app is imported. This test does not
call Stripe or send email.
"""

from __future__ import annotations

import sys
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "e2e"))

from smoke_guard import (  # noqa: E402
    apply_safe_environment,
    assert_loaded_settings,
    assert_process_is_safe,
    smoke_db_path,
)

_DB = smoke_db_path("balancewhiz-smoke-pytest.db")
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


def _money(value) -> Decimal:
    return Decimal(str(value)).quantize(Decimal("0.01"))


def test_projected_balance_includes_starting_balance_income_and_expense():
    with TestClient(app) as client:
        created = client.post(
            "/api/auth/register",
            json={
                "email": "bw-smoke-math@example.com",
                "password": "SmokeOnly1!",
                "first_name": "Smoke",
                "last_name": "Math",
            },
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
                "starting_balance_date": "2026-09-01",
            },
        )
        assert account.status_code == 200, account.text

        income = client.post(
            f"/api/families/{family_id}/transactions",
            json={"date": "2026-09-01", "kind": "income", "amount": "300.00", "description": "Known income"},
        )
        assert income.status_code == 200, income.text

        expense = client.post(
            f"/api/families/{family_id}/transactions",
            json={"date": "2026-09-01", "kind": "expense", "amount": "125.00", "description": "Known expense"},
        )
        assert expense.status_code == 200, expense.text

        calendar = client.get(
            f"/api/families/{family_id}/calendar-month-daily",
            params={"month": "2026-09"},
        )
        assert calendar.status_code == 200, calendar.text
        by_date = {row["date"]: row for row in calendar.json()["days"]}

    # 1000 starting balance + 300 income - 125 expense = 1175, then carried forward.
    assert _money(by_date["2026-09-01"]["end"]) == Decimal("1175.00")
    assert _money(by_date["2026-09-02"]["end"]) == Decimal("1175.00")
