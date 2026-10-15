"""Public sample forecast. Fictional data stays in the browser."""

from __future__ import annotations

import calendar
import re
from datetime import date, timedelta

import pytest
from playwright.sync_api import expect

from smoke_guard import SMOKE_ORIGIN
from support import assert_action_accessible, assert_no_horizontal_overflow, assert_route_ok


def _month_label(year: int, month: int) -> str:
    return f"{calendar.month_name[month]} {year}"


def _freeze(page, year: int, month: int, day: int) -> None:
    page.add_init_script(
        f"""
        (() => {{
          const fixed = new Date({year}, {month - 1}, {day}, 12, 0, 0);
          const RealDate = Date;
          function MockDate(...args) {{
            if (args.length === 0) return new RealDate(fixed.getTime());
            return new RealDate(...args);
          }}
          MockDate.now = () => fixed.getTime();
          MockDate.parse = RealDate.parse;
          MockDate.UTC = RealDate.UTC;
          MockDate.prototype = RealDate.prototype;
          window.Date = MockDate;
        }})();
        """
    )


def _assert_tour_card_in_view(page) -> None:
    box = page.locator("#previewTourDialog").bounding_box()
    viewport = page.viewport_size
    assert box is not None and viewport is not None
    assert box["width"] > 40 and box["height"] > 40
    assert box["x"] >= -1
    assert box["y"] >= -1
    assert box["x"] + box["width"] <= viewport["width"] + 1
    assert box["y"] + box["height"] <= viewport["height"] + 1


def _iso(year: int, month: int, day: int, offset: int) -> str:
    return (date(year, month, day) + timedelta(days=offset)).isoformat()


def _cell(page, iso: str):
    return page.locator(f'.cal-cell[data-iso="{iso}"]')


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
    _freeze(page, 2026, 10, 15)
    response = page.goto("/preview/")
    assert_route_ok(response, "/preview/")
    expect(page.locator("#previewMonthLabel")).to_have_text("October 2026")
    expect(page.get_by_role("dialog")).to_have_count(0)
    expect(page.get_by_role("heading", name="Explore a sample forecast")).to_be_visible()
    expect(page.locator(".preview-mode__badge")).to_have_count(0)
    expect(page.locator(".preview-header-label")).to_have_count(0)
    expect(page.locator("#previewTryExpense")).to_have_count(0)
    expect(page.locator("#homeLoginLink")).to_have_text("Log in")
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
    expect(page.locator("#previewExpenses")).to_have_text("$5,310")
    expect(page.locator("#previewNet")).to_have_text("$-1,910")
    expect(page.locator("#previewCashWarning")).to_have_text(
        "Your forecast drops to $150 on Oct 19 — $1,350 below your $1,500 safety cushion."
    )
    expect(page.locator("#previewLowBalance")).to_have_text("$150")
    expect(page.locator("#previewBufferGap")).to_have_text("$1,350 below your $1,500 safety cushion.")
    def cell(offset):
        return _cell(page, _iso(2026, 10, 15, offset))

    expect(cell(-8)).to_have_attribute("data-end", "4670")
    expect(cell(-6)).to_have_attribute("data-end", "2270")
    reconciled_day = cell(-3)
    expect(reconciled_day).to_have_attribute("data-end", "2060")
    expect(reconciled_day).to_have_attribute("data-projected", "2060")
    expect(reconciled_day).to_have_class(re.compile(r"cal-cell--reconciled"))
    expect(reconciled_day).not_to_have_class(re.compile(r"cal-cell--adjusted-balance"))
    expect(reconciled_day.locator(".cal-balance-status-pill--reconciled")).to_have_text("✓ Reconciled")
    expect(cell(-5)).not_to_have_class(re.compile(r"cal-cell--adjusted-balance|cal-cell--reconciled"))
    mild = cell(3)
    expect(mild).to_have_attribute("data-end", "1400")
    expect(mild).to_have_class(re.compile(r"cal-cell--bal-warn"))
    expect(mild).not_to_have_class(re.compile(r"cal-cell--bal-low"))
    low = cell(4)
    expect(low).to_have_attribute("data-end", "150")
    expect(low).to_have_class(re.compile(r"cal-cell--bal-warn"))
    expect(low).to_have_class(re.compile(r"cal-cell--bal-low"))
    expect(low).not_to_have_class(re.compile(r"cal-cell--bal-risk"))
    expect(cell(5)).to_have_attribute("data-end", "150")
    expect(cell(5)).not_to_have_class(re.compile(r"cal-cell--bal-low"))
    expect(cell(6)).to_have_attribute("data-end", "3550")
    expect(cell(6)).not_to_have_class(re.compile(r"cal-cell--bal-warn|cal-cell--bal-risk"))
    adjusted = cell(10)
    expect(adjusted).to_have_attribute("data-end", "3240")
    expect(adjusted).to_have_attribute("data-projected", "3360")
    expect(adjusted).to_have_class(re.compile(r"cal-cell--adjusted-balance"))
    expect(adjusted.locator(".cal-balance-status-pill--adjusted")).to_have_text("↺ Adjusted")
    expect(adjusted).not_to_have_class(re.compile(r"cal-cell--reconciled"))
    expect(cell(14)).to_have_attribute("data-end", "2820")
    expect(page.locator(".cal-cell[data-iso]")).to_have_count(31)
    expect(page.locator(".cal-dow").first).to_have_text("Sun")

    page.locator("#calendarNextMonth").click()
    expect(page.locator("#previewMonthLabel")).to_have_text("November 2026")
    expect(page.locator("#previewLowBalance")).to_have_text("$2,170")
    expect(_cell(page, "2026-11-02")).to_have_attribute("data-end", "2170")
    expect(page.locator(".cal-balance-status-pill--reconciled")).to_have_count(0)

    page.locator("#calendarPrevMonth").click()
    expect(page.locator("#previewMonthLabel")).to_have_text("October 2026")
    expect(page.locator("#previewLowBalance")).to_have_text("$150")
    _assert_forecast_untouched(api_calls, writes)
    guard.assert_clean()


