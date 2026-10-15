"""Public sample forecast. Fictional data stays in the browser."""

from __future__ import annotations

import calendar
import re
from datetime import date

import pytest
from playwright.sync_api import expect

from smoke_guard import SMOKE_ORIGIN
from support import assert_action_accessible, assert_no_horizontal_overflow, assert_route_ok


def _month_label(year: int, month: int) -> str:
    return f"{calendar.month_name[month]} {year}"


def _shift_month(year: int, month: int, delta: int) -> tuple[int, int]:
    index = year * 12 + (month - 1) + delta
    return index // 12, index % 12 + 1


def _track_api(page):
    api_calls = []
    writes = []

    def _track(request):
        if "/api/" in request.url:
            api_calls.append(request.url)
        if request.method not in ("GET", "HEAD") and request.url.startswith(SMOKE_ORIGIN):
            writes.append(f"{request.method} {request.url}")

    page.on("request", _track)
    return api_calls, writes


def _assert_forecast_untouched(api_calls, writes):
    assert [url for url in api_calls if "/api/auth/me" not in url] == []
    assert writes == []


@pytest.mark.smoke_title("Sample forecast month math")
def test_sample_forecast_month_and_balances(page, guard):
    api_calls, writes = _track_api(page)
    response = page.goto("/preview/")
    assert_route_ok(response, "/preview/")
    today = date.today()
    expect(page.locator("#previewMonthLabel")).to_have_text(_month_label(today.year, today.month))
    expect(page.get_by_role("dialog")).to_have_count(0)
    expect(page.get_by_role("heading", name="Explore a sample forecast")).to_be_visible()
    expect(page.locator(".preview-mode__badge")).to_have_count(0)
    expect(page.locator(".preview-header-label")).to_have_count(0)
    expect(page.locator("#previewTryExpense")).to_have_count(0)
    expect(page.locator("#homeLoginLink")).to_have_text("Login")
    expect(page.locator("#previewReconcile")).to_have_js_property("open", False)
    expect(page.locator("#previewExplore")).to_have_js_property("open", False)
    expect(page.locator(".preview-mode__text")).to_have_text("Fictional finances. Nothing is saved.")
    expect(page.locator(".preview-sample-chip")).to_have_count(0)
    banner_box = page.evaluate(
        """() => {
          const nav = document.querySelector('.top-nav').getBoundingClientRect();
          const banner = document.querySelector('.preview-mode').getBoundingClientRect();
          return { navBottom: nav.bottom, top: banner.top, bottom: banner.bottom, height: banner.height };
        }"""
    )
    assert banner_box["height"] > 32
    assert banner_box["top"] >= banner_box["navBottom"] - 1
    page.evaluate("window.scrollTo(0, 120)")
    scrolled = page.evaluate(
        """() => {
          const nav = document.querySelector('.top-nav').getBoundingClientRect();
          const banner = document.querySelector('.preview-mode');
          const box = banner.getBoundingClientRect();
          const hit = document.elementFromPoint(box.left + box.width / 2, box.top + 12);
          return {
            navBottom: nav.bottom,
            top: box.top,
            bottom: box.bottom,
            height: box.height,
            uncovered: !!(hit && banner.contains(hit))
          };
        }"""
    )
    assert scrolled["height"] > 32
    assert scrolled["top"] >= scrolled["navBottom"] - 1
    assert scrolled["bottom"] > scrolled["navBottom"] + 40
    assert scrolled["uncovered"]
    page.evaluate("window.scrollTo(0, 0)")
    expect(page.locator(".top-nav__tab")).to_have_count(0)
    expect(page.locator("#previewIncome")).to_have_text("$3,400")
    expect(page.locator("#previewExpenses")).to_have_text("$5,960")
    expect(page.locator("#previewNet")).to_have_text("$-2,560")
    expect(page.locator("#previewCashWarning")).to_have_text(
        re.compile(r"Your forecast drops to \$150 on \w+ 14 — \$1,350 below your \$1,500 safety cushion\.")
    )
    expect(page.locator("#previewLowBalance")).to_have_text("$150")
    expect(page.locator("#previewBufferGap")).to_have_text("$1,350 below your $1,500 safety cushion.")
    expect(page.locator('.cal-cell[data-day="1"]')).to_have_attribute("data-end", "4850")
    expect(page.locator('.cal-cell[data-day="4"]')).to_have_attribute("data-end", "4670")
    expect(page.locator('.cal-cell[data-day="6"]')).to_have_attribute("data-end", "2270")
    day10 = page.locator('.cal-cell[data-day="10"]')
    expect(day10).to_have_attribute("data-end", "2060")
    expect(day10).to_have_attribute("data-projected", "2060")
    expect(day10).to_have_class(re.compile(r"cal-cell--reconciled"))
    expect(day10).not_to_have_class(re.compile(r"cal-cell--adjusted-balance"))
    expect(day10.locator(".cal-balance-status-pill--reconciled")).to_have_text("✓ Reconciled")
    expect(page.locator('.cal-cell[data-day="9"]')).not_to_have_class(re.compile(r"cal-cell--adjusted-balance|cal-cell--reconciled"))
    expect(page.locator('.cal-cell[data-day="11"]')).to_have_attribute("data-end", "310")
    expect(page.locator('.cal-cell[data-day="11"]')).to_have_class(re.compile(r"cal-cell--bal-warn"))
    expect(page.locator('.cal-cell[data-day="14"]')).to_have_attribute("data-end", "150")
    expect(page.locator('.cal-cell[data-day="14"]')).to_have_class(re.compile(r"cal-cell--bal-warn"))
    expect(page.locator('.cal-cell[data-day="14"]')).to_have_class(re.compile(r"cal-cell--bal-low"))
    expect(page.locator('.cal-cell[data-day="11"]')).not_to_have_class(re.compile(r"cal-cell--bal-low"))
    expect(page.locator('.cal-cell[data-day="14"]')).not_to_have_class(re.compile(r"cal-cell--bal-risk"))
    expect(page.locator('.cal-cell[data-day="15"]')).to_have_attribute("data-end", "3550")
    expect(page.locator('.cal-cell[data-day="15"]')).not_to_have_class(re.compile(r"cal-cell--bal-warn|cal-cell--bal-risk"))
    day20 = page.locator('.cal-cell[data-day="20"]')
    expect(day20).to_have_attribute("data-end", "3240")
    expect(day20).to_have_attribute("data-projected", "3360")
    expect(day20).to_have_class(re.compile(r"cal-cell--adjusted-balance"))
    expect(day20.locator(".cal-balance-status-pill--adjusted")).to_have_text("↺ Adjusted")
    expect(day20).not_to_have_class(re.compile(r"cal-cell--reconciled"))
    expect(page.locator('.cal-cell[data-day="24"]')).to_have_attribute("data-end", "2820")
    expect(page.locator('.cal-cell[data-day="28"]')).to_have_attribute("data-end", "2170")
    expect(page.locator('.cal-dow').first).to_have_text("Sun")

    page.locator("#calendarNextMonth").click()
    next_year, next_month = _shift_month(today.year, today.month, 1)
    expect(page.locator("#previewMonthLabel")).to_have_text(_month_label(next_year, next_month))
    expect(page.locator("#previewLowBalance")).to_have_text("$150")
    expect(page.locator('.cal-cell[data-day="10"]')).to_have_attribute("data-end", "2060")
    expect(page.locator('.cal-cell[data-day="10"] .cal-balance-status-pill--reconciled')).to_have_text("✓ Reconciled")
    expect(page.locator('.cal-cell[data-day="14"]')).to_have_attribute("data-end", "150")
    expect(page.locator('.cal-cell[data-day="15"]')).to_have_attribute("data-end", "3550")

    page.locator("#calendarPrevMonth").click()
    expect(page.locator("#previewMonthLabel")).to_have_text(_month_label(today.year, today.month))
    expect(page.locator("#previewLowBalance")).to_have_text("$150")
    _assert_forecast_untouched(api_calls, writes)
    guard.assert_clean()


