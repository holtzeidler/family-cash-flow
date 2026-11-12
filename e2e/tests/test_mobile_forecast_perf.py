"""Diagnose mobile forecast load timing. Does not change product behavior."""

from __future__ import annotations

import json
import re
import time
from pathlib import Path

import pytest
from playwright.sync_api import expect

from support import login
from test_mobile_login_forecast import SCROLL_HOOK, _sample_until_ready, _today_metrics

PERF_DIR = Path(__file__).resolve().parents[2] / "tmp" / "forecast-perf"


def _perf_snapshot(page):
    return page.evaluate(
        """() => {
          const nav = (performance.getEntriesByType && performance.getEntriesByType("navigation")[0]) || null;
          const resources = ((performance.getEntriesByType && performance.getEntriesByType("resource")) || [])
            .filter((row) => String(row.name || "").indexOf("/api/") >= 0)
            .map((row) => ({
              name: String(row.name || "").replace(/^https?:\\/\\/[^/]+/, ""),
              start: Math.round(row.startTime || 0),
              dur: Math.round(row.duration || 0),
              wait: Math.round(Math.max(0, (row.responseStart || 0) - (row.requestStart || 0))),
              download: Math.round(Math.max(0, (row.responseEnd || 0) - (row.responseStart || 0))),
              encoded: row.encodedBodySize || 0,
              transfer: row.transferSize || 0,
            }));
          const trace = window.__bwCalendarTrace || [];
          const api = window.__bwApiTrace || [];
          const timed = (name) => {
            const row = trace.find((item) => item.event === name);
            return row ? Math.round(row.t) : null;
          };
          const step = (label) => {
            const row = trace.find((item) => item.event === "step:" + label);
            return row && row.extra ? row.extra.ms : null;
          };
          const usableAt = timed("usable-calendar") || timed("coherent-painted");
          const apiBeforeUsable = api.filter((row) => usableAt == null || row.t <= usableAt);
          const pathsBefore = apiBeforeUsable.map((row) => {
            const qs = row.qs ? ("?" + row.qs) : "";
            return String(row.path || "") + qs;
          });
          return {
            nav: nav && {
              start: Math.round(nav.startTime || 0),
              domContent: Math.round(nav.domContentLoadedEventEnd || 0),
              load: Math.round(nav.loadEventEnd || 0),
              ttfb: Math.round((nav.responseStart || 0) - (nav.requestStart || 0)),
            },
            marks: {
              auth: timed("auth-ready"),
              family: timed("family-ready"),
              bootstrap: timed("bootstrap-start"),
              monthStart: timed("month-load-start"),
              coherent: timed("coherent-painted"),
              usable: timed("usable-calendar"),
              place: timed("mobile-place-today") || timed("mobile-place-month"),
              ready: timed("month-load-ready"),
              cashHealth: timed("cash-health-painted"),
              renderDone: timed("renderCalendar-done"),
            },
            steps: {
              daily: step("daily-balances"),
              transactions: step("transactions"),
              expected: step("expected"),
              extras: step("extras"),
              lowBalance: step("low-balance"),
              reconciled: step("reconciled"),
              verified: step("verified"),
              upcoming: step("upcoming"),
              adjacent: step("adjacent-daily"),
              confidence: step("forecast-confidence"),
            },
            renderMs: (trace.find((row) => row.event === "renderCalendar-done") || {}).extra
              ? (trace.find((row) => row.event === "renderCalendar-done").extra.ms)
              : null,
            placeMs: ((trace.find((row) => row.event === "mobile-place-today" || row.event === "mobile-place-month") || {}).extra || {}).ms,
            renders: trace.filter((row) => row.event === "renderCalendar").length,
            warmed: trace.filter((row) => row.event === "month-warmed").length,
            apiCount: api.length,
            apiBeforeUsableCount: apiBeforeUsable.length,
            apiBeforeUsable: apiBeforeUsable.map((row) => ({
              path: row.path,
              qs: row.qs,
              ms: row.ms,
              status: row.status,
              bytes: row.bytes,
              t: row.t,
            })),
            upcomingBeforeUsable: pathsBefore.some((path) => path.indexOf("transactions?start_date=") >= 0),
            extrasBeforeUsable: pathsBefore.filter((path) => path.indexOf("transactions?month=") >= 0).length > 1
              || pathsBefore.filter((path) => path.indexOf("expected-calendar?month=") >= 0).length > 1,
            api: api.map((row) => ({
              path: row.path,
              qs: row.qs,
              ms: row.ms,
              status: row.status,
              bytes: row.bytes,
              t: row.t,
            })),
            resources,
            events: trace.map((row) => ({ event: row.event, t: Math.round(row.t), ms: row.extra && row.extra.ms })),
          };
        }"""
    )


