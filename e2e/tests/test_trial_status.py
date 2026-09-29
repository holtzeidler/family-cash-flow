"""In-app trial status for deterministic local accounts. No Stripe and no email."""

from __future__ import annotations

import re
from pathlib import Path

import pytest
from playwright.sync_api import expect

from support import assert_no_horizontal_overflow, assert_route_ok, money

SHOTS = Path(__file__).resolve().parents[1] / ".smoke-run" / "trial-status"
NOTICE = "#trialStatusNotice"


def _login(page, email, password):
    response = page.goto("/login.html")
    assert_route_ok(response, "/login.html")
    page.locator("#email").fill(email)
    page.locator("#password").fill(password)
    with page.expect_response(lambda r: "/billing-status" in r.url and r.status == 200, timeout=20_000):
        page.locator("#loginBtn").click()
    page.wait_for_url(re.compile(r"/calendar"), timeout=20_000)
    page.wait_for_function("() => !!document.getElementById('trialStatusNotice')")


def _shots(page, name):
    SHOTS.mkdir(parents=True, exist_ok=True)
    page.set_viewport_size({"width": 1280, "height": 800})
    notice = page.locator(NOTICE)
    if notice.is_visible():
        notice.screenshot(path=str(SHOTS / f"desktop-{name}.png"))
    page.screenshot(path=str(SHOTS / f"desktop-{name}-page.png"), full_page=False)
    assert_no_horizontal_overflow(page)
    page.set_viewport_size({"width": 390, "height": 844})
    if notice.is_visible():
        notice.screenshot(path=str(SHOTS / f"mobile-{name}.png"))
    page.screenshot(path=str(SHOTS / f"mobile-{name}-page.png"), full_page=False)
    assert_no_horizontal_overflow(page)
    page.set_viewport_size({"width": 1280, "height": 800})


def _finish(page, guard):
    assert "/checkout" not in page.url
    assert_no_horizontal_overflow(page)
    guard.assert_clean()


def _open_billing(page):
    page.locator(f"{NOTICE} a.trial-status-notice__action").click()
    page.wait_for_url(re.compile(r"/settings"))
    expect(page.locator("#billingSubscribeMonthly")).to_be_visible()
    expect(page.locator("#billingSubscribeAnnual")).to_be_visible()
    assert "/checkout" not in page.url


@pytest.mark.smoke_title("Trial status hidden after day 7")
def test_trial_status_hidden_with_more_than_7_days(page, guard, seed):
    _login(page, seed["active"]["email"], seed["active"]["password"])
    notice = page.locator(NOTICE)
    expect(notice).to_be_hidden()
    expect(notice).not_to_contain_text("free trial")
    _shots(page, "over-7")
    _finish(page, guard)


@pytest.mark.smoke_title("Trial status at 7 days")
def test_trial_status_at_7_days(page, guard, seed):
    account = seed["trials"]["days7"]
    _login(page, account["email"], account["password"])
    notice = page.locator(NOTICE)
    expect(notice).to_be_visible()
    expect(notice).to_have_attribute("data-trial-state", "countdown")
    expect(notice.locator(".trial-status-notice__message")).to_have_text("7 days left in your free trial")
    expect(notice.locator("a")).to_have_text("View plans")
    page.goto("/transactions/")
    expect(page.locator(NOTICE)).to_contain_text("7 days left in your free trial")
    page.goto("/calendar")
    _shots(page, "7-days")
    page.set_viewport_size({"width": 390, "height": 844})
    _open_billing(page)
    _finish(page, guard)


@pytest.mark.smoke_title("Trial status at 3 days")
def test_trial_status_at_3_days(page, guard, seed):
    account = seed["trials"]["days3"]
    _login(page, account["email"], account["password"])
    label = page.evaluate(
        """(iso) => new Date(iso).toLocaleDateString(undefined, { month: 'long', day: 'numeric', timeZone: 'UTC' })""",
        account["trial_ends_at"],
    )
    notice = page.locator(NOTICE)
    expect(notice).to_have_attribute("data-trial-state", "ending")
    expect(notice.locator(".trial-status-notice__message")).to_have_text(f"Your free trial ends {label}")
    expect(notice.locator("a")).to_have_text("Choose a plan")
    _shots(page, "3-days")
    _open_billing(page)
    _finish(page, guard)


@pytest.mark.smoke_title("Trial status tomorrow")
def test_trial_status_ends_tomorrow(page, guard, seed):
    account = seed["trials"]["days1"]
    _login(page, account["email"], account["password"])
    notice = page.locator(NOTICE)
    expect(notice).to_have_attribute("data-trial-state", "tomorrow")
    expect(notice.locator(".trial-status-notice__message")).to_have_text("Your free trial ends tomorrow")
    expect(notice.locator("a")).to_have_text("Choose a plan")
    expect(notice).not_to_contain_text("has ended")
    _shots(page, "1-day")
    _finish(page, guard)


