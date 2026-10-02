"""Editor tests: twice-monthly days stay as entered across save, reload, and short months."""

from __future__ import annotations

import json
import re
import uuid
import urllib.request

import pytest
from playwright.sync_api import expect

from smoke_guard import SMOKE_ORIGIN, assert_bot_email
from support import assert_route_ok, login, open_add_on_day, show_month

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


def _register(start_date: str = "2026-01-01"):
    email = f"bw-smoke-twice{uuid.uuid4().hex[:10]}@example.com"
    assert_bot_email(email)
    body = _request(
        "POST",
        "/api/auth/register",
        body={"email": email, "password": PASSWORD, "first_name": "Twice", "last_name": "Bot"},
    )
    token = str((body or {}).get("access_token") or "")
    families = _request("GET", "/api/families", token=token)
    family_id = int(families[0]["id"])
    account = _request(
        "POST",
        f"/api/families/{family_id}/accounts",
        token=token,
        body={
            "name": "Checking",
            "type": "checking",
            "starting_balance": "1000.00",
            "starting_balance_date": start_date,
        },
    )
    return email, token, family_id, int(account["id"])


def _stored(token, family_id, series_id):
    rows = _request("GET", f"/api/families/{family_id}/expected-transactions", token=token)
    row = next(item for item in rows if int(item["id"]) == int(series_id))
    start_day = int(str(row["start_date"])[8:10])
    explicit = row.get("day_of_month")
    rule_day = int(explicit) if explicit is not None else start_day
    second = row.get("second_day_of_month")
    return rule_day, (None if second is None else int(second)), row


def _day(page, selector: str) -> int:
    value = page.locator(selector).input_value()
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}", value), value
    return int(value[8:10])


def _set_date(page, selector: str, iso: str) -> None:
    page.locator(selector).fill(iso)
    page.locator(selector).evaluate("(el) => el.dispatchEvent(new Event('change', { bubbles: true }))")


def _open_add(page, iso: str, name: str) -> None:
    open_add_on_day(page, iso)
    page.locator('input[name="txAddKind"][value="income"]').check()
    chip = page.locator("#txAddQuickChips .tx-quick-chip", has_text=re.compile(rf"^{re.escape(name)}$"))
    expect(chip).to_be_visible()
    chip.click()


def _save_new(page) -> dict:
    with page.expect_response(
        lambda response: response.request.method == "POST" and "/expected-transactions" in response.url
    ) as saved:
        page.locator("#txAddSave").click()
    assert saved.value.ok, saved.value.text()[:300]
    expect(page.locator("#txAddModal.modal-overlay--open")).to_have_count(0)
    return saved.value.json()


def _save_scope(page, choice: str) -> dict:
    page.locator("#txEditSave").click()
    scope = page.locator("#txEditApplyScopeModal.modal-overlay--open")
    expect(scope).to_be_visible()
    scope.get_by_text(choice, exact=True).click()
    with page.expect_response(
        lambda response: response.request.method == "POST"
        and ("apply-from-occurrence" in response.url or "/instances/" in response.url)
    ) as saved:
        scope.get_by_role("button", name="Save Changes").click()
    assert saved.value.ok, saved.value.text()[:300]
    expect(page.locator("#txEditModal.modal-overlay--open")).to_have_count(0)
    return saved.value.json()


def _save_series(page) -> dict:
    return _save_scope(page, "Update this and future transactions")


def _save_this_occurrence(page) -> dict:
    return _save_scope(page, "Only update this occurrence")


def _line(page, iso: str, text: str):
    return page.locator(f'.cal-cell[data-iso="{iso}"] .cal-day-tx-line', has_text=text).first


def _open_line(page, iso: str, text: str) -> None:
    show_month(page, iso[:7], iso)
    line = _line(page, iso, text)
    expect(line).to_be_visible()
    line.click()
    expect(page.locator("#txEditModal.modal-overlay--open")).to_be_visible()


def _prepare(page, email: str, month: str, sample: str) -> None:
    login(page, email, PASSWORD)
    show_month(page, month, sample)


