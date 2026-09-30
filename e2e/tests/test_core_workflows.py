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
    expect(ready.locator("#bwForecastReadyTitle")).to_have_text("Your forecast is ready")
    ready.locator("#bwForecastReadyStartTourBtn").click()

    _expect_tour_step(page, "Add what’s coming up", "1 of 4", "bw-tour-target--calendar-add")
    page.locator("[data-bw-tour-next]").click()
    _expect_tour_step(page, "Plan for bills that change", "2 of 4", "bw-tour-target--needs-review")
    page.locator("[data-bw-tour-next]").click()
    _expect_tour_step(page, "Know when cash gets tight", "3 of 4", "bw-tour-target--cash-outlook")
    page.locator("[data-bw-tour-next]").click()
    _expect_tour_step(page, "Keep your forecast accurate", "4 of 4", "bw-tour-target--reconcile-head")
    expect(page.locator("[data-bw-tour-next]")).to_have_text("See My Forecast")
    page.locator("[data-bw-tour-next]").click()
    expect(page.locator(".bw-tour-tooltip--open")).to_have_count(0)

    page.goto("/settings/")
    page.locator('[data-settings-key="preferences"]').click()
    page.locator("#prefRestartTourBtn").click()
    page.wait_for_url(re.compile(r"/calendar"))
    _expect_tour_step(page, "Add what’s coming up", "1 of 4", "bw-tour-target--calendar-add")
    page.locator(".bw-tour-tooltip__close").click()
    expect(page.locator(".bw-tour-tooltip--open")).to_have_count(0)

    page.goto("/settings/")
    page.locator('[data-settings-key="preferences"]').click()
    page.locator("#prefRestartTourBtn").click()
    page.wait_for_url(re.compile(r"/calendar"))
    expect(page.locator("[data-bw-tour-title]")).to_have_text("Add what’s coming up")
    page.locator(".bw-tour-tooltip__skip").click()
    expect(page.locator(".bw-tour-tooltip--open")).to_have_count(0)
    page.reload()
    expect(page.locator("#calendarGrid")).to_be_visible()
    expect(page.locator(".bw-tour-tooltip--open")).to_have_count(0)
    expect(page.locator("#bwForecastReadyModal.modal-overlay--open")).to_have_count(0)
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
    expect(page.locator("#sidebarBalanceThresholdAlerts")).to_contain_text("Below target")
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
    page.locator("#calendarNextMonth").click()
    expect(page.locator(f'.cal-cell[data-iso="{next_month.isoformat()}"]')).to_contain_text(label)
    page.reload()
    page.locator("#calendarNextMonth").click()
    expect(page.locator(f'.cal-cell[data-iso="{next_month.isoformat()}"]')).to_contain_text(label)
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
    expect(page.locator("#forecastConfidenceVerifyBtn")).to_be_visible()
    page.locator("#forecastConfidenceVerifyBtn").click()
    expect(page.locator("#reconcileModal.modal-overlay--open")).to_be_visible()
    page.locator("#reconcileMatchNoBtn").click()
    page.locator("#reconcileActualAmount").fill("5000")
    page.locator("#reconcileSaveBtn").click()
    expect(page.locator("#reconcileModal.modal-overlay--open")).to_have_count(0)
    later_balance = page.locator(f'.cal-cell[data-iso="{later.isoformat()}"] .cal-balance')
    expect(later_balance).to_have_text(money("5000.00"))
    page.reload()
    show_month(page, start[:7], later.isoformat())
    expect(later_balance).to_have_text(money("5000.00"))
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
    reconcile = page.locator("#reconcileModal.modal-overlay--open")
    expect(reconcile).to_be_visible()
    expect(reconcile.locator("#reconcileTitle")).to_have_text("Check your balance")
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
    page.locator(f'.cal-cell[data-iso="{reconciled_day}"] .cal-ledger-metrics').click()
    expect(page.locator("#reconcileModal.modal-overlay--open")).to_be_visible()
    page.locator("#reconcileMatchYesBtn").click()
    expect(page.locator("#reconcileModal.modal-overlay--open")).to_have_count(0)
    expect(page.locator(f'.cal-cell[data-iso="{reconciled_day}"]')).to_contain_text("Reconciled")
    _hover_transaction_without_balance_tip(page, reconciled_day, reconciled_label, "Reconciled")
    _hover_balance_shows(page, reconciled_day, "Reconciled")
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
    scope.get_by_text("Only update this occurrence", exact=True).click()
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
