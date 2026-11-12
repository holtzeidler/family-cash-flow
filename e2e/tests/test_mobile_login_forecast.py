"""Mobile login should open the forecast at the top with Cash Health visible."""

from __future__ import annotations

import json
import re
import time
from pathlib import Path

import pytest
from playwright.sync_api import expect

from support import login

TRACE_DIR = Path(__file__).resolve().parents[2] / "tmp" / "login-forecast-stability"

SCROLL_HOOK = """
(() => {
  window.__bwScrollLog = [];
  const push = (kind, delta) => {
    window.__bwScrollLog.push({
      kind,
      delta: Number(delta) || 0,
      y: Math.round(window.scrollY || 0),
      t: performance.now(),
    });
  };
  const to = window.scrollTo.bind(window);
  const by = window.scrollBy.bind(window);
  window.scrollTo = function (a, b) {
    const top = a && typeof a === "object" ? a.top : b;
    push("to", top);
    return to.apply(this, arguments);
  };
  window.scrollBy = function (a, b) {
    const dy = a && typeof a === "object" ? a.y : b;
    push("by", dy);
    return by.apply(this, arguments);
  };
})();
"""


def _today_metrics(page):
    return page.evaluate(
        """() => {
          const cell = document.querySelector(".cal-cell--today");
          const firstCell = document.querySelector(".cal-cell:not([hidden])");
          const panel = document.getElementById("calendarPanel");
          const ch = document.querySelector("#sidebarCashHealthCard");
          const mcf = document.querySelector('.sidebar .card[data-sidebar-key="month"]');
          const addTx = document.querySelector(".cal-add-tx-btn, .cal-mobile-add-row");
          const log = window.__bwScrollLog || [];
          const trace = window.__bwCalendarTrace || [];
          const events = trace.map((row) => row.event);
          const timed = (name) => {
            const row = trace.find((item) => item.event === name);
            return row ? Math.round(row.t) : null;
          };
          return {
            y: Math.round(window.scrollY || 0),
            todayTop: cell ? Math.round(cell.getBoundingClientRect().top) : null,
            firstCellTop: firstCell ? Math.round(firstCell.getBoundingClientRect().top) : null,
            calendarTop: panel ? Math.round(panel.getBoundingClientRect().top) : null,
            addTxTop: addTx ? Math.round(addTx.getBoundingClientRect().top) : null,
            mcfVisible: !!(mcf && mcf.offsetParent !== null && getComputedStyle(mcf).display !== "none"),
            cashHealthMs: timed("cash-health-painted"),
            usableMs: timed("usable-calendar") || timed("coherent-painted"),
            bootstrapMs: timed("bootstrap-start"),
            todayIso: cell && cell.getAttribute("data-iso"),
            firstVisibleIso: firstCell && firstCell.getAttribute("data-iso"),
            earlierToggle: !!document.querySelector(".cal-earlier-toggle"),
            cacheHits: events.filter((e) => e === "month-cache-hit").length,
            dailyCacheHits: events.filter((e) => e === "daily-cache-hit").length,
            warmed: events.filter((e) => e === "month-warmed").length,
            api: (window.__bwApiTrace || []).map((row) => ({
              path: row.path,
              qs: row.qs,
              ms: row.ms,
              status: row.status,
            })),
            steps: trace
              .filter((row) => String(row.event || "").indexOf("step:") === 0)
              .map((row) => ({ event: row.event, ms: row.extra && row.extra.ms })),
            busy: !!(panel && panel.classList.contains("calendar-panel--loading")),
            restoration: String(history.scrollRestoration || ""),
            toCount: log.filter((row) => row.kind === "to").length,
            byCount: log.filter((row) => row.kind === "by").length,
            landCount: trace.filter((row) => row.event === "mobile-today").length,
            topCount: trace.filter((row) => row.event === "mobile-top").length,
            cashHealthHidden: !!(ch && ch.hidden),
            cashHealthTop: ch ? Math.round(ch.getBoundingClientRect().top) : null,
            renders: trace.filter((row) => row.event === "renderCalendar").length,
            skippedEmpty: events.filter((e) => e === "renderCalendar-skipped-empty").length,
            daily: events.includes("daily-balances-painted"),
            coherent: events.includes("coherent-painted"),
            ready: events.includes("month-load-ready"),
            usable: events.includes("usable-calendar"),
            cells: document.querySelectorAll(".cal-cell").length,
            txLines: document.querySelectorAll(".cal-day-tx-line").length,
            chip: !!document.querySelector(".cal-cash-health-chip"),
            ribbon: (() => {
              const el = document.getElementById("bwForecastStatusRibbon");
              if (!el) return false;
              const text = String(el.textContent || "").trim();
              const shown = el.style.display !== "none" && getComputedStyle(el).display !== "none";
              return shown && !!text;
            })(),
            ribbonText: (() => {
              const el = document.getElementById("bwForecastStatusRibbon");
              return el ? String(el.textContent || "").trim() : "";
            })(),
            welcomeOpen: !!document.querySelector("#bwForecastReadyModal.modal-overlay--open"),
            tourOpen: !!document.querySelector(".bw-tour-tooltip--open"),
            events,
            layout: trace.filter((row) => row.extra && "y" in row.extra).map((row) => ({
              event: row.event,
              y: row.extra.y,
              chHidden: row.extra.chHidden,
              chTop: row.extra.chTop,
              cells: row.extra.cells,
              busy: row.extra.busy,
            })),
          };
        }"""
    )


