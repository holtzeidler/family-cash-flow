"""Public sample forecast. Fictional data stays in the browser."""

from __future__ import annotations

import calendar
import re
from datetime import date

import pytest
from playwright.sync_api import expect

from smoke_guard import SMOKE_ORIGIN
from support import assert_no_horizontal_overflow, assert_route_ok


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
    expect(page.locator("#previewStartBalance")).to_have_text("$4,850")
    expect(page.locator("#previewBuffer")).to_have_text("$1,500")
    expect(page.locator("#previewLowBalance")).to_have_text("$150")
    expect(page.locator("#previewBufferGap")).to_have_text("$1,350 below buffer")
    expect(page.locator('.cal-cell[data-day="1"]')).to_have_attribute("data-end", "4850")
    expect(page.locator('.cal-cell[data-day="4"]')).to_have_attribute("data-end", "4670")
    expect(page.locator('.cal-cell[data-day="6"]')).to_have_attribute("data-end", "2270")
    expect(page.locator('.cal-cell[data-day="11"]')).to_have_attribute("data-end", "310")
    expect(page.locator('.cal-cell[data-day="14"]')).to_have_attribute("data-end", "150")
    expect(page.locator('.cal-cell[data-day="15"]')).to_have_attribute("data-end", "3550")
    expect(page.locator('.cal-cell[data-day="28"]')).to_have_attribute("data-end", "2290")
    expect(page.locator('.cal-dow').first).to_have_text("Sun")

    page.locator("#previewNextMonth").click()
    next_year, next_month = _shift_month(today.year, today.month, 1)
    expect(page.locator("#previewMonthLabel")).to_have_text(_month_label(next_year, next_month))
    expect(page.locator("#previewLowBalance")).to_have_text("$150")
    expect(page.locator('.cal-cell[data-day="14"]')).to_have_attribute("data-end", "150")
    expect(page.locator('.cal-cell[data-day="15"]')).to_have_attribute("data-end", "3550")

    page.locator("#previewPrevMonth").click()
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
    expect(page.locator("#previewDetailList")).to_contain_text("-$1,750")
    expect(page.locator("#previewDetail")).to_contain_text("Read only")
    expect(page.locator("#previewDetail input, #previewDetail textarea, #previewDetail select")).to_have_count(0)
    page.locator('.cal-cell[data-day="1"] .preview-day-open').click()
    expect(page.locator("#previewDetailList")).to_contain_text("No transactions this day")
    expect(page.locator("#previewDetailBalance")).to_contain_text("Ending balance $4,850")
    guard.assert_clean()


@pytest.mark.smoke_title("Hypothetical expense stays in the browser")
def test_sample_forecast_hypothetical_and_reset(page, guard):
    api_calls, writes = _track_api(page)
    response = page.goto("/preview/")
    assert_route_ok(response, "/preview/")
    stored = page.evaluate(
        "() => Object.keys(localStorage).sort().concat(Object.keys(sessionStorage).sort())"
    )
    page.locator("#previewExpenseDay").select_option("14")
    page.locator("#previewExpenseAmount").fill("500")
    expect(page.locator('.cal-cell[data-day="14"]')).to_have_attribute("data-end", "-350")
    expect(page.locator('.cal-cell[data-day="15"]')).to_have_attribute("data-end", "3050")
    expect(page.locator("#previewLowBalance")).to_have_text("($350)")
    expect(page.locator("#previewBufferGap")).to_have_text("$1,850 below buffer")
    expect(page.locator('.cal-cell[data-day="14"]')).to_contain_text("Hypothetical expense")
    page.locator('.cal-cell[data-day="14"] button', has_text="Hypothetical expense").click()
    expect(page.locator("#previewDetailList")).to_contain_text("Demo only. Not saved.")
    page.locator("#previewReset").click()
    expect(page.locator("#previewExpenseAmount")).to_have_value("")
    expect(page.locator('.cal-cell[data-day="14"]')).to_have_attribute("data-end", "150")
    expect(page.locator('.cal-cell[data-day="15"]')).to_have_attribute("data-end", "3550")
    expect(page.locator("#previewLowBalance")).to_have_text("$150")
    expect(page.locator("#previewBufferGap")).to_have_text("$1,350 below buffer")
    after = page.evaluate(
        "() => Object.keys(localStorage).sort().concat(Object.keys(sessionStorage).sort())"
    )
    assert after == stored
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
    expect(page.get_by_text("Start with what’s actually in checking today.")).to_be_visible()
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


@pytest.mark.smoke_title("Public sample forecast fits a phone")
def test_public_preview_mobile(page, guard):
    page.set_viewport_size({"width": 390, "height": 800})
    response = page.goto("/preview/")
    assert_route_ok(response, "/preview/")
    expect(page.locator("#preview-calendar")).to_be_visible()
    expect(page.get_by_text("Credit card").first).to_be_visible()
    expect(page.locator("#previewWhatIf")).to_be_visible()
    expect(page.locator("#previewSignup")).to_be_visible()
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
    expect(page.locator("#previewReplay")).to_have_text("Show me around")
    guard.assert_clean()
