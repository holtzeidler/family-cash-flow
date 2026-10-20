"""Walk the email-verification signup for tests that need a signed-in account.

The confirmation link is taken from the patched sender. It is not printed.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

_UNSET = object()


def signup_verified(
    client,
    *,
    email: str,
    password: str = "SmokeOnly1!",
    first_name: str = "Smoke",
    last_name: str = "Tester",
    onboarding_goals: Any = _UNSET,
    onboarding_goal_other: Any = _UNSET,
    finish: bool = True,
):
    captured: list[dict] = []

    def fake_deliver(**kwargs):
        captured.append(dict(kwargs))
        return "local-not-sent"

    with patch("app.main._deliver_account_email", fake_deliver):
        started = client.post(
            "/api/auth/verification/start",
            json={
                "email": email,
                "password": password,
                "first_name": first_name,
                "last_name": last_name,
            },
        )
    if started.status_code != 200:
        return started
    link = ""
    for item in captured:
        if item.get("kind") == "confirm":
            link = str(item.get("confirm_url") or "")
    token = parse_qs(urlparse(link).query).get("verify", [""])[0]
    if not token:
        raise AssertionError("verification link was not captured")
    verified = client.post("/api/auth/verify-email", json={"token": token})
    if verified.status_code != 200 or not finish:
        return verified
    body: dict = {}
    if onboarding_goals is not _UNSET:
        body["onboarding_goals"] = onboarding_goals
    if onboarding_goal_other is not _UNSET:
        body["onboarding_goal_other"] = onboarding_goal_other
    return client.post("/api/auth/onboarding/complete", json=body)
