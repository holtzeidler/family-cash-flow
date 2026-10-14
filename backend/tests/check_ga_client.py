"""Load GA helpers in a local browser and prove staging-like hosts do not call Google.

Does not use the production measurement ID's network endpoint. Hostname is
127.0.0.1, which the tag treats the same way as staging.balancewhiz.com.
"""

from __future__ import annotations

import json
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
FRONTEND = ROOT / "frontend"
BROWSER = (
    ROOT
    / "e2e/.playwright-browsers/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell"
)
REDIRECTS = (
    "login/index.html",
    "signup/index.html",
    "plan/index.html",
    "settings/billing/index.html",
    "checkout/success/index.html",
)


def main() -> None:
    for rel in REDIRECTS:
        text = (FRONTEND / rel).read_text()
        if "ga.js" in text or "googletagmanager" in text:
            raise SystemExit(f"{rel} still loads Google Analytics")
    privacy = (FRONTEND / "privacy.html").read_text()
    if "Google Analytics" not in privacy or "product usage" not in privacy:
        raise SystemExit("privacy page is missing the Google Analytics disclosure")

    handler = partial(SimpleHTTPRequestHandler, directory=str(FRONTEND))
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    google_hits: list[str] = []
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(executable_path=str(BROWSER), headless=True)
            page = browser.new_page()
            page.on(
                "request",
                lambda req: google_hits.append(req.url)
                if "google-analytics.com" in req.url or "googletagmanager.com" in req.url
                else None,
            )
            page.goto(f"http://127.0.0.1:{port}/privacy.html?token=secret#reset", wait_until="load")
            result = page.evaluate(
                """() => {
                  const ga = window.bwGa;
                  const calls = [];
                  const fake = function () { calls.push(Array.from(arguments)); };
                  const monthly = ga.purchaseParams({
                    transaction_id: "in_1AaBbCcDdEeFfGgHh",
                    plan: "monthly",
                    value: 99999,
                    email: "person@example.com",
                  });
                  const session = ga.purchaseParams({
                    transaction_id: "cs_test_checkoutsession",
                    plan: "monthly",
                  });
                  const hit = ga.pageHit(
                    {
                      hostname: "balancewhiz.com",
                      pathname: "/invite/",
                      search: "?token=secret",
                      hash: "#x",
                      origin: "https://balancewhiz.com",
                    },
                    "https://example.com/reset?token=abc#frag"
                  );
                  const staging = ga.dispatch(
                    "staging.balancewhiz.com",
                    fake,
                    "sign_up",
                    ga.signUpParams()
                  );
                  const sent = ga.dispatch("balancewhiz.com", fake, "purchase", monthly);
                  const again = ga.notePurchase({
                    transaction_id: "in_1AaBbCcDdEeFfGgHh",
                    plan: "annual",
                  });
                  const clickCalls = [];
                  const realClick = ga.noteSignUpClick;
                  ga.noteSignUpClick = function () { clickCalls.push("click"); return false; };
                  document.addEventListener("click", function (event) { event.preventDefault(); }, true);
                  const signupLink = document.createElement("a");
                  signupLink.href = "/account-setup/?fresh=1&email=person@example.com&token=secret";
                  signupLink.textContent = "See my future balance";
                  document.body.appendChild(signupLink);
                  signupLink.click();
                  const otherLink = document.createElement("a");
                  otherLink.href = "/plans/?email=person@example.com";
                  document.body.appendChild(otherLink);
                  otherLink.click();
                  ga.noteSignUpClick = realClick;
                  const tracked = [];
                  ga.track = function (name, params) { tracked.push([name, params]); return true; };
                  const firstClick = ga.noteSignUpClick();
                  const secondClick = ga.noteSignUpClick();
                  const subCalls = [];
                  const sub = ga.dispatch(
                    "balancewhiz.com",
                    function () { subCalls.push(Array.from(arguments)); },
                    "subscription_started",
                    ga.purchaseParams({
                      transaction_id: "in_1AaBbCcDdEeFfGgHh",
                      plan: "monthly",
                      value: 99999,
                      email: "person@example.com",
                    })
                  );
                  return {
                    host: location.hostname,
                    production: ga.isProductionHost(location.hostname),
                    stagingHost: ga.isProductionHost("staging.balancewhiz.com"),
                    liveHost: ga.isProductionHost("balancewhiz.com"),
                    gtag: typeof window.gtag,
                    googleScript: [...document.scripts].some((s) => String(s.src).includes("googletagmanager")),
                    monthly,
                    session,
                    hit,
                    staging,
                    sent,
                    calls,
                    again,
                    stored: localStorage.getItem("bw_ga_purchase_in_1AaBbCcDdEeFfGgHh"),
                    signUp: ga.signUpParams(),
                    trial: ga.trialStartedParams(),
                    onboarding: ga.onboardingParams(),
                    signupHref: ga.isSignupHref("/account-setup/?fresh=1&email=person@example.com&token=secret"),
                    queryHref: ga.isSignupHref("https://balancewhiz.com/plans/?email=person@example.com"),
                    clickCalls,
                    firstClick,
                    secondClick,
                    tracked,
                    sub,
                    subCalls,
                  };
                }"""
            )
            for path in ("/login/", "/signup/?fresh=1", "/plan/", "/settings/billing/?section=billing"):
                page.goto(f"http://127.0.0.1:{port}{path}", wait_until="load")
            page.goto(
                f"http://127.0.0.1:{port}/checkout/success/?session_id=cs_test_secret",
                wait_until="commit",
            )
            page.wait_for_url("**/settings/**")
            browser.close()
    finally:
        server.shutdown()

    print(json.dumps({"google_hits": google_hits, "result": result}, indent=2))
    if google_hits:
        raise SystemExit("Google was contacted")
    if result["production"] or not result["liveHost"] or result["stagingHost"]:
        raise SystemExit("host gate failed")
    if result["gtag"] != "undefined" or result["googleScript"]:
        raise SystemExit("gtag loaded off production")
    if result["monthly"]["value"] != 5.99 or "email" in result["monthly"]:
        raise SystemExit("purchase payload leaked a non-public value")
    if result["session"] is not None or result["staging"] is not None or result["calls"][0][0] != "event":
        raise SystemExit("event gate failed")
    if result["sent"]["transaction_id"] != "in_1AaBbCcDdEeFfGgHh" or result["sent"]["value"] != 5.99:
        raise SystemExit("purchase dispatch changed the public price")
    if "email" in result["sent"] or result["again"] or result["stored"]:
        raise SystemExit("staging host recorded a purchase")
    if result["hit"]["page_location"] != "https://balancewhiz.com/invite/" or "token" in json.dumps(result["hit"]):
        raise SystemExit("page hit kept a query or hash")
    if result["hit"]["page_referrer"] != "https://example.com/reset":
        raise SystemExit("referrer kept a query or hash")
    if not result["signupHref"] or result["queryHref"] or result["clickCalls"] != ["click"]:
        raise SystemExit("signup click tracking did not stay on the signup link")
    if result["firstClick"] is not True or result["secondClick"] is not False or len(result["tracked"]) != 1:
        raise SystemExit("signup click was not limited to one event")
    if result["tracked"][0][0] != "sign_up_click" or result["tracked"][0][1] != {"method": "cta"}:
        raise SystemExit("signup click sent more than the click method")
    if result["sub"]["value"] != 5.99 or result["subCalls"][0][1] != "subscription_started" or "email" in result["sub"]:
        raise SystemExit("subscription event was not limited to the public plan")
    print("ga client checks passed")


if __name__ == "__main__":
    main()
