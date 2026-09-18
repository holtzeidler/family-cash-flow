"""Centralized Resend transactional email for BalanceWhiz.

Future product emails should call send_templated_email() / send_transactional_email()
rather than talking to Resend directly. This module never logs RESEND_API_KEY.

The first consumer is a temporary staging-only design test. Do not wire this to
signup, Stripe, or scheduled mail from here.
"""

from __future__ import annotations

import logging
import re
from typing import Optional

from .email_templates import TransactionalEmailContent, render_transactional_email

logger = logging.getLogger(__name__)

DEFAULT_FROM = "BalanceWhiz <notifications@updates.balancewhiz.com>"
# Published support mailbox on the public site (contact / privacy / terms).
DEFAULT_REPLY_TO = "support@balancewhiz.com"
TEST_TO = "tracy@balancewhiz.com"

_SECRETISH = re.compile(
    r"(?i)(re_[A-Za-z0-9]+|(?:api[_-]?key|authorization|bearer)\s*[:=]\s*\S+)"
)


class EmailNotConfigured(RuntimeError):
    """RESEND_API_KEY is missing or blank."""


class EmailSendError(RuntimeError):
    """Resend rejected the send or the request failed."""


def _safe_error_text(exc: BaseException) -> str:
    text = str(exc or "")[:500]
    return _SECRETISH.sub("[redacted]", text)


def transactional_email_allowed(*, env: str, is_staging_deployment: bool) -> bool:
    """True only for staging hosts or local/dev/staging ENV — never production."""
    if is_staging_deployment:
        return True
    env_l = (env or "").strip().lower()
    return env_l in ("development", "dev", "staging", "local")


def send_transactional_email(
    *,
    api_key: str,
    to_addr: str,
    subject: str,
    text_body: str,
    from_addr: str = DEFAULT_FROM,
    html_body: Optional[str] = None,
    reply_to: Optional[str] = DEFAULT_REPLY_TO,
) -> str:
    """Send one email via the official Resend SDK. Returns the Resend email id."""
    key = (api_key or "").strip()
    if not key:
        logger.error("Resend send skipped: RESEND_API_KEY is not set")
        raise EmailNotConfigured("RESEND_API_KEY is not set")

    to_clean = (to_addr or "").strip()
    from_clean = (from_addr or "").strip() or DEFAULT_FROM
    if not to_clean:
        logger.error("Resend send skipped: recipient is empty")
        raise EmailSendError("Recipient is empty")
    if not (subject or "").strip():
        raise EmailSendError("Subject is empty")
    if not (text_body or "").strip():
        raise EmailSendError("Plain-text body is empty")

    import resend

    resend.api_key = key
    params: dict = {
        "from": from_clean,
        "to": [to_clean],
        "subject": subject.strip(),
        "text": text_body,
    }
    if html_body:
        params["html"] = html_body
    reply_clean = (reply_to or "").strip()
    if reply_clean:
        params["reply_to"] = reply_clean

    try:
        result = resend.Emails.send(params)
    except Exception as exc:
        logger.warning("Resend send failed: %s", _safe_error_text(exc))
        raise EmailSendError(_safe_error_text(exc)[:400]) from None

    email_id = ""
    if isinstance(result, dict):
        email_id = str(result.get("id") or "")
    else:
        email_id = str(getattr(result, "id", "") or "")

    logger.info("Resend email sent id=%s to=%s", email_id or "(unknown)", to_clean)
    return email_id


def send_templated_email(
    *,
    api_key: str,
    to_addr: str,
    content: TransactionalEmailContent,
    from_addr: str = DEFAULT_FROM,
    reply_to: Optional[str] = DEFAULT_REPLY_TO,
) -> str:
    """Render the shared transactional template and send HTML + plain text."""
    html_body, text_body = render_transactional_email(content)
    return send_transactional_email(
        api_key=api_key,
        to_addr=to_addr,
        subject=content.subject,
        text_body=text_body,
        from_addr=from_addr,
        html_body=html_body,
        reply_to=reply_to,
    )


def send_staging_test_email(
    *,
    api_key: str,
    to_addr: str = TEST_TO,
    from_addr: str = DEFAULT_FROM,
    reply_to: Optional[str] = DEFAULT_REPLY_TO,
) -> str:
    """Temporary staging design preview. Recipient is fixed; no product triggers."""
    content = TransactionalEmailContent(
        subject="BalanceWhiz email design test",
        preheader="Your BalanceWhiz email setup is ready.",
        heading="Your forecast is ready.",
        body="BalanceWhiz helps you see what's coming before it hits your checking account.",
        cta_label="View my forecast",
        cta_url="https://balancewhiz.com",
        support_line="Questions? Just reply to this email.",
        include_links=False,
    )
    return send_templated_email(
        api_key=api_key,
        to_addr=to_addr or TEST_TO,
        content=content,
        from_addr=from_addr or DEFAULT_FROM,
        reply_to=reply_to,
    )
