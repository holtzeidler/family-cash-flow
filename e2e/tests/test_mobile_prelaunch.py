"""Phone summary, Reports menu labels, and Forecast landing on the local day."""

from __future__ import annotations

import uuid

import pytest
from playwright.sync_api import expect

from support import login
from test_core_workflows import _complete_setup_through_forecast, _register_checking


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
          const first = document.querySelector(".calendar--mobile .cal-cell:not(.cal-cell--out), .cal-cell:not(.cal-cell--out)");
          const header = document.querySelector(".top-nav");
          const strip = document.getElementById("calCashHealthStrip");
          const stripRect = strip && !strip.hidden && strip.classList.contains("is-active")
            ? strip.getBoundingClientRect()
            : null;
          const box = today.getBoundingClientRect();
          const now = new Date();
          const local = now.getFullYear() + "-"
            + String(now.getMonth() + 1).padStart(2, "0") + "-"
            + String(now.getDate()).padStart(2, "0");
          const headerBottom = header ? header.getBoundingClientRect().bottom : 0;
          const minTop = Math.max(headerBottom + 4, stripRect ? stripRect.bottom - 2 : headerBottom + 4);
          return {
            iso: today.getAttribute("data-iso"),
            local,
            firstIso: first ? first.getAttribute("data-iso") : null,
            top: box.top,
            bottom: box.bottom,
            headerBottom,
            stripBottom: stripRect ? stripRect.bottom : null,
            inView: box.top >= minTop - 2 && box.top < window.innerHeight - 80,
            highlighted: today.classList.contains("cal-cell--today"),
            vh: window.innerHeight,
            tourOpen: !!document.querySelector(".bw-tour-tooltip--open"),
            welcomeOpen: !!document.querySelector("#bwForecastReadyModal.modal-overlay--open"),
          };
        }"""
    )


def _assert_today(pos):
    assert pos["iso"] == pos["local"], pos
    assert pos["highlighted"] is not False, pos
    assert pos["bottom"] > pos["headerBottom"] + 4, pos
    assert pos["top"] < pos["headerBottom"] + 220, pos
    if pos.get("inView") is not None:
        assert pos["inView"] is True, pos
    if pos.get("firstIso") and pos["firstIso"] != pos["iso"]:
        assert pos["firstIso"] < pos["iso"], pos


@pytest.mark.smoke_title("After onboarding, iPhone Forecast opens on today")
def test_mobile_onboarding_lands_on_today(page, guard):
    page.set_viewport_size({"width": 390, "height": 844})
    email = f"bw-smoke-today-onboard-{uuid.uuid4().hex[:8]}@example.com"
    ready = _complete_setup_through_forecast(
        page,
        email,
        txs=[{"kind": "income", "amount": "100"}, {"kind": "expense", "amount": "40"}],
    )
    expect(ready).to_be_visible()
    ready.locator("#bwForecastReadySkipBtn").click()
    expect(ready).to_be_hidden()
    expect(page.locator(".bw-tour-tooltip--open")).to_have_count(0)
    assert page.evaluate("() => localStorage.getItem('bw_tour_seen_v1')")
    page.wait_for_timeout(120)
    pos = _today_position(page)
    _assert_today(pos)
    assert not pos["welcomeOpen"], pos
    assert not pos["tourOpen"], pos
    page.reload()
    expect(page.locator("#calendarGrid")).to_be_visible()
    expect(page.locator(".bw-tour-tooltip--open")).to_have_count(0)
    expect(page.locator("#bwForecastReadyModal.modal-overlay--open")).to_have_count(0)
    _assert_today(_today_position(page))
    guard.assert_clean()


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
    groups = page.evaluate(
        """() => [...document.querySelectorAll("#reportsMobileNavSelect optgroup")].map((g) => g.label)"""
    )
    assert "Reports" in groups, groups
    report = page.evaluate(
        """() => {
          const title = document.querySelector("#reportsViewPanel h1, #reportsViewPanel h2");
          return title ? title.getBoundingClientRect().top : null;
        }"""
    )
    assert report is not None and 0 < report < 260, report

    page.locator("#navSettingsView").click()
    page.wait_for_timeout(200)
    settings = page.evaluate(
        """() => {
          const cash = document.getElementById("sidebarCashHealthCard");
          const menu = document.getElementById("settingsMobileNav");
          const select = document.getElementById("settingsMobileNavSelect");
          const profile = document.getElementById("settingsProfilePane");
          return {
            cashHidden: !cash || cash.hidden || getComputedStyle(cash).display === "none",
            menuVisible: !!(menu && getComputedStyle(menu).display !== "none"),
            options: select ? [...select.options].map((o) => o.textContent) : [],
            profileTop: profile ? profile.getBoundingClientRect().top : null,
            menuTop: menu ? menu.getBoundingClientRect().top : null,
          };
        }"""
    )
    assert settings["cashHidden"], settings
    assert settings["menuVisible"], settings
    assert "Profile" in settings["options"] and "Accounts" in settings["options"], settings
    assert settings["menuTop"] is not None and 0 < settings["menuTop"] < 220, settings

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
