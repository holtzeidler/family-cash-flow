"""Homepage header and CTAs follow the real session, including cookie-only logins."""

from __future__ import annotations

import pytest
from playwright.sync_api import expect

from smoke_guard import SMOKE_ORIGIN
from support import assert_route_ok, login

GUEST_CTA = "/account-setup/?fresh=1"
MEMBER_CTA = "/calendar"


def _tokens(page) -> dict:
    return page.evaluate(
        """() => ({
          session: sessionStorage.getItem("bw_api_access_token") || "",
          local: localStorage.getItem("bw_api_access_token") || "",
        })"""
    )


def _expect_logged_out(page) -> None:
    expect(page.locator("#homeLoginLink")).to_be_visible()
    expect(page.locator("#homeLoginLink")).to_have_text("Log in")
    expect(page.locator("#homeLogoutBtn")).to_be_hidden()
    expect(page.locator("a.landing-hero__cta.home-cta--guest")).to_have_attribute("href", GUEST_CTA)
    expect(page.locator("a.landing-offer__cta.home-cta--guest")).to_have_attribute("href", GUEST_CTA)
    expect(page.locator("a.landing-hero__cta.home-cta--guest")).to_be_visible()
    expect(page.locator("a.landing-offer__cta.home-cta--guest")).to_be_visible()
    expect(page.locator("a.home-cta--member")).to_have_count(2)
    for cta in page.locator("a.home-cta--member").all():
        expect(cta).to_be_hidden()
        expect(cta).to_have_attribute("href", MEMBER_CTA)


def _expect_logged_in(page) -> None:
    expect(page.locator("#homeLogoutBtn")).to_be_visible()
    expect(page.locator("#homeLogoutBtn")).to_have_text("Log Out")
    expect(page.locator("#homeLoginLink")).to_be_hidden()
    expect(page.locator("a.landing-hero__cta.home-cta--member")).to_be_visible()
    expect(page.locator("a.landing-offer__cta.home-cta--member")).to_be_visible()
    expect(page.locator("a.landing-hero__cta.home-cta--member")).to_have_attribute("href", MEMBER_CTA)
    expect(page.locator("a.landing-offer__cta.home-cta--member")).to_have_attribute("href", MEMBER_CTA)
    expect(page.locator("a.home-cta--guest")).to_have_count(2)
    for cta in page.locator("a.home-cta--guest").all():
        expect(cta).to_be_hidden()


def _access_cookie(page):
    matches = [cookie for cookie in page.context.cookies() if cookie.get("name") == "access_token"]
    return matches[0] if matches else None


def _ignore_me_failure(guard) -> None:
    guard.network = [row for row in guard.network if "/api/auth/me" not in row]
    guard.console = [
        row
        for row in guard.console
        if "/api/auth/me" not in row.lower() and "failed to load resource" not in row.lower()
    ]


@pytest.mark.smoke_title("Logged-out homepage offers login and setup")
def test_logged_out_homepage_shows_login_and_setup(page, guard):
    with page.expect_response(lambda res: "/api/auth/me" in res.url and res.request.method == "GET") as me:
        response = page.goto("/")
    assert_route_ok(response, "/")
    assert me.value.status == 401
    _expect_logged_out(page)
    stored = _tokens(page)
    assert stored["session"] == ""
    assert stored["local"] == ""
    guard.assert_clean()


@pytest.mark.smoke_title("Stored bearer token shows the signed-in homepage")
def test_valid_bearer_token_shows_logout_and_calendar(page, guard, seed):
    login(page, seed["active"]["email"], seed["active"]["password"])
    token = _tokens(page)["session"]
    assert token
    page.context.clear_cookies()
    assert _access_cookie(page) is None
    with page.expect_response(lambda res: "/api/auth/me" in res.url and res.request.method == "GET") as me:
        response = page.goto("/")
    assert_route_ok(response, "/")
    assert me.value.status == 200
    assert me.value.request.headers.get("authorization") == f"Bearer {token}"
    _expect_logged_in(page)
    assert _tokens(page)["session"] == token
    guard.assert_clean()


@pytest.mark.smoke_title("Cookie-only session shows the signed-in homepage")
def test_cookie_only_session_shows_logout_and_calendar(page, guard, seed, browser):
    login(page, seed["active"]["email"], seed["active"]["password"])
    cookie = _access_cookie(page)
    assert cookie is not None
    fresh = browser.new_context()
    fresh.add_cookies([cookie])
    returned = fresh.new_page()
    try:
        with returned.expect_response(lambda res: "/api/auth/me" in res.url and res.request.method == "GET") as me:
            response = returned.goto(SMOKE_ORIGIN + "/")
        assert_route_ok(response, "/")
        assert me.value.status == 200
        assert "authorization" not in {key.lower() for key in me.value.request.headers}
        stored = returned.evaluate(
            """() => ({
              session: sessionStorage.getItem("bw_api_access_token") || "",
              local: localStorage.getItem("bw_api_access_token") || "",
            })"""
        )
        assert stored["session"] == ""
        assert stored["local"] == ""
        _expect_logged_in(returned)
    finally:
        fresh.close()
    guard.assert_clean()


