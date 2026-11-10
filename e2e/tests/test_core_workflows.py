"""Core forecast workflows that the older smoke tests do not cover.

Each mutating test uses its own account. The shared smoke seed is left alone.
"""

from __future__ import annotations

import json
import re
import uuid
import urllib.request
from datetime import date, timedelta

import pytest
from playwright.sync_api import expect

from smoke_guard import SMOKE_ORIGIN, assert_bot_email
from support import assert_route_ok, login, money, open_add_on_day, show_month

PASSWORD = "SmokeOnly1!"


def _request(method, path, token=None, body=None):
    data = None if body is None else json.dumps(body).encode()
    headers = {"Accept": "application/json"}
    if body is not None:
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = "Bearer " + token
    req = urllib.request.Request(SMOKE_ORIGIN + path, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=30) as resp:
        raw = resp.read().decode()
        return json.loads(raw) if raw else None


def _register_checking(start_balance: str, start_date: str) -> str:
    email = f"bw-smoke-flow{uuid.uuid4().hex[:10]}@example.com"
    assert_bot_email(email)
    body = _request(
        "POST",
        "/api/auth/register",
        body={"email": email, "password": PASSWORD, "first_name": "Flow", "last_name": "Bot"},
    )
    token = str((body or {}).get("access_token") or "")
    families = _request("GET", "/api/families", token=token)
    family_id = int(families[0]["id"])
    _request(
        "POST",
        f"/api/families/{family_id}/accounts",
        token=token,
        body={
            "name": "Checking",
            "type": "checking",
            "starting_balance": start_balance,
            "starting_balance_date": start_date,
        },
    )
    return email


def _add_planned_item(page, iso: str, amount: str, *, kind: str, repeat: str = "", variable: bool = False, name: str = "") -> str:
    open_add_on_day(page, iso)
    page.locator(f'input[name="txAddKind"][value="{kind}"]').check()
    if name:
        chip = page.locator("#txAddQuickChips .tx-quick-chip", has_text=re.compile(rf"^{re.escape(name)}$"))
    else:
        chip = page.locator("#txAddQuickChips .tx-quick-chip").first
    expect(chip).to_be_visible()
    label = name or " ".join(chip.inner_text().split())
    chip.click()
    page.locator("#txAddRecurrence").select_option(repeat or "")
    if variable:
        page.locator("#txAddVariable").check()
    page.locator("#txAddAmount").fill(amount)
    with page.expect_response(lambda response: response.request.method == "POST" and "/api/families/" in response.url) as saved:
        page.locator("#txAddSave").click()
    body = ""
    if not saved.value.ok:
        try:
            body = saved.value.text()[:300]
        except Exception:
            body = ""
    assert saved.value.ok, f"Saving the transaction failed ({saved.value.status}) {body}"
    expect(page.locator("#txAddModal.modal-overlay--open")).to_have_count(0)
    return label


def _assert_tour_card_stays_anchored(page) -> None:
    samples = page.evaluate(
        """() => new Promise((resolve) => {
          const samples = [];
          const start = performance.now();
          function tick() {
            const card = document.querySelector(".bw-tour-tooltip.bw-tour-tooltip--open");
            const target = document.querySelector(".bw-tour-target");
            if (card && target) {
              const box = card.getBoundingClientRect();
              const aim = target.getBoundingClientRect();
              samples.push({
                x: box.left,
                y: box.top,
                w: box.width,
                h: box.height,
                targetW: aim.width,
                targetH: aim.height,
              });
            }
            if (performance.now() - start < 800) requestAnimationFrame(tick);
            else resolve(samples);
          }
          requestAnimationFrame(tick);
        })"""
    )
    assert samples, "Tour card did not render next to a highlight"
    assert all(sample["w"] > 40 and sample["h"] > 40 for sample in samples)
    assert all(sample["targetW"] > 2 and sample["targetH"] > 2 for sample in samples)
    assert all(not (sample["x"] < 20 and sample["y"] < 20) for sample in samples), samples


def _expect_tour_step(page, title: str, counter: str, target_class: str) -> None:
    expect(page.locator("[data-bw-tour-title]")).to_have_text(title)
    expect(page.locator("[data-bw-tour-counter]")).to_have_text(counter)
    expect(page.locator(f".bw-tour-target.{target_class}")).to_have_count(1)
    _assert_tour_card_stays_anchored(page)


@pytest.mark.smoke_title("Signup validation")
def test_signup_rejects_a_short_password(page, guard):
    response = page.goto("/account-setup/?fresh=1")
    assert_route_ok(response, "/account-setup/?fresh=1")
    page.locator("#firstName").fill("Ada")
    page.locator("#lastName").fill("Bot")
    page.locator("#email").fill(f"bw-smoke-short-{uuid.uuid4().hex[:8]}@example.com")
    page.locator("#password").fill("short")
    page.locator("#password2").fill("short")
    page.locator("#signupBtn").click()
    expect(page.locator("#signupCallout")).to_contain_text("Password must be at least 8 characters.")
    expect(page.locator("#accountSetupWizardStepLabel")).to_have_text("Step 1 of 4")
    guard.assert_clean()


@pytest.mark.smoke_title("Signup forecast and tour")
def test_signup_reaches_forecast_and_can_tour_it(page, guard):
    email = f"bw-smoke-join-{uuid.uuid4().hex[:8]}@example.com"
    today = date.today().isoformat()
    response = page.goto("/account-setup/?fresh=1")
    assert_route_ok(response, "/account-setup/?fresh=1")
    page.locator("#firstName").fill("Ada")
    page.locator("#lastName").fill("Bot")
    page.locator("#email").fill(email)
    page.locator("#password").fill(PASSWORD)
    page.locator("#password2").fill(PASSWORD)
    page.locator("#signupBtn").click()
    expect(page.locator("#accountSetupWizardStepLabel")).to_have_text("Step 2 of 4")

    page.locator("#accountName").fill("Checking")
    page.locator("#accountStartingBalance").fill("2000")
    page.locator("#accountStartingBalanceDate").fill(today)
    page.wait_for_timeout(600)
    page.locator("#signupBtn").click()
    expect(page.locator("#accountSetupWizardStepLabel")).to_have_text("Step 3 of 4")
    page.locator("#asTxHubAddIncomeBtn").click()
    page.locator('input[name="asTxKind"][value="income"]').check()
    page.locator("#asTxAmount").fill("100")
    page.locator("#asTxDate").fill(today)
    page.locator("#asTxSaveIncomeBtn").click()
    expect(page.locator("#accountSetupWizardStepLabel")).to_have_text("Step 3 of 4")
    page.wait_for_timeout(600)
    page.locator("#signupBtn").click()
    expect(page.locator("#accountSetupWizardStepLabel")).to_have_text("Step 4 of 4")
    page.wait_for_timeout(600)
    page.locator("#signupBtn").click()
    page.wait_for_url(re.compile(r"/calendar"), timeout=30_000)

    ready = page.locator("#bwForecastReadyModal.modal-overlay--open")
    expect(ready).to_be_visible()
    expect(ready.locator("#bwForecastReadyTitle")).to_have_text("Your first forecast is ready!")
    ready.locator("#bwForecastReadyStartTourBtn").click()

    back = page.locator("[data-bw-tour-back]")
    nxt = page.locator("[data-bw-tour-next]")
    _expect_tour_step(page, "Add income and expenses", "1 of 4", "bw-tour-target--calendar-add")
    expect(back).to_be_hidden()
    nxt.click()
    _expect_tour_step(page, "Plan for bills that change", "2 of 4", "bw-tour-target--needs-review")
    expect(back).to_be_visible()
    expect(back).to_have_text("Back")
    back.click()
    _expect_tour_step(page, "Add income and expenses", "1 of 4", "bw-tour-target--calendar-add")
    expect(page.locator(".bw-tour-tooltip--open")).to_have_count(1)
    expect(back).to_be_hidden()
    nxt.click()
    _expect_tour_step(page, "Plan for bills that change", "2 of 4", "bw-tour-target--needs-review")
    nxt.click()
    _expect_tour_step(page, "Know before your balance gets too low", "3 of 4", "bw-tour-target--cash-outlook")
    expect(back).to_be_visible()
    back.click()
    _expect_tour_step(page, "Plan for bills that change", "2 of 4", "bw-tour-target--needs-review")
    expect(page.locator(".bw-tour-tooltip--open")).to_have_count(1)
    nxt.click()
    _expect_tour_step(page, "Know before your balance gets too low", "3 of 4", "bw-tour-target--cash-outlook")
    nxt.click()
    _expect_tour_step(page, "Keep your forecast accurate", "4 of 4", "bw-tour-target--reconcile-head")
    expect(nxt).to_have_text("Finish Tour")
    expect(page.locator("[data-bw-tour-body]")).to_contain_text("Something changed?")
    expect(back).to_be_visible()
    expect(page.locator("[data-bw-tour-skip-link]")).to_be_visible()
    assert page.evaluate("() => localStorage.getItem('bw_tour_seen_v1')") is None
    back.click()
    _expect_tour_step(page, "Know before your balance gets too low", "3 of 4", "bw-tour-target--cash-outlook")
    expect(page.locator(".bw-tour-tooltip--open")).to_have_count(1)
    assert page.evaluate("() => localStorage.getItem('bw_tour_seen_v1')") is None
    nxt.click()
    _expect_tour_step(page, "Keep your forecast accurate", "4 of 4", "bw-tour-target--reconcile-head")
    nxt.click()
    expect(page.locator(".bw-tour-tooltip--open")).to_have_count(0)
    expect(page.locator("#sidebarLowBalanceBanner")).to_contain_text("Your forecast is getting started")
    expect(page.locator("#sidebarLowBalanceBanner")).to_contain_text(
        "Add your upcoming bills and income to see where your balance is headed."
    )
    expect(page.get_by_text("Stays above your")).to_have_count(0)
    expect(page.get_by_text("Nothing to review")).to_have_count(0)
    expect(page.locator(".cal-day-tx-line", has_text="Mortgage")).to_have_count(0)
    assert page.evaluate("() => localStorage.getItem('bw_tour_seen_v1')")
    page.set_viewport_size({"width": 390, "height": 800})
    expect(page.locator("#sidebarLowBalanceBanner")).to_be_visible()
    page.set_viewport_size({"width": 1280, "height": 720})
    expect(page.locator("#trialStatusNotice")).to_contain_text(re.compile(r"1[34] days left in your free trial"))

    _add_planned_item(page, today, "40", kind="expense")
    expect(page.locator("#sidebarLowBalanceBanner")).to_contain_text("Stays above your")
    expect(page.locator("#sidebarLowBalanceBanner")).not_to_contain_text("Your forecast is getting started")
    expect(page.locator("#sidebarPendingTxCard")).to_contain_text("Nothing to review")

    page.goto("/settings/")
    page.locator('[data-settings-key="preferences"]').click()
    page.locator("#prefRestartTourBtn").click()
    page.wait_for_url(re.compile(r"/calendar"))
    _expect_tour_step(page, "Add income and expenses", "1 of 4", "bw-tour-target--calendar-add")
    page.locator(".bw-tour-tooltip__close").click()
    expect(page.locator(".bw-tour-tooltip--open")).to_have_count(0)

    page.goto("/settings/")
    page.locator('[data-settings-key="preferences"]').click()
    page.locator("#prefRestartTourBtn").click()
    page.wait_for_url(re.compile(r"/calendar"))
    expect(page.locator("[data-bw-tour-title]")).to_have_text("Add income and expenses")
    page.locator(".bw-tour-tooltip__skip").click()
    expect(page.locator(".bw-tour-tooltip--open")).to_have_count(0)
    page.reload()
    expect(page.locator("#calendarGrid")).to_be_visible()
    expect(page.locator(".bw-tour-tooltip--open")).to_have_count(0)
    expect(page.locator("#bwForecastReadyModal.modal-overlay--open")).to_have_count(0)
    guard.assert_clean()