@pytest.mark.smoke_title("Sample details stay read only")
def test_sample_forecast_readonly_details(page, guard):
    response = page.goto("/preview/")
    assert_route_ok(response, "/preview/")
    page.locator('.cal-cell[data-day="11"] button', has_text="Credit card").click()
    expect(page.locator("#previewDetail")).to_be_visible()
    expect(page.locator("#previewDetailTitle")).to_contain_text("11")
    expect(page.locator("#previewDetailList")).to_contain_text("Credit card")
    expect(page.locator("#previewDetailList")).to_contain_text("$1,750.00")
    expect(page.locator("#previewDetail")).to_contain_text("Read only")
    expect(page.locator("#previewDetail input, #previewDetail textarea, #previewDetail select")).to_have_count(0)
    page.locator("#previewDetailClose").click()
    page.locator('.cal-cell[data-day="1"]').click()
    expect(page.locator("#previewDetailList")).to_contain_text("No transactions this day")
    expect(page.locator("#previewDetailBalance")).to_contain_text("Ending balance $4,850.00")
    guard.assert_clean()


@pytest.mark.smoke_title("Hypothetical expense stays in the browser")
def test_sample_forecast_hypothetical_and_reset(page, guard):
    api_calls, writes = _track_api(page)
    response = page.goto("/preview/")
    assert_route_ok(response, "/preview/")
    stored = page.evaluate(
        "() => Object.keys(localStorage).sort().concat(Object.keys(sessionStorage).sort())"
    )
    page.locator("#previewExplore summary").click()
    page.locator("#previewExpenseDay").select_option("14")
    page.locator("#previewExpenseAmount").fill("500")
    expect(page.locator('.cal-cell[data-day="14"]')).to_have_attribute("data-end", "-350")
    expect(page.locator('.cal-cell[data-day="14"]')).to_have_class(re.compile(r"cal-cell--bal-risk"))
    expect(page.locator('.cal-cell[data-day="15"]')).to_have_attribute("data-end", "3050")
    expect(page.locator('.cal-cell[data-day="20"]')).to_have_attribute("data-end", "3240")
    expect(page.locator('.cal-cell[data-day="28"]')).to_have_attribute("data-end", "2170")
    expect(page.locator("#previewLowBalance")).to_have_text("($350)")
    expect(page.locator("#previewBufferGap")).to_have_text("$1,850 below your $1,500 safety cushion.")
    expect(page.locator("#previewExpenses")).to_have_text("$6,460")
    expect(page.locator("#previewNet")).to_have_text("$-3,060")
    page.locator('.cal-cell[data-day="14"] button', has_text="Hypothetical expense").click()
    expect(page.locator("#previewDetailList")).to_contain_text("Demo only. Not saved.")
    page.locator("#previewDetailClose").click()
    page.locator("#previewReset").click()
    expect(page.locator("#previewExpenseAmount")).to_have_value("")
    expect(page.locator('.cal-cell[data-day="10"]')).to_have_attribute("data-end", "2060")
    expect(page.locator('.cal-cell[data-day="10"] .cal-balance-status-pill--reconciled')).to_have_text("✓ Reconciled")
    expect(page.locator('.cal-cell[data-day="14"]')).to_have_attribute("data-end", "150")
    expect(page.locator('.cal-cell[data-day="14"]')).to_have_class(re.compile(r"cal-cell--bal-warn"))
    expect(page.locator('.cal-cell[data-day="15"]')).to_have_attribute("data-end", "3550")
    expect(page.locator("#previewLowBalance")).to_have_text("$150")
    expect(page.locator("#previewBufferGap")).to_have_text("$1,350 below your $1,500 safety cushion.")
    after = page.evaluate(
        "() => Object.keys(localStorage).sort().concat(Object.keys(sessionStorage).sort())"
    )
    assert after == stored
    _assert_forecast_untouched(api_calls, writes)
    guard.assert_clean()