@pytest.mark.smoke_title("Sample details stay read only")
def test_sample_forecast_readonly_details(page, guard):
    _freeze(page, 2026, 10, 15)
    response = page.goto("/preview/")
    assert_route_ok(response, "/preview/")
    _cell(page, _iso(2026, 10, 15, 3)).locator("button", has_text="Credit card").click()
    expect(page.locator("#previewDetail")).to_be_visible()
    expect(page.locator("#previewDetailTitle")).to_contain_text("October 18, 2026")
    expect(page.locator("#previewDetailList")).to_contain_text("Credit card")
    expect(page.locator("#previewDetailList")).to_contain_text("$660.00")
    expect(page.locator("#previewDetail")).to_contain_text("Read only")
    expect(page.locator("#previewDetail input, #previewDetail textarea, #previewDetail select")).to_have_count(0)
    page.locator("#previewDetailClose").click()
    _cell(page, "2026-10-01").click()
    expect(page.locator("#previewDetailList")).to_contain_text("No transactions this day")
    expect(page.locator("#previewDetailBalance")).to_contain_text("Ending balance $4,850.00")
    guard.assert_clean()


@pytest.mark.smoke_title("Hypothetical expense stays in the browser")
def test_sample_forecast_hypothetical_and_reset(page, guard):
    api_calls, writes = _track_api(page)
    _freeze(page, 2026, 10, 15)
    response = page.goto("/preview/")
    assert_route_ok(response, "/preview/")
    stored = page.evaluate(
        "() => Object.keys(localStorage).sort().concat(Object.keys(sessionStorage).sort())"
    )
    low = _cell(page, _iso(2026, 10, 15, 4))
    page.locator("#previewExplore summary").click()
    page.locator("#previewExpenseDay").select_option("19")
    page.locator("#previewExpenseAmount").fill("500")
    expect(low).to_have_attribute("data-end", "-350")
    expect(low).to_have_class(re.compile(r"cal-cell--bal-risk"))
    expect(_cell(page, _iso(2026, 10, 15, 6))).to_have_attribute("data-end", "3050")
    expect(_cell(page, _iso(2026, 10, 15, 10))).to_have_attribute("data-end", "3240")
    expect(_cell(page, _iso(2026, 10, 15, 14))).to_have_attribute("data-end", "2820")
    expect(page.locator("#previewLowBalance")).to_have_text("($350)")
    expect(page.locator("#previewBufferGap")).to_have_text("$1,850 below your $1,500 safety cushion.")
    expect(page.locator("#previewExpenses")).to_have_text("$5,810")
    expect(page.locator("#previewNet")).to_have_text("$-2,410")
    low.locator("button", has_text="Hypothetical expense").click()
    expect(page.locator("#previewDetailList")).to_contain_text("Demo only. Not saved.")
    page.locator("#previewDetailClose").click()
    page.locator("#previewReset").click()
    expect(page.locator("#previewExpenseAmount")).to_have_value("")
    expect(_cell(page, _iso(2026, 10, 15, -3))).to_have_attribute("data-end", "2060")
    expect(_cell(page, _iso(2026, 10, 15, -3)).locator(".cal-balance-status-pill--reconciled")).to_have_text("✓ Reconciled")
    expect(low).to_have_attribute("data-end", "150")
    expect(low).to_have_class(re.compile(r"cal-cell--bal-warn"))
    expect(_cell(page, _iso(2026, 10, 15, 6))).to_have_attribute("data-end", "3550")
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
    _freeze(page, 2026, 10, 15)
    response = page.goto("/preview/")
    assert_route_ok(response, "/preview/")

    def cell(offset):
        return _cell(page, _iso(2026, 10, 15, offset))

    expect(cell(-4)).to_have_attribute("data-end", "2060")
    expect(cell(-4)).not_to_have_class(re.compile(r"cal-cell--adjusted-balance"))
    page.locator("#previewReconcile summary").click()
    expect(page.locator("#previewReconcile")).to_contain_text(
        "See how entering an actual checking balance updates future projections."
    )
    expect(page.locator("#previewReconcileLead")).to_contain_text("Fictional example")
    expect(page.locator("#previewReconcileLead")).to_contain_text("October 11")
    expect(page.locator("#previewReconcileLead")).to_contain_text("not your bank balance")
    expect(page.locator("#previewReconcileForecast")).to_have_text("$2,060")
    expect(page.locator("#previewReconcileBank")).to_have_text("$1,925")
    expect(page.locator("#previewReconcileDiff")).to_have_text("−$135")
    page.locator("#previewApplyReconcile").click()
    demo = cell(-4)
    expect(demo).to_have_attribute("data-end", "1925")
    expect(demo).to_have_attribute("data-projected", "2060")
    expect(demo).to_have_class(re.compile(r"cal-cell--adjusted-balance"))
    expect(demo.locator(".cal-balance-status-pill--adjusted")).to_have_text("↺ Adjusted")
    expect(cell(-5)).to_have_attribute("data-end", "2270")
    expect(cell(-8)).to_have_attribute("data-end", "4670")
    confirmed = cell(-3)
    expect(confirmed).to_have_attribute("data-end", "1925")
    expect(confirmed).to_have_attribute("data-projected", "1925")
    expect(confirmed).to_have_class(re.compile(r"cal-cell--reconciled"))
    expect(confirmed.locator(".cal-balance-status-pill--reconciled")).to_have_text("✓ Reconciled")
    expect(confirmed.locator(".cal-balance-status-pill--adjusted")).to_have_count(0)
    expect(cell(3)).to_have_attribute("data-end", "1265")
    expect(cell(3)).to_have_class(re.compile(r"cal-cell--bal-warn"))
    expect(cell(4)).to_have_attribute("data-end", "15")
    expect(cell(4)).to_have_class(re.compile(r"cal-cell--bal-warn"))
    expect(cell(6)).to_have_attribute("data-end", "3415")
    expect(cell(6)).not_to_have_class(re.compile(r"cal-cell--bal-warn|cal-cell--bal-risk"))
    expect(cell(10)).to_have_attribute("data-end", "3240")
    expect(cell(10)).to_have_attribute("data-projected", "3225")
    expect(cell(10).locator(".cal-balance-status-pill--adjusted")).to_have_text("↺ Adjusted")
    expect(page.locator("#previewLowBalance")).to_have_text("$15")
    expect(page.locator("#previewBufferGap")).to_have_text("$1,485 below your $1,500 safety cushion.")
    expect(page.locator("#previewIncome")).to_have_text("$3,400")
    expect(page.locator("#previewExpenses")).to_have_text("$5,310")
    expect(page.locator("#previewNet")).to_have_text("$-1,910")
    demo.locator(".cal-day-tx-line").click()
    expect(page.locator("#previewDetailBalance")).to_contain_text("Forecast was $2,060.00")
    expect(page.locator("#previewDetailBalance")).to_contain_text("Fictional bank balance $1,925.00")
    expect(page.locator("#previewDetailBalance")).to_contain_text("Starting balance $2,270.00")
    page.locator("#previewDetailClose").click()

    page.locator("#previewExplore summary").click()
    page.locator("#previewExpenseDay").select_option("19")
    page.locator("#previewExpenseAmount").fill("500")
    expect(cell(-4)).to_have_attribute("data-end", "1925")
    expect(cell(-5)).to_have_attribute("data-end", "2270")
    expect(cell(-3)).to_have_attribute("data-end", "1925")
    expect(cell(-3).locator(".cal-balance-status-pill--reconciled")).to_have_text("✓ Reconciled")
    expect(cell(4)).to_have_attribute("data-end", "-485")
    expect(cell(4)).to_have_class(re.compile(r"cal-cell--bal-risk"))
    expect(cell(6)).to_have_attribute("data-end", "2915")
    expect(page.locator("#previewLowBalance")).to_have_text("($485)")
    expect(page.locator("#previewBufferGap")).to_have_text("$1,985 below your $1,500 safety cushion.")
    expect(page.locator("#previewExpenses")).to_have_text("$5,810")
    expect(page.locator("#previewNet")).to_have_text("$-2,410")

    page.locator("#previewResetReconcile").click()
    expect(cell(-4)).to_have_attribute("data-end", "2060")
    expect(cell(-4)).not_to_have_class(re.compile(r"cal-cell--adjusted-balance"))
    expect(cell(-3)).to_have_attribute("data-end", "2060")
    expect(cell(-3).locator(".cal-balance-status-pill--reconciled")).to_have_text("✓ Reconciled")
    expect(cell(4)).to_have_attribute("data-end", "-350")
    expect(cell(6)).to_have_attribute("data-end", "3050")
    page.locator("#previewReset").click()
    expect(cell(4)).to_have_attribute("data-end", "150")
    expect(page.locator("#previewLowBalance")).to_have_text("$150")

    page.locator("#previewApplyReconcile").click()
    page.locator("#previewExpenseDay").select_option("11")
    page.locator("#previewExpenseAmount").fill("100")
    expect(cell(-5)).to_have_attribute("data-end", "2270")
    expect(cell(-4)).to_have_attribute("data-projected", "1960")
    expect(cell(-4)).to_have_attribute("data-end", "1925")
    expect(cell(-3)).to_have_attribute("data-end", "1925")
    expect(cell(-3)).to_have_attribute("data-projected", "1925")
    expect(cell(-3).locator(".cal-balance-status-pill--reconciled")).to_have_text("✓ Reconciled")
    expect(page.locator("#previewReconcileDiff")).to_have_text("−$35")
    page.locator("#calendarNextMonth").click()
    expect(page.locator("#previewExpenses")).to_have_text("$650")
    expect(_cell(page, "2026-11-02")).to_have_attribute("data-end", "2170")
    page.locator("#calendarPrevMonth").click()
    expect(cell(-4)).to_have_attribute("data-end", "1925")
    page.locator("#previewResetReconcile").click()
    expect(cell(-4)).to_have_attribute("data-end", "2060")
    _assert_forecast_untouched(api_calls, writes)
    guard.assert_clean()