@pytest.mark.smoke_title("A real shortfall still outranks the new-forecast intro")
def test_sparse_forecast_keeps_a_real_shortfall(page, guard):
    email = f"bw-smoke-shortfall-{uuid.uuid4().hex[:8]}@example.com"
    today = date.today().isoformat()
    response = page.goto("/account-setup/?fresh=1")
    assert_route_ok(response, "/account-setup/")
    page.locator("#firstName").fill("Ada")
    page.locator("#lastName").fill("Bot")
    page.locator("#email").fill(email)
    page.locator("#password").fill(PASSWORD)
    page.locator("#password2").fill(PASSWORD)
    page.locator("#signupBtn").click()
    expect(page.locator("#accountSetupWizardStepLabel")).to_have_text("Step 2 of 4")
    page.locator("#accountName").fill("Checking")
    page.locator("#accountStartingBalance").fill("100")
    page.locator("#accountStartingBalanceDate").fill(today)
    page.wait_for_timeout(600)
    page.locator("#signupBtn").click()
    expect(page.locator("#accountSetupWizardStepLabel")).to_have_text("Step 3 of 4")
    page.locator("#asTxHubAddExpenseBtn").click()
    page.locator("#asTxAmount").fill("80")
    page.locator("#asTxDate").fill(today)
    page.locator("#asTxSaveIncomeBtn").click()
    expect(page.locator("#accountSetupWizardStepLabel")).to_have_text("Step 3 of 4")
    page.wait_for_timeout(600)
    page.locator("#signupBtn").click()
    expect(page.locator("#accountSetupWizardStepLabel")).to_have_text("Step 4 of 4")
    page.wait_for_timeout(600)
    page.locator("#signupBtn").click()
    page.wait_for_url(re.compile(r"/calendar"), timeout=30_000)
    page.locator("#bwForecastReadySkipBtn").click()
    expect(page.locator(".bw-tour-tooltip--open")).to_have_count(0)
    expect(page.locator("#sidebarLowBalanceBanner")).to_contain_text("Below your minimum balance")
    expect(page.locator("#sidebarLowBalanceBanner")).not_to_contain_text("Your forecast is getting started")
    page.reload()
    expect(page.locator(".bw-tour-tooltip--open")).to_have_count(0)
    expect(page.locator("#sidebarLowBalanceBanner")).to_contain_text("Below your minimum balance")
    guard.assert_clean()


@pytest.mark.smoke_title("Forecast math persists")
def test_expense_recalculates_forecast_and_survives_reload(page, guard):
    today = date.today()
    start = date(today.year, today.month, 1).isoformat()
    expense_day = today.isoformat()
    email = _register_checking("2000.00", start)
    login(page, email, PASSWORD)
    show_month(page, start[:7], expense_day)
    _add_planned_item(page, expense_day, "1500", kind="expense")
    cell = page.locator(f'.cal-cell[data-iso="{expense_day}"] .cal-balance')
    expect(cell).to_have_text(money("500.00"))
    page.reload()
    show_month(page, start[:7], expense_day)
    expect(cell).to_have_text(money("500.00"))
    expect(page.locator("#sidebarBalanceThresholdAlerts")).to_contain_text("Below your minimum balance")
    guard.assert_clean()


@pytest.mark.smoke_title("Recurring variable bill")
def test_variable_bill_repeats_and_needs_review(page, guard):
    today = date.today()
    start = date(today.year, today.month, 1)
    next_month = (start.replace(day=28) + timedelta(days=4)).replace(day=today.day)
    email = _register_checking("2000.00", start.isoformat())
    login(page, email, PASSWORD)
    show_month(page, start.strftime("%Y-%m"), today.isoformat())
    label = _add_planned_item(page, today.isoformat(), "80", kind="expense", repeat="monthly", variable=True)
    expect(page.locator(f'.cal-cell[data-iso="{today.isoformat()}"]')).to_contain_text(label)
    expect(page.locator("#sidebarPendingTxCard")).to_contain_text("Needs Review")
    expect(page.locator("#sidebarPendingTxCard")).to_contain_text(label)
    expect(page.locator("#sidebarPendingTxCard")).to_contain_text("Est. $80")
    expect(page.locator("#sidebarPendingTxCard")).to_contain_text("due today")
    page.locator("#calendarNextMonth").click()
    expect(page.locator(f'.cal-cell[data-iso="{next_month.isoformat()}"]')).to_contain_text(label)
    expect(page.locator("#sidebarPendingTxCard")).to_contain_text(label)
    expect(page.locator("#sidebarPendingTxCard")).to_contain_text("due today")
    page.reload()
    page.locator("#calendarNextMonth").click()
    expect(page.locator(f'.cal-cell[data-iso="{next_month.isoformat()}"]')).to_contain_text(label)
    expect(page.locator("#sidebarPendingTxCard")).to_contain_text(label)
    guard.assert_clean()


@pytest.mark.smoke_title("Needs Review confirm amount")
def test_needs_review_confirm_this_amount(page, guard):
    today = date.today()
    start = date(today.year, today.month, 1)
    next_month = (start.replace(day=28) + timedelta(days=4)).replace(day=today.day)
    email = _register_checking("2000.00", start.isoformat())
    login(page, email, PASSWORD)
    show_month(page, start.strftime("%Y-%m"), today.isoformat())
    label = _add_planned_item(page, today.isoformat(), "95", kind="expense", repeat="monthly", variable=True)
    expect(page.locator("#sidebarPendingTxCard")).to_contain_text("Est. $95")
    page.locator("#sidebarPendingTxList .pending-attn-item").first.click()
    modal = page.locator("#reviewAmountModal.modal-overlay--open")
    expect(modal).to_be_visible()
    expect(page.locator("#reviewAmountTitle")).to_contain_text(label)
    expect(modal).not_to_contain_text("Estimated amount")
    expect(modal).not_to_contain_text("Actual amount")
    expect(page.locator("#reviewAmountConfirmBtn")).to_have_text("Confirm amount")
    expect(page.locator("#txEditModal.modal-overlay--open")).to_have_count(0)
    expect(page.locator("#txEditApplyScopeModal.modal-overlay--open")).to_have_count(0)
    page.locator("#reviewAmountInput").fill("108")
    page.locator("#reviewAmountConfirmBtn").click()
    expect(page.locator("#txEditApplyScopeModal.modal-overlay--open")).to_have_count(0)
    expect(modal).to_have_count(0)
    expect(page.locator("#sidebarPendingTxCard")).to_contain_text("Nothing to review")
    today_line = _day_line(page, today.isoformat(), label)
    expect(today_line).to_contain_text("108")
    expect(today_line).not_to_have_class(re.compile(r"cal-expected-variable"))
    expect(page.locator(f'.cal-cell[data-iso="{today.isoformat()}"] .cal-balance')).to_have_text(money("1892.00"))

    page.reload()
    show_month(page, start.strftime("%Y-%m"), today.isoformat())
    expect(page.locator("#sidebarPendingTxCard")).to_contain_text("Nothing to review")
    today_line = _day_line(page, today.isoformat(), label)
    expect(today_line).to_contain_text("108")
    expect(today_line).not_to_have_class(re.compile(r"cal-expected-variable"))
    expect(page.locator(f'.cal-cell[data-iso="{today.isoformat()}"] .cal-balance')).to_have_text(money("1892.00"))

    show_month(page, next_month.strftime("%Y-%m"), next_month.isoformat())
    next_line = _day_line(page, next_month.isoformat(), label)
    expect(next_line).to_be_visible()
    expect(next_line).to_contain_text("95")
    expect(next_line).to_have_class(re.compile(r"cal-expected-variable"))
    guard.assert_clean()