@pytest.mark.smoke_title("Trial status later today")
def test_trial_status_later_today_is_not_expired(page, guard, seed):
    account = seed["trials"]["today"]
    _login(page, account["email"], account["password"])
    still_today = page.evaluate(
        """(iso) => {
          const end = new Date(iso);
          const now = new Date();
          const utcDay = (d) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
          return end > now && utcDay(end) === utcDay(now);
        }""",
        account["trial_ends_at"],
    )
    assert still_today, account["trial_ends_at"]
    notice = page.locator(NOTICE)
    expect(notice).to_have_attribute("data-trial-state", "today")
    expect(notice.locator(".trial-status-notice__message")).to_have_text("Your free trial ends today")
    expect(notice).not_to_contain_text("has ended")
    expect(notice.locator("a")).to_have_text("Choose a plan")
    _shots(page, "today")
    _finish(page, guard)


@pytest.mark.smoke_title("Trial expired view-only")
def test_trial_expired_keeps_forecast_and_blocks_writes(page, guard, seed):
    guard.allow_blocked_writes = True
    _login(page, seed["viewonly"]["email"], seed["viewonly"]["password"])
    expect(page.locator("html")).to_have_class(re.compile(r"bw-billing-readonly"))
    expect(page.locator(f'.cal-cell[data-iso="{seed["expense_date"]}"] .cal-balance')).to_have_text(
        money(seed["seed_balance"])
    )
    notice = page.locator(NOTICE)
    expect(notice).to_have_attribute("data-trial-state", "ended")
    expect(notice.locator(".trial-status-notice__message")).to_have_text("Your free trial has ended")
    expect(notice.locator("a")).to_have_text("Choose a plan")
    _shots(page, "expired")
    page.locator(f'.cal-cell[data-iso="{seed["income_date"]}"]').evaluate("el => el.click()")
    expect(page.locator("#billingUpgradeModal.modal-overlay--open")).to_be_visible()
    expect(page.locator("#txAddModal.modal-overlay--open")).to_have_count(0)
    page.locator("#billingUpgradeDismiss").click()
    _open_billing(page)
    _finish(page, guard)


def _assert_plan_selected(page, guard, account, shot_name):
    _login(page, account["email"], account["password"])
    notice = page.locator(NOTICE)
    expect(notice).to_be_hidden()
    expect(page.locator("html")).not_to_have_class(re.compile(r"bw-billing-readonly"))
    _shots(page, shot_name)
    cell = page.locator('.cal-cell[data-iso="2026-09-20"]')
    expect(cell).to_be_visible()
    cell.evaluate("el => el.click()")
    expect(page.locator("#txAddModal.modal-overlay--open")).to_be_visible()
    expect(page.locator("#billingUpgradeModal.modal-overlay--open")).to_have_count(0)
    page.keyboard.press("Escape")
    expect(page.locator("#txAddModal.modal-overlay--open")).to_have_count(0)
    page.goto("/settings/billing/")
    expect(page.locator("#billingManageHeading")).to_have_text("Your subscription is ready")
    expect(page.locator(NOTICE)).to_be_hidden()
    expect(page.get_by_text("View plans")).to_have_count(0)
    expect(page.get_by_text("Choose a plan")).to_have_count(0)
    page.screenshot(path=str(SHOTS / f"desktop-{shot_name}-billing.png"), full_page=False)
    _finish(page, guard)


@pytest.mark.smoke_title("Trial with Monthly selected")
def test_monthly_selected_during_trial_is_not_nagged(page, guard, seed):
    _assert_plan_selected(page, guard, seed["trials"]["monthly"], "monthly-selected")


@pytest.mark.smoke_title("Trial with Annual selected")
def test_annual_selected_during_trial_is_not_nagged(page, guard, seed):
    _assert_plan_selected(page, guard, seed["trials"]["annual"], "annual-selected")


@pytest.mark.smoke_title("Complimentary account has no trial status")
def test_complimentary_account_has_no_trial_status(page, guard, seed):
    account = seed["trials"]["complimentary"]
    _login(page, account["email"], account["password"])
    notice = page.locator(NOTICE)
    expect(notice).to_be_hidden()
    expect(page.locator("html")).not_to_have_class(re.compile(r"bw-billing-readonly"))
    _shots(page, "complimentary")
    cell = page.locator('.cal-cell[data-iso="2026-09-20"]')
    expect(cell).to_be_visible()
    cell.evaluate("el => el.click()")
    expect(page.locator("#txAddModal.modal-overlay--open")).to_be_visible()
    expect(page.locator("#billingUpgradeModal.modal-overlay--open")).to_have_count(0)
    page.keyboard.press("Escape")
    _finish(page, guard)
