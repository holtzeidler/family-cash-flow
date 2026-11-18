"""Desktop Forecast shows the visible month before secondary data finishes."""

from __future__ import annotations

import re
from datetime import date, timedelta

import pytest
from playwright.sync_api import expect

from support import login, money, show_month
from test_core_workflows import PASSWORD, _add_planned_item, _balance, _register_checking


def _trace(page):
    return page.evaluate(
        """() => {
          const trace = window.__bwCalendarTrace || [];
          const api = window.__bwApiTrace || [];
          const timed = (name) => {
            const row = trace.find((item) => item.event === name);
            return row ? Math.round(row.t) : null;
          };
          const step = (label) => {
            const row = trace.find((item) => item.event === "step:" + label);
            return row && row.extra ? row.extra.ms : null;
          };
          const usable = timed("usable-calendar");
          const before = api.filter((row) => usable == null || row.t <= usable);
          const paths = before.map((row) => String(row.path || ""));
          return {
            usable,
            ready: timed("month-load-ready"),
            secondary: timed("secondary-painted"),
            cashHealth: timed("cash-health-painted"),
            steps: {
              daily: step("daily-balances"),
              transactions: step("transactions"),
              expected: step("expected"),
              extras: step("extras"),
              lowBalance: step("low-balance"),
              reconciled: step("reconciled"),
              verified: step("verified"),
              confidence: step("forecast-confidence"),
              adjacent: step("adjacent-daily"),
            },
            paths,
          };
        }"""
    )


@pytest.mark.smoke_title("Desktop Forecast paints the visible month before secondary data")
def test_desktop_forecast_paints_before_secondary_data(page, seed, guard):
    page.set_viewport_size({"width": 1280, "height": 800})
    login(page, seed["active"]["email"], seed["active"]["password"])
    panel = page.locator("#calendarPanel")
    expect(panel).not_to_have_class(re.compile(r"calendar-panel--loading"))
    day = panel.locator(".cal-cell:not(.cal-cell--out) .cal-balance").first
    expect(day).to_be_visible()
    first_balance = day.inner_text()
    page.wait_for_function(
        """() => (window.__bwCalendarTrace || []).some((row) => row.event === "secondary-painted")"""
    )
    expect(day).to_have_text(first_balance)
    snap = _trace(page)
    assert snap["usable"] is not None, snap
    assert snap["ready"] is not None and snap["ready"] <= snap["usable"] + 50, snap
    assert snap["secondary"] is not None and snap["secondary"] >= snap["usable"], snap
    blocked = ("forecast-confidence", "verified-balances", "reconciled-days")
    assert not any(any(part in path for part in blocked) for path in snap["paths"]), snap

    page.locator("#calendarNextMonth").click()
    expect(panel).not_to_have_class(re.compile(r"calendar-panel--loading"), timeout=15000)
    expect(panel.locator(".cal-cell:not(.cal-cell--out) .cal-balance").first).to_be_visible()
    page.locator("#calendarPrevMonth").click()
    expect(panel).not_to_have_class(re.compile(r"calendar-panel--loading"), timeout=15000)

    page.evaluate("() => { window.__bwApiTrace = []; }")
    page.locator("#navTransactionView").click()
    expect(page).to_have_url(re.compile(r"/transactions"))
    expect(page.locator("#txListMain")).to_be_visible()
    page.wait_for_timeout(400)
    tx_calls = page.evaluate(
        """() => (window.__bwApiTrace || []).map((row) => row.path)"""
    )
    assert not any("calendar-month-daily" in path for path in tx_calls), tx_calls
    assert not any(path.endswith("/projection") for path in tx_calls), tx_calls
    page.evaluate("() => { window.__bwApiTrace = []; }")
    switched = page.evaluate("() => performance.now()")
    page.locator("#navCalendarView").click()
    expect(page).to_have_url(re.compile(r"/calendar"))
    expect(panel).not_to_have_class(re.compile(r"calendar-panel--loading"))
    expect(panel.locator(".cal-cell:not(.cal-cell--out) .cal-balance").first).to_be_visible()
    returned = page.evaluate(
        """(started) => ({
          ms: Math.round(performance.now() - started),
          calls: (window.__bwApiTrace || []).map((row) => row.path + (row.qs ? "?" + row.qs : "")),
        })""",
        switched,
    )
    assert returned["ms"] < 1000, returned
    assert not any("calendar-month-daily" in path for path in returned["calls"]), returned
    page.go_back()
    expect(page).to_have_url(re.compile(r"/transactions"))
    expect(page.locator("#txListMain")).to_be_visible()
    page.go_forward()
    expect(page).to_have_url(re.compile(r"/calendar"))
    expect(panel.locator(".cal-cell:not(.cal-cell--out) .cal-balance").first).to_be_visible()
    guard.assert_clean()
    print("DESKTOP_FORECAST_TIMING", snap)
    print("FORECAST_RETURN", returned)


@pytest.mark.smoke_title("Editing on Transactions updates Forecast without a reload")
def test_transaction_edit_shows_on_forecast_return(page, guard):
    today = date.today()
    day = today + timedelta(days=1)
    iso = day.isoformat()
    email = _register_checking("1000.00", today.isoformat())
    login(page, email, PASSWORD)
    show_month(page, iso[:7], iso)
    label = _add_planned_item(page, iso, "100", kind="income", name="Paycheck")
    expect(_balance(page, iso)).to_have_text(money("1100.00"))
    page.locator("#navTransactionView").click()
    expect(page).to_have_url(re.compile(r"/transactions"))
    row = page.locator("#txListMain .tm-row", has_text=label).first
    expect(row).to_be_visible()
    row.locator(".tm-row__edit").click()
    expect(page.locator("#txEditModal.modal-overlay--open")).to_be_visible()
    page.locator("#txEditAmount").fill("250")
    page.locator("#txEditSave").click()
    scope = page.locator("#txEditApplyScopeModal.modal-overlay--open")
    try:
        expect(scope).to_be_visible(timeout=2000)
        page.locator("#txEditApplyScopeInstanceBtn").click()
        page.locator("#txEditApplyScopeSaveBtn").click()
    except AssertionError:
        pass
    expect(page.locator("#txEditModal.modal-overlay--open")).to_have_count(0)
    expect(scope).to_have_count(0)
    page.locator("#navCalendarView").click()
    expect(page).to_have_url(re.compile(r"/calendar"))
    expect(page.locator("#calendarPanel")).not_to_have_class(re.compile(r"calendar-panel--loading"), timeout=15000)
    expect(_balance(page, iso)).to_have_text(money("1250.00"))
    guard.assert_clean()