@pytest.mark.smoke_title("Needs Review confirm error")
def test_needs_review_confirm_keeps_amount_on_error(page, guard):
    today = date.today()
    start = date(today.year, today.month, 1)
    email = _register_checking("2000.00", start.isoformat())
    login(page, email, PASSWORD)
    show_month(page, start.strftime("%Y-%m"), today.isoformat())
    label = _add_planned_item(page, today.isoformat(), "95", kind="expense", repeat="monthly", variable=True)
    page.locator("#sidebarPendingTxList .pending-attn-item").first.click()
    expect(page.locator("#reviewAmountModal.modal-overlay--open")).to_be_visible()
    page.locator("#reviewAmountInput").fill("108")
    page.route(
        re.compile(r"/expected-transactions/.+/instances/"),
        lambda route: route.fulfill(status=400, content_type="application/json", body='{"detail":"Could not save"}'),
    )
    page.locator("#reviewAmountConfirmBtn").click()
    expect(page.locator("#reviewAmountModal.modal-overlay--open")).to_be_visible()
    expect(page.locator("#txEditApplyScopeModal.modal-overlay--open")).to_have_count(0)
    expect(page.locator("#reviewAmountInput")).to_have_value("108")
    expect(page.locator("#reviewAmountErr")).not_to_have_text("")
    expect(page.locator("#sidebarPendingTxCard")).to_contain_text(label)
    guard.assert_clean()


@pytest.mark.smoke_title("Needs Review confirm unchanged")
def test_needs_review_confirm_unchanged_amount(page, guard):
    today = date.today()
    start = date(today.year, today.month, 1)
    next_month = (start.replace(day=28) + timedelta(days=4)).replace(day=today.day)
    email = _register_checking("2000.00", start.isoformat())
    login(page, email, PASSWORD)
    show_month(page, start.strftime("%Y-%m"), today.isoformat())
    label = _add_planned_item(page, today.isoformat(), "95", kind="expense", repeat="monthly", variable=True)
    page.locator("#sidebarPendingTxList .pending-attn-item").first.click()
    expect(page.locator("#reviewAmountModal.modal-overlay--open")).to_be_visible()
    expect(page.locator("#reviewAmountInput")).to_have_value("95.00")
    page.locator("#reviewAmountConfirmBtn").click()
    expect(page.locator("#reviewAmountModal.modal-overlay--open")).to_have_count(0)
    expect(page.locator("#txEditApplyScopeModal.modal-overlay--open")).to_have_count(0)
    expect(page.locator("#sidebarPendingTxCard")).to_contain_text("Nothing to review")
    today_line = _day_line(page, today.isoformat(), label)
    expect(today_line).to_contain_text("95")
    expect(today_line).not_to_have_class(re.compile(r"cal-expected-variable"))
    expect(page.locator(f'.cal-cell[data-iso="{today.isoformat()}"] .cal-balance')).to_have_text(money("1905.00"))
    show_month(page, next_month.strftime("%Y-%m"), next_month.isoformat())
    next_line = _day_line(page, next_month.isoformat(), label)
    expect(next_line).to_contain_text("95")
    expect(next_line).to_have_class(re.compile(r"cal-expected-variable"))
    guard.assert_clean()


@pytest.mark.smoke_title("Needs Review edit transaction")
def test_needs_review_edit_transaction_opens_full_editor(page, guard):
    today = date.today()
    start = date(today.year, today.month, 1)
    email = _register_checking("2000.00", start.isoformat())
    login(page, email, PASSWORD)
    show_month(page, start.strftime("%Y-%m"), today.isoformat())
    label = _add_planned_item(page, today.isoformat(), "95", kind="expense", repeat="monthly", variable=True)
    page.locator("#sidebarPendingTxList .pending-attn-item").first.click()
    expect(page.locator("#reviewAmountModal.modal-overlay--open")).to_be_visible()
    page.locator("#reviewAmountEditBtn").click()
    expect(page.locator("#reviewAmountModal.modal-overlay--open")).to_have_count(0)
    expect(page.locator("#txEditModal.modal-overlay--open")).to_be_visible()
    expect(page.locator("#txEditSave")).to_have_text("Save")
    expect(page.locator("#txEditApplyScopeModal.modal-overlay--open")).to_have_count(0)
    expect(page.locator("#txEditAmount")).to_have_value("95")
    expect(page.locator("#txEditDate")).to_have_value(today.isoformat())
    page.locator("#txEditCancel").click()
    expect(page.locator("#txEditModal.modal-overlay--open")).to_have_count(0)
    expect(page.locator("#sidebarPendingTxCard")).to_contain_text(label)
    guard.assert_clean()


@pytest.mark.smoke_title("Needs Review cancel")
def test_needs_review_cancel_leaves_estimate(page, guard):
    today = date.today()
    start = date(today.year, today.month, 1)
    email = _register_checking("2000.00", start.isoformat())
    login(page, email, PASSWORD)
    show_month(page, start.strftime("%Y-%m"), today.isoformat())
    label = _add_planned_item(page, today.isoformat(), "95", kind="expense", repeat="monthly", variable=True)
    page.locator("#sidebarPendingTxList .pending-attn-item").first.click()
    page.locator("#reviewAmountInput").fill("120")
    page.locator("#reviewAmountCancelBtn").click()
    expect(page.locator("#reviewAmountModal.modal-overlay--open")).to_have_count(0)
    expect(page.locator("#sidebarPendingTxCard")).to_contain_text(label)
    expect(page.locator("#sidebarPendingTxCard")).to_contain_text("Est. $95")
    today_line = _day_line(page, today.isoformat(), label)
    expect(today_line).to_contain_text("95")
    expect(today_line).to_have_class(re.compile(r"cal-expected-variable"))
    guard.assert_clean()


@pytest.mark.smoke_title("Needs Review confirm double click")
def test_needs_review_confirm_ignores_second_click(page, guard):
    today = date.today()
    start = date(today.year, today.month, 1)
    email = _register_checking("2000.00", start.isoformat())
    login(page, email, PASSWORD)
    show_month(page, start.strftime("%Y-%m"), today.isoformat())
    _add_planned_item(page, today.isoformat(), "95", kind="expense", repeat="monthly", variable=True)
    page.locator("#sidebarPendingTxList .pending-attn-item").first.click()
    expect(page.locator("#reviewAmountModal.modal-overlay--open")).to_be_visible()
    posts = {"n": 0}

    def count_post(route):
        if route.request.method == "POST":
            posts["n"] += 1
        route.continue_()

    page.route(re.compile(r"/expected-transactions/.+/instances/"), count_post)
    page.locator("#reviewAmountConfirmBtn").evaluate("el => { el.click(); el.click(); }")
    expect(page.locator("#reviewAmountModal.modal-overlay--open")).to_have_count(0)
    expect(page.locator("#txEditApplyScopeModal.modal-overlay--open")).to_have_count(0)
    expect(page.locator("#sidebarPendingTxCard")).to_contain_text("Nothing to review")
    assert posts["n"] == 1
    guard.assert_clean()


@pytest.mark.smoke_title("Needs Review move date keeps estimate")
def test_needs_review_move_date_without_confirming(page, guard):
    today = date.today()
    tomorrow = today + timedelta(days=1)
    if tomorrow.month != today.month:
        pytest.skip("Needs a later day in the same month to keep the calendar in view")
    start = date(today.year, today.month, 1)
    email = _register_checking("2000.00", start.isoformat())
    login(page, email, PASSWORD)
    show_month(page, start.strftime("%Y-%m"), today.isoformat())
    label = _add_planned_item(page, today.isoformat(), "95", kind="expense", repeat="monthly", variable=True)
    page.locator("#sidebarPendingTxList .pending-attn-item").first.click()
    page.locator("#reviewAmountEditBtn").click()
    expect(page.locator("#txEditModal.modal-overlay--open")).to_be_visible()
    page.locator("#txEditDate").fill(tomorrow.isoformat())
    page.locator("#txEditSave").click()
    scope = page.locator("#txEditApplyScopeModal.modal-overlay--open")
    expect(scope).to_be_visible()
    scope.get_by_role("button", name="Save Changes").click()
    expect(page.locator("#txEditApplyScopeModal.modal-overlay--open")).to_have_count(0)
    expect(page.locator("#txEditModal.modal-overlay--open")).to_have_count(0)
    _wait_calendar_idle(page)
    expect(_day_line(page, today.isoformat(), label)).to_have_count(0)
    moved = _day_line(page, tomorrow.isoformat(), label)
    expect(moved).to_be_visible()
    expect(moved).to_contain_text("95")
    expect(moved).to_have_class(re.compile(r"cal-expected-variable"))
    guard.assert_clean()


