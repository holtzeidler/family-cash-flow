"""Local BalanceWhiz smoke checks. These tests run in order and share one database."""

from __future__ import annotations

import re

import pytest
from playwright.sync_api import expect

from support import (
    assert_action_accessible,
    assert_no_horizontal_overflow,
    assert_route_ok,
    login,
    money,
    open_add_on_day,
    show_month,
)

PUBLIC_LINKS = (
    "/",
    "/learn/",
    "/plans/",
    "/login.html",
    "/account-setup/?fresh=1",
    "/help.html",
    "/about.html",
    "/contactus/",
    "/privacy.html",
    "/terms.html",
)


def _finish(page, guard, locator=None):
    assert "/checkout" not in page.url
    assert_no_horizontal_overflow(page)
    if locator is not None:
        assert_action_accessible(page, locator)
    guard.assert_clean()


@pytest.mark.smoke_title("Public pages")
def test_public_pages(page, guard):
    response = page.goto("/")
    assert_route_ok(response, "/")
    expect(page.get_by_role("heading", name="Never get surprised by your checking account again.")).to_be_visible()
    cta = page.locator("a.landing-hero__cta").first
    assert_action_accessible(page, cta)
    assert_no_horizontal_overflow(page)
    cta.click()
    page.wait_for_url(re.compile(r"/account-setup/"))
    expect(page.locator("#accountSetupWizardStepLabel")).to_have_text("Step 1 of 4")
    assert_action_accessible(page, page.locator("#signupBtn"))

    learn = page.goto("/learn/")
    assert_route_ok(learn, "/learn/")
    expect(page.get_by_role("heading", name="See your cash flow before it happens.")).to_be_visible()
    assert_no_horizontal_overflow(page)

    pricing = page.goto("/plans/")
    assert_route_ok(pricing, "/plans/")
    expect(page.get_by_role("heading", name="Know what cash is safe to use.")).to_be_visible()
    assert_no_horizontal_overflow(page)

    origin = page.url.split("/plans/")[0]
    for path in PUBLIC_LINKS:
        checked = page.request.get(origin + path)
        assert checked.status < 400, f"{path} returned {checked.status}"
    _finish(page, guard, page.locator("a.landing-hero__cta, a.plans-hero__cta, a[href*='account-setup']").first)


@pytest.mark.smoke_title("Login")
def test_login(page, guard, seed):
    response = page.goto("/login.html")
    assert_route_ok(response, "/login.html")
    page.locator("#email").fill(seed["active"]["email"])
    page.locator("#password").fill("not-the-smoke-password")
    page.locator("#loginBtn").click()
    expect(page.locator("#loginCallout")).to_be_visible()
    expect(page).to_have_url(re.compile(r"/login\.html"))

    login(page, seed["active"]["email"], seed["active"]["password"])
    expect(page.locator("#calendarGrid")).to_be_visible()
    page.locator("#logoutBtn").click()
    page.wait_for_url(re.compile(r"http://127\.0\.0\.1:8765/?$"))
    page.goto("/calendar")
    page.wait_for_url(re.compile(r"/login\.html"))
    _finish(page, guard, page.locator("#loginBtn"))


@pytest.mark.smoke_title("Protected routes")
def test_protected_routes(page, guard):
    response = page.goto("/calendar")
    assert response is not None
    page.wait_for_url(re.compile(r"/login\.html"))
    expect(page.locator("#loginBtn")).to_be_visible()
    _finish(page, guard, page.locator("#loginBtn"))


@pytest.mark.smoke_title("Dashboard")
def test_dashboard(page, guard, seed):
    login(page, seed["active"]["email"], seed["active"]["password"])
    show_month(page, seed["month"], seed["expense_date"])
    expect(page.locator(f'.cal-cell[data-iso="{seed["expense_date"]}"] .cal-balance')).to_have_text(
        money(seed["seed_balance"])
    )
    expect(page.locator(f'.cal-cell[data-iso="{seed["income_date"]}"] .cal-balance')).to_have_text(
        money(seed["seed_balance"])
    )
    _finish(page, guard, page.locator("#logoutBtn"))


@pytest.mark.smoke_title("Add income")
def test_add_income(page, guard, seed):
    login(page, seed["active"]["email"], seed["active"]["password"])
    show_month(page, seed["month"], seed["income_date"])
    open_add_on_day(page, seed["income_date"])
    page.locator("#txAddQuickChips .tx-quick-chip", has_text=re.compile(r"^Bonus$")).click()
    page.locator("#txAddRecurrence").select_option("")
    page.locator("#txAddAmount").fill(seed["income_amount"])
    page.locator("#txAddSave").click()
    expect(page.locator("#txAddModal.modal-overlay--open")).to_have_count(0)
    expect(page.locator(f'.cal-cell[data-iso="{seed["income_date"]}"] .cal-balance')).to_have_text(
        money(seed["balance_after_income"])
    )
    expect(page.locator(f'.cal-cell[data-iso="{seed["expense_date"]}"] .cal-balance')).to_have_text(
        money(seed["seed_balance"])
    )
    _finish(page, guard, page.locator("#logoutBtn"))


