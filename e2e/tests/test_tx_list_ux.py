"""Transactions list order, filter hierarchy, and sidebar reconcile placement."""

from __future__ import annotations

import re

import pytest
from playwright.sync_api import expect

from support import login
from test_core_workflows import _register_checking


def _sidebar_layout(page):
    return page.evaluate(
        """() => {
          const box = (sel) => {
            const el = document.querySelector(sel);
            if (!el || el.hidden || !el.getClientRects().length) return null;
            const r = el.getBoundingClientRect();
            return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width };
          };
          const rows = [...document.querySelectorAll("#sidebarBodyMonth .total")].filter((el) => el.getClientRects().length).map((el) => {
            const k = el.querySelector(".k").getBoundingClientRect();
            const v = el.querySelector(".v").getBoundingClientRect();
            const r = el.getBoundingClientRect();
            return { left: k.left, right: v.right, top: r.top, bottom: r.bottom };
          });
          const sidebar = box(".sidebar");
          return {
            warningKicker: box(".cash-health-card__kicker"),
            warningFigure: box(".cash-health-card__nav") || box(".cash-health-card__figure"),
            alerts: box("#sidebarBalanceThresholdAlerts"),
            review: box("#sidebarPendingTxCard"),
            label: box(".sidebar-reconcile__label"),
            date: box("#sidebarReconcileDetail"),
            button: box("#sidebarReconcileBtn"),
            rows,
            sidebarRight: sidebar ? sidebar.right : null,
          };
        }"""
    )


def _assert_sidebar_spacing(layout):
    if layout["warningKicker"] and layout["warningFigure"]:
        assert layout["warningFigure"]["top"] >= layout["warningKicker"]["bottom"] - 1, layout
        assert layout["warningKicker"]["right"] <= layout["sidebarRight"] + 1, layout
    if layout["alerts"] and layout["review"]:
        assert layout["review"]["top"] >= layout["alerts"]["bottom"] + 6, layout
    assert layout["date"]["top"] - layout["label"]["bottom"] >= 4, layout
    assert layout["button"]["top"] - layout["date"]["bottom"] >= 8, layout
    assert len(layout["rows"]) >= 3, layout["rows"]
    lefts = [round(row["left"]) for row in layout["rows"]]
    rights = [round(row["right"]) for row in layout["rows"]]
    assert max(lefts) - min(lefts) <= 1, layout["rows"]
    assert max(rights) - min(rights) <= 1, layout["rows"]
    heights = [row["bottom"] - row["top"] for row in layout["rows"]]
    assert min(heights) >= 24, layout["rows"]


@pytest.mark.smoke_title("Transactions list is dated in order and the sidebar date is not cramped")
def test_transactions_list_order_and_sidebar_date(page, guard):
    page.set_viewport_size({"width": 1280, "height": 900})
    email = _register_checking("1000.00", "2026-11-01")
    login(page, email, "SmokeOnly1!")
    created = page.evaluate(
        """async () => {
          const token = sessionStorage.getItem("bw_api_access_token") || localStorage.getItem("bw_api_access_token");
          const base = typeof getApiBase === "function" ? getApiBase() : "";
          const headers = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
          const families = await fetch(base + "/api/families", { headers }).then((r) => r.json());
          const id = families[0].id;
          const rows = [
            { date: "2026-11-19", kind: "expense", amount: 12, description: "Later bill" },
            { date: "2026-11-15", kind: "expense", amount: 8, description: "Earlier bill" },
            { date: "2026-11-17", kind: "income", amount: 20, description: "Middle pay" },
          ];
          for (const row of rows) {
            const res = await fetch(base + "/api/families/" + id + "/transactions", {
              method: "POST",
              headers,
              body: JSON.stringify(row),
            });
            if (!res.ok) return { ok: false, status: res.status, body: await res.text() };
          }
          return { ok: true };
        }"""
    )
    assert created.get("ok"), created
    page.evaluate(
        """async () => {
          if (typeof loadUpcomingTransactionsPanelUncached === "function") {
            await loadUpcomingTransactionsPanelUncached();
          }
        }"""
    )
    page.locator("#navTransactionView").click()
    expect(page).to_have_url(re.compile(r"/transactions"))
    expect(page.locator(".tm__sub")).to_have_text("Search, review, and manage your past and upcoming transactions.")
    expect(page.locator(".tm__quickLabel")).to_have_text("Quick filters")
    expect(page.locator('.tm-chip[data-tm-when="all"]')).to_have_attribute("aria-pressed", "true")
    expect(page.locator('.tm-chip[data-tm-view="recurring"]')).to_be_visible()
    expect(page.locator("#tmStatus")).to_be_hidden()
    expect(page.locator("#tmInsights")).to_contain_text("category")
    expect(page.locator("#tmInsights")).not_to_contain_text("Forecast hygiene")
    dates = page.locator("#txListMain .tm-col--date")
    expect(dates.first).to_be_visible()
    texts = dates.all_inner_texts()
    assert texts == sorted(texts), texts

    label = page.locator(".sidebar-reconcile__label")
    detail = page.locator("#sidebarReconcileDetail")
    expect(label).to_be_visible()
    expect(detail).to_be_visible()
    boxes = page.evaluate(
        """() => {
          const label = document.querySelector(".sidebar-reconcile__label").getBoundingClientRect();
          const date = document.querySelector("#sidebarReconcileDetail").getBoundingClientRect();
          return { labelBottom: label.bottom, dateTop: date.top, labelRight: label.right, dateLeft: date.left };
        }"""
    )
    assert boxes["dateTop"] >= boxes["labelBottom"] - 1, boxes
    review = page.locator("#sidebarPendingTxCard")
    expect(review).not_to_contain_text("All caught up")
    expect(review).not_to_contain_text("No estimates to review")
    if page.locator("#sidebarPendingTxList .pending-attn-item").count():
        expect(page.locator("#sidebarPendingTitle")).to_have_text("Needs Review")
        expect(review).to_be_visible()
    else:
        expect(review).to_be_hidden()
    expect(page.locator("#sidebarReconcileBtn")).to_be_visible()
    _assert_sidebar_spacing(_sidebar_layout(page))
    page.set_viewport_size({"width": 900, "height": 900})
    expect(page.locator("#sidebarReconcileBtn")).to_be_visible()
    _assert_sidebar_spacing(_sidebar_layout(page))
    page.set_viewport_size({"width": 1280, "height": 900})
    expect(page.locator("#totals")).to_contain_text("Income")
    expect(page.locator("#sidebarMonthLow")).to_contain_text("Lowest balance this month")
    expect(page.locator("#sidebarMonthLowValue")).to_contain_text("$")
    expect(page.locator("#sidebarForecastHints")).not_to_contain_text("Forecast low")
    expect(page.locator("#tmInsights")).not_to_contain_text("Nothing urgent")
    expect(page.locator("#tmInsights")).not_to_contain_text("Forecast hygiene")
    aligned = page.evaluate(
        """() => {
          const label = document.querySelector(".tm__quickLabel").getBoundingClientRect();
          const chip = document.querySelector(".tm__chips--quick .tm-chip").getBoundingClientRect();
          return { labelTop: label.top, chipTop: chip.top, labelRight: label.right, chipLeft: chip.left };
        }"""
    )
    assert abs(aligned["labelTop"] - aligned["chipTop"]) < 16, aligned
    assert aligned["chipLeft"] >= aligned["labelRight"] - 2, aligned

    page.goto("/transactions/")
    expect(page.locator("#sidebarReconcileBtn")).to_be_visible()
    expect(page.locator("#totals")).to_contain_text("Income")
    expect(page.locator("#sidebarMonthLow")).to_contain_text("Lowest balance this month")
    expect(page.locator("#sidebarMonthLowValue")).to_contain_text("$")
    expect(page.locator("#sidebarForecastHints")).not_to_contain_text("Forecast low")
    expect(page.locator("#tmInsights")).not_to_contain_text("Nothing urgent")
    guard.assert_clean()


