"""Mobile Forecast continues to the next month from the last date, not the footer."""

from __future__ import annotations

import json
import time
import uuid
import urllib.error
import urllib.request
from urllib.parse import parse_qs, urlparse

import pytest
from playwright.sync_api import expect

from smoke_guard import SMOKE_ORIGIN, assert_bot_email, latest_confirm_url
from support import assert_route_ok, login

PASSWORD = "SmokeOnly1!"


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


def _register_november_account():
    email = f"bw-smoke-cal{uuid.uuid4().hex[:10]}@example.com"
    assert_bot_email(email)
    _request(
        "POST",
        "/api/auth/verification/start",
        body={"email": email, "password": PASSWORD, "first_name": "Cal", "last_name": "Nav"},
    )
    confirm_url = _wait_confirm_url(email)
    token = str(parse_qs(urlparse(confirm_url).query).get("verify", [""])[0] or "").strip()
    verified = _request("POST", "/api/auth/verify-email", body={"token": token})
    access = str((verified or {}).get("access_token") or "").strip()
    complete = _request("POST", "/api/auth/onboarding/complete", token=access, body={})
    token = str((complete or {}).get("access_token") or access).strip()
    families = _request("GET", "/api/families", token=token)
    family_id = int(families[0]["id"])
    _request(
        "POST",
        f"/api/families/{family_id}/accounts",
        token=token,
        body={
            "name": "Checking",
            "type": "checking",
            "starting_balance": "2500.00",
            "starting_balance_date": "2026-11-01",
        },
    )
    return email


def _wait_calendar_idle(page):
    expect(page.locator("#calendarPanel")).not_to_have_class("calendar-panel--loading")


def _expect_month(page, ym: str):
    year, month = ym.split("-")
    expect(page.locator("#calendarYear")).to_have_value(year)
    expect(page.locator("#calendarMonthNum")).to_have_value(str(int(month)))


def _show_month(page, ym: str):
    year, month = ym.split("-")
    page.locator("#calendarYear").select_option(year)
    page.locator("#calendarMonthNum").select_option(str(int(month)))
    _expect_month(page, ym)
    _wait_calendar_idle(page)


def _first_in_month(page):
    return page.evaluate(
        """() => {
          const cell = document.querySelector(".calendar--mobile .cal-cell:not(.cal-cell--out)");
          if (!cell) return null;
          const rect = cell.getBoundingClientRect();
          return { iso: cell.getAttribute("data-iso"), top: Math.round(rect.top) };
        }"""
    )


def _continue(page, month_name: str):
    btn = page.locator(".cal-month-continue", has_text=f"Continue to {month_name}")
    expect(btn).to_be_visible()
    btn.scroll_into_view_if_needed()
    btn.click()
    _wait_calendar_idle(page)


def _assert_landed_on_first(page, iso: str):
    expect(page.locator(f'.calendar--mobile .cal-cell[data-iso="{iso}"]:not(.cal-cell--out)')).to_be_visible()
    first = _first_in_month(page)
    assert first and first["iso"] == iso, first
    assert first["top"] is not None and first["top"] < 220, first
    expect(page.locator("#calendarGoToday")).to_be_visible()
    expect(page.locator("#calendarPrevMonth")).to_be_visible()
    expect(page.locator("#calendarNextMonth")).to_be_visible()


def _run_phone(page, guard, email, width):
    page.set_viewport_size({"width": width, "height": 844})
    login(page, email, PASSWORD)
    response = page.goto("/calendar/")
    assert_route_ok(response, "/calendar/")
    _wait_calendar_idle(page)
    _show_month(page, "2026-11")
    expect(page.locator(".cal-month-continue")).to_have_count(1)
    _continue(page, "December")
    _expect_month(page, "2026-12")
    _assert_landed_on_first(page, "2026-12-01")
    _continue(page, "January")
    _expect_month(page, "2027-01")
    _assert_landed_on_first(page, "2027-01-01")
    expect(page.locator(".cal-month-continue", has_text="Continue to February")).to_be_visible()
    guard.assert_clean()


@pytest.mark.smoke_title("Mobile Forecast continues November to January at 320")
def test_mobile_forecast_continues_at_320(page, guard):
    email = _register_november_account()
    _run_phone(page, guard, email, 320)


@pytest.mark.smoke_title("Mobile Forecast continues November to January at 375")
def test_mobile_forecast_continues_at_375(page, guard):
    email = _register_november_account()
    _run_phone(page, guard, email, 375)


@pytest.mark.smoke_title("Mobile Forecast continues November to January at 390")
def test_mobile_forecast_continues_at_390(page, guard):
    email = _register_november_account()
    _run_phone(page, guard, email, 390)


@pytest.mark.smoke_title("Desktop Forecast has no continue-to-next-month control")
def test_desktop_forecast_has_no_month_continue(page, guard):
    email = _register_november_account()
    page.set_viewport_size({"width": 1280, "height": 800})
    login(page, email, PASSWORD)
    _wait_calendar_idle(page)
    expect(page.locator(".cal-month-continue")).to_have_count(0)
    expect(page.locator("#calendarNextMonth")).to_be_visible()
    guard.assert_clean()