@pytest.mark.smoke_title("Sample reconciliation adjusts only later days")
def test_sample_forecast_reconciliation(page, guard):
    api_calls, writes = _track_api(page)
    response = page.goto("/preview/")
    assert_route_ok(response, "/preview/")
    expect(page.locator('.cal-cell[data-day="9"]')).to_have_attribute("data-end", "2060")
    expect(page.locator('.cal-cell[data-day="9"]')).not_to_have_class(re.compile(r"cal-cell--adjusted-balance"))
    page.locator("#previewReconcile summary").click()
    expect(page.locator("#previewReconcile")).to_contain_text(
        "See how entering an actual checking balance updates future projections."
    )
    expect(page.locator("#previewReconcileLead")).to_contain_text("Fictional example")
    expect(page.locator("#previewReconcileLead")).to_contain_text("not your bank balance")
    expect(page.locator("#previewReconcileForecast")).to_have_text("$2,060")
    expect(page.locator("#previewReconcileBank")).to_have_text("$1,925")
    expect(page.locator("#previewReconcileDiff")).to_have_text("−$135")
    page.locator("#previewApplyReconcile").click()
    day9 = page.locator('.cal-cell[data-day="9"]')
    expect(day9).to_have_attribute("data-end", "1925")
    expect(day9).to_have_attribute("data-projected", "2060")
    expect(day9).to_have_class(re.compile(r"cal-cell--adjusted-balance"))
    expect(day9.locator(".cal-balance-status-pill--adjusted")).to_have_text("↺ Adjusted")
    expect(page.locator('.cal-cell[data-day="8"]')).to_have_attribute("data-end", "2270")
    expect(page.locator('.cal-cell[data-day="4"]')).to_have_attribute("data-end", "4670")
    expect(page.locator('.cal-cell[data-day="10"]')).to_have_attribute("data-end", "1925")
    expect(page.locator('.cal-cell[data-day="10"]')).to_have_attribute("data-projected", "1925")
    expect(page.locator('.cal-cell[data-day="10"]')).to_have_class(re.compile(r"cal-cell--reconciled"))
    expect(page.locator('.cal-cell[data-day="10"] .cal-balance-status-pill--reconciled')).to_have_text("✓ Reconciled")
    expect(page.locator('.cal-cell[data-day="10"] .cal-balance-status-pill--adjusted')).to_have_count(0)
    expect(page.locator('.cal-cell[data-day="11"]')).to_have_attribute("data-end", "175")
    expect(page.locator('.cal-cell[data-day="11"]')).to_have_class(re.compile(r"cal-cell--bal-warn"))
    expect(page.locator('.cal-cell[data-day="14"]')).to_have_attribute("data-end", "15")
    expect(page.locator('.cal-cell[data-day="14"]')).to_have_class(re.compile(r"cal-cell--bal-warn"))
    expect(page.locator('.cal-cell[data-day="15"]')).to_have_attribute("data-end", "3415")
    expect(page.locator('.cal-cell[data-day="15"]')).not_to_have_class(re.compile(r"cal-cell--bal-warn|cal-cell--bal-risk"))
    expect(page.locator('.cal-cell[data-day="20"]')).to_have_attribute("data-end", "3240")
    expect(page.locator('.cal-cell[data-day="20"]')).to_have_attribute("data-projected", "3225")
    expect(page.locator('.cal-cell[data-day="20"] .cal-balance-status-pill--adjusted')).to_have_text("↺ Adjusted")
    expect(page.locator('.cal-cell[data-day="28"]')).to_have_attribute("data-end", "2170")
    expect(page.locator("#previewLowBalance")).to_have_text("$15")
    expect(page.locator("#previewBufferGap")).to_have_text("$1,485 below your $1,500 safety cushion.")
    expect(page.locator("#previewIncome")).to_have_text("$3,400")
    expect(page.locator("#previewExpenses")).to_have_text("$5,960")
    expect(page.locator("#previewNet")).to_have_text("$-2,560")
    day9.locator(".cal-day-tx-line").click()
    expect(page.locator("#previewDetailBalance")).to_contain_text("Forecast was $2,060.00")
    expect(page.locator("#previewDetailBalance")).to_contain_text("Fictional bank balance $1,925.00")
    expect(page.locator("#previewDetailBalance")).to_contain_text("Starting balance $2,270.00")
    page.locator("#previewDetailClose").click()

    page.locator("#previewExplore summary").click()
    page.locator("#previewExpenseDay").select_option("14")
    page.locator("#previewExpenseAmount").fill("500")
    expect(page.locator('.cal-cell[data-day="9"]')).to_have_attribute("data-end", "1925")
    expect(page.locator('.cal-cell[data-day="8"]')).to_have_attribute("data-end", "2270")
    expect(page.locator('.cal-cell[data-day="10"]')).to_have_attribute("data-end", "1925")
    expect(page.locator('.cal-cell[data-day="10"] .cal-balance-status-pill--reconciled')).to_have_text("✓ Reconciled")
    expect(page.locator('.cal-cell[data-day="14"]')).to_have_attribute("data-end", "-485")
    expect(page.locator('.cal-cell[data-day="14"]')).to_have_class(re.compile(r"cal-cell--bal-risk"))
    expect(page.locator('.cal-cell[data-day="15"]')).to_have_attribute("data-end", "2915")
    expect(page.locator("#previewLowBalance")).to_have_text("($485)")
    expect(page.locator("#previewBufferGap")).to_have_text("$1,985 below your $1,500 safety cushion.")
    expect(page.locator("#previewExpenses")).to_have_text("$6,460")
    expect(page.locator("#previewNet")).to_have_text("$-3,060")

    page.locator("#previewResetReconcile").click()
    expect(page.locator('.cal-cell[data-day="9"]')).to_have_attribute("data-end", "2060")
    expect(page.locator('.cal-cell[data-day="9"]')).not_to_have_class(re.compile(r"cal-cell--adjusted-balance"))
    expect(page.locator('.cal-cell[data-day="10"]')).to_have_attribute("data-end", "2060")
    expect(page.locator('.cal-cell[data-day="10"] .cal-balance-status-pill--reconciled')).to_have_text("✓ Reconciled")
    expect(page.locator('.cal-cell[data-day="14"]')).to_have_attribute("data-end", "-350")
    expect(page.locator('.cal-cell[data-day="15"]')).to_have_attribute("data-end", "3050")
    page.locator("#previewReset").click()
    expect(page.locator('.cal-cell[data-day="14"]')).to_have_attribute("data-end", "150")
    expect(page.locator("#previewLowBalance")).to_have_text("$150")

    page.locator("#previewApplyReconcile").click()
    page.locator("#previewExpenseDay").select_option("9")
    page.locator("#previewExpenseAmount").fill("100")
    expect(page.locator('.cal-cell[data-day="8"]')).to_have_attribute("data-end", "2270")
    expect(page.locator('.cal-cell[data-day="9"]')).to_have_attribute("data-projected", "1960")
    expect(page.locator('.cal-cell[data-day="9"]')).to_have_attribute("data-end", "1925")
    expect(page.locator('.cal-cell[data-day="10"]')).to_have_attribute("data-end", "1925")
    expect(page.locator('.cal-cell[data-day="10"]')).to_have_attribute("data-projected", "1925")
    expect(page.locator('.cal-cell[data-day="10"] .cal-balance-status-pill--reconciled')).to_have_text("✓ Reconciled")
    expect(page.locator("#previewReconcileDiff")).to_have_text("−$35")
    page.locator("#calendarNextMonth").click()
    expect(page.locator('.cal-cell[data-day="9"]')).to_have_attribute("data-end", "1925")
    expect(page.locator('.cal-cell[data-day="8"]')).to_have_attribute("data-end", "2270")
    expect(page.locator("#previewExpenses")).to_have_text("$5,960")
    page.locator("#previewResetReconcile").click()
    expect(page.locator('.cal-cell[data-day="9"]')).to_have_attribute("data-end", "2060")
    _assert_forecast_untouched(api_calls, writes)
    guard.assert_clean()


