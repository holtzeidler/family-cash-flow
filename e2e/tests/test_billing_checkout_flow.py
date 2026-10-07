"""Billing plan choice stays on the page until Continue to secure checkout."""

from __future__ import annotations

import json
import re

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
    expect(page.locator("#billingContinueCheckout")).to_be_visible()


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
    annual = page.locator("#billingSubscribeAnnual")
    monthly = page.locator("#billingSubscribeMonthly")
    cta = page.locator("#billingContinueCheckout")

    expect(page.locator("#billingSubscribeTitle")).to_have_text("Continue after your free trial")
    expect(page.locator("#billingSubscribeReassure")).to_contain_text("No charge today")
    expect(annual).to_have_attribute("aria-checked", "false")
    expect(monthly).to_have_attribute("aria-checked", "false")
    expect(cta).to_be_disabled()
    expect(cta).to_have_text("Continue to secure checkout")

    annual.click()
    expect(annual).to_have_attribute("aria-checked", "true")
    expect(monthly).to_have_attribute("aria-checked", "false")
    expect(cta).to_be_enabled()
    assert "/checkout" not in page.url
    assert posts == []
    selected_shadow = annual.evaluate("el => getComputedStyle(el).boxShadow")
    assert "11, 61, 46" in selected_shadow

    monthly.click()
    expect(monthly).to_have_attribute("aria-checked", "true")
    expect(annual).to_have_attribute("aria-checked", "false")
    assert posts == []

    held = _hold_checkout(page)
    page.evaluate(
        """() => {
          const btn = document.getElementById("billingContinueCheckout");
          btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
          btn.disabled = false;
          btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        }"""
    )
    expect(cta).to_have_text("Preparing checkout…")
    assert len(held) == 1
    assert _lookup_key(held[0].request) == MONTHLY

    _fail(held[0])
    expect(cta).to_have_text("Continue to secure checkout")
    expect(cta).to_be_enabled()
    expect(page.locator("#billingCheckoutError")).to_be_visible()
    expect(page.locator("#billingCheckoutError")).to_have_text("Stripe could not start checkout.")
    assert "/checkout" not in page.url

    annual.click()
    expect(annual).to_have_attribute("aria-checked", "true")
    held.clear()
    cta.click()
    expect(cta).to_have_text("Preparing checkout…")
    assert len(held) == 1
    assert _lookup_key(held[0].request) == ANNUAL
    _fail(held[0], "Annual checkout failed.")
    expect(cta).to_be_enabled()
    expect(page.locator("#billingCheckoutError")).to_be_visible()
    expect(page.locator("#billingCheckoutError")).to_have_text("Annual checkout failed.")

    held.clear()
    cta.click()
    expect(cta).to_have_text("Preparing checkout…")
    assert len(held) == 1
    page.evaluate(
        """() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }))"""
    )
    expect(cta).to_have_text("Continue to secure checkout")
    expect(cta).to_be_enabled()
    expect(annual).to_have_attribute("aria-checked", "true")
    held[0].fulfill(
        status=200,
        content_type="application/json",
        body=json.dumps({"url": "https://checkout.stripe.com/c/pay/cs_test_abandoned"}),
    )
    page.wait_for_timeout(400)
    assert "stripe.com" not in page.url
    assert "/checkout" not in page.url
    expect(cta).to_have_text("Continue to secure checkout")

    response = page.goto("/settings/?section=billing&checkout=canceled")
    assert_route_ok(response, "/settings/?section=billing&checkout=canceled")
    expect(page.locator("#bwToast")).to_have_text("Checkout canceled — you can subscribe anytime.")
    expect(cta).to_have_text("Continue to secure checkout")
    expect(cta).to_be_disabled()
    expect(annual).to_have_attribute("aria-checked", "false")
    annual.click()
    expect(cta).to_be_enabled()
    expect(cta).not_to_have_text("Preparing checkout…")
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
    annual = page.locator("#billingSubscribeAnnual")
    monthly = page.locator("#billingSubscribeMonthly")
    cta = page.locator("#billingContinueCheckout")
    expect(annual).to_have_text("Choose annual")
    expect(monthly).to_have_text("Choose monthly")
    expect(cta).to_be_disabled()
    _dismiss_upgrade_modal(page)

    annual.click()
    expect(annual).to_have_attribute("aria-checked", "true")
    expect(page.locator(".billing-price-card--annual")).to_be_visible()
    assert "/checkout" not in page.url
    assert posts == []

    _dismiss_upgrade_modal(page)
    held = _hold_checkout(page)
    cta.click()
    assert len(held) == 1
    assert _lookup_key(held[0].request) == ANNUAL
    _fail(held[0])
    expect(cta).to_be_enabled()
    expect(page.locator("#billingCheckoutError")).to_be_visible()

    _dismiss_upgrade_modal(page)
    monthly.click()
    held.clear()
    _dismiss_upgrade_modal(page)
    cta.click()
    assert len(held) == 1
    assert _lookup_key(held[0].request) == MONTHLY
    _fail(held[0])
    expect(cta).to_have_text("Continue to secure checkout")
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
    expect(page.locator("#checkout-and-portal-button")).to_have_text("Continue to checkout")
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
    expect(page.locator("#billingContinueCheckout")).to_have_text("Continue to secure checkout")
    guard.assert_clean()
