"""Public sample walkthrough. No login and no API calls."""

from __future__ import annotations

import re

import pytest
from playwright.sync_api import expect

from support import assert_no_horizontal_overflow, assert_route_ok


@pytest.mark.smoke_title("Public walkthrough needs no account")
def test_public_preview_walkthrough(page, guard):
    api_calls = []

    def _track(request):
        if "/api/" in request.url:
            api_calls.append(request.url)

    page.on("request", _track)
    response = page.goto("/preview/")
    assert_route_ok(response, "/preview/")
    expect(page.get_by_role("dialog")).to_be_visible()
    expect(page.locator("#previewTourCounter")).to_have_text("1 of 5")
    expect(page.get_by_text("Start with what’s actually in checking today.")).to_be_visible()
    expect(page.get_by_text("Mortgage")).to_be_visible()
    expect(page.get_by_text("Paycheck")).to_be_visible()
    expect(page.get_by_text("$4,850")).to_be_visible()
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
    assert api_calls == []
    assert_no_horizontal_overflow(page)
    guard.assert_clean()


@pytest.mark.smoke_title("Public walkthrough fits a phone")
def test_public_preview_mobile(page, guard):
    page.set_viewport_size({"width": 390, "height": 800})
    response = page.goto("/preview/")
    assert_route_ok(response, "/preview/")
    expect(page.locator("#previewTourNext")).to_be_visible()
    expect(page.get_by_text("Credit card")).to_be_visible()
    assert_no_horizontal_overflow(page)
    guard.assert_clean()


@pytest.mark.smoke_title("FAQ opens the public walkthrough")
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
    expect(page.get_by_role("dialog")).to_be_visible()
    guard.assert_clean()