@pytest.mark.smoke_title("Sample forecast links keep the public signup path")
def test_sample_forecast_signup_and_homepage(page, guard):
    response = page.goto("/")
    assert_route_ok(response, "/")
    expect(page.locator("a.landing-hero__cta").first).to_have_text("Start my free forecast")
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
    setup = page.goto("/account-setup/?fresh=1")
    assert_route_ok(setup, "/account-setup/")
    expect(page.locator("#accountSetupWizardEyebrow")).to_have_text("Create your login")
    expect(page.locator("#accountSetupWizardSubeyebrow")).to_have_text(
        "You're just a few minutes away from seeing your future checking balance."
    )
    expect(page.locator("#accountSetupWizardReassurance")).to_have_text(
        "Start with a 14-day free trial. No credit card required."
    )
    expect(page.get_by_text("$5.99")).to_have_count(0)
    expect(page.locator("#accountSetupBackToSample")).to_have_text("Back to sample forecast")
    expect(page.locator("#accountSetupBackToSample")).to_have_attribute("href", "/preview/")
    expect(page.locator("#homeLogoutBtn")).to_be_hidden()
    expect(page.locator("#homeForecastLink")).to_be_hidden()
    expect(page.locator("#homeLoginLink")).to_be_visible()
    page.locator("#accountSetupBackToSample").click()
    page.wait_for_url(re.compile(r"/preview/?$"))
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
    page.locator("#previewTourNext").click()
    expect(page.locator("#previewTourCounter")).to_have_text("3 of 5")
    expect(page.get_by_role("heading", name="Keep your forecast accurate")).to_be_visible()
    expect(page.locator("#previewReconcile")).to_have_js_property("open", True)
    expect(page.locator("#previewExplore")).to_have_js_property("open", False)
    page.locator("#previewTourNext").click()
    expect(page.locator("#previewTourCounter")).to_have_text("4 of 5")
    expect(page.locator("#previewTourTitle")).to_have_text("Explore")
    expect(page.locator("#previewReconcile")).to_have_js_property("open", False)
    expect(page.locator("#previewExplore")).to_have_js_property("open", True)
    page.locator("#previewTourNext").click()
    expect(page.locator("#previewTourCounter")).to_have_text("5 of 5")
    expect(page.get_by_role("heading", name="Now see your own future balance.")).to_be_visible()
    expect(page.get_by_text("Your own forecast stays private to your account.")).to_be_visible()
    expect(page.get_by_text("Free for 14 days · No bank connection required")).to_be_visible()
    expect(page.locator("#previewTourStart")).to_have_attribute("href", "/account-setup/?fresh=1")
    expect(page.locator("#previewTourStart")).to_have_text("Start my free forecast")
    expect(page.locator("#previewTourNext")).to_be_hidden()
    expect(page.locator("#previewTourFaq")).to_have_count(0)
    expect(page.locator("#previewReconcile")).to_have_js_property("open", False)
    expect(page.locator("#previewExplore")).to_have_js_property("open", False)
    _assert_tour_card_in_view(page)
    page.locator("#previewTourBack").click()
    expect(page.locator("#previewTourCounter")).to_have_text("4 of 5")
    expect(page.locator("#previewExplore")).to_have_js_property("open", True)
    expect(page.locator("#previewReconcile")).to_have_js_property("open", False)
    page.locator("#previewTourNext").click()
    page.locator("#previewTourContinue").click()
    expect(page.get_by_role("dialog")).to_be_hidden()
    expect(page.locator("#previewExplore")).to_have_js_property("open", False)
    expect(page.locator(".bw-tour-target")).to_have_count(0)
    page.locator("#previewReplay").click()
    expect(page.locator("#previewTourCounter")).to_have_text("1 of 5")
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
    page.locator("#previewReplay").click()
    expect(page.locator("#previewTourCounter")).to_have_text("1 of 5")
    _assert_tour_card_in_view(page)
    page.locator("#previewTourNext").click()
    page.locator("#previewTourNext").click()
    expect(page.locator("#previewReconcile")).to_have_js_property("open", True)
    _assert_tour_card_in_view(page)
    page.keyboard.press("Escape")
    expect(page.locator("#previewReconcile")).to_have_js_property("open", False)
    page.set_viewport_size({"width": 320, "height": 700})
    page.locator("#previewReplay").click()
    page.locator("#previewTourNext").click()
    page.locator("#previewTourNext").click()
    page.locator("#previewTourNext").click()
    page.locator("#previewTourNext").click()
    expect(page.locator("#previewTourCounter")).to_have_text("5 of 5")
    expect(page.locator("#previewExplore")).to_have_js_property("open", False)
    _assert_tour_card_in_view(page)
    page.locator("#previewTourContinue").click()
    page.set_viewport_size({"width": 390, "height": 800})
    page.locator("#previewExplore summary").click()
    page.locator("#previewExpenseAmount").fill("80")
    expect(page.locator("#previewLowBalance")).not_to_have_text("$150")
    page.locator("#previewReset").click()
    expect(page.locator("#previewLowBalance")).to_have_text("$150")
    assert_no_horizontal_overflow(page)
    page.set_viewport_size({"width": 320, "height": 700})
    assert_no_horizontal_overflow(page)
    guard.assert_clean()


