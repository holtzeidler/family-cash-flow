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
          const firstCell = document.querySelector(".calendar--mobile .cal-cell:not(.cal-cell--out), .cal-cell:not(.cal-cell--out)");
          const panel = document.getElementById("calendarPanel");
          const scroll = document.querySelector(".calendar-scroll");
          const scrollStyle = scroll ? getComputedStyle(scroll) : null;
          const datesHidden = !!(scrollStyle && (scrollStyle.visibility === "hidden" || scrollStyle.opacity === "0"));
          const todayRect = cell ? cell.getBoundingClientRect() : null;
          const ch = document.querySelector("#sidebarCashHealthCard");
          const strip = document.getElementById("calCashHealthStrip");
          const stripRect = strip && !strip.hidden ? strip.getBoundingClientRect() : null;
          const nav = document.querySelector(".top-nav");
          const navBottom = nav ? Math.round(nav.getBoundingClientRect().bottom) : 0;
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
            firstInMonthIso: firstCell && firstCell.getAttribute("data-iso"),
            firstVisibleIso: firstCell && firstCell.getAttribute("data-iso"),
            todayInView: !!(todayRect && todayRect.top >= Math.max(70, stripRect ? stripRect.bottom - 2 : 70) && todayRect.top < window.innerHeight - 80 && !datesHidden),
            datesHidden,
            earlierToggle: !!document.querySelector(".cal-earlier-toggle"),
            placeCount: events.filter((e) => e === "mobile-place-today" || e === "mobile-place-month").length,
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
            cashHealthInView: !!(ch && !ch.hidden && (() => {
              const rect = ch.getBoundingClientRect();
              return rect.bottom > navBottom + 4 && rect.top < window.innerHeight - 8;
            })()),
            stripActive: !!(strip && !strip.hidden && strip.classList.contains("is-active")),
            stripTop: stripRect ? Math.round(stripRect.top) : null,
            stripBottom: stripRect ? Math.round(stripRect.bottom) : null,
            stripInView: !!(stripRect && stripRect.top >= navBottom - 1 && stripRect.bottom <= window.innerHeight),
            stripText: strip ? String(strip.textContent || "").replace(/\\s+/g, " ").trim() : "",
            stripTone: strip ? (
              strip.classList.contains("cal-cash-health-strip--negative") ? "negative"
              : strip.classList.contains("cal-cash-health-strip--below") ? "below"
              : strip.classList.contains("cal-cash-health-strip--healthy") ? "healthy"
              : ""
            ) : "",
            stripRole: strip ? String(strip.tagName || "").toLowerCase() : "",
            stripType: strip ? String(strip.getAttribute("type") || "") : "",
            stripAria: strip ? String(strip.getAttribute("aria-label") || "") : "",
            stripHeight: stripRect ? Math.round(stripRect.height) : null,
            duplicateCashHealth: !!(strip && !strip.hidden && strip.classList.contains("is-active") && ch && !ch.hidden && (() => {
              const rect = ch.getBoundingClientRect();
              return rect.bottom > navBottom + 4 && rect.top < window.innerHeight - 8;
            })()),
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


def _parse_rgb(value):
    text = str(value or "")
    nums = [int(part) for part in re.findall(r"\d+", text)[:3]]
    if len(nums) != 3:
        return None
    return tuple(nums)


def _rel_lum(rgb):
    def lin(channel):
        c = channel / 255
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    r, g, b = rgb
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)


def _contrast(fg, bg):
    if not fg or not bg:
        return 0
    lighter = max(_rel_lum(fg), _rel_lum(bg))
    darker = min(_rel_lum(fg), _rel_lum(bg))
    return (lighter + 0.05) / (darker + 0.05)


