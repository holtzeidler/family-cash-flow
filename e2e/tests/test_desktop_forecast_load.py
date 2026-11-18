"""Desktop Forecast shows the visible month before secondary data finishes."""

from __future__ import annotations

import re

import pytest
from playwright.sync_api import expect

from support import login


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

    page.locator("#navTransactionView").click()
    expect(page.locator("#txListMain")).to_be_visible()
    page.locator("#navCalendarView").click()
    expect(panel).not_to_have_class(re.compile(r"calendar-panel--loading"), timeout=15000)
    expect(panel.locator(".cal-cell:not(.cal-cell--out) .cal-balance").first).to_be_visible()
    guard.assert_clean()
    print("DESKTOP_FORECAST_TIMING", snap)