@pytest.mark.smoke_title("Twice monthly 15 and 30")
def test_new_15_and_30_saves_and_reloads(page, guard):
    email, token, family_id, _account_id = _register()
    _prepare(page, email, "2026-03", "2026-03-15")
    _open_add(page, "2026-03-15", "Bonus")
    page.locator("#txAddRecurrence").select_option("twice_monthly")
    _set_date(page, "#txAddDate", "2026-03-15")
    _set_date(page, "#txAddSecondDayOfMonth", "2026-03-30")
    page.locator("#txAddAmount").fill("100")
    created = _save_new(page)
    assert _stored(token, family_id, created["id"])[:2] == (15, 30)

    page.reload()
    assert_route_ok(page.goto("/calendar/"), "/calendar/")
    _open_line(page, "2026-03-15", "Bonus")
    assert _day(page, "#txEditDate") == 15
    assert _day(page, "#instanceSecondDayOfMonth") == 30
    page.locator("#txEditCancel").click()
    assert _stored(token, family_id, created["id"])[:2] == (15, 30)
    guard.assert_clean()


@pytest.mark.smoke_title("Twice monthly 1 and 15")
def test_new_1_and_15_saves_and_reloads(page, guard):
    email, token, family_id, _account_id = _register()
    _prepare(page, email, "2026-03", "2026-03-01")
    _open_add(page, "2026-03-01", "Bonus")
    page.locator("#txAddRecurrence").select_option("twice_monthly")
    _set_date(page, "#txAddDate", "2026-03-01")
    _set_date(page, "#txAddSecondDayOfMonth", "2026-03-15")
    page.locator("#txAddAmount").fill("100")
    created = _save_new(page)
    assert _stored(token, family_id, created["id"])[:2] == (1, 15)

    page.reload()
    assert_route_ok(page.goto("/calendar/"), "/calendar/")
    _open_line(page, "2026-03-01", "Bonus")
    assert _day(page, "#txEditDate") == 1
    assert _day(page, "#instanceSecondDayOfMonth") == 15
    page.locator("#txEditCancel").click()
    assert _stored(token, family_id, created["id"])[:2] == (1, 15)
    guard.assert_clean()


@pytest.mark.smoke_title("Twice monthly 15 and 31")
def test_new_15_and_31_saves_and_reloads(page, guard):
    email, token, family_id, _account_id = _register()
    _prepare(page, email, "2026-03", "2026-03-15")
    _open_add(page, "2026-03-15", "Bonus")
    page.locator("#txAddRecurrence").select_option("twice_monthly")
    _set_date(page, "#txAddDate", "2026-03-15")
    _set_date(page, "#txAddSecondDayOfMonth", "2026-03-31")
    page.locator("#txAddAmount").fill("100")
    created = _save_new(page)
    assert _stored(token, family_id, created["id"])[:2] == (15, 31)

    page.reload()
    assert_route_ok(page.goto("/calendar/"), "/calendar/")
    _open_line(page, "2026-03-15", "Bonus")
    assert _day(page, "#txEditDate") == 15
    assert _day(page, "#instanceSecondDayOfMonth") == 31
    page.locator("#txEditCancel").click()
    assert _stored(token, family_id, created["id"])[:2] == (15, 31)
    guard.assert_clean()


@pytest.mark.smoke_title("Changing the first date keeps the second day")
def test_changing_the_first_date_does_not_change_the_second_day(page, guard):
    email, token, family_id, _account_id = _register()
    _prepare(page, email, "2026-03", "2026-03-30")
    _open_add(page, "2026-03-30", "Bonus")
    page.locator("#txAddRecurrence").select_option("twice_monthly")
    _set_date(page, "#txAddDate", "2026-03-30")
    _set_date(page, "#txAddSecondDayOfMonth", "2026-03-15")
    _set_date(page, "#txAddDate", "2026-03-01")
    assert _day(page, "#txAddSecondDayOfMonth") == 15
    page.locator("#txAddAmount").fill("80")
    created = _save_new(page)
    assert _stored(token, family_id, created["id"])[:2] == (1, 15)

    _open_line(page, "2026-03-01", "Bonus")
    _set_date(page, "#txEditDate", "2026-04-10")
    assert _day(page, "#instanceSecondDayOfMonth") == 15
    saved = _save_series(page)
    series_id = int(saved.get("future_series_id") or created["id"])
    assert _stored(token, family_id, series_id)[:2] == (10, 15)
    guard.assert_clean()