@pytest.mark.smoke_title("Update current balance")
def test_updating_the_balance_resets_later_days(page, guard):
    today = date.today()
    later = today + timedelta(days=1)
    if later.month != today.month:
        pytest.skip("Needs a later day in the same month to check the reset forecast")
    start = date(today.year, today.month, 1).isoformat()
    email = _register_checking("2000.00", start)
    login(page, email, PASSWORD)
    show_month(page, start[:7], today.isoformat())
    expect(page.locator(f'.cal-cell[data-iso="{today.isoformat()}"] .cal-day-reconcile-action')).to_have_count(0)
    expect(page.locator("#sidebarReconcileRow")).to_contain_text("Not reconciled yet")
    expect(page.locator("#sidebarReconcileBtn")).to_be_visible()
    expect(page.locator("#sidebarReconcileBtn")).to_have_text("Reconcile balance")
    page.locator("#sidebarReconcileBtn").click()
    expect(page.locator("#reconcileModal.modal-overlay--open")).to_be_visible()
    expected_iso = today.isoformat()
    expect(page.locator("#reconcileDateInput")).to_have_value(expected_iso)
    page.locator("#reconcileMatchNoBtn").click()
    page.locator("#reconcileActualAmount").fill("5000")
    page.locator("#reconcileSaveBtn").click()
    expect(page.locator("#reconcileModal.modal-overlay--open")).to_have_count(0)
    later_balance = page.locator(f'.cal-cell[data-iso="{later.isoformat()}"] .cal-balance')
    expect(later_balance).to_have_text(money("5000.00"))
    page.reload()
    show_month(page, start[:7], later.isoformat())
    expect(later_balance).to_have_text(money("5000.00"))
    page.locator(f'.cal-cell[data-iso="{expected_iso}"] .cal-ledger-metrics.cal-day-balance-hit').click()
    page.locator(".reports-risk-tip.reports-risk-tip--visible [data-bw-bal-action='edit-adjustment']").click()
    page.locator("#editAdjustmentRemoveBtn").click()
    page.locator("#removeAdjustmentConfirmBtn").click()
    expect(page.locator("#bwToast")).to_contain_text("Adjustment removed.")
    expect(later_balance).to_have_text(money("2000.00"))
    guard.assert_clean()


@pytest.mark.smoke_title("App navigation")
def test_main_navigation(page, guard, seed):
    login(page, seed["active"]["email"], seed["active"]["password"])
    expect(page.locator("#navCalendarView")).to_have_attribute("aria-selected", "true")

    page.locator("#navTransactionView").click()
    page.wait_for_url(re.compile(r"/transactions"))
    expect(page.locator("#transactionViewPanel")).to_be_visible()

    page.locator("#navReportsView").click()
    page.wait_for_url(re.compile(r"/reports"))
    expect(page.get_by_role("heading", name="Balance trendline")).to_be_visible()

    page.locator("#navSettingsView").click()
    page.wait_for_url(re.compile(r"/settings"))
    expect(page.locator('[data-settings-key="preferences"]')).to_be_visible()

    reimbursements = page.locator("#navReimbursementsView")
    if reimbursements.count():
        reimbursements.click()
        page.wait_for_url(re.compile(r"/reimbursements"))
        expect(page.locator("#reimbursementsTitle")).to_be_visible()

    page.locator("#navCalendarView").click()
    page.wait_for_url(re.compile(r"/calendar"))
    expect(page.locator("#calendarGrid")).to_be_visible()
    guard.assert_clean()


def _settle_calendar(page, iso: str) -> None:
    show_month(page, iso[:7], iso)
    expect(page.locator("#calendarErr")).to_be_hidden()
    expect(page.locator("#bwForecastStatusRibbon")).to_be_hidden()


def _open_tx_edit_more_options(page) -> None:
    toggle = page.locator("#txEditMoreOptionsToggle")
    panel = page.locator("#txEditMoreOptionsPanel")
    if toggle.count() and panel.is_hidden():
        toggle.click()
    expect(panel).to_be_visible()


def _open_calendar_item(page, iso: str, text: str, *, expected: bool = False):
    kind = ".cal-day-tx-line--expected" if expected else ".cal-tx-part"
    line = page.locator(f'.cal-cell[data-iso="{iso}"] {kind}', has_text=text).first
    expect(line).to_be_visible()
    line.click()
    expect(page.locator("#txEditModal.modal-overlay--open")).to_be_visible()
    expect(page.locator("#reconcileModal.modal-overlay--open")).to_have_count(0)
    return line


def _close_tx_editor(page) -> None:
    page.locator("#txEditCancel").click()
    expect(page.locator("#txEditModal.modal-overlay--open")).to_have_count(0)
    expect(page.locator("#reconcileModal.modal-overlay--open")).to_have_count(0)


def _balance(page, iso: str):
    return page.locator(f'.cal-cell[data-iso="{iso}"] .cal-balance')


def _day_line(page, iso: str, text: str):
    return page.locator(f'.cal-cell[data-iso="{iso}"] .cal-day-tx-line', has_text=text).first


def _expect_visible_month(page, ym: str) -> None:
    year, month = ym.split("-")
    expect(page.locator("#calendarYear")).to_have_value(year)
    expect(page.locator("#calendarMonthNum")).to_have_value(str(int(month)))


def _wait_calendar_idle(page) -> None:
    expect(page.locator("#calendarPanel")).not_to_have_class(re.compile(r"calendar-panel--loading"))


def _shift_visible_month(page, button: str, ym: str, sample_iso: str) -> None:
    _wait_calendar_idle(page)
    page.locator(button).click()
    _expect_visible_month(page, ym)
    expect(_balance(page, sample_iso)).to_be_visible()
    _wait_calendar_idle(page)


def _med_date(iso: str) -> str:
    year, month, day = (int(part) for part in iso.split("-"))
    when = date(year, month, day)
    return f"{when.strftime('%b')} {when.day}, {when.year}"


def _balance_tip(page):
    return page.locator(".reports-risk-tip.reports-risk-tip--visible")


def _hover_transaction_without_balance_tip(page, iso: str, label: str, forbidden: str) -> None:
    line = _day_line(page, iso, label)
    expect(line).to_be_visible()
    line.scroll_into_view_if_needed()
    line.hover()
    page.wait_for_timeout(400)
    tip = _balance_tip(page)
    if tip.count():
        expect(tip).not_to_contain_text(forbidden)
    line.click()
    expect(page.locator("#txEditModal.modal-overlay--open")).to_be_visible()
    expect(page.locator("#reconcileModal.modal-overlay--open")).to_have_count(0)
    _close_tx_editor(page)


def _hover_balance_shows(page, iso: str, text: str) -> None:
    metrics = page.locator(f'.cal-cell[data-iso="{iso}"] .cal-ledger-metrics')
    metrics.scroll_into_view_if_needed()
    metrics.hover()
    expect(_balance_tip(page)).to_contain_text(text)


