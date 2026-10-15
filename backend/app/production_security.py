"""Startup and webhook checks for production.

Error text names the missing setting. It never includes the configured value.
"""

from __future__ import annotations

import json
from typing import Any, Optional

import stripe

# Public placeholder shipped in the repo. Not a credential.
DEFAULT_JWT_PLACEHOLDER = "change-me-in-production"


class ProductionSecurityError(RuntimeError):
    """The web service must not start with this configuration."""


class WebhookRejected(Exception):
    """A webhook was not accepted. status_code and error are safe to return."""

    def __init__(self, status_code: int, error: str):
        super().__init__(error)
        self.status_code = int(status_code)
        self.error = error


def is_production_env(env: Optional[str]) -> bool:
    return (env or "").strip().lower() == "production"


def assert_production_secrets(
    *,
    env: Optional[str],
    jwt_secret: Optional[str],
    webhook_secret: Optional[str],
) -> None:
    """Raise when a production web process would sign tokens or webhooks unsafely."""
    if not is_production_env(env):
        return
    jwt = (jwt_secret or "").strip()
    if not jwt or jwt == DEFAULT_JWT_PLACEHOLDER:
        raise ProductionSecurityError(
            "Refusing to start: set JWT_SECRET to a unique value. "
            "Production cannot use a missing or default login secret."
        )
    if not (webhook_secret or "").strip():
        raise ProductionSecurityError(
            "Refusing to start: set STRIPE_WEBHOOK_SECRET. "
            "Production cannot accept unsigned Stripe webhooks."
        )


def parse_stripe_webhook(
    *,
    env: Optional[str],
    payload: bytes,
    signature: Optional[str],
    webhook_secret: Optional[str],
) -> Any:
    """Verify a Stripe webhook.

    Production always requires a signing secret and a valid signature.
    Other environments verify when a secret is configured, and otherwise
    accept a JSON payload so local tests can run without Stripe credentials.
    """
    secret = (webhook_secret or "").strip()
    if not secret:
        if is_production_env(env):
            raise WebhookRejected(400, "Stripe webhook signature is required")
        try:
            data = json.loads(payload.decode("utf-8"))
        except Exception as exc:
            raise WebhookRejected(400, "Invalid payload") from exc
        if not isinstance(data, dict):
            raise WebhookRejected(400, "Invalid payload")
        return stripe.Event.construct_from(data, stripe.api_key or "")

    sig = (signature or "").strip()
    if not sig:
        raise WebhookRejected(400, "Missing Stripe-Signature header")
    try:
        return stripe.Webhook.construct_event(payload, sig, secret)
    except ValueError as exc:
        raise WebhookRejected(400, "Invalid payload") from exc
    except stripe.error.SignatureVerificationError as exc:
        raise WebhookRejected(400, "Invalid signature") from exc