def _write_perf(name, payload):
    PERF_DIR.mkdir(parents=True, exist_ok=True)
    (PERF_DIR / name).write_text(json.dumps(payload, indent=2), encoding="utf-8")


@pytest.mark.smoke_title("Mobile forecast load timing is captured")
@pytest.mark.parametrize("width", [320, 375, 390])
def test_mobile_forecast_perf_login(page, seed, guard, width):
    page.set_viewport_size({"width": width, "height": 844})
    page.add_init_script(SCROLL_HOOK)
    login(page, seed["active"]["email"], seed["active"]["password"])
    expect(page.locator("#calendarPanel")).not_to_have_class(re.compile(r"calendar-panel--loading"))
    _sample_until_ready(page)
    page.wait_for_timeout(400)
    snap = _perf_snapshot(page)
    _write_perf(f"login-{width}.json", snap)
    assert snap["marks"]["usable"] or snap["marks"]["coherent"], snap
    assert snap["api"], snap
    assert snap["upcomingBeforeUsable"] is False, snap
    if snap["marks"]["usable"] and snap["marks"]["cashHealth"]:
        assert snap["marks"]["usable"] <= snap["marks"]["cashHealth"], snap
    guard.assert_clean()


@pytest.mark.smoke_title("Returning mobile login timing is captured")
def test_mobile_forecast_perf_reload(page, seed, guard):
    page.set_viewport_size({"width": 390, "height": 844})
    page.add_init_script(SCROLL_HOOK)
    login(page, seed["active"]["email"], seed["active"]["password"])
    expect(page.locator("#calendarPanel")).not_to_have_class(re.compile(r"calendar-panel--loading"))
    page.reload()
    expect(page.locator("#calendarPanel")).not_to_have_class(re.compile(r"calendar-panel--loading"))
    _sample_until_ready(page)
    page.wait_for_timeout(400)
    snap = _perf_snapshot(page)
    _write_perf("reload-390.json", snap)
    assert snap["marks"]["usable"] or snap["marks"]["coherent"], snap
    guard.assert_clean()


@pytest.mark.smoke_title("Throttled mobile forecast timing is captured")
def test_mobile_forecast_perf_throttled(page, seed, guard):
    page.set_viewport_size({"width": 390, "height": 844})
    page.add_init_script(SCROLL_HOOK)

    def delay(route):
        if route.request.method == "GET" and "/api/" in route.request.url:
            time.sleep(0.18)
        route.continue_()

    page.route("**/api/**", delay)
    login(page, seed["active"]["email"], seed["active"]["password"])
    expect(page.locator("#calendarPanel")).not_to_have_class(re.compile(r"calendar-panel--loading"), timeout=30_000)
    _sample_until_ready(page, timeout_ms=30000)
    page.unroute("**/api/**")
    page.wait_for_timeout(400)
    snap = _perf_snapshot(page)
    metrics = _today_metrics(page)
    _write_perf("throttled-390.json", {"snap": snap, "todayInView": metrics.get("todayInView")})
    assert snap["marks"]["usable"] or snap["marks"]["coherent"], snap
    guard.assert_clean()
