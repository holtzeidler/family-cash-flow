"""Create two disposable forecast accounts in the local smoke database.

Active account: checking balance $1,000 on 2026-09-01 and a $200 expense on
2026-09-10, so that day's projected balance is $800.

View-only account: the same forecast, with the family trial start moved to
2020 so the account is expired. This update touches only the smoke SQLite file.
"""

from __future__ import annotations

import json
import sqlite3
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Optional

from smoke_guard import SMOKE_ORIGIN, assert_bot_email, smoke_db_path, smoke_run_dir

ACTIVE_EMAIL = "bw-smoke-active@example.com"
VIEWONLY_EMAIL = "bw-smoke-viewonly@example.com"
PASSWORD = "SmokeOnly1!"
MONTH = "2026-09"
START_DATE = "2026-09-01"
EXPENSE_DATE = "2026-09-10"
INCOME_DATE = "2026-09-15"


def _request(method: str, path: str, token: Optional[str] = None, body: Optional[dict] = None, timeout: int = 30):
    data = None if body is None else json.dumps(body).encode()
    headers = {"Accept": "application/json"}
    if body is not None:
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = "Bearer " + token
    req = urllib.request.Request(SMOKE_ORIGIN + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode()
            return resp.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")[:400]
        raise SystemExit(f"Smoke seed failed: {method} {path} returned {exc.code}. {detail}") from None


def _assert_public_config() -> None:
    _status, cfg = _request("GET", "/api/debug/public-config")
    problems = []
    if cfg.get("env") == "production":
        problems.append("ENV is production")
    if cfg.get("database_host_kind") != "sqlite":
        problems.append("database is not sqlite")
    if cfg.get("database_name") != "balancewhiz-smoke.db":
        problems.append("database file is not the smoke database")
    if cfg.get("stripe_mode") != "none" or cfg.get("stripe_billing_configured"):
        problems.append("Stripe is configured")
    if cfg.get("contact_form_delivery") != "none":
        problems.append("email delivery is configured")
    if cfg.get("password_reset_email_configured") or cfg.get("family_invite_email_configured"):
        problems.append("transactional email is configured")
    if cfg.get("auth_cookie_secure"):
        problems.append("auth cookie is marked Secure, which is the production setting")
    if problems:
        raise SystemExit("Smoke seed refused to create accounts: " + "; ".join(problems) + ".")


def _register(email: str) -> str:
    assert_bot_email(email)
    _status, body = _request(
        "POST",
        "/api/auth/register",
        body={
            "email": email,
            "password": PASSWORD,
            "first_name": "Smoke",
            "last_name": "Bot",
        },
    )
    token = str((body or {}).get("access_token") or "").strip()
    if not token:
        raise SystemExit("Smoke seed failed: register did not return a token.")
    return token


def _seed_forecast(token: str) -> int:
    _status, families = _request("GET", "/api/families", token=token)
    if not families:
        raise SystemExit("Smoke seed failed: the new account has no family.")
    family_id = int(families[0]["id"])
    _request(
        "POST",
        f"/api/families/{family_id}/accounts",
        token=token,
        body={
            "name": "Checking",
            "type": "checking",
            "starting_balance": "1000.00",
            "starting_balance_date": START_DATE,
        },
    )
    _status, categories = _request("GET", f"/api/families/{family_id}/categories", token=token)
    other_id = next((int(row["id"]) for row in categories if row.get("name") == "Other"), None)
    if other_id is None:
        names = ", ".join(sorted({str(row.get("name") or "") for row in categories}))
        raise SystemExit(f"Smoke seed failed: category Other was not found. Saw: {names}")
    _request(
        "POST",
        f"/api/families/{family_id}/transactions",
        token=token,
        body={
            "date": EXPENSE_DATE,
            "kind": "expense",
            "amount": "200.00",
            "description": "Smoke expense",
            "category_id": other_id,
        },
    )
    return family_id


def _exec_sql(sql: str, params: tuple) -> None:
    db_path = smoke_db_path()
    last_error = "unknown"
    for _ in range(8):
        try:
            con = sqlite3.connect(str(db_path), timeout=5)
            try:
                cur = con.execute(sql, params)
                con.commit()
                if sql.lstrip().upper().startswith("UPDATE") and cur.rowcount != 1:
                    raise SystemExit("Smoke seed failed: database update did not change one row.")
                return
            finally:
                con.close()
        except sqlite3.OperationalError as exc:
            last_error = str(exc)
            time.sleep(0.25)
    raise SystemExit(f"Smoke seed failed: could not update the smoke database ({last_error}).")


def _utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _set_created(family_id: int, created: datetime) -> None:
    _exec_sql(
        "UPDATE families SET created_at = ? WHERE id = ?",
        (created.strftime("%Y-%m-%d %H:%M:%S"), family_id),
    )


def _end_later_today_utc() -> datetime:
    """A trial end still on today's local calendar date, after the current minute."""
    local = datetime.now().astimezone()
    end_local = local + timedelta(minutes=90)
    if end_local.date() != local.date():
        end_local = local.replace(hour=23, minute=59, second=0, microsecond=0)
    if end_local <= local:
        end_local = local + timedelta(minutes=5)
    return end_local.astimezone(timezone.utc).replace(tzinfo=None)


def _ensure_checking(token: str, family_id: int) -> None:
    _request(
        "POST",
        f"/api/families/{family_id}/accounts",
        token=token,
        body={
            "name": "Checking",
            "type": "checking",
            "starting_balance": "1000.00",
            "starting_balance_date": START_DATE,
        },
    )


def _family_id(token: str) -> int:
    _status, families = _request("GET", "/api/families", token=token)
    if not families:
        raise SystemExit("Smoke seed failed: the new account has no family.")
    return int(families[0]["id"])


def _open_account(email: str) -> tuple[str, int]:
    assert_bot_email(email)
    token = _register(email)
    return token, _family_id(token)


def _shift_trial(family_id: int, end: datetime) -> None:
    _set_created(family_id, end - timedelta(days=14))


def _mark_complimentary(email: str) -> None:
    _exec_sql(
        "UPDATE users SET complimentary_access = 1, complimentary_access_expires_at = NULL WHERE email = ?",
        (email,),
    )


def _insert_trial_plan(family_id: int, *, sub_id: str, lookup: str, trial_end: datetime) -> None:
    stamp = _utc_now().strftime("%Y-%m-%d %H:%M:%S")
    end = trial_end.strftime("%Y-%m-%d %H:%M:%S")
    _exec_sql(
        "INSERT INTO billing_subscriptions ("
        "family_id, stripe_subscription_id, status, lookup_key, cancel_at_period_end, "
        "trial_end, current_period_end, created_at, updated_at"
        ") VALUES (?, ?, 'trialing', ?, 0, ?, ?, ?, ?)",
        (family_id, sub_id, lookup, end, end, stamp, stamp),
    )


def _expire_trial(family_id: int) -> None:
    db_path = smoke_db_path()
    last_error = "unknown"
    for _ in range(8):
        try:
            con = sqlite3.connect(str(db_path), timeout=5)
            try:
                cur = con.execute(
                    "UPDATE families SET created_at = ? WHERE id = ?",
                    ("2020-01-01 00:00:00", family_id),
                )
                if cur.rowcount != 1:
                    raise SystemExit("Smoke seed failed: could not backdate the view-only family.")
                con.commit()
                return
            finally:
                con.close()
        except sqlite3.OperationalError as exc:
            last_error = str(exc)
            time.sleep(0.25)
    raise SystemExit(f"Smoke seed failed: could not update the smoke database ({last_error}).")


def _billing(token: str, family_id: int) -> dict:
    _status, body = _request("GET", f"/api/families/{family_id}/billing-status", token=token)
    return body or {}


def main() -> None:
    _assert_public_config()
    active_token = _register(ACTIVE_EMAIL)
    active_family = _seed_forecast(active_token)
    active_billing = _billing(active_token, active_family)
    if not active_billing.get("entitled") or active_billing.get("phase") != "trial":
        raise SystemExit("Smoke seed failed: the active account is not in an entitled trial.")

    view_token = _register(VIEWONLY_EMAIL)
    view_family = _seed_forecast(view_token)
    _expire_trial(view_family)
    view_billing = _billing(view_token, view_family)
    if view_billing.get("entitled") or view_billing.get("phase") != "expired":
        raise SystemExit("Smoke seed failed: the view-only account is still entitled to make changes.")
    if not (active_billing.get("trial_days_remaining") or 0) > 7:
        raise SystemExit("Smoke seed failed: the fresh trial is not more than 7 days from expiration.")

    def trial_row(email: str, *, end: datetime, plan: Optional[str] = None, complimentary: bool = False, forecast: bool = False) -> dict:
        token, family_id = _open_account(email)
        if complimentary:
            _mark_complimentary(email)
        _shift_trial(family_id, end)
        if plan:
            _insert_trial_plan(family_id, sub_id=f"sub_smoke_{family_id}", lookup=plan, trial_end=end)
        if forecast:
            _seed_forecast(token)
        else:
            _ensure_checking(token, family_id)
        billing = _billing(token, family_id)
        return {
            "email": email,
            "password": PASSWORD,
            "family_id": family_id,
            "trial_ends_at": billing.get("trial_ends_at"),
            "phase": billing.get("phase"),
            "entitled": billing.get("entitled"),
            "in_app_trial": billing.get("in_app_trial"),
            "status": billing.get("status"),
            "lookup_key": billing.get("lookup_key"),
            "complimentary_access_active": billing.get("complimentary_access_active"),
        }

    now = _utc_now()
    days7 = trial_row("bw-smoke-trial7d@example.com", end=now + timedelta(days=7))
    days3 = trial_row("bw-smoke-trial3d@example.com", end=now + timedelta(days=3))
    days1 = trial_row("bw-smoke-trial1d@example.com", end=now + timedelta(days=1))
    today_end = _end_later_today_utc()
    today = trial_row("bw-smoke-trialtoday@example.com", end=today_end)
    monthly = trial_row(
        "bw-smoke-trialmo@example.com",
        end=now + timedelta(days=3),
        plan="cash_forecast_monthly",
        forecast=True,
    )
    annual = trial_row(
        "bw-smoke-trialyr@example.com",
        end=now + timedelta(days=3),
        plan="cash_forecast_annual",
        forecast=True,
    )
    complimentary = trial_row(
        "bw-smoke-compfull@example.com",
        end=datetime(2020, 1, 15, 12, 0, 0),
        complimentary=True,
        forecast=True,
    )

    def _require(row: dict, **checks: object) -> None:
        email = row["email"]
        for key, expected in checks.items():
            if row.get(key) != expected:
                raise SystemExit(f"Smoke seed failed: {email} {key} is {row.get(key)!r}, expected {expected!r}.")

    _require(days7, phase="trial", entitled=True, in_app_trial=True, complimentary_access_active=False)
    _require(days3, phase="trial", entitled=True, in_app_trial=True)
    _require(days1, phase="trial", entitled=True, in_app_trial=True)
    _require(today, phase="trial", entitled=True, in_app_trial=True)
    _require(monthly, phase="trial", entitled=True, in_app_trial=True, status="trialing", lookup_key="cash_forecast_monthly")
    _require(annual, phase="trial", entitled=True, in_app_trial=True, status="trialing", lookup_key="cash_forecast_annual")
    _require(complimentary, phase="complimentary", entitled=True, complimentary_access_active=True, in_app_trial=False)

    payload = {
        "origin": SMOKE_ORIGIN,
        "month": MONTH,
        "active": {"email": ACTIVE_EMAIL, "password": PASSWORD, "family_id": active_family},
        "viewonly": {"email": VIEWONLY_EMAIL, "password": PASSWORD, "family_id": view_family},
        "expense_date": EXPENSE_DATE,
        "expense_amount": "200.00",
        "expense_category": "Other",
        "seed_balance": "800.00",
        "income_date": INCOME_DATE,
        "income_amount": "100.00",
        "income_category": "Bonus",
        "balance_after_income": "900.00",
        "edited_expense_amount": "50.00",
        "balance_after_edit_on_expense_day": "950.00",
        "balance_after_edit_on_income_day": "1050.00",
        "balance_after_delete": "950.00",
        "trials": {
            "days7": days7,
            "days3": days3,
            "days1": days1,
            "today": today,
            "monthly": monthly,
            "annual": annual,
            "complimentary": complimentary,
        },
    }
    dest = smoke_run_dir() / "seed.json"
    dest.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print("Smoke seed ready: trial states, active trial, and expired view-only account", flush=True)


if __name__ == "__main__":
    main()