def _strip_styles(page):
    return page.evaluate(
        """() => {
          const el = document.getElementById("calCashHealthStrip");
          if (!el) return null;
          const kicker = el.querySelector(".cal-cash-health-strip__kicker");
          const amount = el.querySelector(".cal-cash-health-strip__amount");
          const when = el.querySelector(".cal-cash-health-strip__when");
          const icon = el.querySelector(".cash-health-card__icon");
          const cs = getComputedStyle(el);
          const kickerCs = kicker ? getComputedStyle(kicker) : null;
          const amountCs = amount ? getComputedStyle(amount) : null;
          const whenCs = when ? getComputedStyle(when) : null;
          const iconCs = icon ? getComputedStyle(icon) : null;
          const rect = el.getBoundingClientRect();
          const tone = el.classList.contains("cal-cash-health-strip--negative") ? "negative"
            : el.classList.contains("cal-cash-health-strip--below") ? "below"
            : el.classList.contains("cal-cash-health-strip--healthy") ? "healthy"
            : "";
          return {
            tone,
            tag: String(el.tagName || "").toLowerCase(),
            type: String(el.getAttribute("type") || ""),
            aria: String(el.getAttribute("aria-label") || ""),
            text: String(el.textContent || "").replace(/\\s+/g, " ").trim(),
            hidden: !!el.hidden,
            active: el.classList.contains("is-active"),
            height: Math.round(rect.height),
            bg: cs.backgroundColor,
            color: cs.color,
            kickerWeight: kickerCs ? String(kickerCs.fontWeight) : "",
            kickerColor: kickerCs ? kickerCs.color : "",
            amountColor: amountCs ? amountCs.color : "",
            whenColor: whenCs ? whenCs.color : "",
            iconColor: iconCs ? iconCs.color : "",
            iconWidth: iconCs ? iconCs.width : "",
          };
        }"""
    )


def _paint_strip_tone(page, tone):
    return page.evaluate(
        """(tone) => {
          const el = document.getElementById("calCashHealthStrip");
          if (!el) return null;
          el.className = `cal-cash-health-strip cal-cash-health-strip--${tone} is-active`;
          el.hidden = false;
          const kicker = el.querySelector(".cal-cash-health-strip__kicker");
          const amount = el.querySelector(".cal-cash-health-strip__amount");
          const when = el.querySelector(".cal-cash-health-strip__when");
          const icon = el.querySelector(".cash-health-card__icon");
          if (icon) {
            icon.className = `cash-health-card__icon cash-health-card__icon--${tone}`;
            if (tone === "healthy") {
              icon.innerHTML = "";
            } else if (!icon.querySelector("svg")) {
              icon.innerHTML = '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" focusable="false"><path d="M8 2.2L14.2 13.4H1.8L8 2.2z" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"></path><path d="M8 6.5v3.1M8 11.4v.01" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"></path></svg>';
            }
          }
          if (tone === "healthy") {
            if (kicker) kicker.textContent = "Looking good";
            if (amount) amount.textContent = "$1,240";
            if (when) when.textContent = "";
          } else if (tone === "negative") {
            if (kicker) kicker.textContent = "Negative";
            if (amount) amount.textContent = "-$120";
            if (when) when.textContent = "today";
          } else {
            if (kicker) kicker.textContent = "Below minimum";
            if (amount) amount.textContent = "$800";
            if (when) when.textContent = "today";
          }
          return true;
        }""",
        tone,
    )


def _assert_strip_tone_styles(styles, tone):
    assert styles, styles
    assert styles["tone"] == tone, styles
    assert styles["tag"] == "button", styles
    assert styles["type"] == "button", styles
    assert int(styles["kickerWeight"] or 0) >= 600, styles
    assert styles["height"] is not None and styles["height"] <= 40, styles
    bg = _parse_rgb(styles["bg"])
    for color in (styles["kickerColor"], styles["amountColor"], styles["color"]):
        ratio = _contrast(_parse_rgb(color), bg)
        assert ratio >= 4.5, {"tone": tone, "ratio": ratio, "styles": styles}
    if styles["whenColor"] and tone != "healthy":
        ratio = _contrast(_parse_rgb(styles["whenColor"]), bg)
        assert ratio >= 4.5, {"tone": tone, "whenRatio": ratio, "styles": styles}