@pytest.mark.smoke_title("Sample forecast links keep the public signup path")
def test_sample_forecast_signup_and_homepage(page, guard):
    response = page.goto("/")
    assert_route_ok(response, "/")
    expect(page.locator("a.landing-hero__cta").first).to_have_text("See my future balance")
    expect(page.locator("a.landing-hero__cta.home-cta--guest")).to_have_attribute(
        "href", "/account-setup/?fresh=1"
    )
    sample = page.locator("a.landing-hero__sample")
    expect(sample).to_have_text("Try a sample forecast")
    expect(sample).to_have_attribute("href", "/preview/")
    sample.click()
    page.wait_for_url(re.compile(r"/preview/?$"))
    expect(page.locator("#previewSignup")).to_have_attribute("href", "/account-setup/?fresh=1")
    expect(page.locator("#previewSignup")).to_be_visible()
    guard.assert_clean()


@pytest.mark.smoke_title("Signed-in forecast shell is unchanged")
def test_signed_in_forecast_shell_unchanged(page, guard):
    response = page.request.get(SMOKE_ORIGIN + "/calendar/")
    assert response.ok
    body = response.text()
    assert 'id="calendarGrid"' in body
    assert "previewWhatIf" not in body
    assert "Try a hypothetical expense" not in body
    assert "app.js" in body
    guard.assert_clean()


