"""Dev preview of the trial banner. No account, Stripe, or email."""

from __future__ import annotations

import re

import pytest
from playwright.sync_api import expect

from support import assert_route_ok

NOTICE = "#trialStatusNotice"


def _open(page):
    api_calls = []

    def _track(request):
        if "/api/" in request.url:
            api_calls.append(request.url)

    page.on("request", _track)
    response = page.goto("/dev/trial-banner/?state=d14")
    assert_route_ok(response, "/dev/trial-banner/")
    expect(page.locator("#trialPreviewButtons")).to_be_visible()
    return api_calls


def _show(page, state_id):
    page.locator(f'[data-preview-state="{state_id}"]').click()
    expect(page.locator(f'[data-preview-state="{state_id}"]')).to_have_attribute("aria-pressed", "true")


def _line_background(notice):
    return notice.locator(".trial-status-notice__line").evaluate("el => getComputedStyle(el).backgroundColor")


@pytest.mark.smoke_title("Trial banner preview states")
def test_trial_banner_preview_switches_states_without_api(page, guard):
    api_calls = _open(page)
    notice = page.locator(NOTICE)
    expect(notice.locator(".trial-status-notice__message")).to_have_text("14 days left in your free trial")
    expect(notice.locator("a")).to_have_text("Choose a plan")
    expect(notice).to_have_attribute("data-trial-state", "countdown")
    expect(notice).to_have_attribute("data-trial-cta", "link")
    neutral = _line_background(notice)

    _show(page, "d8")
    expect(notice.locator(".trial-status-notice__message")).to_have_text("8 days left in your free trial")
    expect(notice).to_have_attribute("data-trial-state", "countdown")
    expect(notice).to_have_attribute("data-trial-cta", "link")
    expect(notice.locator("a")).not_to_have_class(re.compile(r"action--button"))

    _show(page, "d3")
    expect(notice.locator(".trial-status-notice__message")).to_have_text("3 days left in your free trial")
    expect(notice).to_have_attribute("data-trial-state", "soon")
    expect(notice).to_have_attribute("data-trial-cta", "button")
    expect(notice.locator("a")).to_have_class(re.compile(r"trial-status-notice__action--button"))
    expect(notice.locator("a")).not_to_have_class(re.compile(r"action--prominent"))
    expect(notice.locator("a")).to_have_attribute("href", "/settings/?section=billing")
    soon = _line_background(notice)
    assert soon != neutral

    _show(page, "d1")
    expect(notice.locator(".trial-status-notice__message")).to_have_text("1 day left in your free trial")
    expect(notice).to_have_attribute("data-trial-state", "urgent")
    expect(notice).to_have_attribute("data-trial-cta", "button")
    urgent = _line_background(notice)
    assert urgent != soon

    _show(page, "today")
    expect(notice.locator(".trial-status-notice__message")).to_have_text("Your free trial ends today")
    expect(notice).to_have_attribute("data-trial-state", "today")
    expect(notice).to_have_attribute("data-trial-cta", "prominent")
    expect(notice.locator("a")).to_have_class(re.compile(r"trial-status-notice__action--prominent"))
    expect(notice).not_to_contain_text("0 days")
    today = _line_background(notice)
    assert today != urgent

    _show(page, "expired")
    expect(notice.locator(".trial-status-notice__message")).to_have_text(
        "Your free trial has ended. Your forecast is now view-only."
    )
    expect(notice.locator("a")).to_have_text("Choose a plan")
    expect(notice).to_have_attribute("data-trial-state", "ended")
    expect(notice).to_have_attribute("data-trial-cta", "prominent")
    assert _line_background(notice) == today

    _show(page, "monthly")
    expect(notice.locator(".trial-status-notice__message")).to_contain_text("8 days left in your free trial · Monthly plan starts ")
    expect(notice.locator("a")).to_have_count(0)
    expect(notice).to_have_attribute("data-trial-state", "scheduled")
    scheduled = _line_background(notice)
    assert scheduled not in (soon, urgent, today)

    _show(page, "annual")
    expect(notice.locator(".trial-status-notice__message")).to_contain_text("3 days left in your free trial · Annual plan starts ")
    expect(notice.locator("a")).to_have_count(0)
    expect(notice).to_have_attribute("data-trial-state", "scheduled")
    assert _line_background(notice) == scheduled

    _show(page, "paid")
    expect(notice).to_be_hidden()
    expect(page.locator("#trialPreviewEmpty")).to_contain_text("paid subscriber")

    _show(page, "comp")
    expect(notice).to_be_hidden()
    expect(page.locator("#trialPreviewEmpty")).to_contain_text("Complimentary")
    expect(notice).not_to_contain_text("Choose a plan")

    assert api_calls == []
    guard.assert_clean()
