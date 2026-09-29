"""Shared browser checks for the smoke suite."""

from __future__ import annotations

import re

from playwright.sync_api import expect

_IGNORED_CONSOLE = ("favicon", "fonts.gstatic", "fonts.googleapis", "fonts.google")


def money(amount: str) -> str:
    return f"${float(amount):,.2f}"


class PageGuard:
    """Collect JavaScript errors, console errors, and failed API calls."""

    def __init__(self, page):
        self.page = page
        self.page_errors = []
        self.console = []
        self.network = []
        self.checked = False
        self.allow_blocked_writes = False
        page.on("pageerror", lambda err: self.page_errors.append(str(err)))
        page.on("console", self._on_console)
        page.on("response", self._on_response)

    def _on_console(self, msg) -> None:
        if msg.type != "error":
            return
        text = msg.text or ""
        low = text.lower()
        if any(bit in low for bit in _IGNORED_CONSOLE):
            return
        if "failed to load resource" in low and "/api/" not in low:
            return
        self.console.append(text)

    def _on_response(self, response) -> None:
        if response.status < 400:
            return
        url = response.url
        if "/api/" not in url:
            return
        if response.status == 401 and ("/api/auth/me" in url or "/api/auth/login" in url):
            return
        if self.allow_blocked_writes and response.status == 403 and response.request.method != "GET":
            return
        self.network.append(f"{response.status} {response.request.method} {url}")

    def assert_clean(self) -> None:
        self.checked = True
        problems = []
        if self.page_errors:
            problems.append("JavaScript error: " + self.page_errors[0])
        if self.network:
            problems.append("Failed request: " + self.network[0])
        if self.console:
            problems.append("Console error: " + self.console[0])
        if problems:
            raise AssertionError("Route: " + self.page.url + "\n" + "\n".join(problems))


def assert_no_horizontal_overflow(page) -> None:
    delta = page.evaluate(
        "() => document.documentElement.scrollWidth - document.documentElement.clientWidth"
    )
    assert delta <= 1, f"Page has horizontal overflow ({delta}px) at {page.url}"


def assert_action_accessible(page, locator) -> None:
    expect(locator).to_be_visible()
    locator.scroll_into_view_if_needed()
    box = locator.bounding_box()
    assert box and box["width"] >= 8 and box["height"] >= 8, f"Primary action has no size at {page.url}"
    viewport = page.viewport_size or {"width": 1280, "height": 800}
    assert box["x"] >= -1, f"Primary action is clipped on the left at {page.url}"
    assert box["y"] >= -1, f"Primary action is clipped at the top at {page.url}"
    assert box["x"] + box["width"] <= viewport["width"] + 2, f"Primary action is clipped on the right at {page.url}"
    assert box["y"] + box["height"] <= viewport["height"] + 2, f"Primary action is clipped at the bottom at {page.url}"


def assert_route_ok(response, url: str) -> None:
    assert response is not None, f"{url} did not load"
    assert response.status < 400, f"{url} returned {response.status}"


def login(page, email: str, password: str) -> None:
    response = page.goto("/login.html")
    assert_route_ok(response, "/login.html")
    page.locator("#email").fill(email)
    page.locator("#password").fill(password)
    page.locator("#loginBtn").click()
    page.wait_for_url(re.compile(r"/calendar"), timeout=20_000)


def show_month(page, month: str, iso: str) -> None:
    page.locator("#monthInput").evaluate(
        """(el, month) => {
          el.value = month;
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }""",
        month,
    )
    expect(page.locator(f'.cal-cell[data-iso="{iso}"] .cal-balance')).to_be_visible()


def open_add_on_day(page, iso: str) -> None:
    page.locator(f'.cal-cell[data-iso="{iso}"]').evaluate("el => el.click()")
    expect(page.locator("#txAddModal.modal-overlay--open")).to_be_visible()