@pytest.mark.smoke_title("Past transaction click")
def test_past_transaction_click_opens_editor_not_balance_check(page, guard):
    """A direct click on a calendar transaction opens the editor, including on past days."""
    today = date.today()
    past = today - timedelta(days=12)
    expense_day = today - timedelta(days=11)
    recurring_day = today - timedelta(days=10)
    transfer_day = today - timedelta(days=9)
    future = today + timedelta(days=4)
    start = (past - timedelta(days=1)).isoformat()
    email = _register_checking("2000.00", start)
    login(page, email, PASSWORD)
    _settle_calendar(page, past.isoformat())

    income_label = _add_planned_item(page, past.isoformat(), "100", kind="income", name="Bonus")
    past_balance = page.locator(f'.cal-cell[data-iso="{past.isoformat()}"] .cal-balance')
    expect(past_balance).to_have_text(money("2100.00"))

    _open_calendar_item(page, past.isoformat(), income_label)
    page.locator("#txEditAmount").fill("25")
    page.locator("#txEditSave").click()
    expect(page.locator("#txEditModal.modal-overlay--open")).to_have_count(0)
    expect(past_balance).to_have_text(money("2025.00"))

    _open_calendar_item(page, past.isoformat(), income_label)
    page.locator("#txEditDelete").click()
    page.locator("#bwConfirmOk").click()
    expect(page.locator(f'.cal-cell[data-iso="{past.isoformat()}"] .cal-tx-part', has_text=income_label)).to_have_count(0)
    expect(past_balance).to_have_text(money("2000.00"))

    page.locator(f'.cal-cell[data-iso="{past.isoformat()}"] .cal-ledger-metrics.cal-day-balance-hit').click()
    recon_btn = page.locator(".reports-risk-tip.reports-risk-tip--visible [data-bw-bal-action='reconcile-this-date']")
    expect(recon_btn).to_have_text("Reconcile this date")
    recon_btn.click()
    reconcile = page.locator("#reconcileModal.modal-overlay--open")
    expect(reconcile).to_be_visible()
    expect(page.locator("#reconcileDateInput")).to_have_value(past.isoformat())
    expect(reconcile.locator("#reconcileTitle")).to_have_text("Check your balance")
    expect(reconcile.locator(".balance-check-in__forecast-k")).to_have_text("Projected end-of-day balance")
    expect(reconcile.locator(".balance-check-in__prep-note")).to_have_text(
        "Make sure your transactions are up to date before reconciling."
    )
    expect(reconcile.locator("#reconcileMatchPrompt")).to_have_text("Does this match your bank's end-of-day balance?")
    expect(reconcile.locator("#reconcileMatchYesBtn")).to_have_text("Yes, it matches")
    expect(reconcile.locator("#reconcileMatchNoBtn")).to_have_text("No, enter a different balance")
    expect(page.locator("#txEditModal.modal-overlay--open")).to_have_count(0)
    page.keyboard.press("Escape")
    expect(reconcile).to_have_count(0)

    expense_label = _add_planned_item(page, expense_day.isoformat(), "40", kind="expense", name="Mortgage / Rent")
    _open_calendar_item(page, expense_day.isoformat(), expense_label)
    _close_tx_editor(page)

    _settle_calendar(page, today.isoformat())
    today_label = _add_planned_item(page, today.isoformat(), "30", kind="expense", name="Credit Card Payment")
    _open_calendar_item(page, today.isoformat(), today_label)
    _close_tx_editor(page)

    _settle_calendar(page, future.isoformat())
    future_label = _add_planned_item(page, future.isoformat(), "60", kind="income", name="Bonus")
    _open_calendar_item(page, future.isoformat(), future_label)
    _close_tx_editor(page)

    _settle_calendar(page, recurring_day.isoformat())
    recurring_label = _add_planned_item(page, recurring_day.isoformat(), "70", kind="expense", repeat="monthly", name="Mortgage / Rent")
    _open_calendar_item(page, recurring_day.isoformat(), recurring_label, expected=True)
    _close_tx_editor(page)

    variable_label = _add_planned_item(
        page, recurring_day.isoformat(), "80", kind="expense", repeat="monthly", variable=True, name="Credit Card Payment"
    )
    _open_calendar_item(page, recurring_day.isoformat(), variable_label, expected=True)
    _close_tx_editor(page)

    token = page.evaluate("() => sessionStorage.getItem('bw_api_access_token') || localStorage.getItem('bw_api_access_token')")
    assert token, "Login did not keep an access token for the transfer setup"
    families = _request("GET", "/api/families", token=token)
    family_id = int(families[0]["id"])
    categories = _request("GET", f"/api/families/{family_id}/categories", token=token)
    category_id = int(categories[0]["id"])
    _request(
        "POST",
        f"/api/families/{family_id}/transactions",
        token=token,
        body={
            "date": transfer_day.isoformat(),
            "kind": "expense",
            "amount": "15.00",
            "description": "Transfer to savings",
            "category_id": category_id,
        },
    )
    page.reload()
    _settle_calendar(page, transfer_day.isoformat())
    transfer = page.locator(f'.cal-cell[data-iso="{transfer_day.isoformat()}"] .cal-day-tx-line--kind-transfer')
    expect(transfer).to_be_visible()
    transfer.click()
    expect(page.locator("#txEditModal.modal-overlay--open")).to_be_visible()
    expect(page.locator("#reconcileModal.modal-overlay--open")).to_have_count(0)
    _close_tx_editor(page)
    guard.assert_clean()


@pytest.mark.smoke_title("Balance record does not block transactions")
def test_balance_record_does_not_block_transactions(page, guard):
    """A starting point or reconciliation stays on the balance, so the day's transactions can still be opened."""
    start = "2026-09-01"
    reconciled_day = "2026-09-08"
    email = _register_checking("2000.00", start)
    login(page, email, PASSWORD)
    show_month(page, "2026-09", start)

    start_label = _add_planned_item(page, start, "100", kind="income", name="Bonus")
    start_cell = page.locator(f'.cal-cell[data-iso="{start}"]')
    expect(start_cell).to_contain_text("Starting Point")
    expect(_balance(page, start)).to_have_text(money("2100.00"))
    _hover_transaction_without_balance_tip(page, start, start_label, "Starting Point")
    _hover_balance_shows(page, start, "Starting Point")

    reconciled_label = _add_planned_item(page, reconciled_day, "50", kind="expense", name="Mortgage / Rent")
    expect(_balance(page, reconciled_day)).to_have_text(money("2050.00"))
    page.locator(f'.cal-cell[data-iso="{reconciled_day}"] .cal-ledger-metrics.cal-day-balance-hit').click()
    recon_btn = page.locator(".reports-risk-tip.reports-risk-tip--visible [data-bw-bal-action='reconcile-this-date']")
    expect(recon_btn).to_have_text("Reconcile this date")
    recon_btn.click()
    expect(page.locator("#reconcileModal.modal-overlay--open")).to_be_visible()
    expect(page.locator("#reconcileDateInput")).to_have_value(reconciled_day)
    page.locator("#reconcileMatchYesBtn").click()
    expect(page.locator("#reconcileModal.modal-overlay--open")).to_have_count(0)
    reconciled_mark = page.locator(f'.cal-cell[data-iso="{reconciled_day}"] .cal-balance-reconciled-mark')
    expect(reconciled_mark).to_be_visible()
    expect(reconciled_mark).to_have_attribute("aria-label", "Reconciled")
    expect(page.locator("#sidebarReconcileDetail")).to_contain_text("Sep 8")
    _hover_transaction_without_balance_tip(page, reconciled_day, reconciled_label, "Reconciled")
    _hover_balance_shows(page, reconciled_day, "Reconciled")
    page.locator(f'.cal-cell[data-iso="{reconciled_day}"] .cal-ledger-metrics.cal-day-balance-hit').click()
    tip = _balance_tip(page)
    expect(tip).to_contain_text("Reconciled ·")
    expect(tip).to_contain_text("Sep 8, 2026")
    expect(tip).to_contain_text(money("2050.00"))
    expect(tip).to_contain_text("Bank balance matched forecast.")
    expect(tip).not_to_contain_text("Reconciled balance")
    expect(tip.locator("[data-bw-bal-action='enter-different-balance']")).to_be_visible()
    expect(tip.locator("[data-bw-bal-action='remove-reconciliation']")).to_be_visible()
    expect(tip.locator("[data-bw-bal-action='remove-adjustment']")).to_have_count(0)
    expect(page.locator("[data-bw-bal-action='reconcile-this-date']")).to_have_count(0)
    expect(page.locator("#reconcileModal.modal-overlay--open")).to_have_count(0)
    tip.locator("[data-bw-bal-action='remove-reconciliation']").click()
    expect(page.locator("#bwToast")).to_contain_text("Reconciliation removed.")
    expect(page.locator("#bwToast")).to_have_class(re.compile(r"bw-toast--calendar"))
    expect(reconciled_mark).to_have_count(0)
    expect(page.locator("#sidebarReconcileDetail")).to_have_text("Not reconciled yet")
    expect(_balance(page, reconciled_day)).to_have_text(money("2050.00"))
    expect(page.locator(".reports-risk-tip.reports-risk-tip--visible")).to_have_count(0)
    guard.assert_clean()


@pytest.mark.smoke_title("Adjusted popover can remove the verified balance")
def test_adjusted_balance_remove_updates_last_reconciled(page, guard):
    start = "2026-09-01"
    matched_day = "2026-09-08"
    adjusted_day = "2026-09-09"
    email = _register_checking("2000.00", start)
    login(page, email, PASSWORD)
    show_month(page, "2026-09", start)

    _add_planned_item(page, matched_day, "50", kind="expense", name="Mortgage / Rent")
    page.locator(f'.cal-cell[data-iso="{matched_day}"] .cal-ledger-metrics.cal-day-balance-hit').click()
    page.locator(".reports-risk-tip.reports-risk-tip--visible [data-bw-bal-action='reconcile-this-date']").click()
    page.locator("#reconcileMatchYesBtn").click()
    expect(page.locator("#sidebarReconcileDetail")).to_contain_text("Sep 8")

    page.locator(f'.cal-cell[data-iso="{adjusted_day}"] .cal-ledger-metrics.cal-day-balance-hit').click()
    page.locator(".reports-risk-tip.reports-risk-tip--visible [data-bw-bal-action='reconcile-this-date']").click()
    page.locator("#reconcileMatchNoBtn").click()
    page.locator("#reconcileActualAmount").fill("1999.00")
    page.locator("#reconcileSaveBtn").click()
    expect(page.locator("#reconcileModal.modal-overlay--open")).to_have_count(0)
    expect(page.locator("#sidebarReconcileDetail")).to_contain_text("Sep 9")
    expect(page.locator(f'.cal-cell[data-iso="{adjusted_day}"]')).to_contain_text("Adjusted")

    page.locator(f'.cal-cell[data-iso="{adjusted_day}"] .cal-ledger-metrics.cal-day-balance-hit').click()
    tip = _balance_tip(page)
    expect(tip).to_contain_text("Adjusted ·")
    expect(tip).to_contain_text(money("1999.00"))
    expect(tip).to_contain_text("forecast")
    expect(tip.locator("[data-bw-bal-action='edit-adjustment']")).to_be_visible()
    expect(tip.locator("[data-bw-bal-action='remove-adjustment']")).to_have_text("Remove adjustment")
    tip.locator("[data-bw-bal-action='remove-adjustment']").click()
    expect(page.locator("#bwToast")).to_contain_text("Adjustment removed.")
    expect(page.locator(f'.cal-cell[data-iso="{adjusted_day}"]')).not_to_contain_text("Adjusted")
    expect(page.locator("#sidebarReconcileDetail")).to_contain_text("Sep 8")
    expect(page.locator(".reports-risk-tip.reports-risk-tip--visible")).to_have_count(0)
    guard.assert_clean()


