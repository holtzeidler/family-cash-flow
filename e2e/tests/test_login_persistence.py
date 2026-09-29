"""Keep me logged in is off by default and only persists when the user opts in."""

from __future__ import annotations

import re
import time

import pytest
from playwright.sync_api import expect

from smoke_guard import SMOKE_ORIGIN
from support import assert_route_ok


def _open_login(page) -> None:
    response = page.goto("/login.html")
    assert_route_ok(response, "/login.html")


def _submit(page, email: str, password: str, keep: bool) -> None:
    _open_login(page)
    page.locator("#email").fill(email)
    page.locator("#password").fill(password)
    if keep:
        page.locator("#keepMeLoggedIn").check()
    page.locator("#loginBtn").click()


def _stored_tokens(page) -> dict:
    return page.evaluate(
        """() => ({
          session: sessionStorage.getItem("bw_api_access_token") || "",
          local: localStorage.getItem("bw_api_access_token") || "",
        })"""
    )


def _access_cookie(page):
    matches = [cookie for cookie in page.context.cookies() if cookie.get("name") == "access_token"]
    return matches[0] if matches else None


@pytest.mark.smoke_title("Keep me logged in starts unchecked")
def test_keep_me_logged_in_is_unchecked_by_default(page, guard):
    _open_login(page)
    box = page.locator("#keepMeLoggedIn")
    expect(box).to_be_visible()
    expect(box).not_to_be_checked()
    page.locator("label[for='keepMeLoggedIn']").click()
    expect(box).to_be_checked()
    page.locator("label[for='keepMeLoggedIn']").click()
    expect(box).not_to_be_checked()
    guard.assert_clean()


@pytest.mark.smoke_title("Login without Keep me logged in")
def test_login_without_keep_me_uses_a_browser_session(page, guard, seed):
    _submit(page, seed["active"]["email"], seed["active"]["password"], keep=False)
    page.wait_for_url(re.compile(r"/calendar"), timeout=20_000)
    stored = _stored_tokens(page)
    assert stored["session"]
    assert stored["local"] == ""
    cookie = _access_cookie(page)
    assert cookie is not None
    assert cookie["expires"] == -1
    guard.assert_clean()


@pytest.mark.smoke_title("Login with Keep me logged in")
def test_login_with_keep_me_persists_for_thirty_days(page, guard, seed, browser):
    _submit(page, seed["active"]["email"], seed["active"]["password"], keep=True)
    page.wait_for_url(re.compile(r"/calendar"), timeout=20_000)
    stored = _stored_tokens(page)
    assert stored["session"]
    assert stored["local"] == stored["session"]
    cookie = _access_cookie(page)
    assert cookie is not None
    remaining = cookie["expires"] - time.time()
    assert 29 * 24 * 60 * 60 < remaining < 30 * 24 * 60 * 60 + 120

    page.evaluate("() => sessionStorage.removeItem('bw_api_access_token')")
    fresh = browser.new_context()
    fresh.add_cookies([cookie])
    returned = fresh.new_page()
    returned.goto(SMOKE_ORIGIN + "/calendar")
    returned.wait_for_url(re.compile(r"/calendar"), timeout=20_000)
    fresh.close()
    guard.assert_clean()


@pytest.mark.smoke_title("Logout clears both login types")
def test_logout_clears_persistent_and_session_login(page, guard, seed):
    _submit(page, seed["active"]["email"], seed["active"]["password"], keep=True)
    page.wait_for_url(re.compile(r"/calendar"), timeout=20_000)
    page.locator("#logoutBtn").click()
    page.wait_for_url(re.compile(r":8765/?$"), timeout=20_000)
    stored = _stored_tokens(page)
    assert stored["session"] == ""
    assert stored["local"] == ""
    assert _access_cookie(page) is None

    page.goto("/calendar")
    page.wait_for_url(re.compile(r"/login\.html"), timeout=20_000)
    expect(page.locator("#keepMeLoggedIn")).not_to_be_checked()

    _submit(page, seed["active"]["email"], seed["active"]["password"], keep=False)
    page.wait_for_url(re.compile(r"/calendar"), timeout=20_000)
    page.locator("#logoutBtn").click()
    page.wait_for_url(re.compile(r":8765/?$"), timeout=20_000)
    page.goto("/calendar")
    page.wait_for_url(re.compile(r"/login\.html"), timeout=20_000)
    expect(page.locator("#loginCallout")).to_be_hidden()
    guard.assert_clean()


@pytest.mark.smoke_title("Wrong password still stays on login")
def test_wrong_password_does_not_log_in(page, guard, seed):
    _open_login(page)
    page.locator("#keepMeLoggedIn").check()
    page.locator("#email").fill(seed["active"]["email"])
    page.locator("#password").fill("not-the-smoke-password")
    page.locator("#loginBtn").click()
    expect(page.locator("#loginCallout")).to_be_visible()
    expect(page.locator("#loginCallout")).to_contain_text("Invalid email or password")
    expect(page).to_have_url(re.compile(r"/login\.html"))
    expect(page.locator("#keepMeLoggedIn")).to_be_checked()
    stored = _stored_tokens(page)
    assert stored["session"] == ""
    assert stored["local"] == ""
    guard.assert_clean()