def _assert_today_with_strip(metrics):
    assert metrics["todayInView"] is True, metrics
    assert metrics["earlierToggle"] is False, metrics
    assert metrics["stripActive"] is True, metrics
    assert metrics["stripInView"] is True, metrics
    assert metrics["cashHealthInView"] is False, metrics
    assert metrics["duplicateCashHealth"] is False, metrics
    if metrics["stripBottom"] is not None and metrics["todayTop"] is not None:
        assert metrics["stripBottom"] <= metrics["todayTop"] + 2, metrics
    if metrics["stripTop"] is not None:
        assert metrics["stripTop"] >= 70, metrics
    assert metrics["chip"] is False, metrics


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
        assert row["cashHealthHidden"] is False, row
        assert row["ribbon"] is False, row
        assert row["ribbonText"] != "Loading forecast…", row
        assert row["landCount"] == 0, row
        if row["cells"] > 0:
            assert row["datesHidden"] is True, row

    assert after_ready["coherent"] or after_ready["todayIso"], after_ready
    assert after_ready["daily"] is False, after_ready
    assert after_settle["restoration"] == "manual"
    assert after_settle["byCount"] == 0, after_settle
    assert after_settle["landCount"] == 0, after_settle
    assert after_settle["toCount"] <= 3, after_settle
    assert after_settle["cells"] > 0, after_settle
    assert after_settle["mcfVisible"] is False, after_settle
    assert after_settle["usable"] or after_settle["coherent"], after_settle
    assert after_settle["datesHidden"] is False, after_settle
    assert after_settle["placeCount"] >= 1, after_settle
    _assert_today_with_strip(after_settle)
    _assert_strip_tone_styles(_strip_styles(page), "below")
    assert after_settle["stripRole"] == "button", after_settle
    assert after_settle["stripType"] == "button", after_settle
    assert "Show Cash Health details" in after_settle["stripAria"], after_settle
    if after_settle["stripHeight"] is not None:
        assert after_settle["stripHeight"] <= 40, after_settle
    if after_settle["todayIso"] and after_settle["firstInMonthIso"]:
        assert after_settle["firstInMonthIso"] < after_settle["todayIso"], after_settle
    if after_settle["todayTop"] is not None:
        assert 40 <= after_settle["todayTop"] < 844, after_settle
    expect(page.get_by_role("heading", name="Cash Health")).to_be_visible()
    expect(page.locator(".cal-cash-health-chip")).to_have_count(0)
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
        assert row["ribbon"] is False, row
        assert row["ribbonText"] != "Loading forecast…", row
        assert row["landCount"] == 0, row
        if row["cells"] > 0:
            assert row["datesHidden"] is True, row
    assert after_ready["daily"] is False, after_ready
    assert metrics["landCount"] == 0, metrics
    assert metrics["cells"] > 0, metrics
    _assert_today_with_strip(metrics)
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
    assert after_ready["landCount"] == 0, after_ready
    for row in samples:
        if row["busy"]:
            assert row["landCount"] == 0, row
            if row["cells"] > 0:
                assert row["datesHidden"] is True, row
    expect(page.get_by_role("heading", name="Cash Health")).to_be_visible()
    settled = _today_metrics(page)
    _assert_today_with_strip(settled)
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


@pytest.mark.smoke_title("Mobile Today control returns to today")
def test_mobile_today_button_scrolls_to_today(page, seed, guard):
    page.set_viewport_size({"width": 390, "height": 844})
    page.add_init_script(SCROLL_HOOK)
    login(page, seed["active"]["email"], seed["active"]["password"])
    expect(page.get_by_role("heading", name="Cash Health")).to_be_visible()
    expect(page.locator("#calendarPanel")).not_to_have_class(re.compile(r"calendar-panel--loading"))
    expect(page.locator(".cal-earlier-toggle")).to_have_count(0)
    page.evaluate("window.scrollTo(0, 0)")
    page.wait_for_timeout(80)
    page.locator("#calendarGoToday").click()
    page.wait_for_timeout(200)
    metrics = _today_metrics(page)
    _assert_today_with_strip(metrics)
    assert metrics["landCount"] >= 1, metrics
    guard.assert_clean()