def _write_trace(name, payload):
    TRACE_DIR.mkdir(parents=True, exist_ok=True)
    (TRACE_DIR / name).write_text(json.dumps(payload, indent=2), encoding="utf-8")


def _sample_until_ready(page, timeout_ms=20000):
    samples = []
    deadline = time.time() + timeout_ms / 1000
    while time.time() < deadline:
        row = _today_metrics(page)
        samples.append(row)
        if not row["busy"] and (row["ready"] or row["todayIso"] or row["cells"] > 0):
            return row, samples
        page.wait_for_timeout(80)
    return _today_metrics(page), samples


@pytest.mark.smoke_title("Mobile login opens Cash Health at the top")
@pytest.mark.parametrize("width", [320, 375, 390])
def test_mobile_login_lands_once(page, seed, guard, width):
    page.set_viewport_size({"width": width, "height": 844})
    page.add_init_script(SCROLL_HOOK)
    login(page, seed["active"]["email"], seed["active"]["password"])
    expect(page.locator("#sidebarCashHealthCard")).to_be_visible()
    after_ready, samples = _sample_until_ready(page)
    expect(page.locator("#calendarPanel")).not_to_have_class(re.compile(r"calendar-panel--loading"))
    page.wait_for_timeout(2800)
    after_settle = _today_metrics(page)
    _write_trace(f"chromium-{width}.json", {"ready": after_ready, "settle": after_settle, "samples": samples})

    busy_samples = [row for row in samples if row["busy"]]
    for row in busy_samples:
        assert row["y"] <= 24, row
        assert row["cashHealthHidden"] is False, row
        assert row["ribbon"] is False, row
        assert row["ribbonText"] != "Loading forecast…", row
        assert row["landCount"] == 0, row

    assert after_ready["coherent"] or after_ready["todayIso"], after_ready
    assert after_ready["daily"] is False, after_ready
    assert after_settle["restoration"] == "manual"
    assert after_settle["y"] <= 24, after_settle
    assert after_settle["byCount"] == 0, after_settle
    assert after_settle["landCount"] == 0, after_settle
    assert after_settle["toCount"] <= 1, after_settle
    assert after_settle["cells"] > 0, after_settle
    assert after_settle["mcfVisible"] is False, after_settle
    assert after_settle["usable"] or after_settle["coherent"], after_settle
    if after_settle["cashHealthTop"] is not None:
        assert after_settle["cashHealthTop"] < 280, after_settle
    if after_settle["firstCellTop"] is not None:
        assert after_settle["firstCellTop"] < 844, after_settle
    if after_settle["calendarTop"] is not None:
        assert after_settle["calendarTop"] < 700, after_settle
    if after_settle["todayIso"] and after_settle["firstVisibleIso"]:
        assert after_settle["firstVisibleIso"] == after_settle["todayIso"], after_settle
    assert after_settle["earlierToggle"] is True, after_settle
    if after_settle["todayTop"] is not None:
        assert after_settle["todayTop"] < 844, after_settle
    expect(page.get_by_role("heading", name="Cash Health")).to_be_visible()
    expect(page.locator(".cal-cash-health-chip")).to_have_count(0)
    assert after_settle["chip"] is False, after_settle
    kicker = page.locator(".cash-health-card__kicker")
    expect(kicker).to_be_visible()
    kicker_text = kicker.inner_text()
    if "Below minimum projected" in kicker_text or "Negative balance projected" in kicker_text:
        panel_text = page.locator("#calendarPanel").inner_text()
        assert "Below minimum projected" not in panel_text
        assert "Negative balance projected" not in panel_text
    expect(page.get_by_role("heading", name="Monthly Cash Flow")).to_have_count(0)
    assert not after_settle["welcomeOpen"]
    assert not after_settle["tourOpen"]
    TRACE_DIR.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(TRACE_DIR / f"chromium-{width}-ready.png"), full_page=False)
    guard.assert_clean()


