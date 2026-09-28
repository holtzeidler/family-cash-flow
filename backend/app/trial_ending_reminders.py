"""Send the 3-day trial reminder once per trial.

This is a one-shot command for the staging Render cron job. It does not run
on login, and it does not start from the web process.

Safety:
- Refuses to run unless TRIAL_ENDING_REMINDERS_ENABLED=1.
- Refuses the production database unless TRIAL_ENDING_REMINDERS_ALLOW_PRODUCTION=1
  (that flag is not set on the staging cron).
- On staging, sends only to STAGING_AUTH_EMAIL_ALLOWLIST. An empty allowlist
  sends nobody.
- Records a row in lifecycle_email_sends after a successful send. The unique
  key is the family's existing trial end, so the reminder goes out once.

Preview the template with POST /api/platform/email-test?template=trial-ending.
That route does not call this job.
"""

from __future__ import annotations

import logging
import os
import sys

logger = logging.getLogger("balancewhiz.trial_reminder")

REMINDER_KIND = "trial_ending_3d"


def _enabled(name: str) -> bool:
    return (os.environ.get(name) or "").strip() == "1"


def refusal_reason() -> str:
    """Empty when this process may send. Does not change billing or access."""
    from .main import (
        _database_identity,
        _host_label_matches,
        _is_staging_deployment,
        settings,
    )

    if not _enabled("TRIAL_ENDING_REMINDERS_ENABLED"):
        return "TRIAL_ENDING_REMINDERS_ENABLED is not 1"
    if _host_label_matches(settings.PRODUCTION_DATABASE_HOST, _database_identity()):
        if not _enabled("TRIAL_ENDING_REMINDERS_ALLOW_PRODUCTION"):
            return "refusing the production database"
    if not _is_staging_deployment() and not _enabled("TRIAL_ENDING_REMINDERS_ALLOW_PRODUCTION"):
        return "lifecycle reminders are only scheduled for staging"
    return ""


def _allowlist_blocks(email: str) -> bool:
    """True when this staging recipient must not be emailed."""
    from .main import _is_staging_deployment, _staging_auth_email_allowlist

    if not _is_staging_deployment():
        return False
    allow = _staging_auth_email_allowlist()
    if not allow:
        return True
    return (email or "").strip().lower() not in allow


def run(*, dry_run: bool = False) -> int:
    """Send or list due reminders. Returns a process exit code."""
    from sqlalchemy.exc import IntegrityError

    from .billing_entitlement import (
        family_billing_payload,
        family_owner_user,
        trial_end_idempotency_key,
        trial_ending_reminder_applies,
        trial_ends_at,
    )
    from .email_service import EmailNotConfigured, EmailSendError, send_trial_ending_email
    from .email_templates import resolve_app_url
    from .main import (
        Base,
        Family,
        LifecycleEmailSend,
        SessionLocal,
        _is_staging_deployment,
        engine,
        select,
        settings,
    )

    reason = refusal_reason()
    if reason:
        logger.warning("Trial reminder job skipped: %s", reason)
        print(f"skipped: {reason}")
        return 1

    if not dry_run and not (settings.RESEND_API_KEY or "").strip():
        print("skipped: RESEND_API_KEY is not set")
        return 1

    Base.metadata.create_all(bind=engine)
    app_url = resolve_app_url(
        is_staging_deployment=_is_staging_deployment(),
        app_public_base_url=settings.APP_PUBLIC_BASE_URL,
    )
    sent = 0
    skipped = 0
    failed = 0

    with SessionLocal() as db:
        families = db.execute(select(Family).order_by(Family.id.asc())).scalars().all()
        for family in families:
            try:
                payload = family_billing_payload(db, family_id=int(family.id))
            except Exception:
                db.rollback()
                logger.exception("Trial reminder skipped family_id=%s", family.id)
                skipped += 1
                continue
            if not trial_ending_reminder_applies(payload):
                continue
            owner = family_owner_user(db, int(family.id))
            email = (getattr(owner, "email", None) or "").strip() if owner is not None else ""
            if owner is None or "@" not in email:
                skipped += 1
                continue
            if _allowlist_blocks(email):
                skipped += 1
                continue
            end = trial_ends_at(family.created_at)
            key = trial_end_idempotency_key(family.created_at)
            if end is None or not key:
                skipped += 1
                continue
            already = db.execute(
                select(LifecycleEmailSend.id).where(
                    LifecycleEmailSend.family_id == int(family.id),
                    LifecycleEmailSend.kind == REMINDER_KIND,
                    LifecycleEmailSend.trial_end_key == key,
                )
            ).first()
            if already:
                skipped += 1
                continue
            if dry_run:
                print(f"would send family_id={family.id} user_id={owner.id}")
                sent += 1
                continue
            try:
                send_trial_ending_email(
                    api_key=settings.RESEND_API_KEY,
                    to_addr=email,
                    app_url=app_url,
                    first_name=getattr(owner, "first_name", "") or "",
                    trial_ends_on=end,
                    reply_to=(settings.TRANSACTIONAL_REPLY_TO or "").strip() or None,
                )
            except (EmailNotConfigured, EmailSendError):
                logger.exception("Trial reminder send failed family_id=%s", family.id)
                failed += 1
                continue
            db.add(
                LifecycleEmailSend(
                    family_id=int(family.id),
                    user_id=int(owner.id),
                    kind=REMINDER_KIND,
                    trial_end_key=key,
                )
            )
            try:
                db.commit()
            except IntegrityError:
                db.rollback()
                logger.info("Trial reminder already recorded family_id=%s", family.id)
                skipped += 1
                continue
            sent += 1
            logger.info("Trial reminder sent family_id=%s user_id=%s", family.id, owner.id)

    mode = "dry-run" if dry_run else "sent"
    print(f"{mode}={sent} skipped={skipped} failed={failed}")
    return 2 if failed else 0


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")
    args = list(sys.argv[1:] if argv is None else argv)
    dry_run = "--dry-run" in args
    return run(dry_run=dry_run)


if __name__ == "__main__":
    raise SystemExit(main())