@pytest.mark.smoke_title("Other fields do not change recurrence days")
def test_amount_category_account_notes_and_color_do_not_change_days(page, guard):
    email, token, family_id, checking_id = _register()
    _request(
        "POST",
        f"/api/families/{family_id}/accounts",
        token=token,
        body={
            "name": "Savings",
            "type": "savings",
            "starting_balance": "0.00",
            "starting_balance_date": "2026-01-01",
        },
    )
    _prepare(page, email, "2026-03", "2026-03-01")
    _open_add(page, "2026-03-01", "Bonus")
    page.locator("#txAddRecurrence").select_option("twice_monthly")
    _set_date(page, "#txAddDate", "2026-03-01")
    _set_date(page, "#txAddSecondDayOfMonth", "2026-03-15")
    page.locator("#txAddAmount").fill("100")
    created = _save_new(page)
    assert _stored(token, family_id, created["id"])[:2] == (1, 15)

    _open_line(page, "2026-03-01", "Bonus")
    page.locator("#txEditAmount").fill("250")
    page.locator("#txEditNotes").fill("Holt")
    page.locator("#txEditCategoryId_search").evaluate(
        """() => {
          const st = categoryComboboxRegistry.get("txEditCategoryId");
          const next = (st.categories || []).find((cat) => String(cat.id) !== String(st.hidden.value));
          if (!next) throw new Error("no other category");
          selectCategoryComboboxChoice("txEditCategoryId", next.id, next.name);
        }"""
    )
    page.locator("#instanceAccountId").evaluate(
        """(el, checkingId) => {
          const next = Array.from(el.querySelectorAll("option")).find((opt) => opt.value && opt.value !== String(checkingId));
          if (!next) throw new Error("no other account");
          el.value = next.value;
          el.dispatchEvent(new Event("change", { bubbles: true }));
        }""",
        checking_id,
    )
    page.locator("#txEditCategoryColorSwatches .cat-swatch:not(.is-active)").first.click()
    assert _day(page, "#txEditDate") == 1
    assert _day(page, "#instanceSecondDayOfMonth") == 15
    saved = _save_series(page)
    series_id = int(saved.get("future_series_id") or created["id"])
    start_day, second_day, row = _stored(token, family_id, series_id)
    assert (start_day, second_day) == (1, 15)
    assert str(row.get("notes") or "") == "Holt"
    assert float(row["amount"]) == 250.0
    guard.assert_clean()


@pytest.mark.smoke_title("A 31st stays stored while viewing short months")
def test_true_31st_stays_stored_while_viewing_short_months(page, guard):
    email, token, family_id, _account_id = _register()
    _prepare(page, email, "2026-01", "2026-01-15")
    _open_add(page, "2026-01-15", "Bonus")
    page.locator("#txAddRecurrence").select_option("twice_monthly")
    _set_date(page, "#txAddDate", "2026-01-15")
    _set_date(page, "#txAddSecondDayOfMonth", "2026-01-31")
    page.locator("#txAddAmount").fill("100")
    created = _save_new(page)

    for iso in ("2026-02-28", "2026-04-30", "2026-09-30", "2026-11-30"):
        _open_line(page, iso, "Bonus")
        assert _day(page, "#instanceSecondDayOfMonth") == 31
        page.locator("#txEditCancel").click()
        expect(page.locator("#txEditModal.modal-overlay--open")).to_have_count(0)
        assert _stored(token, family_id, created["id"])[:2] == (15, 31)
    guard.assert_clean()


@pytest.mark.smoke_title("February clamps without changing the saved rule")
def test_february_clamps_occurrences_without_changing_the_saved_rule(page, guard):
    email, token, family_id, _account_id = _register()
    _prepare(page, email, "2026-01", "2026-01-15")
    _open_add(page, "2026-01-15", "Bonus")
    page.locator("#txAddRecurrence").select_option("twice_monthly")
    _set_date(page, "#txAddDate", "2026-01-15")
    _set_date(page, "#txAddSecondDayOfMonth", "2026-01-31")
    page.locator("#txAddAmount").fill("100")
    created = _save_new(page)

    _open_add(page, "2026-01-30", "Paycheck")
    page.locator("#txAddRecurrence").select_option("twice_monthly")
    _set_date(page, "#txAddDate", "2026-01-30")
    _set_date(page, "#txAddSecondDayOfMonth", "2026-01-15")
    page.locator("#txAddAmount").fill("200")
    paycheck = _save_new(page)

    show_month(page, "2026-02", "2026-02-15")
    expect(_line(page, "2026-02-15", "Bonus")).to_be_visible()
    expect(_line(page, "2026-02-28", "Bonus")).to_be_visible()
    expect(_line(page, "2026-02-15", "Paycheck")).to_be_visible()
    expect(_line(page, "2026-02-28", "Paycheck")).to_be_visible()
    assert _line(page, "2026-02-28", "Bonus").count() == 1
    assert _line(page, "2026-02-28", "Paycheck").count() == 1
    assert _stored(token, family_id, created["id"])[:2] == (15, 31)
    assert _stored(token, family_id, paycheck["id"])[:2] == (30, 15)
    guard.assert_clean()