@pytest.mark.smoke_title("Slow calendar fetches keep empty cards off screen")
def test_mobile_slow_network_holds_calendar_until_ready(page, seed, guard):
    page.set_viewport_size({"width": 375, "height": 844})
    page.add_init_script(SCROLL_HOOK)

    def delay(route):
        url = route.request.url
        if "calendar-month-daily" not in url and route.request.method == "GET":
            time.sleep(0.18)
        route.continue_()

    page.route("**/api/**", delay)
    login(page, seed["active"]["email"], seed["active"]["password"])
    expect(page.get_by_role("heading", name="Cash Health")).to_be_visible()
    after_ready, samples = _sample_until_ready(page, timeout_ms=30000)
    page.unroute("**/api/**")
    expect(page.locator("#calendarPanel")).not_to_have_class(re.compile(r"calendar-panel--loading"), timeout=30_000)
    metrics = _today_metrics(page)
    busy_samples = [row for row in samples if row["busy"]]
    for row in busy_samples:
        assert row["y"] <= 24, row
        assert row["ribbon"] is False, row
        assert row["ribbonText"] != "Loading forecast…", row
        assert row["landCount"] == 0, row
    assert after_ready["daily"] is False, after_ready
    assert metrics["y"] <= 24, metrics
    assert metrics["landCount"] == 0, metrics
    assert metrics["cells"] > 0, metrics
    guard.assert_clean()


@pytest.mark.smoke_title("Refresh while signed in stays at Cash Health")
def test_mobile_refresh_stays_at_top(page, seed, guard):
    page.set_viewport_size({"width": 390, "height": 844})
    page.add_init_script(SCROLL_HOOK)
    login(page, seed["active"]["email"], seed["active"]["password"])
    expect(page.locator("#calendarPanel")).not_to_have_class(re.compile(r"calendar-panel--loading"))
    page.reload()
    expect(page.locator("#sidebarCashHealthCard")).to_be_visible()
    after_ready, samples = _sample_until_ready(page)
    expect(page.locator("#calendarPanel")).not_to_have_class(re.compile(r"calendar-panel--loading"))
    assert after_ready["y"] <= 24, after_ready
    assert after_ready["landCount"] == 0, after_ready
    for row in samples:
        if row["busy"]:
            assert row["y"] <= 24, row
            assert row["landCount"] == 0, row
    expect(page.get_by_role("heading", name="Cash Health")).to_be_visible()
    guard.assert_clean()


