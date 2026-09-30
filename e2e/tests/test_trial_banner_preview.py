"""Dev preview of the trial banner. No account, Stripe, or email."""

from __future__ import annotations

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


@pytest.mark.smoke_title("Trial banner preview states")
def test_trial_banner_preview_switches_states_without_api(page, guard):
    api_calls = _open(page)
    notice = page.locator(NOTICE)
    expect(notice.locator(".trial-status-notice__message")).to_have_text("14 days left in your free trial")
    expect(notice.locator("a")).to_have_text("Choose a plan")
    expect(notice).to_have_attribute("data-trial-state", "countdown")

    _show(page, "d8")
    expect(notice.locator(".trial-status-notice__message")).to_have_text("8 days left in your free trial")
    expect(notice).to_have_attribute("data-trial-state", "countdown")

    _show(page, "d3")
    expect(notice.locator(".trial-status-notice__message")).to_have_text("3 days left in your free trial")
    expect(notice).to_have_attribute("data-trial-state", "ending")
    expect(notice.locator("a")).to_have_attribute("href", "/settings/?section=billing")

    _show(page, "d1")
    expect(notice.locator(".trial-status-notice__message")).to_have_text("1 day left in your free trial")
    expect(notice).to_have_attribute("data-trial-state", "ending")

    _show(page, "today")
    expect(notice.locator(".trial-status-notice__message")).to_have_text("Your free trial ends today")
    expect(notice).not_to_contain_text("0 days")

    _show(page, "expired")
    expect(notice.locator(".trial-status-notice__message")).to_have_text("Your free trial has ended")
    expect(notice.locator("a")).to_have_text("Choose a plan")
    expect(notice).to_have_attribute("data-trial-state", "ended")

    _show(page, "monthly")
    expect(notice.locator(".trial-status-notice__message")).to_contain_text("8 days left in your free trial · Monthly plan starts ")
    expect(notice.locator("a")).to_have_count(0)

    _show(page, "annual")
    expect(notice.locator(".trial-status-notice__message")).to_contain_text("3 days left in your free trial · Annual plan starts ")
    expect(notice.locator("a")).to_have_count(0)
    expect(notice).to_have_attribute("data-trial-state", "ending")

    _show(page, "paid")
    expect(notice).to_be_hidden()
    expect(page.locator("#trialPreviewEmpty")).to_contain_text("paid subscriber")

    _show(page, "comp")
    expect(notice).to_be_hidden()
    expect(page.locator("#trialPreviewEmpty")).to_contain_text("Complimentary")
    expect(notice).not_to_contain_text("Choose a plan")

    assert api_calls == []
    guard.assert_clean()