@pytest.mark.smoke_title("Sidebar reconcile defaults to today")
def test_sidebar_reconcile_defaults_to_today(page, guard):
    today = date.today()
    yesterday = today - timedelta(days=1)
    start = min(date(today.year, today.month, 1), today)
    email = _register_checking("2000.00", start.isoformat())
    login(page, email, PASSWORD)
    show_month(page, today.strftime("%Y-%m"), today.isoformat())

    page.locator("#sidebarReconcileBtn").click()
    modal = page.locator("#reconcileModal.modal-overlay--open")
    expect(modal).to_be_visible()
    expect(page.locator("#reconcileDateInput")).to_have_value(today.isoformat())
    expect(modal.locator("#reconcileTitle")).to_have_text("Check your balance")
    expect(modal.locator("#reconcileMatchPrompt")).to_be_visible()
    page.locator("#reconcileMatchYesBtn").click()
    expect(modal).to_have_count(0)
    expect(page.locator("#sidebarReconcileBtn")).to_be_visible()
    expect(page.locator("#sidebarReconcileDetail")).to_have_text(
        f"{['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][today.month - 1]} {today.day}"
    )

    page.locator("#sidebarReconcileBtn").click()
    expect(modal).to_be_visible()
    expect(modal.locator("#reconcileTitle")).to_have_text("Reconciled")
    expect(modal.locator("#reconcileRecordState")).to_be_visible()
    expect(modal.locator("#reconcileRecordState")).to_contain_text("Bank balance matched forecast.")
    expect(modal.locator("#reconcileRecordState")).not_to_contain_text("Reconciled ·")
    expect(modal.locator("#reconcileMatchPrompt")).to_be_hidden()
    expect(page.locator("#reconcileDateInput")).to_be_hidden()
    expect(page.locator("#reconcileDateDisplay")).to_be_visible()

    page.keyboard.press("Escape")
    if yesterday >= start:
        page.locator(
            f'.cal-cell[data-iso="{yesterday.isoformat()}"] .cal-ledger-metrics.cal-day-balance-hit'
        ).click()
        page.locator(".reports-risk-tip.reports-risk-tip--visible [data-bw-bal-action='reconcile-this-date']").click()
        expect(modal).to_be_visible()
        expect(page.locator("#reconcileDateInput")).to_be_visible()
        expect(page.locator("#reconcileDateInput")).to_have_value(yesterday.isoformat())
        expect(modal.locator("#reconcileTitle")).to_have_text("Check your balance")
        expect(modal.locator("#reconcileMatchPrompt")).to_be_visible()
        page.keyboard.press("Escape")
    guard.assert_clean()


@pytest.mark.smoke_title("Calendar EOD reconcile this date")
def test_calendar_eod_balance_opens_reconcile_this_date(page, guard):
    """Past and today balances offer Reconcile this date; future dates do not."""
    today = date.today()
    future = today + timedelta(days=3)
    start = min(date(today.year, today.month, 1), today)
    email = _register_checking("2000.00", start.isoformat())
    login(page, email, PASSWORD)
    show_month(page, today.strftime("%Y-%m"), today.isoformat())

    today_metrics = page.locator(f'.cal-cell[data-iso="{today.isoformat()}"] .cal-ledger-metrics.cal-day-balance-hit')
    expect(today_metrics).to_be_visible()
    today_metrics.click()
    today_btn = page.locator(".reports-risk-tip.reports-risk-tip--visible [data-bw-bal-action='reconcile-this-date']")
    expect(today_btn).to_have_text("Reconcile this date")
    today_btn.click()
    expect(page.locator("#reconcileModal.modal-overlay--open")).to_be_visible()
    expect(page.locator("#reconcileDateInput")).to_have_value(today.isoformat())
    page.keyboard.press("Escape")
    expect(page.locator("#reconcileModal.modal-overlay--open")).to_have_count(0)

    show_month(page, future.strftime("%Y-%m"), future.isoformat())
    future_cell = page.locator(f'.cal-cell[data-iso="{future.isoformat()}"]')
    expect(future_cell.locator(".cal-ledger-metrics.cal-day-balance-hit")).to_have_count(0)
    future_cell.locator(".cal-ledger-metrics").click()
    expect(page.locator("#reconcileModal.modal-overlay--open")).to_have_count(0)
    expect(page.locator("[data-bw-bal-action='reconcile-this-date']")).to_have_count(0)
    guard.assert_clean()


@pytest.mark.smoke_title("Transactions tab edit persists")
def test_transactions_tab_edit_persists_and_updates_forecast(page, guard):
    """Saving from the Transactions tab updates that list, keeps the edit after reload, and changes the forecast."""
    today = date.today()
    tomorrow = today + timedelta(days=1)
    today_iso = today.isoformat()
    tomorrow_iso = tomorrow.isoformat()
    email = _register_checking("1000.00", today_iso)
    login(page, email, PASSWORD)
    show_month(page, today_iso[:7], today_iso)
    label = _add_planned_item(page, today_iso, "100", kind="income", name="Bonus")
    expect(_balance(page, today_iso)).to_have_text(money("1100.00"))

    page.locator("#navTransactionView").click()
    page.wait_for_url(re.compile(r"/transactions"))
    row = page.locator("#txListMain .tm-row", has_text=label).first
    expect(row).to_contain_text(_med_date(today_iso))
    expect(row).to_contain_text("+$100.00")
    row.locator(".tm-row__edit").click()
    expect(page.locator("#txEditModal.modal-overlay--open")).to_be_visible()
    page.locator("#txEditDate").fill(tomorrow_iso)
    page.locator("#txEditAmount").fill("250")
    page.locator("#txEditSave").click()
    expect(page.locator("#txEditModal.modal-overlay--open")).to_have_count(0)

    updated = page.locator("#txListMain .tm-row", has_text=label).first
    expect(updated).to_contain_text(_med_date(tomorrow_iso))
    expect(updated).to_contain_text("+$250.00")
    expect(page.locator("#txListMain .tm-row", has_text=_med_date(today_iso))).to_have_count(0)

    page.reload()
    updated = page.locator("#txListMain .tm-row", has_text=label).first
    expect(updated).to_contain_text(_med_date(tomorrow_iso))
    expect(updated).to_contain_text("+$250.00")

    page.locator("#navCalendarView").click()
    page.wait_for_url(re.compile(r"/calendar"))
    show_month(page, today_iso[:7], today_iso)
    expect(_day_line(page, today_iso, label)).to_have_count(0)
    expect(_balance(page, today_iso)).to_have_text(money("1000.00"))
    if tomorrow_iso[:7] != today_iso[:7]:
        show_month(page, tomorrow_iso[:7], tomorrow_iso)
    expect(_day_line(page, tomorrow_iso, label)).to_be_visible()
    expect(_balance(page, tomorrow_iso)).to_have_text(money("1250.00"))
    guard.assert_clean()


@pytest.mark.smoke_title("Moved transaction recalculates forecast")
def test_moving_occurrence_recalculates_forecast_without_jumping_months(page, guard):
    """Moving one occurrence into an earlier month changes both dates' projected balances and leaves the open month in place."""
    email = _register_checking("10000.00", "2026-09-01")
    login(page, email, PASSWORD)
    show_month(page, "2026-10", "2026-10-03")
    _expect_visible_month(page, "2026-10")
    label = _add_planned_item(page, "2026-10-03", "500", kind="income", repeat="monthly", name="Bonus")
    expect(_day_line(page, "2026-10-03", label)).to_be_visible()
    expect(_balance(page, "2026-10-03")).to_have_text(money("10500.00"))

    _day_line(page, "2026-10-03", label).click()
    expect(page.locator("#txEditModal.modal-overlay--open")).to_be_visible()
    page.locator("#txEditDate").fill("2026-09-30")
    page.locator("#txEditSave").click()
    scope = page.locator("#txEditApplyScopeModal.modal-overlay--open")
    expect(scope).to_be_visible()
    expect(scope.locator("#txEditApplyScopeInstanceBtn")).to_have_class(re.compile(r"apply-scope-option--selected"))
    expect(scope.locator("#txEditApplyScopeInstanceTitle")).to_have_text("Move only Oct 3 to Sep 30")
    expect(scope.locator("#txEditApplyScopeSeriesTitle")).to_have_text("Change this and future scheduled dates")
    scope.get_by_role("button", name="Save Changes").click()
    expect(page.locator("#txEditApplyScopeModal.modal-overlay--open")).to_have_count(0)
    expect(page.locator("#txEditModal.modal-overlay--open")).to_have_count(0)
    _wait_calendar_idle(page)

    _expect_visible_month(page, "2026-10")
    expect(page.locator('.cal-cell[data-iso="2026-10-03"]')).not_to_have_class(re.compile(r"cal-cell--out"))
    expect(_day_line(page, "2026-10-03", label)).to_have_count(0)
    expect(_balance(page, "2026-10-03")).to_have_text(money("10500.00"))
    expect(_balance(page, "2026-10-04")).to_have_text(money("10500.00"))

    _shift_visible_month(page, "#calendarPrevMonth", "2026-09", "2026-09-30")
    expect(_day_line(page, "2026-09-30", label)).to_be_visible()
    expect(_balance(page, "2026-09-29")).to_have_text(money("10000.00"))
    expect(_balance(page, "2026-09-30")).to_have_text(money("10500.00"))

    _shift_visible_month(page, "#calendarNextMonth", "2026-10", "2026-10-03")
    _shift_visible_month(page, "#calendarNextMonth", "2026-11", "2026-11-03")
    expect(_day_line(page, "2026-11-03", label)).to_be_visible()
    expect(_balance(page, "2026-11-03")).to_have_text(money("11000.00"))
    guard.assert_clean()


