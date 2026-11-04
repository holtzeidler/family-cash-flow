"""Favorite transactions are household templates. Saving one does not create a forecast entry.

Uses a disposable local database.
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
from verified_signup import signup_verified  # noqa: E402

_DB = smoke_db_path("balancewhiz-smoke-favorite-transactions.db")
_DB.parent.mkdir(parents=True, exist_ok=True)
for _extra in (_DB, Path(str(_DB) + "-wal"), Path(str(_DB) + "-shm")):
    if _extra.exists():
        _extra.unlink()

apply_safe_environment(_DB)
assert_process_is_safe(_DB)

sys.path.insert(0, str(ROOT / "backend"))
from app.main import Account, Category, ExpectedTransaction, FavoriteTransaction, Transaction, app, settings  # noqa: E402
from app.main import SessionLocal  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import func, select  # noqa: E402

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


def _category_id(tree: dict, name: str) -> int:
    for group in tree["groups"]:
        for category in group["categories"]:
            if category["name"] == name:
                return int(category["id"])
    raise AssertionError(f"missing category {name}")


def _signup(client: TestClient, email: str) -> int:
    created = signup_verified(
        client,
        email=email,
        password="SmokeOnly1!",
        first_name="Smoke",
        last_name="Favorite",
    )
    assert created.status_code == 200, created.text
    return int(created.json()["family_id"])


def _account(client: TestClient, family_id: int, name: str = "Checking") -> int:
    account = client.post(
        f"/api/families/{family_id}/accounts",
        json={
            "name": name,
            "type": "checking",
            "starting_balance": "1000.00",
            "starting_balance_date": "2026-10-01",
        },
    )
    assert account.status_code == 200, account.text
    return int(account.json()["id"])


def _counts() -> tuple[int, int]:
    with SessionLocal() as db:
        transactions = int(db.execute(select(func.count(Transaction.id))).scalar_one() or 0)
        expected = int(db.execute(select(func.count(ExpectedTransaction.id))).scalar_one() or 0)
    return transactions, expected


def test_favorites_are_family_scoped_templates():
    with TestClient(app) as client:
        assert client.get("/api/families/1/favorite-transactions").status_code == 401

        family_id = _signup(client, "bw-smoke-favorites@example.com")
        account_id = _account(client, family_id)
        tree = client.get(f"/api/families/{family_id}/categories/tree")
        assert tree.status_code == 200, tree.text
        utilities = _category_id(tree.json(), "Utilities")
        other_family_id = _signup(client, "bw-smoke-favorites-other@example.com")
        other_account_id = _account(client, other_family_id, "Other checking")
        other_tree = client.get(f"/api/families/{other_family_id}/categories/tree")
        other_utilities = _category_id(other_tree.json(), "Utilities")
        logged_in = client.post(
            "/api/auth/login",
            json={"email": "bw-smoke-favorites@example.com", "password": "SmokeOnly1!"},
        )
        assert logged_in.status_code == 200, logged_in.text

        before = _counts()
        created = client.post(
            f"/api/families/{family_id}/favorite-transactions",
            json={
                "name": "  Electric bill  ",
                "kind": "expense",
                "amount": "86.40",
                "category_id": utilities,
                "account_id": account_id,
                "notes": "  winter average  ",
            },
        )
        assert created.status_code == 200, created.text
        body = created.json()
        favorite_id = int(body["id"])
        assert body["name"] == "Electric bill"
        assert body["kind"] == "expense"
        assert _money(body["amount"]) == Decimal("86.40")
        assert body["category_id"] == utilities
        assert body["account_id"] == account_id
        assert body["notes"] == "winter average"
        assert _counts() == before

        listed = client.get(f"/api/families/{family_id}/favorite-transactions")
        assert listed.status_code == 200, listed.text
        assert [row["id"] for row in listed.json()] == [favorite_id]

        other_login = client.post(
            "/api/auth/login",
            json={"email": "bw-smoke-favorites-other@example.com", "password": "SmokeOnly1!"},
        )
        assert other_login.status_code == 200, other_login.text
        hidden = client.get(f"/api/families/{other_family_id}/favorite-transactions")
        assert hidden.status_code == 200, hidden.text
        assert hidden.json() == []
        forbidden = client.post(
            f"/api/families/{family_id}/favorite-transactions",
            json={"name": "Nope", "kind": "expense", "amount": "1.00"},
        )
        assert forbidden.status_code == 403, forbidden.text
        stolen = client.put(
            f"/api/families/{other_family_id}/favorite-transactions/{favorite_id}",
            json={"name": "Stolen"},
        )
        assert stolen.status_code == 404, stolen.text

        logged_back = client.post(
            "/api/auth/login",
            json={"email": "bw-smoke-favorites@example.com", "password": "SmokeOnly1!"},
        )
        assert logged_back.status_code == 200, logged_back.text
        renamed = client.put(
            f"/api/families/{family_id}/favorite-transactions/{favorite_id}",
            json={"name": "Power", "amount": "90.00", "category_id": None, "notes": ""},
        )
        assert renamed.status_code == 200, renamed.text
        assert renamed.json()["name"] == "Power"
        assert _money(renamed.json()["amount"]) == Decimal("90.00")
        assert renamed.json()["category_id"] is None
        assert renamed.json()["account_id"] == account_id
        assert renamed.json()["notes"] is None
        assert renamed.json()["kind"] == "expense"

        wrong_category = client.put(
            f"/api/families/{family_id}/favorite-transactions/{favorite_id}",
            json={"category_id": other_utilities},
        )
        assert wrong_category.status_code == 400, wrong_category.text
        wrong_account = client.put(
            f"/api/families/{family_id}/favorite-transactions/{favorite_id}",
            json={"account_id": other_account_id},
        )
        assert wrong_account.status_code == 400, wrong_account.text
        blank = client.post(
            f"/api/families/{family_id}/favorite-transactions",
            json={"name": "   ", "kind": "expense", "amount": "1.00"},
        )
        assert blank.status_code == 422, blank.text
        cents = client.post(
            f"/api/families/{family_id}/favorite-transactions",
            json={"name": "Too precise", "kind": "expense", "amount": "1.239"},
        )
        assert cents.status_code == 422, cents.text
        zero = client.post(
            f"/api/families/{family_id}/favorite-transactions",
            json={"name": "Zero", "kind": "income", "amount": "0"},
        )
        assert zero.status_code == 422, zero.text
        absent = client.delete(f"/api/families/{family_id}/favorite-transactions/999999")
        assert absent.status_code == 404, absent.text

        removed = client.delete(f"/api/families/{family_id}/favorite-transactions/{favorite_id}")
        assert removed.status_code == 200, removed.text
        assert client.get(f"/api/families/{family_id}/favorite-transactions").json() == []
        assert _counts() == before


def test_favorite_limit_and_category_deletion_clears_the_reference():
    with TestClient(app) as client:
        family_id = _signup(client, "bw-smoke-favorites-limit@example.com")
        account_id = _account(client, family_id)
        tree = client.get(f"/api/families/{family_id}/categories/tree")
        utilities = _category_id(tree.json(), "Utilities")
        insurance = _category_id(tree.json(), "Insurance")

        for index in range(30):
            created = client.post(
                f"/api/families/{family_id}/favorite-transactions",
                json={"name": f"Favorite {index}", "kind": "expense", "amount": "2.00"},
            )
            assert created.status_code == 200, created.text
        overflow = client.post(
            f"/api/families/{family_id}/favorite-transactions",
            json={"name": "One too many", "kind": "income", "amount": "3.00"},
        )
        assert overflow.status_code == 400, overflow.text
        assert len(client.get(f"/api/families/{family_id}/favorite-transactions").json()) == 30

        linked = client.post(
            f"/api/families/{family_id}/favorite-transactions",
            json={
                "name": "Favorite 0",
                "kind": "expense",
                "amount": "2.00",
                "category_id": utilities,
                "account_id": account_id,
            },
        )
        # The cap is still in force, so reuse the first saved row instead of creating another.
        assert linked.status_code == 400
        rows = client.get(f"/api/families/{family_id}/favorite-transactions").json()
        first_id = int(rows[0]["id"])
        attached = client.put(
            f"/api/families/{family_id}/favorite-transactions/{first_id}",
            json={"category_id": utilities, "account_id": account_id},
        )
        assert attached.status_code == 200, attached.text

        used = client.post(
            f"/api/families/{family_id}/transactions",
            json={
                "date": "2026-10-02",
                "kind": "expense",
                "amount": "40.00",
                "description": "Power",
                "category_id": utilities,
            },
        )
        assert used.status_code == 200, used.text
        blocked = client.delete(f"/api/families/{family_id}/categories/{utilities}")
        assert blocked.status_code == 400, blocked.text
        still = client.get(f"/api/families/{family_id}/favorite-transactions").json()
        assert still[0]["category_id"] == utilities

        cleared = client.delete(
            f"/api/families/{family_id}/categories/{utilities}",
            params={"uncategorize_refs": "true"},
        )
        assert cleared.status_code == 200, cleared.text
        after = client.get(f"/api/families/{family_id}/favorite-transactions").json()
        assert after[0]["category_id"] is None
        assert after[0]["account_id"] == account_id
        assert len(after) == 30

        only_favorite = client.put(
            f"/api/families/{family_id}/favorite-transactions/{first_id}",
            json={"category_id": insurance},
        )
        assert only_favorite.status_code == 200, only_favorite.text
        removed = client.delete(f"/api/families/{family_id}/categories/{insurance}")
        assert removed.status_code == 200, removed.text
        final = client.get(f"/api/families/{family_id}/favorite-transactions").json()
        assert final[0]["category_id"] is None
        with SessionLocal() as db:
            favorite = db.execute(select(FavoriteTransaction).where(FavoriteTransaction.id == first_id)).scalar_one()
            assert favorite.category_id is None
            category = db.execute(select(Category).where(Category.id == insurance)).scalar_one_or_none()
            assert category is None
            account = db.execute(select(Account).where(Account.id == account_id)).scalar_one()
            assert int(account.family_id) == family_id
