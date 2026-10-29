"""Safety checks for the local BalanceWhiz smoke suite.

This module must not import the application. Importing the app reads
backend/.env, which may point at a hosted database.
"""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path

SMOKE_PORT = 8765
SMOKE_ORIGIN = f"http://127.0.0.1:{SMOKE_PORT}"
BOT_EMAIL = re.compile(r"^bw-smoke-[a-z0-9]+@example\.com$")

_FORBIDDEN_BITS = (
    "ep-ancient-union",
    "ep-polished-boat",
    "neon.tech",
    "render.com",
    "balancewhiz.com",
    "postgresql://",
    "postgres://",
    "sk_live",
    "rk_live",
    "sk_test",
    "rk_test",
)

_WATCHED_KEYS = (
    "DATABASE_URL",
    "APP_PUBLIC_BASE_URL",
    "CORS_ORIGINS",
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "RESEND_API_KEY",
    "RESEND_FROM",
    "CONTACT_SMTP_HOST",
    "CONTACT_SMTP_USER",
    "CONTACT_SMTP_PASSWORD",
    "CONTACT_EMAIL_TO",
    "CONTACT_EMAIL_FROM",
    "PLATFORM_ADMIN_EMAILS",
    "STAGING_AUTH_EMAIL_ALLOWLIST",
    "TRANSACTIONAL_REPLY_TO",
    "MAINT_TOKEN",
    "ENV",
    "JWT_SECRET",
)


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def smoke_run_dir() -> Path:
    return Path(__file__).resolve().parent / ".smoke-run"


def smoke_db_path(filename: str = "balancewhiz-smoke.db") -> Path:
    if not filename.startswith("balancewhiz-smoke"):
        raise SystemExit("Smoke test refused to start: unexpected database filename.")
    return smoke_run_dir() / filename


def sqlite_url(path: Path) -> str:
    return "sqlite:///" + str(path.resolve())


def apply_safe_environment(db_path: Path) -> None:
    """Force a local, disposable configuration before the app is imported."""
    os.environ["DATABASE_URL"] = sqlite_url(db_path)
    os.environ["ENV"] = "development"
    os.environ["APP_PUBLIC_BASE_URL"] = SMOKE_ORIGIN
    os.environ["CORS_ORIGINS"] = ""
    os.environ["STRIPE_SECRET_KEY"] = ""
    os.environ["STRIPE_WEBHOOK_SECRET"] = ""
    os.environ["RESEND_API_KEY"] = ""
    os.environ["RESEND_FROM"] = ""
    os.environ["CONTACT_SMTP_HOST"] = ""
    os.environ["CONTACT_SMTP_USER"] = ""
    os.environ["CONTACT_SMTP_PASSWORD"] = ""
    os.environ["CONTACT_EMAIL_TO"] = ""
    os.environ["CONTACT_EMAIL_FROM"] = ""
    os.environ["PLATFORM_ADMIN_EMAILS"] = ""
    os.environ["STAGING_AUTH_EMAIL_ALLOWLIST"] = ""
    os.environ["TRANSACTIONAL_REPLY_TO"] = ""
    os.environ["MAINT_TOKEN"] = ""
    os.environ["JWT_SECRET"] = "balancewhiz-local-smoke-not-for-production"


def assert_bot_email(email: str) -> None:
    if not BOT_EMAIL.fullmatch(email or ""):
        raise SystemExit(
            "Smoke test refused to start: accounts must be bw-smoke-...@example.com, not a real mailbox."
        )


def assert_process_is_safe(db_path: Path) -> None:
    expected = sqlite_url(db_path)
    url = os.environ.get("DATABASE_URL", "")
    resolved = db_path.resolve()
    run_dir = smoke_run_dir().resolve()
    if resolved.parent != run_dir or not resolved.name.startswith("balancewhiz-smoke"):
        raise SystemExit("Smoke test refused to start: database is not inside the local smoke folder.")
    if url != expected or not url.startswith("sqlite:///"):
        raise SystemExit("Smoke test refused to start: database is not the local smoke database.")
    if os.environ.get("ENV") == "production":
        raise SystemExit("Smoke test refused to start: ENV is production.")
    if (os.environ.get("STRIPE_SECRET_KEY") or "").strip():
        raise SystemExit("Smoke test refused to start: a Stripe key is configured.")
    if (os.environ.get("RESEND_API_KEY") or "").strip():
        raise SystemExit("Smoke test refused to start: a Resend key is configured.")
    blob = "\n".join(os.environ.get(key, "") for key in _WATCHED_KEYS).lower()
    for bit in _FORBIDDEN_BITS:
        if bit in blob:
            raise SystemExit(
                "Smoke test refused to start: configuration looks like production, staging, Stripe, or hosted email."
            )


def assert_loaded_settings(
    *,
    database_url: str,
    env: str,
    stripe_key: str,
    resend_key: str,
    smtp_host: str,
    db_filename: str,
) -> None:
    """Confirm the imported app actually honored the safe environment."""
    url = database_url or ""
    if not url.startswith("sqlite") or db_filename not in url:
        raise SystemExit("Smoke test refused to start: the app is not using the local smoke database.")
    low = url.lower()
    for bit in ("neon.tech", "ep-ancient-union", "ep-polished-boat", "balancewhiz.com", "render.com", "postgres"):
        if bit in low:
            raise SystemExit("Smoke test refused to start: the app database looks hosted.")
    if env == "production":
        raise SystemExit("Smoke test refused to start: the app ENV is production.")
    if (stripe_key or "").strip():
        raise SystemExit("Smoke test refused to start: the app has a Stripe key.")
    if (resend_key or "").strip() or (smtp_host or "").strip():
        raise SystemExit("Smoke test refused to start: the app can send email.")


def refuse(message: str) -> None:
    print(message, file=sys.stderr)
    raise SystemExit(1)