@pytest.mark.smoke_title("Calendar stays on the selected month")
def test_calendar_stays_on_the_selected_month_until_the_user_navigates(page, guard):
    """Changing a transaction's date does not switch months. The next and previous buttons still do."""
    email = _register_checking("2000.00", "2026-08-01")
    login(page, email, PASSWORD)
    show_month(page, "2026-08", "2026-08-10")
    _expect_visible_month(page, "2026-08")
    label = _add_planned_item(page, "2026-08-10", "100", kind="expense", name="Mortgage / Rent")
    expect(_balance(page, "2026-08-10")).to_have_text(money("1900.00"))

    _day_line(page, "2026-08-10", label).click()
    expect(page.locator("#txEditModal.modal-overlay--open")).to_be_visible()
    page.locator("#txEditDate").fill("2026-09-10")
    page.locator("#txEditSave").click()
    expect(page.locator("#txEditModal.modal-overlay--open")).to_have_count(0)
    _wait_calendar_idle(page)

    _expect_visible_month(page, "2026-08")
    expect(page.locator('.cal-cell[data-iso="2026-08-10"]')).not_to_have_class(re.compile(r"cal-cell--out"))
    expect(_day_line(page, "2026-08-10", label)).to_have_count(0)
    expect(_balance(page, "2026-08-09")).to_have_text(money("2000.00"))
    expect(_balance(page, "2026-08-10")).to_have_text(money("2000.00"))

    _shift_visible_month(page, "#calendarNextMonth", "2026-09", "2026-09-10")
    expect(_day_line(page, "2026-09-10", label)).to_be_visible()
    expect(_balance(page, "2026-09-09")).to_have_text(money("2000.00"))
    expect(_balance(page, "2026-09-10")).to_have_text(money("1900.00"))
    guard.assert_clean()


_TX_LIST_URL = re.compile(r"/api/families/\d+/(?:transactions|expected-transactions)(?:\?|$)")

_TX_EMPTY_WATCH = """
(() => {
  window.__bwTxEmptyFlashed = false;
  const note = (node) => {
    if (!node || node.nodeType !== 1) return;
    if (node.classList && node.classList.contains("tm-empty-state")) window.__bwTxEmptyFlashed = true;
    else if (node.querySelector && node.querySelector(".tm-empty-state")) window.__bwTxEmptyFlashed = true;
  };
  const wrap = (proto, name) => {
    const orig = proto[name];
    if (typeof orig !== "function") return;
    proto[name] = function (...args) {
      const result = orig.apply(this, args);
      try { args.forEach(note); } catch (_) {}
      return result;
    };
  };
  wrap(Element.prototype, "appendChild");
  wrap(Element.prototype, "insertBefore");
  wrap(Element.prototype, "replaceChildren");
})();
"""


def _hold_transaction_lists(page):
    """Pause transaction-list GETs so the loading state can be observed, then let later GETs through."""
    release = {"go": False}
    held = []

    def handler(route):
        if route.request.method != "GET" or release["go"]:
            route.continue_()
            return
        held.append(route)

    page.add_init_script(_TX_EMPTY_WATCH)
    page.route(_TX_LIST_URL, handler)
    page.goto("/transactions/")
    return release, held


def _release_transaction_lists(release, held):
    release["go"] = True
    pending = list(held)
    held.clear()
    for route in pending:
        route.continue_()


def _assert_transactions_still_loading(page):
    expect(page.locator(".tm-table__head")).to_be_visible()
    expect(page.locator(".tm-list-loading")).to_be_visible()
    expect(page.get_by_text("Loading transactions…")).to_be_visible()
    expect(page.locator(".tm-empty-state")).to_have_count(0)
    expect(page.get_by_text("No transactions match these filters")).to_have_count(0)
    expect(page.get_by_text("Nothing flagged for cleanup in this view.")).to_have_count(0)
    expect(page.get_by_text("0 in this list")).to_have_count(0)
    assert page.evaluate("() => window.__bwTxEmptyFlashed") is False


@pytest.mark.smoke_title("Transactions list loading then rows")
def test_transactions_list_shows_loading_then_rows(page, guard):
    """The empty state must not flash while transaction lists are still loading."""
    today = date.today().isoformat()
    email = _register_checking("1000.00", today)
    login(page, email, PASSWORD)
    token = page.evaluate(
        "() => sessionStorage.getItem('bw_api_access_token') || localStorage.getItem('bw_api_access_token')"
    )
    families = _request("GET", "/api/families", token=token)
    family_id = int(families[0]["id"])
    _request(
        "POST",
        f"/api/families/{family_id}/transactions",
        token=token,
        body={
            "date": today,
            "kind": "income",
            "amount": "42.00",
            "description": "Loading row paycheck",
        },
    )

    release, held = _hold_transaction_lists(page)
    try:
        _assert_transactions_still_loading(page)
        _release_transaction_lists(release, held)
        row = page.locator("#txListMain .tm-row", has_text="Loading row paycheck")
        expect(row).to_be_visible()
        expect(page.locator(".tm-list-loading")).to_have_count(0)
        expect(page.locator(".tm-empty-state")).to_have_count(0)
        expect(page.get_by_text("No transactions match these filters")).to_have_count(0)
        assert page.evaluate("() => window.__bwTxEmptyFlashed") is False
    finally:
        _release_transaction_lists(release, held)
    guard.assert_clean()


@pytest.mark.smoke_title("Transactions list loading then empty")
def test_transactions_list_shows_loading_then_empty_state(page, guard):
    """A real zero-result response shows the empty state only after loading finishes."""
    today = date.today().isoformat()
    email = _register_checking("1000.00", today)
    login(page, email, PASSWORD)

    release, held = _hold_transaction_lists(page)
    try:
        _assert_transactions_still_loading(page)
        _release_transaction_lists(release, held)
        expect(page.locator(".tm-list-loading")).to_have_count(0)
        expect(page.locator(".tm-empty-state__title")).to_have_text("No transactions match these filters")
        expect(page.locator(".tm-empty-state__lede")).to_have_text("Try clearing a filter or adjusting your search.")
        expect(page.get_by_text("Try a wider date range", exact=False)).to_have_count(0)
        assert page.evaluate("() => window.__bwTxEmptyFlashed") is True
    finally:
        _release_transaction_lists(release, held)
    guard.assert_clean()


def _month_day(iso: str) -> str:
    d = date.fromisoformat(iso)
    return f"{('Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec')[d.month - 1]} {d.day}"


@pytest.mark.smoke_title("Edit one occurrence amount")
def test_changing_one_occurrence_amount_leaves_later_dates(page, guard):
    email = _register_checking("2000.00", "2026-11-01")
    login(page, email, PASSWORD)
    show_month(page, "2026-11", "2026-11-09")
    label = _add_planned_item(page, "2026-11-09", "80", kind="expense", repeat="monthly", name="Mortgage / Rent")
    _open_calendar_item(page, "2026-11-09", label, expected=True)
    expect(page.locator("#txEditModeBanner")).to_have_text("Editing Nov 9")
    page.locator("#txEditAmount").fill("95")
    page.locator("#txEditSave").click()
    scope = page.locator("#txEditApplyScopeModal.modal-overlay--open")
    expect(scope).to_be_visible()
    expect(scope.locator("#txEditApplyScopeInstanceBtn")).to_have_class(re.compile(r"apply-scope-option--selected"))
    expect(scope.locator("#txEditApplyScopeInstanceTitle")).to_have_text("Only this occurrence")
    expect(scope.locator("#txEditApplyScopeInstanceBadge")).to_be_visible()
    scope.get_by_role("button", name="Save Changes").click()
    expect(page.locator("#txEditModal.modal-overlay--open")).to_have_count(0)
    expect(_day_line(page, "2026-11-09", label)).to_contain_text("95")
    show_month(page, "2026-12", "2026-12-09")
    expect(_day_line(page, "2026-12-09", label)).to_contain_text("80")
    guard.assert_clean()


@pytest.mark.smoke_title("This and future occurrences")
def test_this_and_future_occurrences_updates_later_dates(page, guard):
    email = _register_checking("2000.00", "2026-11-01")
    login(page, email, PASSWORD)
    show_month(page, "2026-11", "2026-11-09")
    label = _add_planned_item(page, "2026-11-09", "80", kind="expense", repeat="monthly", name="Mortgage / Rent")
    _open_calendar_item(page, "2026-11-09", label, expected=True)
    page.locator("#txEditAmount").fill("110")
    page.locator("#txEditSave").click()
    scope = page.locator("#txEditApplyScopeModal.modal-overlay--open")
    expect(scope).to_be_visible()
    scope.locator("#txEditApplyScopeSeriesBtn").click()
    expect(scope.locator("#txEditApplyScopeSeriesTitle")).to_have_text("This and future occurrences")
    scope.get_by_role("button", name="Save Changes").click()
    expect(page.locator("#txEditModal.modal-overlay--open")).to_have_count(0)
    expect(_day_line(page, "2026-11-09", label)).to_contain_text("110")
    show_month(page, "2026-12", "2026-12-09")
    expect(_day_line(page, "2026-12-09", label)).to_contain_text("110")
    guard.assert_clean()


