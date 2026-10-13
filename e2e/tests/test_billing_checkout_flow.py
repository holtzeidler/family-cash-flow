"""New subscriptions choose a plan on the standalone checkout page."""

from __future__ import annotations

import json
import re
from datetime import datetime

import pytest
from playwright.sync_api import expect

from smoke_guard import SMOKE_ORIGIN
from support import assert_route_ok, login

ANNUAL = "cash_forecast_annual"
MONTHLY = "cash_forecast_monthly"
SESSION = "**/create-checkout-session"


def _open_billing(page, email, password):
    login(page, email, password)
    response = page.goto("/settings/?section=billing")
    assert_route_ok(response, "/settings/?section=billing")
    expect(page.locator("#billingChoosePlanLink")).to_be_visible()


def _lookup_key(request):
    body = request.post_data or ""
    if ANNUAL in body:
        return ANNUAL
    if MONTHLY in body:
        return MONTHLY
    return ""


def _hold_checkout(page):
    held = []

    def handle(route):
        held.append(route)

    page.route(SESSION, handle)
    return held


def _fail(route, message="Stripe could not start checkout."):
    route.fulfill(
        status=400,
        content_type="application/json",
        body=json.dumps({"error": {"message": message}}),
    )


@pytest.mark.smoke_title("Billing checkout waits for an explicit continue")
def test_billing_checkout_select_then_continue(page, guard, seed):
    posts = []
    page.on(
        "request",
        lambda req: posts.append(req)
        if req.method == "POST" and "create-checkout-session" in req.url
        else None,
    )
    _open_billing(page, seed["active"]["email"], seed["active"]["password"])
    link = page.locator("#billingChoosePlanLink")
    expect(link).to_have_text("Choose a plan")
    expect(link).to_have_attribute("href", re.compile(r"/checkout/\?family_id=\d+$"))
    expect(page.locator("#billingSubscribeAnnual")).to_be_hidden()
    expect(page.locator("#billingContinueCheckout")).to_be_hidden()
    expect(page.locator("#billingSubscribeReassure")).to_contain_text("No charge today")
    assert posts == []

    link.click()
    page.wait_for_url(re.compile(r"/checkout/"))
    expect(page.locator("#checkoutTitle")).to_have_text("Choose your billing option")
    expect(page.locator("#checkoutNavCta")).to_have_text("Back to Forecast")
    expect(page.locator("#checkoutNavCta")).to_have_attribute("href", "/calendar/")
    expect(page.locator("#billingCardVerifyNotice")).to_contain_text("temporary $1 authorization")
    monthly = page.locator('input[data-lookup-key="cash_forecast_monthly"]')
    annual = page.locator('input[data-lookup-key="cash_forecast_annual"]')
    cta = page.locator("#checkout-and-portal-button")
    expect(annual).not_to_be_checked()
    expect(monthly).not_to_be_checked()
    expect(cta).to_have_attribute("aria-disabled", "true")
    expect(page.locator("#checkoutReassure")).to_contain_text(
        "You won't be charged for your subscription today."
    )
    expect(page.locator("#checkoutReassure")).to_contain_text("Your first charge is")
    expect(page.locator("#checkoutReassure")).to_contain_text("when your free trial ends.")
    assert posts == []

    monthly.check()
    expect(monthly).to_be_checked()
    expect(cta).not_to_have_attribute("aria-disabled", "true")
    expect(cta).to_have_text("Continue to checkout")
    assert posts == []

    held = _hold_checkout(page)
    cta.click()
    expect(cta).to_contain_text("Redirecting to Stripe")
    assert len(held) == 1
    assert _lookup_key(held[0].request) == MONTHLY

    _fail(held[0])
    expect(cta).to_have_text("Continue to checkout")
    expect(page.locator("#checkoutErr")).to_be_visible()
    expect(page.locator("#checkoutErr")).to_have_text("Stripe could not start checkout.")
    assert "/checkout/" in page.url

    annual.check()
    held.clear()
    cta.click()
    assert len(held) == 1
    assert _lookup_key(held[0].request) == ANNUAL
    _fail(held[0], "Annual checkout failed.")
    expect(page.locator("#checkoutErr")).to_have_text("Annual checkout failed.")
    guard.assert_clean()


def _dismiss_upgrade_modal(page):
    modal = page.locator("#billingUpgradeModal.modal-overlay--open")
    if modal.count() == 0:
        return
    page.locator("#billingUpgradeDismiss").click()
    expect(modal).to_be_hidden()


@pytest.mark.smoke_title("Expired trial billing cards use the same checkout button")
def test_trial_ended_cards_use_secure_checkout_button(page, guard, seed):
    guard.allow_blocked_writes = True
    posts = []
    page.on(
        "request",
        lambda req: posts.append(req)
        if req.method == "POST" and "create-checkout-session" in req.url
        else None,
    )
    _open_billing(page, seed["viewonly"]["email"], seed["viewonly"]["password"])
    link = page.locator("#billingChoosePlanLink")
    expect(link).to_have_text("Choose a plan")
    expect(page.locator("#billingSubscribeMonthly")).to_be_hidden()
    expect(page.locator("#billingContinueCheckout")).to_be_hidden()
    _dismiss_upgrade_modal(page)
    assert posts == []

    link.click()
    page.wait_for_url(re.compile(r"/checkout/"))
    monthly = page.locator('input[data-lookup-key="cash_forecast_monthly"]')
    annual = page.locator('input[data-lookup-key="cash_forecast_annual"]')
    cta = page.locator("#checkout-and-portal-button")
    expect(annual).not_to_be_checked()
    expect(monthly).not_to_be_checked()
    expect(cta).to_have_attribute("aria-disabled", "true")
    expect(page.locator("#checkoutReassure")).to_have_text(
        "Payment is completed securely through Stripe."
    )
    assert posts == []

    annual.check()
    expect(cta).to_have_text("Continue to checkout")
    held = _hold_checkout(page)
    cta.click()
    assert len(held) == 1
    assert _lookup_key(held[0].request) == ANNUAL
    _fail(held[0])
    expect(cta).to_have_text("Continue to checkout")
    expect(page.locator("#checkoutErr")).to_be_visible()

    monthly.check()
    held.clear()
    cta.click()
    assert len(held) == 1
    assert _lookup_key(held[0].request) == MONTHLY
    _fail(held[0])
    expect(cta).to_have_text("Continue to checkout")
    guard.assert_clean()


