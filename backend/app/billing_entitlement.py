"""Server-side Cash Forecast entitlement (trial + Stripe subscription).

DB is the source of truth. Stripe webhooks upsert billing_subscriptions;
GET /api/families/{id}/billing-status reads this module.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from .billing_catalog import (
    ALLOWED_PRICE_LOOKUP_KEYS,
    LOOKUP_ANNUAL,
    LOOKUP_MONTHLY,
    PRODUCT_CODE,
    PRODUCT_NAME,
    TRIAL_DAYS,
)

logger = logging.getLogger("balancewhiz.billing")

# Families with these Stripe statuses still get product access.
ENTITLED_STATUSES = frozenset({"active", "trialing", "past_due"})


def _utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _as_naive_utc(value: Any) -> Optional[datetime]:
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is not None:
            return value.astimezone(timezone.utc).replace(tzinfo=None)
        return value
    if isinstance(value, (int, float)):
        return datetime.utcfromtimestamp(int(value))
    return None


def _obj_get(obj: Any, key: str, default: Any = None) -> Any:
    if obj is None:
        return default
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


def trial_ends_at(family_created_at: Optional[datetime]) -> Optional[datetime]:
    if family_created_at is None:
        return None
    start = family_created_at
    if start.tzinfo is not None:
        start = start.astimezone(timezone.utc).replace(tzinfo=None)
    return start + timedelta(days=int(TRIAL_DAYS))


def is_in_app_trial(family_created_at: Optional[datetime], *, now: Optional[datetime] = None) -> bool:
    end = trial_ends_at(family_created_at)
    if end is None:
        return False
    n = now or _utc_now()
    return n < end


def lookup_key_from_subscription(sub: Any) -> Optional[str]:
    meta = _obj_get(sub, "metadata") or {}
    if hasattr(meta, "get"):
        key = (meta.get("bw_lookup_key") or meta.get("lookup_key") or "").strip()
    else:
        key = ""
    if key in ALLOWED_PRICE_LOOKUP_KEYS:
        return key

    items = _obj_get(sub, "items")
    data = _obj_get(items, "data") if items is not None else None
    if not data and isinstance(items, list):
        data = items
    if not data:
        return None
    first = data[0] if data else None
    price = _obj_get(first, "price")
    if price is None:
        return None
    # Expanded Price object
    lk = (_obj_get(price, "lookup_key") or "").strip()
    if lk in ALLOWED_PRICE_LOOKUP_KEYS:
        return lk
    # Infer from recurring interval when lookup_key missing
    recurring = _obj_get(price, "recurring") or {}
    interval = (_obj_get(recurring, "interval") or "").strip().lower()
    if interval == "year":
        return LOOKUP_ANNUAL
    if interval == "month":
        return LOOKUP_MONTHLY
    return None


def price_id_from_subscription(sub: Any) -> Optional[str]:
    items = _obj_get(sub, "items")
    data = _obj_get(items, "data") if items is not None else None
    if not data and isinstance(items, list):
        data = items
    if not data:
        return None
    first = data[0]
    price = _obj_get(first, "price")
    if isinstance(price, str):
        return price
    pid = _obj_get(price, "id")
    return str(pid) if pid else None


def build_billing_status(*, family, subscription=None, now: Optional[datetime] = None) -> dict[str, Any]:
    """Compute entitlement payload for the Billing UI / future paywall."""
    n = now or _utc_now()
    created = getattr(family, "created_at", None)
    trial_end = trial_ends_at(created)
    in_trial = is_in_app_trial(created, now=n)

    sub_status = (getattr(subscription, "status", None) or "").strip().lower() if subscription else ""
    sub_entitled = sub_status in ENTITLED_STATUSES
    entitled = bool(sub_entitled or in_trial)

    if sub_entitled:
        if sub_status == "past_due":
            phase = "past_due"
        elif sub_status == "trialing":
            phase = "trial"  # Stripe trial (unused in product model, but handle if present)
        else:
            phase = "active"
    elif in_trial:
        phase = "trial"
    else:
        phase = "expired"

    period_end = getattr(subscription, "current_period_end", None) if subscription else None
    cancel_at_period_end = bool(getattr(subscription, "cancel_at_period_end", False)) if subscription else False
    lookup_key = getattr(subscription, "lookup_key", None) if subscription else None
    portal_available = bool(subscription and getattr(subscription, "billing_customer_id", None))

    return {
        "product_code": PRODUCT_CODE,
        "product_name": PRODUCT_NAME,
        "entitled": entitled,
        "phase": phase,
        "trial_days": TRIAL_DAYS,
        "trial_ends_on": trial_end.date().isoformat() if trial_end else None,
        "in_app_trial": in_trial,
        "status": sub_status or ("trialing" if in_trial else "none"),
        "lookup_key": lookup_key,
        "current_period_end": period_end.isoformat() + "Z" if isinstance(period_end, datetime) else None,
        "cancel_at_period_end": cancel_at_period_end,
        "portal_available": portal_available,
        "stripe_subscription_id": getattr(subscription, "stripe_subscription_id", None) if subscription else None,
    }


def webhook_event_already_processed(db, event_id: str) -> bool:
    from sqlalchemy import select

    from .main import StripeWebhookEvent

    eid = (event_id or "").strip()
    if not eid:
        return True
    existing = db.execute(select(StripeWebhookEvent).where(StripeWebhookEvent.event_id == eid)).scalar_one_or_none()
    return existing is not None


def mark_webhook_event_processed(db, *, event_id: str, event_type: str) -> None:
    from sqlalchemy.exc import IntegrityError

    from .main import StripeWebhookEvent

    eid = (event_id or "").strip()
    if not eid:
        return
    row = StripeWebhookEvent(event_id=eid, event_type=(event_type or "")[:120])
    try:
        with db.begin_nested():
            db.add(row)
            db.flush()
    except IntegrityError:
        # Concurrent delivery recorded the same event_id — fine.
        pass


def upsert_billing_customer(db, *, user_id: int, stripe_customer_id: str):
    from .main import BillingCustomer
    from sqlalchemy import select

    cid = (stripe_customer_id or "").strip()
    if not cid:
        return None
    row = db.execute(select(BillingCustomer).where(BillingCustomer.user_id == int(user_id))).scalar_one_or_none()
    if row is None:
        by_stripe = db.execute(
            select(BillingCustomer).where(BillingCustomer.stripe_customer_id == cid)
        ).scalar_one_or_none()
        if by_stripe is not None:
            by_stripe.user_id = int(user_id)
            db.add(by_stripe)
            return by_stripe
        row = BillingCustomer(user_id=int(user_id), stripe_customer_id=cid)
        db.add(row)
        db.flush()
        return row
    if row.stripe_customer_id != cid:
        row.stripe_customer_id = cid
        db.add(row)
    return row


def get_or_create_stripe_customer_for_user(db, *, user, stripe_mod, family_id: Optional[int] = None):
    """Return BillingCustomer row, creating a Stripe Customer when the user has none."""
    from sqlalchemy import select

    from .main import BillingCustomer

    uid = int(user.id)
    row = db.execute(select(BillingCustomer).where(BillingCustomer.user_id == uid)).scalar_one_or_none()
    if row is not None and (row.stripe_customer_id or "").strip():
        return row

    email = (getattr(user, "email", None) or "").strip() or None
    name = (getattr(user, "name", None) or "").strip() or None
    meta = {
        "bw_user_id": str(uid),
        "bw_product_code": PRODUCT_CODE,
    }
    if family_id is not None:
        meta["bw_family_id"] = str(int(family_id))

    create_kwargs: dict[str, Any] = {"metadata": meta}
    if email:
        create_kwargs["email"] = email
    if name:
        create_kwargs["name"] = name

    customer = stripe_mod.Customer.create(**create_kwargs)
    cid = (getattr(customer, "id", None) or "").strip()
    if not cid:
        raise RuntimeError("Stripe Customer.create returned no id")
    return upsert_billing_customer(db, user_id=uid, stripe_customer_id=cid)


def stripe_customer_id_for_family(db, *, family_id: int) -> Optional[str]:
    """Resolve Stripe customer id for portal (via family's subscription → billing customer)."""
    from sqlalchemy import select

    from .main import BillingCustomer, BillingSubscription

    sub = db.execute(
        select(BillingSubscription).where(BillingSubscription.family_id == int(family_id))
    ).scalar_one_or_none()
    if sub is None or not sub.billing_customer_id:
        return None
    cust = db.get(BillingCustomer, int(sub.billing_customer_id))
    if cust is None:
        return None
    cid = (cust.stripe_customer_id or "").strip()
    return cid or None


def _resolve_family_id_from_metadata(meta: Any) -> Optional[int]:
    if not meta:
        return None
    raw = None
    if hasattr(meta, "get"):
        raw = meta.get("bw_family_id") or meta.get("family_id")
    if raw is None:
        return None
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


def _resolve_user_id_from_metadata(meta: Any) -> Optional[int]:
    if not meta:
        return None
    raw = None
    if hasattr(meta, "get"):
        raw = meta.get("bw_user_id") or meta.get("user_id")
    if raw is None:
        return None
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


def resolve_family_id_for_customer(db, *, stripe_customer_id: str, metadata: Any = None) -> Optional[int]:
    from .main import BillingCustomer, BillingSubscription, FamilyMember
    from sqlalchemy import select

    fam = _resolve_family_id_from_metadata(metadata)
    if fam:
        return fam

    uid = _resolve_user_id_from_metadata(metadata)
    customer = None
    cid = (stripe_customer_id or "").strip()
    if cid:
        customer = db.execute(
            select(BillingCustomer).where(BillingCustomer.stripe_customer_id == cid)
        ).scalar_one_or_none()
    if customer is None and uid:
        customer = db.execute(select(BillingCustomer).where(BillingCustomer.user_id == int(uid))).scalar_one_or_none()

    if customer is not None:
        # Prefer an existing subscription for this customer
        sub = db.execute(
            select(BillingSubscription).where(BillingSubscription.billing_customer_id == int(customer.id))
        ).scalar_one_or_none()
        if sub is not None:
            return int(sub.family_id)
        # Else owner's first owned family
        owner_m = (
            db.execute(
                select(FamilyMember)
                .where(FamilyMember.user_id == int(customer.user_id), FamilyMember.is_family_owner == True)  # noqa: E712
                .order_by(FamilyMember.family_id.asc())
            )
            .scalars()
            .first()
        )
        if owner_m is not None:
            return int(owner_m.family_id)
    return None


def upsert_subscription_from_stripe(
    db,
    *,
    sub: Any,
    family_id: Optional[int] = None,
    billing_customer_id: Optional[int] = None,
) -> Any:
    from .main import BillingSubscription
    from sqlalchemy import select

    sub_id = (_obj_get(sub, "id") or "").strip()
    if not sub_id:
        raise ValueError("subscription missing id")

    status = (_obj_get(sub, "status") or "incomplete").strip().lower()
    lookup_key = lookup_key_from_subscription(sub)
    price_id = price_id_from_subscription(sub)
    period_end = _as_naive_utc(_obj_get(sub, "current_period_end"))
    trial_end = _as_naive_utc(_obj_get(sub, "trial_end"))
    cancel_at_period_end = bool(_obj_get(sub, "cancel_at_period_end") or False)

    meta = _obj_get(sub, "metadata")
    fam_id = family_id or _resolve_family_id_from_metadata(meta)
    if fam_id is None:
        cust = _obj_get(sub, "customer")
        cust_id = cust if isinstance(cust, str) else _obj_get(cust, "id")
        fam_id = resolve_family_id_for_customer(db, stripe_customer_id=str(cust_id or ""), metadata=meta)

    row = db.execute(
        select(BillingSubscription).where(BillingSubscription.stripe_subscription_id == sub_id)
    ).scalar_one_or_none()

    if row is None and fam_id is not None:
        # One subscription row per family — reuse if Stripe id rotated
        row = db.execute(
            select(BillingSubscription).where(BillingSubscription.family_id == int(fam_id))
        ).scalar_one_or_none()

    if row is None:
        if fam_id is None:
            logger.warning("Cannot upsert subscription %s — family_id unknown", sub_id)
            return None
        row = BillingSubscription(
            family_id=int(fam_id),
            stripe_subscription_id=sub_id,
            status=status,
        )
        db.add(row)

    row.stripe_subscription_id = sub_id
    row.status = status
    if fam_id is not None:
        row.family_id = int(fam_id)
    if billing_customer_id is not None:
        row.billing_customer_id = int(billing_customer_id)
    if lookup_key:
        row.lookup_key = lookup_key
    if price_id:
        row.stripe_price_id = price_id
    row.current_period_end = period_end
    row.trial_end = trial_end
    row.cancel_at_period_end = cancel_at_period_end
    db.add(row)
    db.flush()
    return row


def handle_stripe_event(db, event: Any, logger_: logging.Logger) -> None:
    """Apply a verified Stripe event to billing tables. Caller commits."""
    from sqlalchemy import select

    from .main import BillingCustomer, BillingSubscription

    event_type = _obj_get(event, "type") or ""
    event_id = _obj_get(event, "id") or ""
    if webhook_event_already_processed(db, str(event_id)):
        logger_.info("Skipping already-processed Stripe event %s", event_id)
        return

    data_obj = _obj_get(event, "data")
    obj = _obj_get(data_obj, "object") if data_obj is not None else None
    if obj is None:
        logger_.warning("Stripe event %s missing data.object", event_id)
        mark_webhook_event_processed(db, event_id=str(event_id), event_type=str(event_type))
        return

    if event_type == "checkout.session.completed":
        mode = (_obj_get(obj, "mode") or "").strip()
        if mode and mode != "subscription":
            mark_webhook_event_processed(db, event_id=str(event_id), event_type=str(event_type))
            return
        customer_id = _obj_get(obj, "customer")
        if isinstance(customer_id, dict):
            customer_id = customer_id.get("id")
        customer_id = str(customer_id or "").strip()
        meta = _obj_get(obj, "metadata") or {}
        user_id = _resolve_user_id_from_metadata(meta)
        family_id = _resolve_family_id_from_metadata(meta)
        billing_customer = None
        if customer_id and user_id:
            billing_customer = upsert_billing_customer(db, user_id=int(user_id), stripe_customer_id=customer_id)
        elif customer_id:
            billing_customer = db.execute(
                select(BillingCustomer).where(BillingCustomer.stripe_customer_id == customer_id)
            ).scalar_one_or_none()

        sub_ref = _obj_get(obj, "subscription")
        sub_id = sub_ref if isinstance(sub_ref, str) else _obj_get(sub_ref, "id")
        if sub_id:
            # Minimal stub until subscription.* events arrive with full object
            stub = {
                "id": str(sub_id),
                "status": "active",
                "customer": customer_id,
                "metadata": meta,
                "cancel_at_period_end": False,
            }
            upsert_subscription_from_stripe(
                db,
                sub=stub,
                family_id=family_id,
                billing_customer_id=int(billing_customer.id) if billing_customer else None,
            )
        mark_webhook_event_processed(db, event_id=str(event_id), event_type=str(event_type))
        return

    if event_type in (
        "customer.subscription.created",
        "customer.subscription.updated",
        "customer.subscription.deleted",
    ):
        customer_id = _obj_get(obj, "customer")
        if isinstance(customer_id, dict):
            customer_id = customer_id.get("id")
        customer_id = str(customer_id or "").strip()
        billing_customer = None
        if customer_id:
            billing_customer = db.execute(
                select(BillingCustomer).where(BillingCustomer.stripe_customer_id == customer_id)
            ).scalar_one_or_none()
            meta = _obj_get(obj, "metadata") or {}
            uid = _resolve_user_id_from_metadata(meta)
            if billing_customer is None and uid and customer_id:
                billing_customer = upsert_billing_customer(db, user_id=int(uid), stripe_customer_id=customer_id)

        if event_type == "customer.subscription.deleted":
            # Force canceled status even if Stripe object still transitional
            if isinstance(obj, dict):
                obj = {**obj, "status": "canceled"}
            else:
                try:
                    obj.status = "canceled"
                except Exception:
                    pass

        upsert_subscription_from_stripe(
            db,
            sub=obj,
            billing_customer_id=int(billing_customer.id) if billing_customer else None,
        )
        mark_webhook_event_processed(db, event_id=str(event_id), event_type=str(event_type))
        return

    if event_type in ("invoice.paid", "invoice.payment_failed"):
        sub_ref = _obj_get(obj, "subscription")
        sub_id = sub_ref if isinstance(sub_ref, str) else _obj_get(sub_ref, "id")
        if not sub_id:
            mark_webhook_event_processed(db, event_id=str(event_id), event_type=str(event_type))
            return
        row = db.execute(
            select(BillingSubscription).where(BillingSubscription.stripe_subscription_id == str(sub_id))
        ).scalar_one_or_none()
        if row is None:
            mark_webhook_event_processed(db, event_id=str(event_id), event_type=str(event_type))
            return
        if event_type == "invoice.paid":
            if row.status in ("past_due", "unpaid", "incomplete"):
                row.status = "active"
            lines = _obj_get(obj, "lines")
            line_data = _obj_get(lines, "data") if lines is not None else None
            if line_data:
                period = _obj_get(line_data[0], "period")
                pe = None
                if isinstance(period, dict):
                    pe = _as_naive_utc(period.get("end"))
                else:
                    pe = _as_naive_utc(_obj_get(period, "end"))
                if pe:
                    row.current_period_end = pe
            db.add(row)
        else:
            row.status = "past_due"
            db.add(row)
        mark_webhook_event_processed(db, event_id=str(event_id), event_type=str(event_type))
        return

    logger_.info("No DB mutation for Stripe event type %s", event_type)
    mark_webhook_event_processed(db, event_id=str(event_id), event_type=str(event_type))
