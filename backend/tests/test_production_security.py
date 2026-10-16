"""Production refuses unsafe login and webhook configuration.

These tests use stand-in values. They do not read hosted credentials.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import sys
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from app.production_security import (  # noqa: E402
    ProductionSecurityError,
    WebhookRejected,
    assert_production_secrets,
    parse_stripe_webhook,
)

_JWT = "unit-test-jwt-not-a-credential"
_WEBHOOK = "whsec_unit_test_not_a_credential"


def _sign(payload: bytes, secret: str, timestamp: int | None = None) -> str:
    stamp = int(time.time()) if timestamp is None else int(timestamp)
    signed = f"{stamp}.".encode() + payload
    digest = hmac.new(secret.encode(), signed, hashlib.sha256).hexdigest()
    return f"t={stamp},v1={digest}"


def _event_id(event) -> str:
    if isinstance(event, dict):
        return str(event.get("id") or "")
    return str(getattr(event, "id", "") or "")


def test_production_refuses_missing_jwt_secret():
    with pytest.raises(ProductionSecurityError, match="JWT_SECRET"):
        assert_production_secrets(env="production", jwt_secret="", webhook_secret=_WEBHOOK)
    with pytest.raises(ProductionSecurityError, match="JWT_SECRET"):
        assert_production_secrets(env="production", jwt_secret="   ", webhook_secret=_WEBHOOK)
    with pytest.raises(ProductionSecurityError, match="JWT_SECRET"):
        assert_production_secrets(env="production", jwt_secret=None, webhook_secret=_WEBHOOK)


def test_production_refuses_default_jwt_secret():
    with pytest.raises(ProductionSecurityError, match="default login secret") as raised:
        assert_production_secrets(
            env="production",
            jwt_secret="change-me-in-production",
            webhook_secret=_WEBHOOK,
        )
    assert _WEBHOOK not in str(raised.value)


def test_production_accepts_a_unique_jwt_secret():
    assert_production_secrets(env="production", jwt_secret=_JWT, webhook_secret=_WEBHOOK)


def test_production_refuses_missing_webhook_secret():
    with pytest.raises(ProductionSecurityError, match="STRIPE_WEBHOOK_SECRET") as raised:
        assert_production_secrets(env="production", jwt_secret=_JWT, webhook_secret="")
    assert _JWT not in str(raised.value)
    with pytest.raises(ProductionSecurityError, match="STRIPE_WEBHOOK_SECRET"):
        assert_production_secrets(env=" Production ", jwt_secret=_JWT, webhook_secret="  ")


def test_development_and_test_envs_keep_local_defaults():
    assert_production_secrets(env="development", jwt_secret="change-me-in-production", webhook_secret="")
    assert_production_secrets(env="test", jwt_secret="", webhook_secret="")
    assert_production_secrets(env="", jwt_secret=None, webhook_secret=None)


def test_production_rejects_unsigned_webhook_when_secret_missing():
    payload = b'{"id":"evt_unsigned","object":"event","type":"ping"}'
    with pytest.raises(WebhookRejected, match="signature is required") as raised:
        parse_stripe_webhook(
            env="production",
            payload=payload,
            signature=_sign(payload, _WEBHOOK),
            webhook_secret="",
        )
    assert raised.value.status_code == 400
    assert _WEBHOOK not in str(raised.value)


def test_production_rejects_missing_and_invalid_signatures():
    payload = b'{"id":"evt_bad","object":"event","type":"ping","data":{"object":{}}}'
    with pytest.raises(WebhookRejected, match="Missing Stripe-Signature") as missing:
        parse_stripe_webhook(env="production", payload=payload, signature=None, webhook_secret=_WEBHOOK)
    assert missing.value.status_code == 400
    with pytest.raises(WebhookRejected, match="Invalid signature") as invalid:
        parse_stripe_webhook(
            env="production",
            payload=payload,
            signature=_sign(payload, "whsec_other_unit_test"),
            webhook_secret=_WEBHOOK,
        )
    assert invalid.value.status_code == 400
    assert _WEBHOOK not in str(invalid.value)


def test_production_accepts_a_valid_signature():
    payload = json.dumps(
        {"id": "evt_signed", "object": "event", "type": "ping", "data": {"object": {}}}
    ).encode()
    event = parse_stripe_webhook(
        env="production",
        payload=payload,
        signature=_sign(payload, _WEBHOOK),
        webhook_secret=_WEBHOOK,
    )
    assert _event_id(event) == "evt_signed"


def test_signed_webhook_with_invalid_json_is_rejected():
    payload = b"not-json"
    with pytest.raises(WebhookRejected, match="Invalid payload") as raised:
        parse_stripe_webhook(
            env="production",
            payload=payload,
            signature=_sign(payload, _WEBHOOK),
            webhook_secret=_WEBHOOK,
        )
    assert raised.value.status_code == 400


def test_development_allows_unsigned_payloads_only_without_a_secret():
    payload = json.dumps(
        {"id": "evt_local", "object": "event", "type": "ping", "data": {"object": {}}}
    ).encode()
    event = parse_stripe_webhook(env="development", payload=payload, signature=None, webhook_secret="")
    assert _event_id(event) == "evt_local"
    with pytest.raises(WebhookRejected, match="Invalid payload"):
        parse_stripe_webhook(env="test", payload=b"not-json", signature=None, webhook_secret="")
    with pytest.raises(WebhookRejected, match="Missing Stripe-Signature"):
        parse_stripe_webhook(env="development", payload=payload, signature=None, webhook_secret=_WEBHOOK)


def test_web_startup_checks_secrets_before_serving(monkeypatch):
    if "app.main" not in sys.modules:
        sys.path.insert(0, str(ROOT / "e2e"))
        from smoke_guard import apply_safe_environment, assert_process_is_safe, smoke_db_path

        db = smoke_db_path("balancewhiz-smoke-security.db")
        db.parent.mkdir(parents=True, exist_ok=True)
        apply_safe_environment(db)
        assert_process_is_safe(db)
    from app.main import startup_populate_schema
    from app import production_security

    seen = {}

    def boom(**kwargs):
        seen.update(kwargs)
        raise production_security.ProductionSecurityError("stopped for test")

    monkeypatch.setattr(production_security, "assert_production_secrets", boom)
    with pytest.raises(ProductionSecurityError, match="stopped for test"):
        startup_populate_schema()
    assert set(seen) == {"env", "jwt_secret", "webhook_secret"}
    assert seen["env"]
    assert "change-me-in-production" not in "stopped for test"