@pytest.mark.smoke_title("Desktop login still paints after daily balances")
def test_desktop_login_paints_progressively(page, seed, guard):
    page.set_viewport_size({"width": 1280, "height": 800})
    page.add_init_script(SCROLL_HOOK)
    login(page, seed["active"]["email"], seed["active"]["password"])
    expect(page.locator("#calendarPanel")).not_to_have_class(re.compile(r"calendar-panel--loading"))
    metrics = _today_metrics(page)
    assert metrics["cells"] > 0, metrics
    assert metrics["landCount"] == 0, metrics
    expect(page.get_by_role("heading", name="Cash Health")).to_be_visible()
    guard.assert_clean()


@pytest.mark.smoke_title("Mobile Today control returns to today without scrolling")
def test_mobile_today_button_scrolls_to_today(page, seed, guard):
    page.set_viewport_size({"width": 390, "height": 844})
    page.add_init_script(SCROLL_HOOK)
    login(page, seed["active"]["email"], seed["active"]["password"])
    expect(page.get_by_role("heading", name="Cash Health")).to_be_visible()
    expect(page.locator("#calendarPanel")).not_to_have_class(re.compile(r"calendar-panel--loading"))
    expect(page.locator(".cal-earlier-toggle")).to_be_visible()
    page.locator(".cal-earlier-toggle").click()
    expect(page.locator(".cal-earlier-toggle")).to_have_count(0)
    page.locator("#calendarGoToday").click()
    page.wait_for_timeout(200)
    metrics = _today_metrics(page)
    assert metrics["firstVisibleIso"] == metrics["todayIso"], metrics
    assert metrics["earlierToggle"] is True, metrics
    assert metrics["landCount"] == 0, metrics
    assert metrics["y"] <= 24, metrics
    guard.assert_clean()


@pytest.mark.smoke_title("Cached next month paints without a loading spinner")
def test_mobile_cached_next_month_is_instant(page, seed, guard):
    page.set_viewport_size({"width": 390, "height": 844})
    page.add_init_script(SCROLL_HOOK)
    login(page, seed["active"]["email"], seed["active"]["password"])
    expect(page.locator("#calendarPanel")).not_to_have_class(re.compile(r"calendar-panel--loading"))
    page.wait_for_function(
        """() => {
          const ym = document.getElementById("calendarMonth") && document.getElementById("calendarMonth").value;
          if (!ym) return false;
          const parts = ym.split("-").map(Number);
          const next = parts[1] === 12
            ? `${parts[0] + 1}-01`
            : `${parts[0]}-${String(parts[1] + 1).padStart(2, "0")}`;
          return (window.__bwCalendarTrace || []).some((row) => row.event === "month-warmed" && row.extra && row.extra.ym === next);
        }""",
        timeout=8000,
    )
    before = _today_metrics(page)
    started = time.perf_counter()
    page.locator("#calendarNextMonth").click()
    page.wait_for_function(
        """() => {
          const ym = document.getElementById("calendarMonth") && document.getElementById("calendarMonth").value;
          const panel = document.getElementById("calendarPanel");
          return ym && ym.slice(5) !== '11' && panel && !panel.classList.contains("calendar-panel--loading");
        }""",
        timeout=8000,
    )
    elapsed_ms = int((time.perf_counter() - started) * 1000)
    after = _today_metrics(page)
    _write_trace(
        "chromium-month-switch.json",
        {"before": before, "after": after, "elapsedMs": elapsed_ms},
    )
    assert after["y"] <= 24, after
    assert after["cacheHits"] >= 1, after
    assert elapsed_ms < 1500, {"elapsed_ms": elapsed_ms, "after": after}
    expect(page.locator("#calendarPanel")).not_to_have_class(re.compile(r"calendar-panel--loading"))
    guard.assert_clean()
