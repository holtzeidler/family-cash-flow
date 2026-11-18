"""Phone summary, Reports menu labels, and Forecast landing on the local day."""

from __future__ import annotations

import pytest
from playwright.sync_api import expect

from support import login
from test_core_workflows import _register_checking


def _today_position(page):
    page.wait_for_function(
        """() => {
          const panel = document.getElementById("calendarPanel");
          const today = document.querySelector(".cal-cell--today");
          return !!(today && panel && !panel.classList.contains("calendar-panel--loading"));
        }""",
        timeout=20000,
    )
    page.wait_for_timeout(150)
    return page.evaluate(
        """() => {
          const today = document.querySelector(".cal-cell--today");
          const header = document.querySelector(".top-nav");
          const box = today.getBoundingClientRect();
          const now = new Date();
          const local = now.getFullYear() + "-"
            + String(now.getMonth() + 1).padStart(2, "0") + "-"
            + String(now.getDate()).padStart(2, "0");
          return {
            iso: today.getAttribute("data-iso"),
            local,
            top: box.top,
            bottom: box.bottom,
            headerBottom: header ? header.getBoundingClientRect().bottom : 0,
            vh: window.innerHeight,
          };
        }"""
    )


def _assert_today(pos):
    assert pos["iso"] == pos["local"], pos
    assert pos["bottom"] > pos["headerBottom"] + 4, pos
    assert pos["top"] < pos["headerBottom"] + 220, pos


@pytest.mark.smoke_title("Phone summary, report labels, and today stay in view")
def test_mobile_summary_reports_and_today(page, guard):
    page.set_viewport_size({"width": 390, "height": 844})
    email = _register_checking("1000.00", "2026-11-01")
    login(page, email, "SmokeOnly1!")

    _assert_today(_today_position(page))
    expect(page.locator("#mobileSummaryToggle")).to_have_text("Hide summary")
    expect(page.locator("#sidebarCashHealthCard #sidebarMonthLow")).to_be_visible()
    expect(page.locator("#sidebarMonthLow")).to_contain_text("Lowest balance this month")
    expect(page.locator("#sidebarForecastHints")).not_to_contain_text("Forecast low")

    page.locator("#navTransactionView").click()
    expect(page.locator("#mobileSummaryToggle")).to_have_text("Summary")
    expect(page.locator("#sidebarMonthLow")).to_be_hidden()
    page.wait_for_timeout(200)
    phone = page.evaluate(
        """() => {
          const title = document.querySelector("#transactionViewPanel h1, #transactionViewPanel .tm__title");
          const month = document.querySelector('[data-sidebar-key="month"]');
          const alerts = document.getElementById("sidebarBalanceThresholdAlerts");
          return {
            titleTop: title ? title.getBoundingClientRect().top : null,
            monthDisplay: month ? getComputedStyle(month).display : "",
            alertsDisplay: alerts ? getComputedStyle(alerts).display : "",
            collapsed: document.body.classList.contains("mobile-summary-collapsed"),
          };
        }"""
    )
    assert phone["collapsed"], phone
    assert phone["titleTop"] is not None and 0 < phone["titleTop"] < 220, phone
    assert phone["monthDisplay"] == "none", phone
    assert phone["alertsDisplay"] != "none", phone
    page.locator("#mobileSummaryToggle").click()
    expect(page.locator("#sidebarMonthLow")).to_be_visible()

    page.locator("#navReportsView").click()
    page.wait_for_timeout(200)
    options = page.evaluate(
        """() => [...document.querySelectorAll("#reportsMobileNavSelect option")].map((opt) => ({
          value: opt.value,
          text: opt.textContent,
        }))"""
    )
    assert len(options) >= 2, options
    for opt in options:
        assert opt["text"] and "[object Object]" not in opt["text"], opt
        assert opt["value"] and "[object Object]" not in opt["value"], opt
    report = page.evaluate(
        """() => {
          const title = document.querySelector("#reportsViewPanel h1, #reportsViewPanel h2");
          return title ? title.getBoundingClientRect().top : null;
        }"""
    )
    assert report is not None and 0 < report < 260, report

    page.locator("#navCalendarView").click()
    page.wait_for_timeout(200)
    _assert_today(_today_position(page))

    page.set_viewport_size({"width": 1280, "height": 900})
    page.wait_for_timeout(100)
    desktop = page.evaluate(
        """() => ({
          toggle: getComputedStyle(document.getElementById("mobileSummaryToggle")).display,
          month: getComputedStyle(document.querySelector('[data-sidebar-key="month"]')).display,
        })"""
    )
    assert desktop["toggle"] == "none", desktop
    assert desktop["month"] != "none", desktop
    guard.assert_clean()
