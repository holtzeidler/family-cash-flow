"""Mobile login should open the forecast at the top with Cash Health visible."""

from __future__ import annotations

import re
import time

import pytest
from playwright.sync_api import expect

from support import login

SCROLL_HOOK = """
(() => {
  window.__bwScrollLog = [];
  const push = (kind, delta) => {
    window.__bwScrollLog.push({
      kind,
      delta: Number(delta) || 0,
      y: Math.round(window.scrollY || 0),
      t: performance.now(),
    });
  };
  const to = window.scrollTo.bind(window);
  const by = window.scrollBy.bind(window);
  window.scrollTo = function (a, b) {
    const top = a && typeof a === "object" ? a.top : b;
    push("to", top);
    return to.apply(this, arguments);
  };
  window.scrollBy = function (a, b) {
    const dy = a && typeof a === "object" ? a.y : b;
    push("by", dy);
    return by.apply(this, arguments);
  };
})();
"""


def _today_metrics(page):
    return page.evaluate(
        """() => {
          const cell = document.querySelector(".cal-cell--today");
          const panel = document.getElementById("calendarPanel");
          const log = window.__bwScrollLog || [];
          const trace = window.__bwCalendarTrace || [];
          return {
            y: Math.round(window.scrollY || 0),
            todayTop: cell ? Math.round(cell.getBoundingClientRect().top) : null,
            todayIso: cell && cell.getAttribute("data-iso"),
            busy: !!(panel && panel.classList.contains("calendar-panel--loading")),
            restoration: String(history.scrollRestoration || ""),
            toCount: log.filter((row) => row.kind === "to").length,
            byCount: log.filter((row) => row.kind === "by").length,
            landCount: trace.filter((row) => row.event === "mobile-today").length,
            topCount: trace.filter((row) => row.event === "mobile-top").length,
            cashHealthTop: document.querySelector("#sidebarCashHealthCard")
              ? Math.round(document.querySelector("#sidebarCashHealthCard").getBoundingClientRect().top)
              : null,
            renders: trace.filter((row) => row.event === "renderCalendar").length,
            daily: trace.some((row) => row.event === "daily-balances-painted"),
            secondary: trace.some((row) => row.event === "secondary-painted"),
            welcomeOpen: !!document.querySelector("#bwForecastReadyModal.modal-overlay--open"),
            tourOpen: !!document.querySelector(".bw-tour-tooltip--open"),
          };
        }"""
    )


@pytest.mark.smoke_title("Mobile login opens Cash Health at the top")
@pytest.mark.parametrize("width", [320, 375, 390])
def test_mobile_login_lands_once(page, seed, guard, width):
    page.set_viewport_size({"width": width, "height": 844})
    page.add_init_script(SCROLL_HOOK)
    login(page, seed["active"]["email"], seed["active"]["password"])
    expect(page.locator("#sidebarCashHealthCard")).to_be_visible()
    expect(page.locator("#calendarPanel")).not_to_have_class(re.compile(r"calendar-panel--loading"))
    after_ready = _today_metrics(page)
    page.wait_for_timeout(2800)
    after_settle = _today_metrics(page)

    assert after_ready["daily"] or after_ready["todayIso"], "daily balances never painted"
    assert after_settle["restoration"] == "manual"
    assert after_settle["y"] <= 24, after_settle
    assert after_settle["byCount"] == 0, after_settle
    assert after_settle["landCount"] == 0, after_settle
    assert after_settle["toCount"] <= 1, after_settle
    if after_settle["cashHealthTop"] is not None:
        assert after_settle["cashHealthTop"] < 280, after_settle
    expect(page.get_by_role("heading", name="Cash Health")).to_be_visible()
    assert not after_settle["welcomeOpen"]
    assert not after_settle["tourOpen"]
    guard.assert_clean()


@pytest.mark.smoke_title("Slow calendar fetches still paint daily balances first")
def test_mobile_slow_network_keeps_daily_balances_first(page, seed, guard):
    page.set_viewport_size({"width": 375, "height": 844})
    page.add_init_script(SCROLL_HOOK)

    def delay(route):
        url = route.request.url
        if "calendar-month-daily" not in url and route.request.method == "GET":
            time.sleep(0.18)
        route.continue_()

    page.route("**/api/**", delay)
    login(page, seed["active"]["email"], seed["active"]["password"])
    expect(page.locator(".cal-cell--today .cal-balance, .cal-cell--today")).to_be_visible()
    expect(page.get_by_role("heading", name="Cash Health")).to_be_visible()
    metrics = _today_metrics(page)
    assert metrics["daily"] or metrics["todayIso"]
    assert metrics["y"] <= 24, metrics
    assert metrics["landCount"] == 0, metrics
    page.unroute("**/api/**")
    expect(page.locator("#calendarPanel")).not_to_have_class(re.compile(r"calendar-panel--loading"), timeout=30_000)
    guard.assert_clean()


@pytest.mark.smoke_title("Mobile Today control scrolls to today")
def test_mobile_today_button_scrolls_to_today(page, seed, guard):
    page.set_viewport_size({"width": 390, "height": 844})
    page.add_init_script(SCROLL_HOOK)
    login(page, seed["active"]["email"], seed["active"]["password"])
    expect(page.get_by_role("heading", name="Cash Health")).to_be_visible()
    expect(page.locator("#calendarPanel")).not_to_have_class(re.compile(r"calendar-panel--loading"))
    page.locator("#calendarGoToday").click()
    page.wait_for_timeout(500)
    metrics = _today_metrics(page)
    assert metrics["landCount"] >= 1 or (metrics["todayTop"] is not None and metrics["todayTop"] < 220), metrics
    guard.assert_clean()