@pytest.mark.smoke_title("Expired trial can return to the forecast")
def test_expired_trial_can_return_to_forecast(page, guard, seed):
    guard.allow_blocked_writes = True
    account = seed["viewonly"]
    login(page, account["email"], account["password"])
    response = page.goto(f"/checkout/?family_id={account['family_id']}")
    assert_route_ok(response, "/checkout/")
    back = page.locator("#checkoutNavCta")
    expect(back).to_have_text("Back to Forecast")
    expect(back).to_have_attribute("href", "/calendar/")
    back.click()
    page.wait_for_url(re.compile(r"/calendar"))
    modal = page.locator("#billingUpgradeModal.modal-overlay--open")
    if modal.count():
        page.locator("#billingUpgradeDismiss").click()
        expect(modal).to_be_hidden()
    expect(page.locator(".cal-cell").first).to_be_visible()
    assert "/checkout/" not in page.url
    guard.assert_clean()


@pytest.mark.smoke_title("Trial ending today is not billed at checkout")
def test_checkout_names_same_day_trial_charge(page, guard, seed):
    account = seed["trials"]["today"]
    login(page, account["email"], account["password"])
    response = page.goto(f"/checkout/?family_id={account['family_id']}")
    assert_route_ok(response, "/checkout/")
    reassure = page.locator("#checkoutReassure")
    when = datetime.fromisoformat(account["trial_ends_at"].replace("Z", "+00:00")).astimezone()
    charge_is_today = when.date() == datetime.now().astimezone().date()
    expect(reassure).to_contain_text("when your free trial ends.")
    if charge_is_today:
        expect(reassure).to_contain_text("You won't be charged when you check out.")
        expect(reassure).to_contain_text("Your first subscription charge is today at")
        expect(reassure).not_to_contain_text("You won't be charged for your subscription today.")
    else:
        expect(reassure).to_contain_text("You won't be charged for your subscription today.")
        expect(reassure).to_contain_text("Your first charge is")
    expect(page.locator('input[name="billing_cycle"]:checked')).to_have_count(0)
    expect(page.locator("#checkout-and-portal-button")).to_have_attribute("aria-disabled", "true")

    annual = page.goto(
        f"/checkout/?family_id={account['family_id']}&lookup_key={ANNUAL}"
    )
    assert_route_ok(annual, "/checkout/")
    expect(page.locator('input[data-lookup-key="cash_forecast_annual"]')).to_be_checked()
    expect(page.locator('input[data-lookup-key="cash_forecast_monthly"]')).not_to_be_checked()
    expect(page.locator("#checkout-and-portal-button")).to_have_text("Continue to checkout")
    guard.assert_clean()


@pytest.mark.smoke_title("Standalone checkout page still starts Stripe")
def test_standalone_checkout_page_still_starts_checkout(page, guard, seed):
    login(page, seed["active"]["email"], seed["active"]["password"])
    family_id = seed["active"]["family_id"]

    def serve_built_checkout(route):
        response = route.fetch()
        body = response.text().replace("__API_BASE__", SMOKE_ORIGIN)
        route.fulfill(status=response.status, content_type="text/html", body=body)

    page.route(re.compile(r"/checkout/(\?|$)"), serve_built_checkout)
    held = _hold_checkout(page)
    response = page.goto(f"/checkout/?lookup_key={MONTHLY}&family_id={family_id}")
    assert_route_ok(response, "/checkout/")
    expect(page.locator("#checkoutTitle")).to_have_text("Choose your billing option")
    expect(page.locator('input[data-lookup-key="cash_forecast_monthly"]')).to_be_checked()
    expect(page.locator('input[data-lookup-key="cash_forecast_annual"]')).not_to_be_checked()
    expect(page.locator("#checkout-and-portal-button")).to_have_text("Continue to checkout")
    expect(page.locator("#checkoutReassure")).to_contain_text(
        "You won't be charged for your subscription today."
    )
    assert held == []

    page.locator("#checkout-and-portal-button").click()
    assert len(held) == 1
    assert _lookup_key(held[0].request) == MONTHLY
    assert "family_id" in (held[0].request.post_data or "")
    held[0].fulfill(
        status=200,
        content_type="application/json",
        body=json.dumps({"url": "/checkout/success/?probe=1"}),
    )
    page.wait_for_url(re.compile(r"/settings/"))
    expect(page.locator("#bwToast")).to_have_text("Payment received — refreshing your billing status.")
    expect(page.locator("#billingChoosePlanLink")).to_have_text("Choose a plan")
    expect(page.locator("#billingContinueCheckout")).to_be_hidden()
    guard.assert_clean()
