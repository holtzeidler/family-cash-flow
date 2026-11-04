"""Starter categories are created once and never replace an existing list.

Uses a disposable local database. Does not call Stripe or send email.
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

_DB = smoke_db_path("balancewhiz-smoke-startercats.db")
_DB.parent.mkdir(parents=True, exist_ok=True)
for _extra in (_DB, Path(str(_DB) + "-wal"), Path(str(_DB) + "-shm")):
    if _extra.exists():
        _extra.unlink()

apply_safe_environment(_DB)
assert_process_is_safe(_DB)

sys.path.insert(0, str(ROOT / "backend"))
from app.main import _default_category_blueprint_rows, app, settings  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

assert_loaded_settings(
    database_url=settings.DATABASE_URL,
    env=settings.ENV,
    stripe_key=settings.STRIPE_SECRET_KEY,
    resend_key=settings.RESEND_API_KEY,
    smtp_host=settings.CONTACT_SMTP_HOST,
    db_filename=_DB.name,
)

EXPECTED = [
    ("Income", ["Paycheck", "Other Income"]),
    ("Housing & Bills", ["Mortgage / Rent", "Utilities", "Insurance", "Subscriptions"]),
    ("Debt & Payments", ["Credit Card Payment", "Loan Payment"]),
    ("Savings & Transfers", ["Savings Transfer", "Investment Transfer", "Other Transfer", "Cash & ATM"]),
    ("Other", ["Other Expense"]),
]


def _names(tree: dict) -> list[tuple[str, list[str]]]:
    return [
        (group["name"], [category["name"] for category in group["categories"]])
        for group in tree["groups"]
    ]


def test_blueprint_matches_the_starter_categories_without_renames():
    rows = _default_category_blueprint_rows()
    assert [(group, name) for group, name, _old in rows] == [
        (group, name) for group, names in EXPECTED for name in names
    ]
    assert all(old is None for _group, _name, old in rows)


def test_new_account_gets_starters_and_later_seeds_leave_them_alone():
    with TestClient(app) as client:
        created = signup_verified(client, email="bw-smoke-startercats@example.com")
        assert created.status_code == 200, created.text
        family_id = int(created.json()["family_id"])

        first = client.get(f"/api/families/{family_id}/categories/tree")
        assert first.status_code == 200, first.text
        assert _names(first.json()) == EXPECTED

        plain = client.post(f"/api/families/{family_id}/categories/seed-defaults")
        forced = client.post(f"/api/families/{family_id}/categories/seed-defaults?force=true")
        assert plain.status_code == 409, plain.text
        assert forced.status_code == 409, forced.text
        assert "not changed" in plain.json()["detail"]
        assert "not changed" in forced.json()["detail"]

        paycheck = next(
            category
            for group in first.json()["groups"]
            if group["name"] == "Income"
            for category in group["categories"]
            if category["name"] == "Paycheck"
        )
        renamed = client.put(
            f"/api/families/{family_id}/categories/{paycheck['id']}",
            json={"name": "Salary"},
        )
        assert renamed.status_code == 200, renamed.text

        other = next(group for group in first.json()["groups"] if group["name"] == "Other")
        added = client.post(
            f"/api/families/{family_id}/categories",
            json={"name": "Dog food", "group_id": other["id"]},
        )
        assert added.status_code == 200, added.text

        again = client.post(f"/api/families/{family_id}/categories/seed-defaults?force=true")
        assert again.status_code == 409, again.text

        after = client.get(f"/api/families/{family_id}/categories/tree")
        assert after.status_code == 200, after.text
        names = _names(after.json())
        assert names[0] == ("Income", ["Salary", "Other Income"])
        assert names[-1][0] == "Other"
        assert "Dog food" in names[-1][1]
        assert "Paycheck" not in [name for _group, cats in names for name in cats]
        savings = next(cats for group, cats in names if group == "Savings & Transfers")
        assert savings.count("Cash & ATM") == 1
        assert [group for group, _cats in names] == [group for group, _cats in EXPECTED]