@pytest.mark.smoke_title("Saving in a short month keeps both recurrence days")
def test_reopening_and_saving_in_a_short_month_keeps_both_days(page, guard):
    email, token, family_id, _account_id = _register()
    _prepare(page, email, "2026-01", "2026-01-15")
    _open_add(page, "2026-01-15", "Bonus")
    page.locator("#txAddRecurrence").select_option("twice_monthly")
    _set_date(page, "#txAddDate", "2026-01-15")
    _set_date(page, "#txAddSecondDayOfMonth", "2026-01-31")
    page.locator("#txAddAmount").fill("100")
    created = _save_new(page)

    _open_line(page, "2026-02-28", "Bonus")
    assert _day(page, "#instanceSecondDayOfMonth") == 31
    page.locator("#txEditNotes").fill("February save")
    saved = _save_series(page)
    series_id = int(saved.get("future_series_id") or created["id"])
    start_day, second_day, row = _stored(token, family_id, series_id)
    assert (start_day, second_day) == (15, 31), (
        f"stored start day {start_day} on {row['start_date']}, second day {second_day}, day_of_month {row.get('day_of_month')}"
    )
    assert str(row.get("notes") or "") == "February save"
    march = _request(
        "GET",
        f"/api/families/{family_id}/expected-calendar?month=2026-03",
        token=token,
    )
    march_dates = sorted(
        item["date"] for item in march["items"] if int(item["expected_transaction_id"]) == series_id
    )
    assert march_dates == ["2026-03-15", "2026-03-31"]
    guard.assert_clean()


@pytest.mark.smoke_title("Amount edit on a clamped 30th keeps 30 and 15")
def test_amount_edit_on_clamped_february_keeps_30_and_15(page, guard):
    email, token, family_id, _account_id = _register()
    _prepare(page, email, "2026-01", "2026-01-30")
    _open_add(page, "2026-01-30", "Paycheck")
    page.locator("#txAddRecurrence").select_option("twice_monthly")
    _set_date(page, "#txAddDate", "2026-01-30")
    _set_date(page, "#txAddSecondDayOfMonth", "2026-01-15")
    page.locator("#txAddAmount").fill("80")
    created = _save_new(page)

    _open_line(page, "2026-02-28", "Paycheck")
    page.locator("#txEditAmount").fill("250")
    saved = _save_series(page)
    series_id = int(saved.get("future_series_id") or created["id"])
    assert _stored(token, family_id, series_id)[:2] == (30, 15)
    guard.assert_clean()


@pytest.mark.smoke_title("Monthly 31st notes edit keeps the 31st")
def test_monthly_31_notes_edit_from_february_keeps_the_31st(page, guard):
    email, token, family_id, _account_id = _register()
    _prepare(page, email, "2026-01", "2026-01-31")
    _open_add(page, "2026-01-31", "Bonus")
    page.locator("#txAddRecurrence").select_option("monthly")
    _set_date(page, "#txAddDate", "2026-01-31")
    page.locator("#txAddAmount").fill("40")
    created = _save_new(page)

    _open_line(page, "2026-02-28", "Bonus")
    page.locator("#txEditNotes").fill("Still the 31st")
    saved = _save_series(page)
    series_id = int(saved.get("future_series_id") or created["id"])
    assert _stored(token, family_id, series_id)[:2] == (31, None)
    show_month(page, "2026-03", "2026-03-31")
    expect(_line(page, "2026-03-31", "Bonus")).to_be_visible()
    guard.assert_clean()