@pytest.mark.smoke_title("Public walkthrough is optional")
def test_public_preview_walkthrough(page, guard):
    api_calls, writes = _track_api(page)
    response = page.goto("/preview/")
    assert_route_ok(response, "/preview/")
    expect(page.get_by_role("dialog")).to_have_count(0)
    expect(page.get_by_role("button", name=re.compile(r"Mortgage"))).to_be_visible()
    expect(page.get_by_role("button", name=re.compile(r"Paycheck"))).to_be_visible()
    page.locator("#previewReplay").click()
    expect(page.get_by_role("dialog")).to_be_visible()
    expect(page.locator("#previewTourCounter")).to_have_text("1 of 5")
    expect(page.get_by_text("See upcoming income, expenses, and the checking balance each day.")).to_be_visible()
    expect(page.locator("#previewReconcile")).to_have_js_property("open", False)
    page.locator("#previewTourNext").click()
    expect(page.locator("#previewTourCounter")).to_have_text("2 of 5")
    page.locator("#previewTourBack").click()
    expect(page.locator("#previewTourCounter")).to_have_text("1 of 5")
    page.keyboard.press("ArrowRight")
    expect(page.locator("#previewTourCounter")).to_have_text("2 of 5")
    for _ in range(4):
        page.locator("#previewTourNext").click()
    expect(page.get_by_role("heading", name="Now see your own future balance.")).to_be_visible()
    expect(page.get_by_text("Free for 14 days · No bank connection required")).to_be_visible()
    expect(page.locator("#previewTourStart")).to_have_attribute("href", "/account-setup/?fresh=1")
    expect(page.locator("#previewTourFaq")).to_have_attribute("href", "/help.html")
    page.keyboard.press("Escape")
    expect(page.get_by_role("dialog")).to_be_hidden()
    _assert_forecast_untouched(api_calls, writes)
    assert_no_horizontal_overflow(page)
    guard.assert_clean()


