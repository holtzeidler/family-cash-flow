"""Transactions list must paint from series + 548-day actuals without waiting for Forecast."""

from __future__ import annotations

import json
import time
import uuid
import urllib.error
import urllib.request
from datetime import date, timedelta
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import pytest
from playwright.sync_api import expect

from smoke_guard import SMOKE_ORIGIN, assert_bot_email, latest_confirm_url
from support import assert_route_ok, login

PASSWORD = "SmokeOnly1!"
OUT = Path(__file__).resolve().parents[2] / "tmp" / "tx-load-diag"


def _request(method, path, token=None, body=None):
    data = None if body is None else json.dumps(body).encode()
    headers = {"Accept": "application/json"}
    if body is not None:
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = "Bearer " + token
    req = urllib.request.Request(SMOKE_ORIGIN + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read().decode()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")[:400]
        raise AssertionError(f"{method} {path} returned {exc.code}. {detail}") from None


def _wait_confirm_url(email: str) -> str:
    deadline = time.time() + 8
    while time.time() < deadline:
        url = latest_confirm_url(email)
        if url:
            return url
        time.sleep(0.2)
    raise AssertionError("confirmation link was not captured")


def _register_with_rare_bills():
    email = f"bw-smoke-tx{uuid.uuid4().hex[:10]}@example.com"
    assert_bot_email(email)
    _request(
        "POST",
        "/api/auth/verification/start",
        body={"email": email, "password": PASSWORD, "first_name": "Tx", "last_name": "Load"},
    )
    confirm_url = _wait_confirm_url(email)
    token = str(parse_qs(urlparse(confirm_url).query).get("verify", [""])[0] or "").strip()
    assert token, "confirmation link had no token"
    verified = _request("POST", "/api/auth/verify-email", body={"token": token})
    access = str((verified or {}).get("access_token") or "").strip()
    assert access, "verify-email did not return a token"
    complete = _request("POST", "/api/auth/onboarding/complete", token=access, body={})
    token = str((complete or {}).get("access_token") or access).strip()
    families = _request("GET", "/api/families", token=token)
    family_id = int(families[0]["id"])
    today = date.today()
    account = _request(
        "POST",
        f"/api/families/{family_id}/accounts",
        token=token,
        body={
            "name": "Checking",
            "type": "checking",
            "starting_balance": "2500.00",
            "starting_balance_date": today.isoformat(),
        },
    )
    account_id = int(account["id"])
    yearly_start = today + timedelta(days=300)
    semi_start = today + timedelta(days=170)
    _request(
        "POST",
        f"/api/families/{family_id}/expected-transactions",
        token=token,
        body={
            "account_id": account_id,
            "start_date": yearly_start.isoformat(),
            "recurrence": "yearly",
            "description": "Annual Insurance Premium",
            "notes": "policy 9988",
            "kind": "expense",
            "amount": "1280.00",
        },
    )
    _request(
        "POST",
        f"/api/families/{family_id}/expected-transactions",
        token=token,
        body={
            "account_id": account_id,
            "start_date": semi_start.isoformat(),
            "recurrence": "semiannual",
            "second_day_of_month": semi_start.day,
            "second_occurrence_month": ((semi_start.month + 5) % 12) + 1,
            "description": "County Property Taxes",
            "kind": "expense",
            "amount": "2100.00",
        },
    )
    return email


def _snapshot(page, width):
    return page.evaluate(
        """(width) => {
          const loading = !!document.querySelector('.tm-list-loading');
          const rows = document.querySelectorAll('#txListMain .tm-row').length;
          const api = window.__bwApiTrace || [];
          const trace = window.__bwCalendarTrace || [];
          const timed = (name) => {
            const row = trace.find((item) => item.event === name);
            return row ? Math.round(row.t) : null;
          };
          const rangeTx = api.filter((row) =>
            /\\/transactions$/.test(String(row.path || '')) && String(row.qs || '').indexOf('start_date=') >= 0
          );
          const expected = api.filter((row) =>
            /\\/expected-transactions$/.test(String(row.path || '')) && String(row.method || 'GET') === 'GET'
          );
          return {
            width,
            loading,
            rows,
            apiCount: api.length,
            listReady: timed('tx-list-ready'),
            listStart: timed('tx-list-prefetch-start'),
            family: timed('family-ready'),
            calendar: timed('bootstrap-calendar-ready'),
            cashHealth: timed('cash-health-painted'),
            rangeTx: rangeTx.map((row) => ({ t: row.t, ms: row.ms, qs: row.qs, bytes: row.bytes })),
            expected: expected.map((row) => ({ t: row.t, ms: row.ms, bytes: row.bytes })),
          };
        }""",
        width,
    )


def _wait_list(page):
    page.locator(".tm-list-loading").wait_for(state="hidden", timeout=8000)
    expect(page.locator(".tm-list-loading")).to_have_count(0)


def _row(page, amount: str, freq: str):
    """Match the visible row copy. Uncategorized series show the category, not the description."""
    return page.locator("#txListMain .tm-row").filter(has_text=amount).filter(has_text=freq)


def _expect_list_count(page, n: int):
    expect(page.get_by_text(f"{n} in this list")).to_be_visible()


def _run_viewport(page, guard, email, width, height, name):
    page.set_viewport_size({"width": width, "height": height})
    login(page, email, PASSWORD)
    response = page.goto("/transactions/")
    assert_route_ok(response, "/transactions/")
    _wait_list(page)
    snap = _snapshot(page, width)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"{name}.json").write_text(json.dumps(snap, indent=2), encoding="utf-8")
    assert snap["loading"] is False, snap
    assert snap["rows"] >= 2, snap
    assert snap["listStart"] is not None, "list prefetch never started: " + json.dumps(snap)
    assert snap["listReady"] is not None, "list never settled: " + json.dumps(snap)
    assert snap["rangeTx"], "548-day actuals request never started: " + json.dumps(snap)
    assert snap["expected"], "expected-transactions request never started: " + json.dumps(snap)
    assert len(snap["rangeTx"]) <= 2, "duplicate 548-day fetches: " + json.dumps(snap)
    if snap["calendar"] is not None:
        assert snap["listStart"] <= snap["calendar"], snap

    yearly = _row(page, "-$1,280.00", "Every year")
    semi = _row(page, "-$2,100.00", "Twice Yearly")
    expect(yearly).to_be_visible()
    expect(semi).to_be_visible()
    _expect_list_count(page, snap["rows"])

    page.locator("#tmSearch").fill("Annual Insurance")
    expect(yearly).to_be_visible()
    expect(semi).to_have_count(0)
    _expect_list_count(page, 1)
    page.locator("#tmSearch").fill("policy 9988")
    expect(yearly).to_be_visible()
    expect(semi).to_have_count(0)
    _expect_list_count(page, 1)
    page.locator("#tmSearch").fill("County Property")
    expect(semi).to_be_visible()
    expect(yearly).to_have_count(0)
    _expect_list_count(page, 1)
    semi.locator(".tm-row__edit").click()
    expect(page.locator("#txEditModal.modal-overlay--open")).to_be_visible()
    page.locator("#txEditAmount").fill("2150")
    page.locator("#txEditSave").click()
    scope = page.locator("#txEditApplyScopeModal.modal-overlay--open")
    expect(scope).to_be_visible()
    expect(page.locator("#txEditApplyScopeInstanceBtn")).to_be_visible()
    expect(page.locator("#txEditApplyScopeSeriesBtn")).to_be_visible()
    page.locator("#txEditApplyScopeCancelBtn").click()
    expect(scope).to_have_count(0)
    page.locator("#txEditCancel").click()
    expect(page.locator("#txEditModal.modal-overlay--open")).to_have_count(0)

    page.locator("#tmSearch").fill("")
    expect(yearly).to_be_visible()
    expect(semi).to_be_visible()
    expect(page.locator("#txListMain .tm-row")).to_have_count(snap["rows"])
    _expect_list_count(page, snap["rows"])

    page.wait_for_function(
        """() => {
          const trace = window.__bwCalendarTrace || [];
          return trace.some((item) => item.event === "cash-health-painted");
        }""",
        timeout=15000,
    )
    cash_snap = page.evaluate(
        """() => {
          const trace = window.__bwCalendarTrace || [];
          const painted = trace.find((item) => item.event === "cash-health-painted");
          const kicker = document.querySelector(".cash-health-card__kicker");
          return {
            painted: painted ? Math.round(painted.t) : null,
            kicker: kicker ? String(kicker.textContent || "").trim() : "",
            pending: !!document.querySelector(".cash-health-card--pending"),
          };
        }"""
    )
    snap["cashHealthAfter"] = cash_snap
    (OUT / f"{name}.json").write_text(json.dumps(snap, indent=2), encoding="utf-8")
    assert cash_snap["painted"] is not None, cash_snap
    assert cash_snap["pending"] is False, cash_snap
    guard.assert_clean()
    return snap


@pytest.mark.smoke_title("Transactions list loads on a phone without Forecast")
def test_tx_list_loads_on_phone(page, guard):
    email = _register_with_rare_bills()
    snap = _run_viewport(page, guard, email, 390, 844, "after-390")
    assert snap["width"] == 390


@pytest.mark.smoke_title("Transactions list loads on desktop without Forecast")
def test_tx_list_loads_on_desktop(page, guard):
    email = _register_with_rare_bills()
    snap = _run_viewport(page, guard, email, 1280, 800, "after-1280")
    assert snap["width"] == 1280