@pytest.mark.smoke_title("Monthly 30th category edit keeps the 30th")
def test_monthly_30_category_edit_from_february_keeps_the_30th(page, guard):
    email, token, family_id, _account_id = _register()
    _prepare(page, email, "2026-01", "2026-01-30")
    _open_add(page, "2026-01-30", "Bonus")
    page.locator("#txAddRecurrence").select_option("monthly")
    _set_date(page, "#txAddDate", "2026-01-30")
    page.locator("#txAddAmount").fill("40")
    created = _save_new(page)

    _open_line(page, "2026-02-28", "Bonus")
    page.locator("#txEditCategoryId_search").evaluate(
        """() => {
          const st = categoryComboboxRegistry.get("txEditCategoryId");
          const next = (st.categories || []).find((cat) => String(cat.id) !== String(st.hidden.value));
          if (!next) throw new Error("no other category");
          selectCategoryComboboxChoice("txEditCategoryId", next.id, next.name);
        }"""
    )
    saved = _save_series(page)
    series_id = int(saved.get("future_series_id") or created["id"])
    assert _stored(token, family_id, series_id)[:2] == (30, None)
    show_month(page, "2026-03", "2026-03-30")
    expect(page.locator('.cal-cell[data-iso="2026-03-30"] .cal-day-tx-line')).to_be_visible()
    guard.assert_clean()


@pytest.mark.smoke_title("Explicit recurrence date changes update only that day")
def test_explicit_recurrence_date_changes_update_only_that_day(page, guard):
    email, token, family_id, _account_id = _register()
    _prepare(page, email, "2026-03", "2026-03-15")
    _open_add(page, "2026-03-15", "Bonus")
    page.locator("#txAddRecurrence").select_option("twice_monthly")
    _set_date(page, "#txAddDate", "2026-03-15")
    _set_date(page, "#txAddSecondDayOfMonth", "2026-03-31")
    page.locator("#txAddAmount").fill("100")
    created = _save_new(page)

    _open_line(page, "2026-03-15", "Bonus")
    _set_date(page, "#txEditDate", "2026-03-10")
    assert _day(page, "#instanceSecondDayOfMonth") == 31
    saved = _save_series(page)
    series_id = int(saved.get("future_series_id") or created["id"])
    assert _stored(token, family_id, series_id)[:2] == (10, 31)

    show_month(page, "2026-04", "2026-04-15")
    _open_add(page, "2026-04-15", "Paycheck")
    page.locator("#txAddRecurrence").select_option("twice_monthly")
    _set_date(page, "#txAddDate", "2026-04-15")
    _set_date(page, "#txAddSecondDayOfMonth", "2026-03-31")
    page.locator("#txAddAmount").fill("60")
    paycheck = _save_new(page)
    _open_line(page, "2026-04-15", "Paycheck")
    _set_date(page, "#instanceSecondDayOfMonth", "2026-04-20")
    assert _day(page, "#txEditDate") == 15
    saved = _save_series(page)
    series_id = int(saved.get("future_series_id") or paycheck["id"])
    assert _stored(token, family_id, series_id)[:2] == (15, 20)
    guard.assert_clean()


@pytest.mark.smoke_title("This occurrence only leaves the parent rule")
def test_this_occurrence_only_on_a_clamped_date_leaves_the_parent_rule(page, guard):
    email, token, family_id, _account_id = _register()
    _prepare(page, email, "2026-01", "2026-01-15")
    _open_add(page, "2026-01-15", "Bonus")
    page.locator("#txAddRecurrence").select_option("twice_monthly")
    _set_date(page, "#txAddDate", "2026-01-15")
    _set_date(page, "#txAddSecondDayOfMonth", "2026-01-31")
    page.locator("#txAddAmount").fill("100")
    created = _save_new(page)

    _open_line(page, "2026-02-28", "Bonus")
    page.locator("#txEditAmount").fill("250")
    _save_this_occurrence(page)
    assert _stored(token, family_id, created["id"])[:2] == (15, 31)
    assert float(_stored(token, family_id, created["id"])[2]["amount"]) == 100.0
    guard.assert_clean()


@pytest.mark.smoke_title("Saving a clamped occurrence without edits keeps the rule")
def test_reopen_and_save_without_changes_keeps_the_rule(page, guard):
    email, token, family_id, _account_id = _register()
    _prepare(page, email, "2026-01", "2026-01-15")
    _open_add(page, "2026-01-15", "Bonus")
    page.locator("#txAddRecurrence").select_option("twice_monthly")
    _set_date(page, "#txAddDate", "2026-01-15")
    _set_date(page, "#txAddSecondDayOfMonth", "2026-01-31")
    page.locator("#txAddAmount").fill("100")
    created = _save_new(page)

    _open_line(page, "2026-02-28", "Bonus")
    assert _day(page, "#instanceSecondDayOfMonth") == 31
    saved = _save_series(page)
    series_id = int(saved.get("future_series_id") or created["id"])
    assert _stored(token, family_id, series_id)[:2] == (15, 31)
    guard.assert_clean()