@pytest.mark.smoke_title("Sample forecast fits common screen widths")
def test_sample_forecast_fits_common_widths(page, guard):
    response = page.goto("/preview/")
    assert_route_ok(response, "/preview/")
    expect(page.locator("#previewReconcile summary")).to_contain_text("Update bank balance")
    expect(page.locator("#previewExplore summary")).to_contain_text("Try a hypothetical expense")
    expect(page.locator("#previewReconcile")).to_have_js_property("open", False)
    expect(page.locator("#previewExplore")).to_have_js_property("open", False)
    page.locator("#previewReconcile summary").focus()
    page.keyboard.press("Enter")
    expect(page.locator("#previewReconcile")).to_have_js_property("open", True)
    expect(page.locator("#previewReconcile .preview-demo__chevron")).to_be_visible()
    page.keyboard.press("Enter")
    expect(page.locator("#previewReconcile")).to_have_js_property("open", False)
    for width, height in ((1280, 800), (1440, 900), (1920, 1080), (768, 1024), (390, 844)):
        page.set_viewport_size({"width": width, "height": height})
        assert_no_horizontal_overflow(page)
        for selector in ("#previewSignup", "#homeLoginLink", "#previewReplay", "#calendarGoToday"):
            assert_action_accessible(page, page.locator(selector))
    guard.assert_clean()


