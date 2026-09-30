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
    with page.expect_response(lambda r: "/billing-status" in r.url and r.status == 200, timeout=20_000) as info:
        page.locator("#loginBtn").click()
    billing = info.value.json()
    page.wait_for_url(re.compile(r"/calendar"), timeout=20_000)
    page.wait_for_function("() => !!document.getElementById('trialStatusNotice')")
    return billing


def _trial_lead(days: int) -> str:
    if days <= 0:
        return "Your free trial ends today"
    if days == 1:
        return "1 day left in your free trial"
    return f"{days} days left in your free trial"


def _utc_month_day(page, iso: str) -> str:
    return page.evaluate(
        """(iso) => {
          const date = new Date(iso);
          const now = new Date();
          const opts = { month: 'long', day: 'numeric', timeZone: 'UTC' };
          if (date.getUTCFullYear() !== now.getUTCFullYear()) opts.year = 'numeric';
          return date.toLocaleDateString(undefined, opts);
        }""",
        iso,
    )


def _assert_under_nav(page):
    placed = page.evaluate(
        """() => {
          const el = document.getElementById('trialStatusNotice');
          return !!(el && el.previousElementSibling && el.previousElementSibling.classList.contains('top-nav'));
        }"""
    )
    assert placed, "trial status notice is not directly under the main navigation"


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


def _assert_text_link(notice):
    link = notice.locator("a.trial-status-notice__action")
    expect(link).to_have_text("Choose a plan")
    expect(link).to_have_attribute("href", "/settings/?section=billing")
    expect(notice).to_have_attribute("data-trial-cta", "link")
    expect(link).not_to_have_class(re.compile(r"trial-status-notice__action--button"))


def _assert_filled_cta(notice, prominent=False):
    link = notice.locator("a.trial-status-notice__action--button")
    expect(link).to_have_text("Choose a plan")
    expect(link).to_have_attribute("href", "/settings/?section=billing")
    expect(notice).to_have_attribute("data-trial-cta", "prominent" if prominent else "button")
    if prominent:
        expect(link).to_have_class(re.compile(r"trial-status-notice__action--prominent"))
    else:
        expect(link).not_to_have_class(re.compile(r"trial-status-notice__action--prominent"))


def _open_billing(page):
    page.locator(f"{NOTICE} a.trial-status-notice__action").click()
    page.wait_for_url(re.compile(r"/settings"))
    expect(page.locator("#billingSubscribeMonthly")).to_be_visible()
    expect(page.locator("#billingSubscribeAnnual")).to_be_visible()
    assert "/checkout" not in page.url


@pytest.mark.smoke_title("Trial status with more than 3 days left")
def test_trial_status_shows_days_remaining_beyond_3(page, guard, seed):
    billing = _login(page, seed["active"]["email"], seed["active"]["password"])
    days = int(billing["trial_days_remaining"])
    assert days > 3, days
    notice = page.locator(NOTICE)
    _assert_under_nav(page)
    expect(notice).to_be_visible()
    expect(notice).to_have_attribute("data-trial-state", "countdown")
    expect(notice.locator(".trial-status-notice__message")).to_have_text(_trial_lead(days))
    _assert_text_link(notice)
    weight = notice.locator(".trial-status-notice__message").evaluate("el => getComputedStyle(el).fontWeight")
    assert int(weight) < 600
    _shots(page, "over-3")
    _open_billing(page)
    _finish(page, guard)


@pytest.mark.smoke_title("Trial status at 7 days")
def test_trial_status_at_7_days(page, guard, seed):
    account = seed["trials"]["days7"]
    _login(page, account["email"], account["password"])
    notice = page.locator(NOTICE)
    expect(notice).to_be_visible()
    expect(notice).to_have_attribute("data-trial-state", "countdown")
    expect(notice.locator(".trial-status-notice__message")).to_have_text("7 days left in your free trial")
    _assert_text_link(notice)
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
    days = int(account["trial_days_remaining"])
    assert days == 3, days
    notice = page.locator(NOTICE)
    expect(notice).to_have_attribute("data-trial-state", "soon")
    expect(notice.locator(".trial-status-notice__message")).to_have_text(_trial_lead(days))
    _assert_filled_cta(notice)
    weight = notice.locator(".trial-status-notice__message").evaluate("el => getComputedStyle(el).fontWeight")
    assert int(weight) >= 600
    _shots(page, "3-days")
    _open_billing(page)
    _finish(page, guard)


@pytest.mark.smoke_title("Trial status one day left")
def test_trial_status_one_day_left(page, guard, seed):
    account = seed["trials"]["days1"]
    _login(page, account["email"], account["password"])
    assert int(account["trial_days_remaining"]) == 1
    notice = page.locator(NOTICE)
    expect(notice).to_have_attribute("data-trial-state", "urgent")
    expect(notice.locator(".trial-status-notice__message")).to_have_text("1 day left in your free trial")
    _assert_filled_cta(notice)
    expect(notice).not_to_contain_text("has ended")
    expect(notice).not_to_contain_text("tomorrow")
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
    assert int(account["trial_days_remaining"]) == 0
    notice = page.locator(NOTICE)
    expect(notice).to_have_attribute("data-trial-state", "today")
    expect(notice.locator(".trial-status-notice__message")).to_have_text("Your free trial ends today")
    expect(notice).not_to_contain_text("0 days")
    expect(notice).not_to_contain_text("has ended")
    _assert_filled_cta(notice, prominent=True)
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
    expect(notice.locator(".trial-status-notice__message")).to_have_text(
        "Your free trial has ended. Your forecast is now view-only."
    )
    _assert_filled_cta(notice, prominent=True)
    _shots(page, "expired")
    page.locator(f'.cal-cell[data-iso="{seed["income_date"]}"]').evaluate("el => el.click()")
    expect(page.locator("#billingUpgradeModal.modal-overlay--open")).to_be_visible()
    expect(page.locator("#txAddModal.modal-overlay--open")).to_have_count(0)
    page.locator("#billingUpgradeDismiss").click()
    _open_billing(page)
    _finish(page, guard)