@pytest.mark.smoke_title("Mobile forecast scrolls up to earlier dates and down to later dates")
def test_mobile_natural_scroll_around_today(page, seed, guard):
    page.set_viewport_size({"width": 390, "height": 844})
    page.add_init_script(SCROLL_HOOK)
    login(page, seed["active"]["email"], seed["active"]["password"])
    expect(page.locator("#calendarPanel")).not_to_have_class(re.compile(r"calendar-panel--loading"))
    ready = _today_metrics(page)
    _assert_today_with_strip(ready)
    assert ready["firstInMonthIso"] < ready["todayIso"], ready
    page.evaluate("window.scrollBy(0, -360)")
    page.wait_for_timeout(80)
    earlier = page.evaluate(
        """() => {
          const todayIso = document.querySelector(".cal-cell--today") && document.querySelector(".cal-cell--today").getAttribute("data-iso");
          const days = [...document.querySelectorAll(".calendar--mobile .cal-cell:not(.cal-cell--out)")];
          const visible = days.filter((el) => {
            const rect = el.getBoundingClientRect();
            return rect.bottom > 72 && rect.top < window.innerHeight - 24;
          });
          const prev = visible.find((el) => todayIso && el.getAttribute("data-iso") < todayIso);
          return { iso: prev && prev.getAttribute("data-iso"), count: visible.length };
        }"""
    )
    assert earlier["iso"] and earlier["iso"] < ready["todayIso"], earlier
    mid = _today_metrics(page)
    assert mid["stripActive"] is True, mid
    assert mid["cashHealthInView"] is False, mid
    page.evaluate("window.scrollTo(0, 0)")
    page.wait_for_timeout(80)
    at_top = _today_metrics(page)
    assert at_top["cashHealthInView"] is True, at_top
    assert at_top["stripActive"] is False, at_top
    page.evaluate(f"window.scrollTo(0, {int(ready['y'])})")
    page.wait_for_timeout(80)
    page.evaluate("window.scrollBy(0, 720)")
    page.wait_for_timeout(80)
    later = page.evaluate(
        """() => {
          const todayIso = document.querySelector(".cal-cell--today") && document.querySelector(".cal-cell--today").getAttribute("data-iso");
          const days = [...document.querySelectorAll(".calendar--mobile .cal-cell:not(.cal-cell--out)")];
          const visible = days.filter((el) => {
            const rect = el.getBoundingClientRect();
            return rect.bottom > 72 && rect.top < window.innerHeight - 24;
          });
          const next = visible.find((el) => todayIso && el.getAttribute("data-iso") > todayIso);
          return { iso: next && next.getAttribute("data-iso"), count: visible.length };
        }"""
    )
    assert later["iso"] and later["iso"] > ready["todayIso"], later
    expect(page.locator(".cal-earlier-toggle")).to_have_count(0)
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
    assert after["cacheHits"] >= 1, after
    assert after["earlierToggle"] is False, after
    assert after["datesHidden"] is False, after
    assert after["duplicateCashHealth"] is False, after
    if after["cashHealthInView"]:
        assert after["stripActive"] is False, after
    else:
        assert after["stripActive"] is True, after
    assert elapsed_ms < 1500, {"elapsed_ms": elapsed_ms, "after": after}
    expect(page.locator("#calendarPanel")).not_to_have_class(re.compile(r"calendar-panel--loading"))
    guard.assert_clean()


@pytest.mark.smoke_title("Mobile Cash Health strip tones stay compact and tappable")
@pytest.mark.parametrize("width", [320, 375, 390])
def test_mobile_cash_health_strip_tones(page, seed, guard, width):
    page.set_viewport_size({"width": width, "height": 844})
    page.add_init_script(SCROLL_HOOK)
    login(page, seed["active"]["email"], seed["active"]["password"])
    expect(page.locator("#calendarPanel")).not_to_have_class(re.compile(r"calendar-panel--loading"))
    _assert_today_with_strip(_today_metrics(page))

    below = _strip_styles(page)
    _assert_strip_tone_styles(below, "below")
    assert "Below minimum" in below["text"], below
    TRACE_DIR.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(TRACE_DIR / f"chromium-{width}-strip-below.png"), full_page=False)

    _paint_strip_tone(page, "healthy")
    healthy = _strip_styles(page)
    _assert_strip_tone_styles(healthy, "healthy")
    assert "Looking good" in healthy["text"], healthy
    page.screenshot(path=str(TRACE_DIR / f"chromium-{width}-strip-healthy.png"), full_page=False)

    _paint_strip_tone(page, "negative")
    negative = _strip_styles(page)
    _assert_strip_tone_styles(negative, "negative")
    assert "Negative" in negative["text"], negative
    page.screenshot(path=str(TRACE_DIR / f"chromium-{width}-strip-negative.png"), full_page=False)

    _paint_strip_tone(page, "below")
    page.locator("#calCashHealthStrip").click()
    page.wait_for_timeout(120)
    after_click = _today_metrics(page)
    assert after_click["cashHealthInView"] is True, after_click
    assert after_click["stripActive"] is False, after_click
    assert after_click["duplicateCashHealth"] is False, after_click
    guard.assert_clean()