@pytest.mark.smoke_title("Transactions page upcoming occurrence")
def test_transactions_page_opens_next_upcoming_occurrence(page, guard):
    today = date.today()
    today_iso = today.isoformat()
    email = _register_checking("2000.00", date(today.year, today.month, 1).isoformat())
    login(page, email, PASSWORD)
    show_month(page, today_iso[:7], today_iso)
    label = _add_planned_item(page, today_iso, "80", kind="expense", repeat="monthly", name="Mortgage / Rent")
    page.locator("#navTransactionView").click()
    page.wait_for_url(re.compile(r"/transactions"))
    page.locator('.tm-chip[data-tm-view="recurring"]').click()
    row = page.locator("#txListMain .tm-row", has_text=label).first
    expect(row).to_be_visible()
    row.click()
    expect(page.locator("#txEditModal.modal-overlay--open")).to_be_visible()
    expect(page.locator("#txEditModeBanner")).to_have_text(f"Editing {_month_day(today_iso)}")
    expect(page.locator("#txEditOccurrenceHint")).to_have_text("Starts on the next upcoming occurrence.")
    expect(page.locator("#txEditDate")).to_have_value(today_iso)
    page.locator("#txEditCancel").click()
    guard.assert_clean()


@pytest.mark.smoke_title("Variable calendar edit can move")
def test_variable_calendar_edit_can_move_without_confirm(page, guard):
    email = _register_checking("2000.00", "2026-11-01")
    login(page, email, PASSWORD)
    show_month(page, "2026-11", "2026-11-09")
    label = _add_planned_item(
        page, "2026-11-09", "80", kind="expense", repeat="monthly", variable=True, name="Credit Card Payment"
    )
    _open_calendar_item(page, "2026-11-09", label, expected=True)
    expect(page.locator("#txEditSave")).to_have_text("Save")
    expect(page.locator("#txEditConfirmHint")).to_be_hidden()
    page.locator("#txEditDate").fill("2026-11-12")
    page.locator("#txEditSave").click()
    scope = page.locator("#txEditApplyScopeModal.modal-overlay--open")
    expect(scope).to_be_visible()
    expect(scope.locator("#txEditApplyScopeInstanceTitle")).to_have_text("Move only Nov 9 to Nov 12")
    scope.get_by_role("button", name="Save Changes").click()
    expect(page.locator("#txEditModal.modal-overlay--open")).to_have_count(0)
    expect(_day_line(page, "2026-11-09", label)).to_have_count(0)
    expect(_day_line(page, "2026-11-12", label)).to_be_visible()
    guard.assert_clean()


@pytest.mark.smoke_title("Series fields cannot save on one occurrence")
def test_notes_repeat_ends_require_series_scope(page, guard):
    email = _register_checking("2000.00", "2026-11-01")
    login(page, email, PASSWORD)
    show_month(page, "2026-11", "2026-11-09")
    label = _add_planned_item(page, "2026-11-09", "80", kind="expense", repeat="monthly", name="Mortgage / Rent")
    _open_calendar_item(page, "2026-11-09", label, expected=True)
    page.locator("#txEditNotes").fill("Call the utility")
    page.locator("#txEditSave").click()
    scope = page.locator("#txEditApplyScopeModal.modal-overlay--open")
    expect(scope).to_be_visible()
    expect(scope.locator("#txEditApplyScopeSeriesNotice")).to_contain_text("Notes applies to the series")
    expect(scope.locator("#txEditApplyScopeSeriesBtn")).to_have_class(re.compile(r"apply-scope-option--selected"))
    scope.locator("#txEditApplyScopeInstanceBtn").click()
    scope.get_by_role("button", name="Save Changes").click()
    expect(scope.locator("#txEditApplyScopeErr")).to_contain_text("Notes applies to the series")
    expect(scope).to_be_visible()
    scope.locator("#txEditApplyScopeSeriesBtn").click()
    scope.get_by_role("button", name="Save Changes").click()
    expect(page.locator("#txEditModal.modal-overlay--open")).to_have_count(0)
    _open_calendar_item(page, "2026-11-09", label, expected=True)
    expect(page.locator("#txEditNotes")).to_have_value("Call the utility")
    page.locator("#txEditCancel").click()
    guard.assert_clean()


@pytest.mark.smoke_title("Recurring delete uses one date by default")
def test_recurring_delete_defaults_to_one_date(page, guard):
    email = _register_checking("2000.00", "2026-11-01")
    login(page, email, PASSWORD)
    show_month(page, "2026-11", "2026-11-09")
    label = _add_planned_item(page, "2026-11-09", "80", kind="expense", repeat="monthly", name="Mortgage / Rent")
    _open_calendar_item(page, "2026-11-09", label, expected=True)
    expect(page.locator("#txEditDelete")).to_have_text("Delete")
    page.locator("#txEditDelete").click()
    scope = page.locator("#txEditDeleteScopeModal.modal-overlay--open")
    expect(scope).to_be_visible()
    expect(scope.locator("#txEditDeleteScopeTitle")).to_have_text("Delete this transaction?")
    expect(scope.locator("#txEditDeleteScopeInstanceTitle")).to_have_text("Delete only Nov 9")
    expect(scope.locator("#txEditDeleteScopeInstanceHint")).to_have_text("All other dates stay the same.")
    expect(scope.locator("#txEditDeleteScopeFutureTitle")).to_have_text("Delete Nov 9 and future occurrences")
    expect(scope.locator("#txEditDeleteScopeFutureHint")).to_have_text("Earlier dates stay the same.")
    expect(scope.locator("#txEditDeleteScopeInstanceBtn")).to_have_class(re.compile(r"apply-scope-option--selected"))
    expect(scope.locator("#txEditDeleteScopeInstanceBtn")).to_have_class(re.compile(r"apply-scope-option--recommended"))
    expect(scope.locator("#txEditDeleteScopeConfirmBtn")).to_have_text("Delete")
    scope.locator("#txEditDeleteScopeConfirmBtn").click()
    expect(page.locator("#txEditModal.modal-overlay--open")).to_have_count(0)
    expect(_day_line(page, "2026-11-09", label)).to_have_count(0)
    show_month(page, "2026-12", "2026-12-09")
    expect(_day_line(page, "2026-12-09", label)).to_be_visible()
    guard.assert_clean()


@pytest.mark.smoke_title("Recurring delete this and future")
def test_recurring_delete_this_and_future_keeps_earlier_dates(page, guard):
    email = _register_checking("2000.00", "2026-10-01")
    login(page, email, PASSWORD)
    show_month(page, "2026-10", "2026-10-09")
    label = _add_planned_item(page, "2026-10-09", "80", kind="expense", repeat="monthly", name="Mortgage / Rent")
    show_month(page, "2026-11", "2026-11-09")
    _open_calendar_item(page, "2026-11-09", label, expected=True)
    page.locator("#txEditDelete").click()
    scope = page.locator("#txEditDeleteScopeModal.modal-overlay--open")
    expect(scope).to_be_visible()
    scope.locator("#txEditDeleteScopeFutureBtn").click()
    expect(scope.locator("#txEditDeleteScopeFutureTitle")).to_have_text("Delete Nov 9 and future occurrences")
    expect(scope.locator("#txEditDeleteScopeConfirmBtn")).to_have_text("Delete")
    scope.locator("#txEditDeleteScopeConfirmBtn").click()
    expect(page.locator("#txEditModal.modal-overlay--open")).to_have_count(0)
    expect(_day_line(page, "2026-11-09", label)).to_have_count(0)
    show_month(page, "2026-12", "2026-12-09")
    expect(_day_line(page, "2026-12-09", label)).to_have_count(0)
    show_month(page, "2026-10", "2026-10-09")
    expect(_day_line(page, "2026-10-09", label)).to_be_visible()
    guard.assert_clean()


@pytest.mark.smoke_title("Recurring delete cancel leaves series")
def test_recurring_delete_cancel_makes_no_changes(page, guard):
    email = _register_checking("2000.00", "2026-11-01")
    login(page, email, PASSWORD)
    show_month(page, "2026-11", "2026-11-09")
    label = _add_planned_item(page, "2026-11-09", "80", kind="expense", repeat="monthly", name="Mortgage / Rent")
    _open_calendar_item(page, "2026-11-09", label, expected=True)
    page.locator("#txEditDelete").click()
    scope = page.locator("#txEditDeleteScopeModal.modal-overlay--open")
    expect(scope).to_be_visible()
    scope.locator("#txEditDeleteScopeCancelBtn").click()
    expect(scope).to_have_count(0)
    expect(page.locator("#txEditModal.modal-overlay--open")).to_be_visible()
    page.locator("#txEditCancel").click()
    expect(_day_line(page, "2026-11-09", label)).to_be_visible()
    show_month(page, "2026-12", "2026-12-09")
    expect(_day_line(page, "2026-12-09", label)).to_be_visible()
    guard.assert_clean()