@pytest.mark.smoke_title("Sample forecast stays ahead of today across a year boundary")
def test_sample_forecast_rolls_across_new_year(page, guard):
    _freeze(page, 2026, 12, 30)
    response = page.goto("/preview/")
    assert_route_ok(response, "/preview/")
    expect(page.locator("#previewMonthLabel")).to_have_text("January 2027")
    expect(page.locator("#previewCashWarning")).to_have_text(
        "Your forecast drops to $150 on Jan 3 — $1,350 below your $1,500 safety cushion."
    )
    expect(_cell(page, "2027-01-03")).to_have_attribute("data-end", "150")
    expect(_cell(page, "2027-01-03")).to_have_class(re.compile(r"cal-cell--bal-low"))
    expect(_cell(page, "2027-01-05")).to_have_attribute("data-end", "3550")
    page.locator("#calendarPrevMonth").click()
    expect(page.locator("#previewMonthLabel")).to_have_text("December 2026")
    confirmed = _cell(page, "2026-12-27")
    expect(confirmed).to_have_attribute("data-end", "2060")
    expect(confirmed.locator(".cal-balance-status-pill--reconciled")).to_have_text("✓ Reconciled")
    guard.assert_clean()


@pytest.mark.smoke_title("Phone sample opens on the next 14 days")
def test_sample_forecast_phone_agenda(page, guard):
    _freeze(page, 2026, 10, 15)
    page.set_viewport_size({"width": 390, "height": 844})
    response = page.goto("/preview/")
    assert_route_ok(response, "/preview/")
    expect(page.locator("#previewMonthLabel")).to_have_text("Next 14 days")
    expect(page.locator("#previewShowAgenda")).to_have_attribute("aria-pressed", "true")
    expect(page.locator(".cal-cell[data-iso]")).to_have_count(14)
    expect(page.locator(".cal-cell[data-iso]").first).to_have_attribute("data-iso", "2026-10-15")
    expect(_cell(page, "2026-10-19")).to_have_class(re.compile(r"cal-cell--bal-low"))
    expect(page.locator(".cal-dow")).to_have_count(0)
    expect(page.locator("#preview-calendar")).to_have_class(re.compile(r"preview-calendar--agenda"))
    page.locator("#previewShowMonth").click()
    expect(page.locator("#previewMonthLabel")).to_have_text("October 2026")
    expect(page.locator(".cal-cell[data-iso]")).to_have_count(31)
    expect(page.locator("#preview-calendar")).to_have_class(re.compile(r"calendar--mobile"))
    assert_no_horizontal_overflow(page)
    page.set_viewport_size({"width": 768, "height": 1024})
    expect(page.locator(".cal-dow")).to_have_count(0)
    expect(page.locator("#preview-calendar")).to_have_class(re.compile(r"calendar--mobile"))
    expect(page.locator(".cal-cell[data-iso]")).to_have_count(31)
    assert_no_horizontal_overflow(page)
    page.set_viewport_size({"width": 1024, "height": 900})
    expect(page.locator(".cal-dow").first).to_have_text("Sun")
    expect(page.locator("#preview-calendar")).not_to_have_class(re.compile(r"calendar--mobile"))
    expect(page.locator(".cal-cell[data-iso]")).to_have_count(31)
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