def _assert_plan_selected(page, guard, account, shot_name, plan_name):
    _login(page, account["email"], account["password"])
    days = int(account["trial_days_remaining"])
    label = _utc_month_day(page, account["first_charge_at"])
    message = f"{_trial_lead(days)} · {plan_name} plan starts {label}"
    notice = page.locator(NOTICE)
    expect(notice).to_be_visible()
    expect(notice).to_have_attribute("data-trial-state", "scheduled")
    expect(notice).not_to_have_attribute("data-trial-cta", re.compile(r".+"))
    expect(notice.locator(".trial-status-notice__message")).to_have_text(message)
    expect(notice.locator("a")).to_have_count(0)
    expect(notice).not_to_contain_text("Choose a plan")
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
    expect(page.locator(NOTICE).locator(".trial-status-notice__message")).to_have_text(message)
    expect(page.locator(f"{NOTICE} a")).to_have_count(0)
    expect(page.get_by_text("Choose a plan")).to_have_count(0)
    page.screenshot(path=str(SHOTS / f"desktop-{shot_name}-billing.png"), full_page=False)
    _finish(page, guard)


@pytest.mark.smoke_title("Trial with Monthly selected")
def test_monthly_selected_during_trial_is_not_nagged(page, guard, seed):
    account = seed["trials"]["monthly"]
    assert int(account["trial_days_remaining"]) > 3
    _assert_plan_selected(page, guard, account, "monthly-selected", "Monthly")


@pytest.mark.smoke_title("Trial with Annual selected")
def test_annual_selected_during_trial_is_not_nagged(page, guard, seed):
    account = seed["trials"]["annual"]
    assert int(account["trial_days_remaining"]) == 3
    _assert_plan_selected(page, guard, account, "annual-selected", "Annual")


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
    page.goto("/settings/billing/")
    billing = page.locator('[data-settings-pane="billing"]')
    expect(page.locator("#billingManageHeading")).to_be_visible()
    expect(page.locator("#billingManageHeading")).to_have_text("Complimentary access")
    expect(page.locator("#billingManageHint")).to_have_text(
        "You have complimentary access to BalanceWhiz. No subscription or payment is required."
    )
    expect(page.locator(".billing-page__lede")).to_have_text("Your access to BalanceWhiz.")
    expect(page.locator(NOTICE)).to_be_hidden()
    expect(billing.locator("#billingMeta")).to_be_hidden()
    expect(billing.locator("#billingSubscribeChoices")).to_be_hidden()
    expect(billing.locator("#billingPrimaryCta")).to_be_hidden()
    expect(billing.locator("#billingCancelSection")).to_be_hidden()
    expect(billing.locator('[data-billing-action="portal"]')).to_be_hidden()
    expect(billing.locator('[data-billing-action="cycle"]')).to_be_hidden()
    expect(billing.locator("#billingManageReassure")).to_be_hidden()
    expect(billing.get_by_text("Cancel anytime")).to_have_count(0)
    expect(billing.get_by_text("free trial", exact=False)).to_have_count(0)
    expect(billing.get_by_text("Choose a plan")).to_have_count(0)
    expect(billing.get_by_text("Next renewal")).to_be_hidden()
    expect(page.locator(".billing-side__support-copy")).to_have_text("Questions about your account?")
    _shots(page, "complimentary-billing")
    _finish(page, guard)


@pytest.mark.smoke_title("Paid subscriber has no trial status")
def test_paid_subscriber_has_no_trial_status(page, guard, seed):
    account = seed["trials"]["paid"]
    billing = _login(page, account["email"], account["password"])
    assert billing["phase"] == "active"
    assert billing["in_app_trial"] is True
    notice = page.locator(NOTICE)
    expect(notice).to_be_hidden()
    expect(notice).not_to_contain_text("free trial")
    expect(notice).not_to_contain_text("Choose a plan")
    expect(page.locator("html")).not_to_have_class(re.compile(r"bw-billing-readonly"))
    _shots(page, "paid")
    _finish(page, guard)


@pytest.mark.smoke_title("Canceling subscription is not a trial")
def test_canceling_subscription_is_not_a_trial(page, guard, seed):
    account = seed["trials"]["canceling"]
    _login(page, account["email"], account["password"])
    notice = page.locator(NOTICE)
    expect(notice).to_be_hidden()
    expect(notice).not_to_contain_text("free trial")
    expect(notice).not_to_contain_text("Choose a plan")
    page.goto("/settings/billing/")
    expect(page.locator("#billingManageHeading")).to_have_text("Your subscription is set to end")
    expect(page.locator(NOTICE)).to_be_hidden()
    expect(page.get_by_text("Choose a plan")).to_have_count(0)
    _shots(page, "canceling")
    _finish(page, guard)