@pytest.mark.smoke_title("Stale stored token is cleared after 401")
def test_stale_token_401_clears_storage_and_shows_login(page, guard):
    response = page.goto("/")
    assert_route_ok(response, "/")
    page.evaluate(
        """() => {
          sessionStorage.setItem("bw_api_access_token", "stale-session-token");
          localStorage.setItem("bw_api_access_token", "stale-local-token");
        }"""
    )
    with page.expect_response(lambda res: "/api/auth/me" in res.url and res.request.method == "GET") as me:
        page.reload()
    assert me.value.status == 401
    _expect_logged_out(page)
    stored = _tokens(page)
    assert stored["session"] == ""
    assert stored["local"] == ""
    guard.assert_clean()


@pytest.mark.smoke_title("Homepage logout ends the session")
def test_homepage_logout_returns_to_logged_out_state(page, guard, seed):
    login(page, seed["active"]["email"], seed["active"]["password"])
    response = page.goto("/")
    assert_route_ok(response, "/")
    _expect_logged_in(page)
    with page.expect_response(lambda res: "/api/auth/logout" in res.url and res.request.method == "POST") as logout:
        page.locator("#homeLogoutBtn").click()
    assert logout.value.status == 200
    page.wait_for_url(lambda url: url.rstrip("/").endswith(":8765") or url.rstrip("/").endswith(SMOKE_ORIGIN.rstrip("/")))
    _expect_logged_out(page)
    stored = _tokens(page)
    assert stored["session"] == ""
    assert stored["local"] == ""
    assert _access_cookie(page) is None
    guard.assert_clean()


@pytest.mark.smoke_title("Back and Forward show the current homepage session")
def test_back_forward_shows_current_homepage_session(page, guard, seed):
    response = page.goto("/")
    assert_route_ok(response, "/")
    _expect_logged_out(page)
    learn = page.goto("/learn/")
    assert_route_ok(learn, "/learn/")
    logged_in = page.evaluate(
        """async ({ email, password }) => {
          const res = await fetch("/api/auth/login", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ email, password, keep_me_logged_in: false }),
          });
          const data = await res.json();
          sessionStorage.setItem("bw_api_access_token", data.access_token);
          return res.status;
        }""",
        {"email": seed["active"]["email"], "password": seed["active"]["password"]},
    )
    assert logged_in == 200
    page.go_back()
    page.wait_for_url(lambda url: url.rstrip("/").endswith(":8765") or url.rstrip("/").endswith(SMOKE_ORIGIN.rstrip("/")))
    _expect_logged_in(page)

    learn_again = page.goto("/learn/")
    assert_route_ok(learn_again, "/learn/")
    page.evaluate(
        """async () => {
          await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
          sessionStorage.removeItem("bw_api_access_token");
          localStorage.removeItem("bw_api_access_token");
        }"""
    )
    page.go_back()
    _expect_logged_out(page)
    page.go_forward()
    page.wait_for_url(lambda url: "/learn/" in url)
    page.go_back()
    _expect_logged_out(page)
    stored = _tokens(page)
    assert stored["session"] == ""
    assert stored["local"] == ""
    guard.assert_clean()


@pytest.mark.smoke_title("Auth check failure keeps a stored homepage session")
def test_me_failure_does_not_clear_stored_session(page, guard):
    response = page.goto("/")
    assert_route_ok(response, "/")
    page.evaluate(
        """() => {
          sessionStorage.setItem("bw_api_access_token", "kept-session-token");
          localStorage.setItem("bw_api_access_token", "kept-local-token");
        }"""
    )

    def fail_me(route):
        if route.request.method == "GET" and "/api/auth/me" in route.request.url:
            route.fulfill(status=503, content_type="application/json", body="{}")
            return
        route.continue_()

    page.route("**/api/auth/me", fail_me)
    with page.expect_response(lambda res: "/api/auth/me" in res.url and res.request.method == "GET") as me:
        page.reload()
    assert me.value.status == 503
    _expect_logged_in(page)
    stored = _tokens(page)
    assert stored["session"] == "kept-session-token"
    assert stored["local"] == "kept-local-token"

    def drop_me(route):
        if route.request.method == "GET" and "/api/auth/me" in route.request.url:
            route.abort()
            return
        route.continue_()

    page.unroute("**/api/auth/me", fail_me)
    page.route("**/api/auth/me", drop_me)
    page.reload()
    _expect_logged_in(page)
    stored = _tokens(page)
    assert stored["session"] == "kept-session-token"
    assert stored["local"] == "kept-local-token"
    _ignore_me_failure(guard)
    guard.assert_clean()