@pytest.mark.smoke_title("Needs Review hides when nothing needs review")
def test_needs_review_hides_when_empty_and_shows_items(page, guard):
    page.set_viewport_size({"width": 1280, "height": 900})
    email = _register_checking("2000.00", "2026-11-01")
    login(page, email, "SmokeOnly1!")
    created = page.evaluate(
        """async () => {
          const token = sessionStorage.getItem("bw_api_access_token") || localStorage.getItem("bw_api_access_token");
          const base = typeof getApiBase === "function" ? getApiBase() : "";
          const headers = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
          const families = await fetch(base + "/api/families", { headers }).then((r) => r.json());
          const id = families[0].id;
          const accounts = await fetch(base + "/api/families/" + id + "/accounts", { headers }).then((r) => r.json());
          const cats = await fetch(base + "/api/families/" + id + "/categories", { headers }).then((r) => r.json());
          const cat = cats.find((c) => c.kind === "expense") || cats[0];
          const today = new Date();
          const iso = today.getFullYear() + "-" + String(today.getMonth() + 1).padStart(2, "0") + "-" + String(today.getDate()).padStart(2, "0");
          const res = await fetch(base + "/api/families/" + id + "/expected-transactions", {
            method: "POST",
            headers,
            body: JSON.stringify({
              account_id: accounts[0].id,
              start_date: iso,
              recurrence: "monthly",
              description: "Electric bill",
              kind: "expense",
              amount: 80,
              variable: true,
              category_id: cat.id,
            }),
          });
          return { ok: res.ok, status: res.status, body: await res.text() };
        }"""
    )
    assert created.get("ok"), created
    page.reload()
    card = page.locator("#sidebarPendingTxCard")
    expect(card).to_be_visible()
    expect(card).to_contain_text("Needs Review")
    expect(card).to_contain_text("Est. $80")
    expect(card).to_contain_text("due today")
    expect(card).not_to_contain_text("All caught up")
    expect(page.locator("#sidebarPendingTxList .pending-attn-item")).to_be_visible()
    expect(page.locator("#sidebarReconcileBtn")).to_be_visible()
    expect(page.locator("#sidebarLowBalanceBanner")).to_be_visible()

    page.set_viewport_size({"width": 390, "height": 800})
    expect(card).to_be_visible()
    expect(page.locator("#sidebarPendingTxList .pending-attn-item")).to_be_visible()

    page.locator("#sidebarPendingTxList .pending-attn-item").first.click()
    expect(page.locator("#reviewAmountModal.modal-overlay--open")).to_be_visible()
    page.locator("#reviewAmountConfirmBtn").click()
    expect(page.locator("#reviewAmountModal.modal-overlay--open")).to_have_count(0)
    expect(card).to_be_hidden()
    expect(card).not_to_contain_text("All caught up")
    expect(card).not_to_contain_text("No estimates to review")
    gap = page.evaluate(
        """() => {
          const el = document.querySelector("#sidebarPendingTxCard");
          const rect = el.getBoundingClientRect();
          return { hidden: el.hidden, height: rect.height, width: rect.width };
        }"""
    )
    assert gap["hidden"] is True and gap["height"] == 0, gap
    expect(page.locator("#sidebarReconcileBtn")).to_be_visible()
    expect(page.locator("#sidebarLowBalanceBanner")).to_be_visible()
    guard.assert_clean()