@pytest.mark.smoke_title("Public sample forecast fits a phone")
def test_public_preview_mobile(page, guard):
    page.set_viewport_size({"width": 390, "height": 800})
    response = page.goto("/preview/")
    assert_route_ok(response, "/preview/")
    expect(page.locator("#preview-calendar")).to_be_visible()
    expect(page.get_by_text("Credit card").first).to_be_visible()
    expect(page.locator("#previewSignup")).to_be_visible()
    expect(page.locator("#sidebarCashHealthCard")).to_be_visible()
    page.locator("#previewExplore summary").click()
    page.locator("#previewExpenseAmount").fill("80")
    expect(page.locator("#previewLowBalance")).not_to_have_text("$150")
    page.locator("#previewReset").click()
    expect(page.locator("#previewLowBalance")).to_have_text("$150")
    assert_no_horizontal_overflow(page)
    page.set_viewport_size({"width": 320, "height": 700})
    assert_no_horizontal_overflow(page)
    guard.assert_clean()


@pytest.mark.smoke_title("FAQ opens the public sample forecast")
def test_faq_links_to_public_preview(page, guard):
    response = page.goto("/help.html")
    assert_route_ok(response, "/help.html")
    link = page.get_by_role("link", name="Take a quick walkthrough")
    expect(link).to_have_attribute("href", re.compile(r"preview/?$"))
    expect(page.locator(".help-callout__hint")).to_contain_text("no account needed")
    expect(page.locator("body")).not_to_contain_text("sign in first")
    questions = page.locator(".help-faq__question").all_inner_texts()
    assert questions == [
        "What is BalanceWhiz?",
        "Do I connect my bank?",
        "Do I need to enter every transaction?",
        "How often should I update BalanceWhiz?",
        "What if a bill changes from month to month?",
        "Can I use BalanceWhiz with multiple checking accounts?",
        "What happens if my balance is getting too low?",
        "How do I reset my password?",
        "How does the free trial and billing work?",
    ]
    page.locator(".help-faq__item").nth(3).locator("summary").click()
    expect(page.get_by_text("There’s no required schedule.")).to_be_visible()
    link.click()
    page.wait_for_url(re.compile(r"/preview/?$"))
    expect(page.locator("#preview-calendar")).to_be_visible()
    expect(page.get_by_role("dialog")).to_have_count(0)
    expect(page.locator("#previewReplay")).to_have_text("Take a quick tour")
    expect(page.locator(".preview-tool--tour")).to_have_count(0)
    guard.assert_clean()
