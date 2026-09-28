"""Centralized Resend transactional email for BalanceWhiz.

Future product emails should call send_templated_email() / send_transactional_email()
rather than talking to Resend directly. This module never logs RESEND_API_KEY.

Signup sends the Welcome email once, including the trial end date. Do not add a
separate trial-started message. The 3-day trial reminder and the 7-day annual
renewal reminder are separate sends from the same scheduled job — never from
login. A failed subscription payment sends once per invoice from the Stripe
webhook. A user-scheduled cancellation sends once per cancellation from the Stripe
subscription update. The trial-expired note sends once from the same scheduled job
as the 3-day reminder, after the trial timestamp has passed. A subscription ended
by unpaid retries sends once when Stripe deletes it for payment_failed and the
account is already view-only. A reversed cancellation and a paid return from
view-only each send once from the Stripe event that confirmed them. A saved
payment method replacement sends once from the Stripe event that changed the
default payment method id. Preview sends stay on POST /api/platform/email-test.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime
from typing import Any, Optional

from .email_templates import (
    PRODUCTION_APP_URL,
    TransactionalEmailContent,
    build_annual_renewal_email_content,
    build_payment_failed_email_content,
    build_payment_method_updated_email_content,
    build_plan_selection_email_content,
    build_subscription_canceled_email_content,
    build_subscription_ended_nonpayment_email_content,
    build_subscription_reactivated_email_content,
    build_trial_ending_email_content,
    build_trial_expired_email_content,
    build_welcome_email_content,
    render_transactional_email,
    resolve_app_url,
)

logger = logging.getLogger(__name__)

DEFAULT_FROM = "BalanceWhiz <notifications@updates.balancewhiz.com>"
# Published support mailbox on the public site (contact / privacy / terms).
DEFAULT_REPLY_TO = "support@balancewhiz.com"
TEST_TO = "tracy@balancewhiz.com"
# Preview/test sends only (POST /api/platform/email-test). Microsoft treats
# staging.balancewhiz.com CTAs as high-confidence phish. Real transactional
# mail must keep using resolve_app_url() / the caller-supplied app_url.
STAGING_EMAIL_PREVIEW_APP_URL = PRODUCTION_APP_URL

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
    app_url: str,
    from_addr: str = DEFAULT_FROM,
    reply_to: Optional[str] = DEFAULT_REPLY_TO,
) -> str:
    """Render the shared transactional template and send HTML + plain text."""
    html_body, text_body = render_transactional_email(content, app_url=app_url)
    return send_transactional_email(
        api_key=api_key,
        to_addr=to_addr,
        subject=content.subject,
        text_body=text_body,
        from_addr=from_addr,
        html_body=html_body,
        reply_to=reply_to,
    )


def send_welcome_email(
    *,
    api_key: str,
    to_addr: str,
    app_url: str,
    first_name: str = "",
    from_addr: str = DEFAULT_FROM,
    reply_to: Optional[str] = DEFAULT_REPLY_TO,
    trial_days: Optional[int] = None,
    trial_ends_on: Optional[datetime] = None,
) -> str:
    """Send the Welcome email. This is also the trial-start confirmation."""
    from .billing_catalog import TRIAL_DAYS

    days = int(trial_days) if trial_days is not None else int(TRIAL_DAYS)
    content = build_welcome_email_content(
        app_url=app_url,
        first_name=first_name,
        trial_days=days,
        trial_ends_on=trial_ends_on,
    )
    return send_templated_email(
        api_key=api_key,
        to_addr=to_addr,
        content=content,
        app_url=app_url,
        from_addr=from_addr,
        reply_to=reply_to,
    )


def send_trial_ending_email(
    *,
    api_key: str,
    to_addr: str,
    app_url: str,
    first_name: str = "",
    trial_ends_on: Optional[datetime] = None,
    from_addr: str = DEFAULT_FROM,
    reply_to: Optional[str] = DEFAULT_REPLY_TO,
) -> str:
    """Send the 3-day trial reminder. Caller enforces eligibility and one-send-per-trial."""
    content = build_trial_ending_email_content(
        app_url=app_url,
        first_name=first_name,
        trial_ends_on=trial_ends_on,
    )
    return send_templated_email(
        api_key=api_key,
        to_addr=to_addr,
        content=content,
        app_url=app_url,
        from_addr=from_addr,
        reply_to=reply_to,
    )


def send_trial_expired_email(
    *,
    api_key: str,
    to_addr: str,
    app_url: str,
    from_addr: str = DEFAULT_FROM,
    reply_to: Optional[str] = DEFAULT_REPLY_TO,
) -> str:
    """Tell a view-only account the trial ended. Caller checks eligibility and idempotency."""
    content = build_trial_expired_email_content(app_url=app_url)
    return send_templated_email(
        api_key=api_key,
        to_addr=to_addr,
        content=content,
        app_url=app_url,
        from_addr=from_addr,
        reply_to=reply_to,
    )


PLAN_SELECTED_KIND = "plan_selected"


def send_plan_selection_email(
    *,
    api_key: str,
    to_addr: str,
    app_url: str,
    first_name: str = "",
    plan_label: str,
    price_display: str,
    trial_ends_on: Optional[datetime] = None,
    renews_each: str = "month",
    from_addr: str = DEFAULT_FROM,
    reply_to: Optional[str] = DEFAULT_REPLY_TO,
) -> str:
    """Confirm a plan chosen during the free trial. Caller checks eligibility and idempotency."""
    content = build_plan_selection_email_content(
        app_url=app_url,
        first_name=first_name,
        plan_label=plan_label,
        price_display=price_display,
        trial_ends_on=trial_ends_on,
        renews_each=renews_each,
    )
    return send_templated_email(
        api_key=api_key,
        to_addr=to_addr,
        content=content,
        app_url=app_url,
        from_addr=from_addr,
        reply_to=reply_to,
    )


def send_annual_renewal_email(
    *,
    api_key: str,
    to_addr: str,
    app_url: str,
    renews_on: Optional[datetime] = None,
    renewal_amount: str,
    from_addr: str = DEFAULT_FROM,
    reply_to: Optional[str] = DEFAULT_REPLY_TO,
) -> str:
    """Remind an annual subscriber before renewal. Caller checks eligibility and idempotency."""
    content = build_annual_renewal_email_content(
        app_url=app_url,
        renews_on=renews_on,
        renewal_amount=renewal_amount,
    )
    return send_templated_email(
        api_key=api_key,
        to_addr=to_addr,
        content=content,
        app_url=app_url,
        from_addr=from_addr,
        reply_to=reply_to,
    )


PAYMENT_FAILED_KIND = "payment_failed"


def send_payment_failed_email(
    *,
    api_key: str,
    to_addr: str,
    app_url: str,
    plan_label: str,
    amount_display: str,
    payment_on: Optional[datetime] = None,
    from_addr: str = DEFAULT_FROM,
    reply_to: Optional[str] = DEFAULT_REPLY_TO,
) -> str:
    """Tell the subscriber a charge failed. Caller checks eligibility and idempotency."""
    content = build_payment_failed_email_content(
        app_url=app_url,
        plan_label=plan_label,
        amount_display=amount_display,
        payment_on=payment_on,
    )
    return send_templated_email(
        api_key=api_key,
        to_addr=to_addr,
        content=content,
        app_url=app_url,
        from_addr=from_addr,
        reply_to=reply_to,
    )


def maybe_send_payment_failed_email(
    db,
    *,
    family_id: Optional[int],
    lookup_key: Optional[str],
    prior_status: str,
    invoice: Any,
    livemode: Any = None,
    failed_on: Optional[datetime] = None,
) -> None:
    """Send once for the first failed attempt on an invoice. Never raises into the webhook."""
    from sqlalchemy import select
    from sqlalchemy.exc import IntegrityError

    from .billing_entitlement import (
        complimentary_access_is_active,
        family_owner_user,
        payment_failed_email_facts,
    )
    from .main import (
        LifecycleEmailSend,
        _database_identity,
        _host_label_matches,
        _is_staging_deployment,
        _staging_auth_email_allowlist,
        settings,
    )

    if family_id is None:
        return
    facts = payment_failed_email_facts(
        invoice,
        lookup_key=lookup_key,
        prior_status=prior_status,
        failed_on=failed_on,
    )
    if not facts:
        return
    user = family_owner_user(db, int(family_id))
    email = (getattr(user, "email", None) or "").strip() if user is not None else ""
    if user is None or "@" not in email:
        return
    if complimentary_access_is_active(user):
        logger.info("Payment failed email skipped; complimentary access family_id=%s", family_id)
        return

    staging = _is_staging_deployment()
    on_production_db = _host_label_matches(settings.PRODUCTION_DATABASE_HOST, _database_identity())
    if on_production_db and staging:
        logger.info("Payment failed email skipped; staging is pointed at the production database")
        return
    if staging:
        allow = _staging_auth_email_allowlist()
        if not allow or email.lower() not in allow:
            logger.info("Payment failed email skipped; staging allowlist family_id=%s", family_id)
            return
    elif livemode is False:
        logger.info("Payment failed email skipped; test-mode event family_id=%s", family_id)
        return

    invoice_id = str(facts["invoice_id"])
    already = db.execute(
        select(LifecycleEmailSend.id).where(
            LifecycleEmailSend.family_id == int(family_id),
            LifecycleEmailSend.kind == PAYMENT_FAILED_KIND,
            LifecycleEmailSend.trial_end_key == invoice_id,
        )
    ).first()
    if already:
        return
    if not (settings.RESEND_API_KEY or "").strip():
        logger.warning("Payment failed email skipped; RESEND_API_KEY is not set")
        return

    app_url = resolve_app_url(
        is_staging_deployment=staging,
        app_public_base_url=settings.APP_PUBLIC_BASE_URL,
    )
    try:
        send_payment_failed_email(
            api_key=settings.RESEND_API_KEY,
            to_addr=email,
            app_url=app_url,
            plan_label=str(facts["plan_label"]),
            amount_display=str(facts["amount_display"]),
            payment_on=facts.get("failed_on"),
            reply_to=(settings.TRANSACTIONAL_REPLY_TO or "").strip() or None,
        )
    except (EmailNotConfigured, EmailSendError):
        logger.exception("Payment failed email failed family_id=%s", family_id)
        return

    nested = db.begin_nested()
    try:
        db.add(
            LifecycleEmailSend(
                family_id=int(family_id),
                user_id=int(user.id),
                kind=PAYMENT_FAILED_KIND,
                trial_end_key=invoice_id,
            )
        )
        db.flush()
        nested.commit()
    except IntegrityError:
        nested.rollback()
        logger.info("Payment failed email already recorded family_id=%s invoice=%s", family_id, invoice_id)


SUBSCRIPTION_CANCELED_KIND = "subscription_canceled"


def send_subscription_canceled_email(
    *,
    api_key: str,
    to_addr: str,
    app_url: str,
    plan_label: str,
    access_through: Optional[datetime] = None,
    from_addr: str = DEFAULT_FROM,
    reply_to: Optional[str] = DEFAULT_REPLY_TO,
) -> str:
    """Confirm a scheduled cancellation. Caller checks eligibility and idempotency."""
    content = build_subscription_canceled_email_content(
        app_url=app_url,
        plan_label=plan_label,
        access_through=access_through,
    )
    return send_templated_email(
        api_key=api_key,
        to_addr=to_addr,
        content=content,
        app_url=app_url,
        from_addr=from_addr,
        reply_to=reply_to,
    )


def maybe_send_subscription_canceled_email(
    db,
    *,
    family_id: Optional[int],
    subscription: Any,
    livemode: Any = None,
) -> None:
    """Send once after Stripe schedules a user cancellation. Never raises into billing."""
    from sqlalchemy import select
    from sqlalchemy.exc import IntegrityError

    from .billing_entitlement import (
        complimentary_access_is_active,
        family_owner_user,
        subscription_cancel_email_facts,
    )
    from .main import (
        LifecycleEmailSend,
        _database_identity,
        _host_label_matches,
        _is_staging_deployment,
        _staging_auth_email_allowlist,
        settings,
    )

    if family_id is None or subscription is None:
        return
    facts = subscription_cancel_email_facts(subscription)
    if not facts:
        return
    user = family_owner_user(db, int(family_id))
    email = (getattr(user, "email", None) or "").strip() if user is not None else ""
    if user is None or "@" not in email:
        return
    if complimentary_access_is_active(user):
        logger.info("Cancellation email skipped; complimentary access family_id=%s", family_id)
        return

    staging = _is_staging_deployment()
    on_production_db = _host_label_matches(settings.PRODUCTION_DATABASE_HOST, _database_identity())
    if on_production_db and staging:
        logger.info("Cancellation email skipped; staging is pointed at the production database")
        return
    if staging:
        allow = _staging_auth_email_allowlist()
        if not allow or email.lower() not in allow:
            logger.info("Cancellation email skipped; staging allowlist family_id=%s", family_id)
            return
    elif livemode is False:
        logger.info("Cancellation email skipped; test-mode event family_id=%s", family_id)
        return

    key = str(facts["idempotency_key"])
    already = db.execute(
        select(LifecycleEmailSend.id).where(
            LifecycleEmailSend.family_id == int(family_id),
            LifecycleEmailSend.kind == SUBSCRIPTION_CANCELED_KIND,
            LifecycleEmailSend.trial_end_key == key,
        )
    ).first()
    if already:
        return
    if not (settings.RESEND_API_KEY or "").strip():
        logger.warning("Cancellation email skipped; RESEND_API_KEY is not set")
        return

    app_url = resolve_app_url(
        is_staging_deployment=staging,
        app_public_base_url=settings.APP_PUBLIC_BASE_URL,
    )
    try:
        send_subscription_canceled_email(
            api_key=settings.RESEND_API_KEY,
            to_addr=email,
            app_url=app_url,
            plan_label=str(facts["plan_label"]),
            access_through=facts.get("access_through"),
            reply_to=(settings.TRANSACTIONAL_REPLY_TO or "").strip() or None,
        )
    except (EmailNotConfigured, EmailSendError):
        logger.exception("Cancellation email failed family_id=%s", family_id)
        return

    nested = db.begin_nested()
    try:
        db.add(
            LifecycleEmailSend(
                family_id=int(family_id),
                user_id=int(user.id),
                kind=SUBSCRIPTION_CANCELED_KIND,
                trial_end_key=key,
            )
        )
        db.flush()
        nested.commit()
    except IntegrityError:
        nested.rollback()
        logger.info("Cancellation email already recorded family_id=%s", family_id)


SUBSCRIPTION_ENDED_NONPAYMENT_KIND = "sub_ended_nonpayment"


def send_subscription_ended_nonpayment_email(
    *,
    api_key: str,
    to_addr: str,
    app_url: str,
    from_addr: str = DEFAULT_FROM,
    reply_to: Optional[str] = DEFAULT_REPLY_TO,
) -> str:
    """Tell the subscriber unpaid retries ended the subscription. Caller checks eligibility."""
    content = build_subscription_ended_nonpayment_email_content(app_url=app_url)
    return send_templated_email(
        api_key=api_key,
        to_addr=to_addr,
        content=content,
        app_url=app_url,
        from_addr=from_addr,
        reply_to=reply_to,
    )


def maybe_send_subscription_ended_nonpayment_email(
    db,
    *,
    family_id: Optional[int],
    subscription: Any,
    livemode: Any = None,
) -> None:
    """Send once after Stripe ends a subscription for nonpayment. Never raises into the webhook."""
    from sqlalchemy import select
    from sqlalchemy.exc import IntegrityError

    from .billing_entitlement import (
        complimentary_access_is_active,
        family_billing_payload,
        family_owner_user,
        subscription_ended_nonpayment_email_facts,
        view_only_after_subscription_ended,
    )
    from .main import (
        LifecycleEmailSend,
        _database_identity,
        _host_label_matches,
        _is_staging_deployment,
        _staging_auth_email_allowlist,
        settings,
    )

    if family_id is None or subscription is None:
        return
    facts = subscription_ended_nonpayment_email_facts(subscription)
    if not facts:
        return
    try:
        payload = family_billing_payload(db, family_id=int(family_id))
    except Exception:
        logger.exception("Subscription ended email skipped; billing status unread family_id=%s", family_id)
        return
    if not view_only_after_subscription_ended(payload):
        logger.info("Subscription ended email skipped; account is not view-only family_id=%s", family_id)
        return
    user = family_owner_user(db, int(family_id))
    email = (getattr(user, "email", None) or "").strip() if user is not None else ""
    if user is None or "@" not in email:
        return
    if complimentary_access_is_active(user):
        logger.info("Subscription ended email skipped; complimentary access family_id=%s", family_id)
        return

    staging = _is_staging_deployment()
    on_production_db = _host_label_matches(settings.PRODUCTION_DATABASE_HOST, _database_identity())
    if on_production_db and staging:
        logger.info("Subscription ended email skipped; staging is pointed at the production database")
        return
    if staging:
        allow = _staging_auth_email_allowlist()
        if not allow or email.lower() not in allow:
            logger.info("Subscription ended email skipped; staging allowlist family_id=%s", family_id)
            return
    elif livemode is False:
        logger.info("Subscription ended email skipped; test-mode event family_id=%s", family_id)
        return

    sub_id = str(facts["subscription_id"])
    already = db.execute(
        select(LifecycleEmailSend.id).where(
            LifecycleEmailSend.family_id == int(family_id),
            LifecycleEmailSend.kind == SUBSCRIPTION_ENDED_NONPAYMENT_KIND,
            LifecycleEmailSend.trial_end_key == sub_id,
        )
    ).first()
    if already:
        return
    if not (settings.RESEND_API_KEY or "").strip():
        logger.warning("Subscription ended email skipped; RESEND_API_KEY is not set")
        return

    app_url = resolve_app_url(
        is_staging_deployment=staging,
        app_public_base_url=settings.APP_PUBLIC_BASE_URL,
    )
    try:
        send_subscription_ended_nonpayment_email(
            api_key=settings.RESEND_API_KEY,
            to_addr=email,
            app_url=app_url,
            reply_to=(settings.TRANSACTIONAL_REPLY_TO or "").strip() or None,
        )
    except (EmailNotConfigured, EmailSendError):
        logger.exception("Subscription ended email failed family_id=%s", family_id)
        return

    nested = db.begin_nested()
    try:
        db.add(
            LifecycleEmailSend(
                family_id=int(family_id),
                user_id=int(user.id),
                kind=SUBSCRIPTION_ENDED_NONPAYMENT_KIND,
                trial_end_key=sub_id,
            )
        )
        db.flush()
        nested.commit()
    except IntegrityError:
        nested.rollback()
        logger.info("Subscription ended email already recorded family_id=%s", family_id)


SUBSCRIPTION_RESUMED_KIND = "subscription_resumed"
SUBSCRIPTION_RESTORED_KIND = "subscription_restored"


def send_subscription_reactivated_email(
    *,
    api_key: str,
    to_addr: str,
    app_url: str,
    resumed: bool,
    plan_label: str,
    amount_display: str,
    renews_on: Optional[datetime] = None,
    from_addr: str = DEFAULT_FROM,
    reply_to: Optional[str] = DEFAULT_REPLY_TO,
) -> str:
    """Confirm a resume or a paid restore. Caller checks eligibility and idempotency."""
    content = build_subscription_reactivated_email_content(
        app_url=app_url,
        resumed=resumed,
        plan_label=plan_label,
        amount_display=amount_display,
        renews_on=renews_on,
    )
    return send_templated_email(
        api_key=api_key,
        to_addr=to_addr,
        content=content,
        app_url=app_url,
        from_addr=from_addr,
        reply_to=reply_to,
    )


def _reactivation_recipient(db, *, family_id: int, user_id: Optional[int], livemode: Any) -> Optional[tuple]:
    """Return (user, email, app_url) when this reactivation may be emailed."""
    from .billing_entitlement import complimentary_access_is_active, family_owner_user
    from .main import (
        User,
        _database_identity,
        _host_label_matches,
        _is_staging_deployment,
        _staging_auth_email_allowlist,
        settings,
    )

    user = db.get(User, int(user_id)) if user_id else None
    if user is None:
        user = family_owner_user(db, int(family_id))
    email = (getattr(user, "email", None) or "").strip() if user is not None else ""
    if user is None or "@" not in email:
        return None
    if complimentary_access_is_active(user):
        logger.info("Reactivation email skipped; complimentary access family_id=%s", family_id)
        return None
    staging = _is_staging_deployment()
    on_production_db = _host_label_matches(settings.PRODUCTION_DATABASE_HOST, _database_identity())
    if on_production_db and staging:
        logger.info("Reactivation email skipped; staging is pointed at the production database")
        return None
    if staging:
        allow = _staging_auth_email_allowlist()
        if not allow or email.lower() not in allow:
            logger.info("Reactivation email skipped; staging allowlist family_id=%s", family_id)
            return None
    elif livemode is False:
        logger.info("Reactivation email skipped; test-mode event family_id=%s", family_id)
        return None
    if not (settings.RESEND_API_KEY or "").strip():
        logger.warning("Reactivation email skipped; RESEND_API_KEY is not set")
        return None
    app_url = resolve_app_url(
        is_staging_deployment=staging,
        app_public_base_url=settings.APP_PUBLIC_BASE_URL,
    )
    return user, email, app_url


def _record_reactivation_email(db, *, family_id: int, user_id: int, kind: str, key: str) -> None:
    from sqlalchemy.exc import IntegrityError

    from .main import LifecycleEmailSend

    nested = db.begin_nested()
    try:
        db.add(
            LifecycleEmailSend(
                family_id=int(family_id),
                user_id=int(user_id),
                kind=kind,
                trial_end_key=key,
            )
        )
        db.flush()
        nested.commit()
    except IntegrityError:
        nested.rollback()
        logger.info("Reactivation email already recorded family_id=%s kind=%s", family_id, kind)


def maybe_send_subscription_resumed_email(
    db,
    *,
    family_id: Optional[int],
    subscription: Any,
    previous: Any,
    livemode: Any = None,
) -> None:
    """Send once after Stripe clears a scheduled cancellation. Never raises into the webhook."""
    from sqlalchemy import select

    from .billing_entitlement import subscription_resume_email_facts
    from .main import LifecycleEmailSend, settings

    if family_id is None or subscription is None:
        return
    facts = subscription_resume_email_facts(subscription, previous)
    if not facts:
        return
    key = str(facts["idempotency_key"])
    already = db.execute(
        select(LifecycleEmailSend.id).where(
            LifecycleEmailSend.family_id == int(family_id),
            LifecycleEmailSend.kind == SUBSCRIPTION_RESUMED_KIND,
            LifecycleEmailSend.trial_end_key == key,
        )
    ).first()
    if already:
        return
    recipient = _reactivation_recipient(db, family_id=int(family_id), user_id=None, livemode=livemode)
    if recipient is None:
        return
    user, email, app_url = recipient
    try:
        send_subscription_reactivated_email(
            api_key=settings.RESEND_API_KEY,
            to_addr=email,
            app_url=app_url,
            resumed=True,
            plan_label=str(facts["plan_label"]),
            amount_display=str(facts["amount_display"]),
            renews_on=facts.get("renews_on"),
            reply_to=(settings.TRANSACTIONAL_REPLY_TO or "").strip() or None,
        )
    except (EmailNotConfigured, EmailSendError):
        logger.exception("Subscription resumed email failed family_id=%s", family_id)
        return
    _record_reactivation_email(
        db,
        family_id=int(family_id),
        user_id=int(user.id),
        kind=SUBSCRIPTION_RESUMED_KIND,
        key=key,
    )


def maybe_send_subscription_restored_email(
    db,
    *,
    family_id: Optional[int],
    user_id: Optional[int],
    subscription: Any,
    prior_status: str,
    amount_cents: Any,
    payment_status: str,
    livemode: Any = None,
) -> None:
    """Send once after a paid Checkout replaces a canceled subscription. Never raises."""
    from sqlalchemy import select

    from .billing_entitlement import subscription_restore_email_facts
    from .main import LifecycleEmailSend, settings

    if family_id is None or subscription is None:
        return
    facts = subscription_restore_email_facts(
        subscription,
        prior_status=prior_status,
        amount_cents=amount_cents,
        payment_status=payment_status,
    )
    if not facts:
        return
    key = str(facts["idempotency_key"])
    already = db.execute(
        select(LifecycleEmailSend.id).where(
            LifecycleEmailSend.family_id == int(family_id),
            LifecycleEmailSend.kind == SUBSCRIPTION_RESTORED_KIND,
            LifecycleEmailSend.trial_end_key == key,
        )
    ).first()
    if already:
        return
    recipient = _reactivation_recipient(
        db, family_id=int(family_id), user_id=user_id, livemode=livemode
    )
    if recipient is None:
        return
    user, email, app_url = recipient
    try:
        send_subscription_reactivated_email(
            api_key=settings.RESEND_API_KEY,
            to_addr=email,
            app_url=app_url,
            resumed=False,
            plan_label=str(facts["plan_label"]),
            amount_display=str(facts["amount_display"]),
            renews_on=facts.get("renews_on"),
            reply_to=(settings.TRANSACTIONAL_REPLY_TO or "").strip() or None,
        )
    except (EmailNotConfigured, EmailSendError):
        logger.exception("Subscription restored email failed family_id=%s", family_id)
        return
    _record_reactivation_email(
        db,
        family_id=int(family_id),
        user_id=int(user.id),
        kind=SUBSCRIPTION_RESTORED_KIND,
        key=key,
    )


PAYMENT_METHOD_UPDATED_KIND = "payment_method_updated"


def send_payment_method_updated_email(
    *,
    api_key: str,
    to_addr: str,
    app_url: str,
    card_label: str = "",
    support_email: str = "",
    from_addr: str = DEFAULT_FROM,
    reply_to: Optional[str] = DEFAULT_REPLY_TO,
) -> str:
    """Confirm a replaced saved payment method. Caller checks eligibility and idempotency."""
    content = build_payment_method_updated_email_content(
        app_url=app_url,
        card_label=card_label,
        support_email=support_email or reply_to or DEFAULT_REPLY_TO,
    )
    return send_templated_email(
        api_key=api_key,
        to_addr=to_addr,
        content=content,
        app_url=app_url,
        from_addr=from_addr,
        reply_to=reply_to,
    )


def _payment_method_card_label(payment_method_id: str) -> str:
    """Read brand and last 4 from Stripe. Empty when the card fields are unavailable."""
    from .billing_entitlement import safe_payment_method_label
    from .main import settings

    pm_id = (payment_method_id or "").strip()
    if not pm_id.startswith("pm_"):
        return ""
    if not (settings.STRIPE_SECRET_KEY or "").strip():
        return ""
    try:
        import stripe

        stripe.api_key = settings.STRIPE_SECRET_KEY
        pm = stripe.PaymentMethod.retrieve(pm_id)
    except Exception:
        logger.info("Payment method label unavailable")
        return ""
    return safe_payment_method_label(pm) or ""


def maybe_send_payment_method_updated_email(
    db,
    *,
    family_id: Optional[int],
    customer_id: str,
    source: Any,
    previous: Any,
    livemode: Any = None,
    changed_on: Optional[datetime] = None,
) -> None:
    """Send once after a saved default payment method id is replaced. Never raises."""
    from sqlalchemy import select
    from sqlalchemy.exc import IntegrityError

    from .billing_entitlement import (
        family_owner_user,
        payment_method_update_email_key,
        replaced_default_payment_method,
        resolve_family_id_for_customer,
    )
    from .main import (
        LifecycleEmailSend,
        _database_identity,
        _host_label_matches,
        _is_staging_deployment,
        _staging_auth_email_allowlist,
        settings,
    )

    pair = replaced_default_payment_method(source, previous)
    if not pair:
        return
    old_id, new_id = pair
    when = changed_on if isinstance(changed_on, datetime) else None
    key = payment_method_update_email_key(old_id, new_id, when)
    fam = int(family_id) if family_id else None
    if fam is None and (customer_id or "").strip():
        fam = resolve_family_id_for_customer(db, stripe_customer_id=str(customer_id).strip())
    if fam is None:
        logger.info("Payment method email skipped; no family for this customer")
        return
    already = db.execute(
        select(LifecycleEmailSend.id).where(
            LifecycleEmailSend.family_id == fam,
            LifecycleEmailSend.kind == PAYMENT_METHOD_UPDATED_KIND,
            LifecycleEmailSend.trial_end_key == key,
        )
    ).first()
    if already:
        return
    user = family_owner_user(db, fam)
    email = (getattr(user, "email", None) or "").strip() if user is not None else ""
    if user is None or "@" not in email:
        return
    staging = _is_staging_deployment()
    on_production_db = _host_label_matches(settings.PRODUCTION_DATABASE_HOST, _database_identity())
    if on_production_db and staging:
        logger.info("Payment method email skipped; staging is pointed at the production database")
        return
    if staging:
        allow = _staging_auth_email_allowlist()
        if not allow or email.lower() not in allow:
            logger.info("Payment method email skipped; staging allowlist family_id=%s", fam)
            return
    elif livemode is False:
        logger.info("Payment method email skipped; test-mode event family_id=%s", fam)
        return
    if not (settings.RESEND_API_KEY or "").strip():
        logger.warning("Payment method email skipped; RESEND_API_KEY is not set")
        return
    app_url = resolve_app_url(
        is_staging_deployment=staging,
        app_public_base_url=settings.APP_PUBLIC_BASE_URL,
    )
    support = (settings.TRANSACTIONAL_REPLY_TO or "").strip() or DEFAULT_REPLY_TO
    try:
        send_payment_method_updated_email(
            api_key=settings.RESEND_API_KEY,
            to_addr=email,
            app_url=app_url,
            card_label=_payment_method_card_label(new_id),
            support_email=support,
            reply_to=support,
        )
    except (EmailNotConfigured, EmailSendError):
        logger.exception("Payment method email failed family_id=%s", fam)
        return
    nested = db.begin_nested()
    try:
        db.add(
            LifecycleEmailSend(
                family_id=fam,
                user_id=int(user.id),
                kind=PAYMENT_METHOD_UPDATED_KIND,
                trial_end_key=key,
            )
        )
        db.flush()
        nested.commit()
    except IntegrityError:
        nested.rollback()
        logger.info("Payment method email already recorded family_id=%s", fam)


def maybe_send_plan_selection_email(
    db,
    *,
    family_id: Optional[int],
    user_id: Optional[int],
    subscription: Any,
    livemode: Any = None,
) -> None:
    """Send once after a trialing subscription is confirmed. Never raises into the webhook."""
    from sqlalchemy import select
    from sqlalchemy.exc import IntegrityError

    from .billing_entitlement import (
        family_owner_user,
        is_in_app_trial,
        subscription_plan_display,
        trial_end_idempotency_key,
        trial_ends_at,
    )
    from .main import Family, LifecycleEmailSend, User, _database_identity, _host_label_matches, _is_staging_deployment, _staging_auth_email_allowlist, settings

    if family_id is None or subscription is None:
        return
    status = ""
    status_raw = getattr(subscription, "status", None)
    if status_raw is None and isinstance(subscription, dict):
        status_raw = subscription.get("status")
    status = str(status_raw or "").strip().lower()
    if status != "trialing":
        return
    family = db.get(Family, int(family_id))
    if family is None or not is_in_app_trial(getattr(family, "created_at", None)):
        return
    trial_end = trial_ends_at(getattr(family, "created_at", None))
    trial_key = trial_end_idempotency_key(getattr(family, "created_at", None))
    plan = subscription_plan_display(subscription)
    if trial_end is None or not trial_key or not plan:
        logger.info("Plan selection email skipped; missing trial date or Stripe price family_id=%s", family_id)
        return

    user = db.get(User, int(user_id)) if user_id else None
    if user is None:
        user = family_owner_user(db, int(family_id))
    email = (getattr(user, "email", None) or "").strip() if user is not None else ""
    if "@" not in email:
        return

    staging = _is_staging_deployment()
    on_production_db = _host_label_matches(settings.PRODUCTION_DATABASE_HOST, _database_identity())
    if on_production_db and staging:
        logger.info("Plan selection email skipped; staging is pointed at the production database")
        return
    if staging:
        allow = _staging_auth_email_allowlist()
        if not allow or email.lower() not in allow:
            logger.info("Plan selection email skipped; staging allowlist family_id=%s", family_id)
            return
    elif livemode is False:
        logger.info("Plan selection email skipped; test-mode event family_id=%s", family_id)
        return

    already = db.execute(
        select(LifecycleEmailSend.id).where(
            LifecycleEmailSend.family_id == int(family_id),
            LifecycleEmailSend.kind == PLAN_SELECTED_KIND,
            LifecycleEmailSend.trial_end_key == trial_key,
        )
    ).first()
    if already:
        return
    if not (settings.RESEND_API_KEY or "").strip():
        logger.warning("Plan selection email skipped; RESEND_API_KEY is not set")
        return

    app_url = resolve_app_url(
        is_staging_deployment=staging,
        app_public_base_url=settings.APP_PUBLIC_BASE_URL,
    )
    try:
        send_plan_selection_email(
            api_key=settings.RESEND_API_KEY,
            to_addr=email,
            app_url=app_url,
            first_name=getattr(user, "first_name", "") or "",
            plan_label=plan["plan_label"],
            price_display=plan["price_display"],
            trial_ends_on=trial_end,
            renews_each=plan["renews_each"],
            reply_to=(settings.TRANSACTIONAL_REPLY_TO or "").strip() or None,
        )
    except (EmailNotConfigured, EmailSendError):
        logger.exception("Plan selection email failed family_id=%s", family_id)
        return

    nested = db.begin_nested()
    try:
        db.add(
            LifecycleEmailSend(
                family_id=int(family_id),
                user_id=int(user.id),
                kind=PLAN_SELECTED_KIND,
                trial_end_key=trial_key,
            )
        )
        db.flush()
        nested.commit()
    except IntegrityError:
        nested.rollback()
        logger.info("Plan selection email already recorded family_id=%s", family_id)


def send_staging_test_email(
    *,
    api_key: str,
    template: str = "welcome",
    to_addr: str = TEST_TO,
    from_addr: str = DEFAULT_FROM,
    reply_to: Optional[str] = DEFAULT_REPLY_TO,
) -> str:
    """Staging-only template preview. Recipient is fixed; no product triggers.

    Link destinations always use STAGING_EMAIL_PREVIEW_APP_URL, never the
    staging app host. send_welcome_email() itself is unchanged.
    """
    from datetime import timedelta

    from .billing_entitlement import trial_ends_at

    preview_url = STAGING_EMAIL_PREVIEW_APP_URL
    kind = (template or "welcome").strip().lower()
    if kind == "welcome":
        return send_welcome_email(
            api_key=api_key,
            to_addr=to_addr or TEST_TO,
            app_url=preview_url,
            first_name="Tracy",
            from_addr=from_addr or DEFAULT_FROM,
            reply_to=reply_to,
            trial_ends_on=trial_ends_at(datetime.utcnow()),
        )
    if kind in ("trial-ending", "trial_ending"):
        # Sample date for the preview only. Real sends use trial_ends_at(family.created_at).
        return send_trial_ending_email(
            api_key=api_key,
            to_addr=to_addr or TEST_TO,
            app_url=preview_url,
            first_name="Tracy",
            trial_ends_on=datetime.utcnow() + timedelta(days=3),
            from_addr=from_addr or DEFAULT_FROM,
            reply_to=reply_to,
        )
    if kind in ("trial-expired", "trial_expired"):
        return send_trial_expired_email(
            api_key=api_key,
            to_addr=to_addr or TEST_TO,
            app_url=preview_url,
            from_addr=from_addr or DEFAULT_FROM,
            reply_to=reply_to,
        )
    if kind in ("plan-monthly", "plan-annual"):
        from .billing_catalog import LOOKUP_ANNUAL, LOOKUP_MONTHLY, price_for_lookup

        lookup = LOOKUP_ANNUAL if kind == "plan-annual" else LOOKUP_MONTHLY
        info = price_for_lookup(lookup) or {}
        interval = str(info.get("interval") or "month")
        amount = str(info.get("amount_usd") or "").strip()
        price_display = f"${amount}/year" if interval == "year" else f"${amount}/month"
        # Sample date only. Real sends use trial_ends_at(family.created_at) and the Stripe Price.
        return send_plan_selection_email(
            api_key=api_key,
            to_addr=to_addr or TEST_TO,
            app_url=preview_url,
            first_name="Tracy",
            plan_label="Annual" if interval == "year" else "Monthly",
            price_display=price_display,
            trial_ends_on=trial_ends_at(datetime.utcnow()),
            renews_each=interval,
            from_addr=from_addr or DEFAULT_FROM,
            reply_to=reply_to,
        )
    if kind in ("annual-renewal", "annual_renewal"):
        from .billing_catalog import LOOKUP_ANNUAL, price_for_lookup

        info = price_for_lookup(LOOKUP_ANNUAL) or {}
        amount = str(info.get("amount_usd") or "").strip()
        # Sample amount and date only. Real sends use the Stripe Price and current_period_end.
        return send_annual_renewal_email(
            api_key=api_key,
            to_addr=to_addr or TEST_TO,
            app_url=preview_url,
            renews_on=datetime.utcnow() + timedelta(days=7),
            renewal_amount=f"${amount}" if amount else "",
            from_addr=from_addr or DEFAULT_FROM,
            reply_to=reply_to,
        )
    if kind in ("payment-failed-monthly", "payment-failed-annual"):
        from .billing_catalog import LOOKUP_ANNUAL, LOOKUP_MONTHLY, price_for_lookup

        annual = kind == "payment-failed-annual"
        info = price_for_lookup(LOOKUP_ANNUAL if annual else LOOKUP_MONTHLY) or {}
        amount = str(info.get("amount_usd") or "").strip()
        # Sample amount and date only. Real sends use the failed Stripe invoice.
        return send_payment_failed_email(
            api_key=api_key,
            to_addr=to_addr or TEST_TO,
            app_url=preview_url,
            plan_label="Annual" if annual else "Monthly",
            amount_display=f"${amount}" if amount else "",
            payment_on=datetime.utcnow(),
            from_addr=from_addr or DEFAULT_FROM,
            reply_to=reply_to,
        )
    if kind in ("cancel-monthly", "cancel-annual"):
        from datetime import timedelta

        annual = kind == "cancel-annual"
        # Sample date only. Real sends use the Stripe subscription period end.
        access_through = datetime.utcnow() + timedelta(days=365 if annual else 30)
        return send_subscription_canceled_email(
            api_key=api_key,
            to_addr=to_addr or TEST_TO,
            app_url=preview_url,
            plan_label="Annual" if annual else "Monthly",
            access_through=access_through,
            from_addr=from_addr or DEFAULT_FROM,
            reply_to=reply_to,
        )
    if kind in ("subscription-ended", "subscription_ended"):
        return send_subscription_ended_nonpayment_email(
            api_key=api_key,
            to_addr=to_addr or TEST_TO,
            app_url=preview_url,
            from_addr=from_addr or DEFAULT_FROM,
            reply_to=reply_to,
        )
    if kind in ("payment-method-updated", "payment_method_updated"):
        # Sample card only. Real sends use Stripe brand and last 4 when present.
        support = (reply_to or DEFAULT_REPLY_TO or "").strip()
        return send_payment_method_updated_email(
            api_key=api_key,
            to_addr=to_addr or TEST_TO,
            app_url=preview_url,
            card_label="Visa ending in 4242",
            support_email=support,
            from_addr=from_addr or DEFAULT_FROM,
            reply_to=reply_to,
        )
    if kind in ("reactivate-resumed", "reactivate-restored"):
        from datetime import timedelta

        from .billing_catalog import LOOKUP_ANNUAL, LOOKUP_MONTHLY, price_for_lookup

        resumed = kind == "reactivate-resumed"
        info = price_for_lookup(LOOKUP_MONTHLY if resumed else LOOKUP_ANNUAL) or {}
        amount = str(info.get("amount_usd") or "").strip()
        # Sample amount and date only. Real sends use the Stripe price or Checkout amount.
        return send_subscription_reactivated_email(
            api_key=api_key,
            to_addr=to_addr or TEST_TO,
            app_url=preview_url,
            resumed=resumed,
            plan_label="Monthly" if resumed else "Annual",
            amount_display=f"${amount}" if amount else "",
            renews_on=datetime.utcnow() + timedelta(days=30 if resumed else 365),
            from_addr=from_addr or DEFAULT_FROM,
            reply_to=reply_to,
        )
    content = TransactionalEmailContent(
        subject="BalanceWhiz email design test",
        preheader="Your BalanceWhiz email setup is ready.",
        heading="Your forecast is ready.",
        body="BalanceWhiz helps you see what's coming before it hits your checking account.",
        cta_label="View my forecast",
        cta_url=preview_url,
        support_line="Questions? Just reply to this email.",
    )
    return send_templated_email(
        api_key=api_key,
        to_addr=to_addr or TEST_TO,
        content=content,
        app_url=preview_url,
        from_addr=from_addr or DEFAULT_FROM,
        reply_to=reply_to,
    )