@pytest.mark.smoke_title("Edit expense")
def test_edit_expense(page, guard, seed):
    login(page, seed["active"]["email"], seed["active"]["password"])
    show_month(page, seed["month"], seed["expense_date"])
    page.locator(
        f'.cal-cell[data-iso="{seed["expense_date"]}"] .cal-tx-part',
        has_text=money(seed["expense_amount"]),
    ).click()
    expect(page.locator("#txEditModal.modal-overlay--open")).to_be_visible()
    page.locator("#txEditAmount").fill(seed["edited_expense_amount"])
    page.locator("#txEditSave").click()
    expect(page.locator("#txEditModal.modal-overlay--open")).to_have_count(0)
    expect(page.locator(f'.cal-cell[data-iso="{seed["expense_date"]}"] .cal-balance')).to_have_text(
        money(seed["balance_after_edit_on_expense_day"])
    )
    expect(page.locator(f'.cal-cell[data-iso="{seed["income_date"]}"] .cal-balance')).to_have_text(
        money(seed["balance_after_edit_on_income_day"])
    )
    _finish(page, guard, page.locator("#logoutBtn"))


@pytest.mark.smoke_title("Delete transaction")
def test_delete_transaction(page, guard, seed):
    login(page, seed["active"]["email"], seed["active"]["password"])
    show_month(page, seed["month"], seed["income_date"])
    bonus = page.locator(
        f'.cal-cell[data-iso="{seed["income_date"]}"] .cal-tx-part',
        has_text=seed["income_category"],
    )
    expect(bonus).to_be_visible()
    bonus.click()
    expect(page.locator("#txEditModal.modal-overlay--open")).to_be_visible()
    page.locator("#txEditDelete").click()
    page.locator("#bwConfirmOk").click()
    expect(bonus).to_have_count(0)
    expect(page.locator(f'.cal-cell[data-iso="{seed["income_date"]}"] .cal-balance')).to_have_text(
        money(seed["balance_after_delete"])
    )
    _finish(page, guard, page.locator("#logoutBtn"))


@pytest.mark.smoke_title("Reports")
def test_reports(page, guard, seed):
    login(page, seed["active"]["email"], seed["active"]["password"])
    response = page.goto("/reports/")
    assert_route_ok(response, "/reports/")
    expect(page.get_by_role("heading", name="Balance trendline")).to_be_visible()
    page.get_by_role("button", name="Income vs Expense").click()
    expect(page.get_by_role("heading", name="Income vs. expense timing")).to_be_visible()
    _finish(page, guard, page.locator("#incomeExpenseStackedBtn"))


@pytest.mark.smoke_title("Billing")
def test_billing(page, guard, seed):
    login(page, seed["active"]["email"], seed["active"]["password"])
    response = page.goto("/settings/?section=billing")
    assert_route_ok(response, "/settings/?section=billing")
    monthly = page.locator("#billingSubscribeMonthly")
    annual = page.locator("#billingSubscribeAnnual")
    expect(monthly).to_be_visible()
    expect(annual).to_be_visible()
    expect(monthly).to_contain_text("$5.99/month")
    expect(annual).to_contain_text("$59.99/year")
    assert "/checkout" not in page.url
    _finish(page, guard, monthly)


@pytest.mark.smoke_title("View-only access")
def test_view_only_access(page, guard, seed):
    guard.allow_blocked_writes = True
    login(page, seed["viewonly"]["email"], seed["viewonly"]["password"])
    show_month(page, seed["month"], seed["expense_date"])
    expect(page.locator(f'.cal-cell[data-iso="{seed["expense_date"]}"] .cal-balance')).to_have_text(
        money(seed["seed_balance"])
    )
    upgrade = page.locator("#billingUpgradeModal.modal-overlay--open")
    if upgrade.count() == 0:
        page.locator(f'.cal-cell[data-iso="{seed["income_date"]}"]').evaluate("el => el.click()")
    expect(upgrade).to_be_visible()
    expect(page.locator("#txAddModal.modal-overlay--open")).to_have_count(0)
    expect(page.locator("#billingUpgradeMonthly")).to_contain_text("$5.99/month")
    expect(page.locator("#billingUpgradeAnnual")).to_contain_text("$59.99/year")
    expect(page.locator("#billingUpgradeAnnual")).to_have_attribute(
        "href", re.compile(r"/checkout/\?.*lookup_key=cash_forecast_annual")
    )
    expect(page.locator("#billingUpgradeMonthly")).to_have_attribute(
        "href", re.compile(r"/checkout/\?.*lookup_key=cash_forecast_monthly")
    )
    assert "/checkout" not in page.url

    response = page.goto("/settings/?section=billing")
    assert_route_ok(response, "/settings/?section=billing")
    monthly = page.locator("#billingSubscribeMonthly")
    annual = page.locator("#billingSubscribeAnnual")
    expect(monthly).to_be_visible()
    expect(annual).to_be_visible()
    expect(page.get_by_text("$5.99/month").first).to_be_visible()
    expect(page.get_by_text("$59.99/year").first).to_be_visible()
    assert "checkout" not in (monthly.get_attribute("href") or "")
    expect(page.locator("#billingContinueCheckout")).to_be_disabled()
    assert "/checkout" not in page.url
    _finish(page, guard, monthly)
