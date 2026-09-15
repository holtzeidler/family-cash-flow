"""Stripe Checkout + Customer Portal + webhook (subscription billing).

Rebuild status:
- Product model: billing_catalog.py (Cash Forecast monthly/annual, app-side trial)
- Entitlement DB + webhooks: billing_entitlement.py
- Authenticated Checkout: requires login + family owner; Stripe Customer + metadata
- Portal: prefers DB customer for the family; optional legacy session_id fallback
- Remaining: Billing UI off localStorage; Stripe Tax/registrations when ready

Secrets come from env only — never hardcode API keys.
"""

from __future__ import annotations

import logging
from typing import Any, Optional

import stripe
from fastapi import FastAPI, Form, HTTPException, Request, status
from fastapi.responses import JSONResponse, RedirectResponse

from .billing_catalog import (
    ALLOWED_PRICE_LOOKUP_KEYS,
    PRODUCT_CODE,
    PRODUCT_NAME,
    catalog_public,
    frequency_storage_value,
    price_for_lookup,
)
from .billing_entitlement import ENTITLED_STATUSES


def _resume_scheduled_cancel(sid: str, live: Any) -> None:
    """Undo a scheduled cancel without sending cancel_at and cancel_at_period_end together.

    Stripe rejects Subscription.modify when both parameters are present. Setting
    cancel_at_period_end=True also populates cancel_at, so Keep must clear them
    in separate updates.
    """
    cancel_at_end = bool(getattr(live, "cancel_at_period_end", False))
    cancel_at = getattr(live, "cancel_at", None)
    if cancel_at_end:
        live = stripe.Subscription.modify(sid, cancel_at_period_end=False)
        cancel_at = getattr(live, "cancel_at", None)
    if cancel_at:
        stripe.Subscription.modify(sid, cancel_at="")
    elif not cancel_at_end:
        stripe.Subscription.modify(sid, cancel_at_period_end=False)


def register_stripe_routes(
    app: FastAPI,
    settings: Any,
    logger: logging.Logger,
    session_factory: Any = None,
) -> None:
    def _stripe_secret() -> str:
        return (getattr(settings, "STRIPE_SECRET_KEY", None) or "").strip()

    def _webhook_secret() -> str:
        return (getattr(settings, "STRIPE_WEBHOOK_SECRET", None) or "").strip()

    def _public_base() -> str:
        return (getattr(settings, "APP_PUBLIC_BASE_URL", None) or "").strip().rstrip("/")

    def _require_stripe() -> None:
        if not _stripe_secret():
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Stripe is not configured on this server (set STRIPE_SECRET_KEY).",
            )
        stripe.api_key = _stripe_secret()

    def _require_public_base() -> str:
        base = _public_base()
        if not base:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="APP_PUBLIC_BASE_URL is required for Stripe Checkout and Customer Portal redirects.",
            )
        return base

    def _billing_page_url(
        domain: str,
        *,
        family_id: Optional[int] = None,
        checkout: Optional[str] = None,
        portal_return: bool = False,
        session_id_placeholder: bool = False,
        frequency: Optional[str] = None,
    ) -> str:
        """Build Billing URL from APP_PUBLIC_BASE_URL only (never from client input).

        Canonical app route: /settings/billing (current environment origin).
        """
        params: list[str] = []
        if checkout:
            params.append(f"checkout={checkout}")
        if portal_return:
            params.append("portal=return")
        if session_id_placeholder:
            params.append("session_id={CHECKOUT_SESSION_ID}")
        if frequency:
            params.append(f"frequency={frequency}")
        if family_id is not None:
            params.append(f"family_id={int(family_id)}")
        qs = f"?{'&'.join(params)}" if params else ""
        return f"{domain}/settings/billing{qs}"

    @app.get("/api/billing/catalog", include_in_schema=False)
    def billing_catalog():
        """Public product model — Cash Forecast prices + trial policy."""
        return catalog_public()

    def _wants_json(request: Request) -> bool:
        return "application/json" in (request.headers.get("accept") or "").lower()

    def _auth_user_id(request: Request) -> int:
        from .main import _read_access_token_from_request, get_current_user_id

        return get_current_user_id(_read_access_token_from_request(request))

    @app.post("/create-checkout-session", include_in_schema=False)
    async def create_checkout_session(
        request: Request,
        lookup_key: str = Form(...),
        family_id: int = Form(...),
    ):
        """
        Authenticated Checkout Session for Cash Forecast.

        Form fields:
        - lookup_key: Stripe Price lookup_key (cash_forecast_monthly | cash_forecast_annual)
        - family_id: BalanceWhiz family to entitle (caller must be family owner)

        Accept: application/json → {"url": "..."}; otherwise 303 redirect.
        """
        _require_stripe()
        domain = _require_public_base()
        if session_factory is None:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Billing database session is not configured.",
            )

        key = (lookup_key or "").strip()
        price_info = price_for_lookup(key)
        if not price_info or key not in ALLOWED_PRICE_LOOKUP_KEYS:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid price lookup_key.",
            )

        user_id = _auth_user_id(request)

        from sqlalchemy import select

        from .billing_entitlement import get_or_create_stripe_customer_for_user, trial_end_unix
        from .main import BillingSubscription, Family, User, require_family_owner

        try:
            stripe_trial_end: Optional[int] = None
            with session_factory() as db:
                require_family_owner(db=db, family_id=int(family_id), user_id=int(user_id))
                user = db.get(User, int(user_id))
                if user is None:
                    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

                existing = db.execute(
                    select(BillingSubscription).where(BillingSubscription.family_id == int(family_id))
                ).scalar_one_or_none()
                if existing is not None:
                    st = (existing.status or "").strip().lower()
                    if st in ENTITLED_STATUSES:
                        raise HTTPException(
                            status_code=status.HTTP_409_CONFLICT,
                            detail="This family already has an active Cash Forecast subscription.",
                        )

                family = db.get(Family, int(family_id))
                stripe_trial_end = trial_end_unix(getattr(family, "created_at", None) if family else None)

                billing_customer = get_or_create_stripe_customer_for_user(
                    db, user=user, stripe_mod=stripe, family_id=int(family_id)
                )
                db.commit()
                stripe_customer_id = (billing_customer.stripe_customer_id or "").strip()
                if not stripe_customer_id:
                    raise HTTPException(
                        status_code=status.HTTP_502_BAD_GATEWAY,
                        detail="Could not create or load a Stripe customer.",
                    )

            prices = stripe.Price.list(lookup_keys=[key], expand=["data.product"])
            if not prices.data:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=(
                        f"No Stripe Price found for lookup_key={key!r}. "
                        f"Create the Cash Forecast {price_info['frequency_label'].lower()} "
                        f"price (${price_info['amount_usd']}) with that lookup_key in the Dashboard."
                    ),
                )

            bw_meta = {
                "bw_product_code": PRODUCT_CODE,
                "bw_product_name": PRODUCT_NAME,
                "bw_lookup_key": key,
                "bw_billing_frequency": frequency_storage_value(key),
                "bw_user_id": str(int(user_id)),
                "bw_family_id": str(int(family_id)),
            }

            subscription_data: dict[str, Any] = {
                "metadata": {
                    "bw_product_code": PRODUCT_CODE,
                    "bw_lookup_key": key,
                    "bw_billing_frequency": frequency_storage_value(key),
                    "bw_user_id": str(int(user_id)),
                    "bw_family_id": str(int(family_id)),
                }
            }
            checkout_kwargs: dict[str, Any] = {
                "mode": "subscription",
                "customer": stripe_customer_id,
                "client_reference_id": str(int(family_id)),
                "line_items": [
                    {
                        "quantity": 1,
                        "price": prices.data[0].id,
                    }
                ],
                "metadata": bw_meta,
                "subscription_data": subscription_data,
                "success_url": _billing_page_url(
                    domain,
                    family_id=int(family_id),
                    checkout="success",
                    session_id_placeholder=True,
                    frequency=frequency_storage_value(key),
                ),
                "cancel_url": _billing_page_url(
                    domain,
                    family_id=int(family_id),
                    checkout="canceled",
                ),
            }
            # Remaining app trial: collect a card now, first charge at trial_end.
            if stripe_trial_end:
                subscription_data["trial_end"] = int(stripe_trial_end)
                checkout_kwargs["payment_method_collection"] = "always"

            session = stripe.checkout.Session.create(**checkout_kwargs)
        except HTTPException:
            raise
        except stripe.error.StripeError as e:
            logger.exception("Stripe checkout session create failed")
            msg = getattr(getattr(e, "error", None), "message", None) or str(e)
            return JSONResponse(
                status_code=status.HTTP_400_BAD_REQUEST,
                content={"error": {"message": msg}},
            )
        except Exception as e:
            logger.exception("Checkout session create failed")
            return JSONResponse(
                status_code=status.HTTP_400_BAD_REQUEST,
                content={"error": {"message": str(e)}},
            )

        if not session.url:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Stripe did not return a Checkout URL.",
            )
        if _wants_json(request):
            return JSONResponse(
                {
                    "url": session.url,
                    "product_code": PRODUCT_CODE,
                    "lookup_key": key,
                    "frequency": frequency_storage_value(key),
                    "family_id": int(family_id),
                }
            )
        return RedirectResponse(url=session.url, status_code=303)

    def _price_id_for_lookup(lookup_key: str) -> Optional[str]:
        listed = stripe.Price.list(lookup_keys=[lookup_key], limit=1)
        if not listed.data:
            return None
        return (getattr(listed.data[0], "id", None) or "").strip() or None

    def _active_subscription_id_for_customer(customer_id: str) -> Optional[str]:
        listed = stripe.Subscription.list(customer=customer_id, status="all", limit=5)
        data = getattr(listed, "data", None) or []
        for candidate in data:
            st = (getattr(candidate, "status", None) or "").strip().lower()
            if st in ("active", "past_due", "trialing"):
                sid = (getattr(candidate, "id", None) or "").strip()
                if sid:
                    return sid
        return None

    @app.post("/switch-billing-interval", include_in_schema=False)
    async def switch_billing_interval(
        request: Request,
        family_id: int = Form(...),
        target_lookup: str = Form(...),
    ):
        """Replace monthly↔annual immediately: full new price, no prorations, cycle starts today."""
        _require_stripe()
        if session_factory is None:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Billing database session is not configured.",
            )
        target = (target_lookup or "").strip()
        if target not in ALLOWED_PRICE_LOOKUP_KEYS:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid billing interval.")
        target_info = price_for_lookup(target)
        user_id = _auth_user_id(request)

        from sqlalchemy import select

        from .billing_entitlement import (
            refresh_subscription_row_from_stripe,
            stripe_customer_id_for_family,
        )
        from .main import BillingCustomer, BillingSubscription, require_family_owner

        try:
            with session_factory() as db:
                require_family_owner(db=db, family_id=int(family_id), user_id=int(user_id))
                customer = stripe_customer_id_for_family(db, family_id=int(family_id))
                if not customer:
                    owner_cust = db.execute(
                        select(BillingCustomer).where(BillingCustomer.user_id == int(user_id))
                    ).scalar_one_or_none()
                    customer = (owner_cust.stripe_customer_id or "").strip() if owner_cust else None
                sub_row = db.execute(
                    select(BillingSubscription).where(BillingSubscription.family_id == int(family_id))
                ).scalar_one_or_none()
                stripe_subscription_id = (
                    (sub_row.stripe_subscription_id or "").strip() if sub_row is not None else ""
                )
                current_lookup = ((getattr(sub_row, "lookup_key", None) or "").strip() if sub_row else "")
                if not stripe_subscription_id and customer:
                    stripe_subscription_id = _active_subscription_id_for_customer(str(customer)) or ""
                if not stripe_subscription_id:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="No Stripe subscription is on file to switch monthly and annual billing.",
                    )
                price_id = _price_id_for_lookup(target)
                if not price_id:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="The Cash Forecast price for that interval is not configured in Stripe.",
                    )
                live = stripe.Subscription.retrieve(stripe_subscription_id, expand=["items.data.price"])
                live_status = (getattr(live, "status", None) or "").strip().lower()
                if live_status not in ("active", "past_due", "trialing"):
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="This subscription can’t be switched in its current state.",
                    )
                items = getattr(getattr(live, "items", None), "data", None) or []
                item = items[0] if items else None
                item_id = (getattr(item, "id", None) or "").strip() if item is not None else ""
                live_price = getattr(item, "price", None) if item is not None else None
                if isinstance(live_price, str):
                    live_lookup = ""
                    live_price_id = live_price.strip()
                else:
                    live_lookup = (
                        (getattr(live_price, "lookup_key", None) or "").strip() if live_price is not None else ""
                    )
                    live_price_id = (getattr(live_price, "id", None) or "").strip() if live_price is not None else ""
                if not item_id:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="Stripe subscription has no item to update.",
                    )
                already_on_target = (
                    live_lookup == target
                    or (bool(live_price_id) and live_price_id == price_id)
                    or current_lookup == target
                )
                if already_on_target:
                    if sub_row is not None and current_lookup != target:
                        sub_row.lookup_key = target
                        db.add(sub_row)
                    db.commit()
                    label = (target_info or {}).get("display_label") or target
                    return JSONResponse(
                        {
                            "switched": False,
                            "already": True,
                            "lookup_key": target,
                            "price_label": label,
                        }
                    )

                # Immediate replacement: charge the full new price only, forfeit unused
                # time on the old interval, and start a new cycle today.
                updated = stripe.Subscription.modify(
                    stripe_subscription_id,
                    items=[{"id": item_id, "price": price_id}],
                    proration_behavior="none",
                    billing_cycle_anchor="now",
                    payment_behavior="error_if_incomplete",
                    cancel_at_period_end=False,
                    metadata={
                        "bw_lookup_key": target,
                        "bw_billing_frequency": frequency_storage_value(target),
                    },
                )
                refreshed, _ = refresh_subscription_row_from_stripe(
                    db,
                    stripe_subscription_id=stripe_subscription_id,
                    api_key=_stripe_secret(),
                    timeout_seconds=8.0,
                )
                row_to_fix = refreshed if refreshed is not None else sub_row
                if row_to_fix is not None:
                    row_to_fix.lookup_key = target
                    db.add(row_to_fix)
                db.commit()
                logger.info(
                    "Switched family_id=%s subscription %s to %s status=%s",
                    family_id,
                    stripe_subscription_id,
                    target,
                    getattr(updated, "status", None),
                )
        except HTTPException:
            raise
        except stripe.error.CardError as e:
            msg = getattr(getattr(e, "error", None), "message", None) or str(e)
            raise HTTPException(status_code=status.HTTP_402_PAYMENT_REQUIRED, detail=msg)
        except stripe.error.StripeError as e:
            logger.exception("Stripe billing-interval switch failed")
            msg = getattr(getattr(e, "error", None), "message", None) or str(e)
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=msg)
        except Exception:
            logger.exception("Billing-interval switch failed")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Could not switch billing interval.",
            )

        label = (target_info or {}).get("display_label") or target
        return JSONResponse(
            {
                "switched": True,
                "lookup_key": target,
                "price_label": label,
            }
        )

    def _family_subscription_id(db, *, family_id: int, user_id: int, customer: Optional[str]) -> str:
        from sqlalchemy import select

        from .main import BillingSubscription

        sub_row = db.execute(
            select(BillingSubscription).where(BillingSubscription.family_id == int(family_id))
        ).scalar_one_or_none()
        sid = (sub_row.stripe_subscription_id or "").strip() if sub_row is not None else ""
        if not sid and customer:
            sid = _active_subscription_id_for_customer(str(customer)) or ""
        return sid

    def _persist_live_subscription(db, stripe_subscription_id: str):
        from .billing_entitlement import (
            _period_end_from_stripe_sub,
            _scheduled_cancel_from_stripe_sub,
            lookup_key_from_subscription,
            refresh_subscription_row_from_stripe,
        )

        live = stripe.Subscription.retrieve(stripe_subscription_id, expand=["items.data.price"])
        refreshed, live_from_refresh = refresh_subscription_row_from_stripe(
            db,
            stripe_subscription_id=stripe_subscription_id,
            api_key=_stripe_secret(),
            timeout_seconds=8.0,
        )
        sub_obj = live_from_refresh if live_from_refresh is not None else live
        period_end = _period_end_from_stripe_sub(sub_obj)
        if refreshed is not None:
            if period_end is not None:
                refreshed.current_period_end = period_end
            refreshed.cancel_at_period_end = _scheduled_cancel_from_stripe_sub(sub_obj)
            lk = lookup_key_from_subscription(sub_obj)
            if lk:
                refreshed.lookup_key = lk
            db.add(refreshed)
        db.commit()
        return sub_obj, refreshed, period_end

    @app.post("/schedule-subscription-cancel", include_in_schema=False)
    async def schedule_subscription_cancel(request: Request, family_id: int = Form(...)):
        """Stop renewal at the current paid period end. Never cancel immediately."""
        _require_stripe()
        if session_factory is None:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Billing database session is not configured.",
            )
        user_id = _auth_user_id(request)
        from .billing_entitlement import (
            _period_end_from_stripe_sub,
            lookup_key_from_subscription,
            stripe_customer_id_for_family,
        )
        from .main import BillingCustomer, require_family_owner
        from sqlalchemy import select

        try:
            with session_factory() as db:
                require_family_owner(db=db, family_id=int(family_id), user_id=int(user_id))
                customer = stripe_customer_id_for_family(db, family_id=int(family_id))
                if not customer:
                    owner_cust = db.execute(
                        select(BillingCustomer).where(BillingCustomer.user_id == int(user_id))
                    ).scalar_one_or_none()
                    customer = (owner_cust.stripe_customer_id or "").strip() if owner_cust else None
                sid = _family_subscription_id(db, family_id=int(family_id), user_id=int(user_id), customer=customer)
                if not sid:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="No Stripe subscription is on file to cancel.",
                    )
                live = stripe.Subscription.retrieve(sid, expand=["items.data.price"])
                live_status = (getattr(live, "status", None) or "").strip().lower()
                if live_status in ("canceled", "cancelled", "incomplete_expired"):
                    period_end = _period_end_from_stripe_sub(live)
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=(
                            "This subscription is already canceled."
                            if period_end is None
                            else "This subscription is already canceled. Access follows the paid period already on file."
                        ),
                    )
                stripe.Subscription.modify(sid, cancel_at_period_end=True)
                sub_obj, _refreshed, period_end = _persist_live_subscription(db, sid)
                logger.info(
                    "Scheduled period-end cancel family_id=%s subscription %s period_end=%s",
                    family_id,
                    sid,
                    period_end,
                )
        except HTTPException:
            raise
        except stripe.error.StripeError as e:
            logger.exception("Stripe schedule-cancel failed")
            msg = getattr(getattr(e, "error", None), "message", None) or str(e)
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=msg)
        except Exception:
            logger.exception("Schedule-cancel failed")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Could not schedule cancellation.",
            )

        pe_iso = period_end.isoformat() + "Z" if period_end is not None else None
        return JSONResponse(
            {
                "scheduled": True,
                "cancel_at_period_end": True,
                "current_period_end": pe_iso,
                "status": (getattr(sub_obj, "status", None) or "active"),
                "lookup_key": lookup_key_from_subscription(sub_obj),
            }
        )

    @app.post("/resume-subscription", include_in_schema=False)
    async def resume_subscription(request: Request, family_id: int = Form(...)):
        """Clear a scheduled period-end cancel and restore automatic renewal."""
        _require_stripe()
        if session_factory is None:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Billing database session is not configured.",
            )
        user_id = _auth_user_id(request)
        from .billing_entitlement import lookup_key_from_subscription, stripe_customer_id_for_family
        from .main import BillingCustomer, require_family_owner
        from sqlalchemy import select

        try:
            with session_factory() as db:
                require_family_owner(db=db, family_id=int(family_id), user_id=int(user_id))
                customer = stripe_customer_id_for_family(db, family_id=int(family_id))
                if not customer:
                    owner_cust = db.execute(
                        select(BillingCustomer).where(BillingCustomer.user_id == int(user_id))
                    ).scalar_one_or_none()
                    customer = (owner_cust.stripe_customer_id or "").strip() if owner_cust else None
                sid = _family_subscription_id(db, family_id=int(family_id), user_id=int(user_id), customer=customer)
                if not sid:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="No Stripe subscription is on file to resume.",
                    )
                live = stripe.Subscription.retrieve(sid, expand=["items.data.price"])
                live_status = (getattr(live, "status", None) or "").strip().lower()
                if live_status in ("canceled", "cancelled", "incomplete_expired"):
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="This subscription has already ended and cannot be kept from here.",
                    )
                _resume_scheduled_cancel(sid, live)
                sub_obj, _refreshed, period_end = _persist_live_subscription(db, sid)
                logger.info("Resumed subscription family_id=%s subscription %s", family_id, sid)
        except HTTPException:
            raise
        except stripe.error.StripeError as e:
            logger.exception("Stripe resume-subscription failed")
            msg = getattr(getattr(e, "error", None), "message", None) or str(e)
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=msg)
        except Exception:
            logger.exception("Resume-subscription failed")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Could not keep this subscription.",
            )

        pe_iso = period_end.isoformat() + "Z" if period_end is not None else None
        return JSONResponse(
            {
                "resumed": True,
                "cancel_at_period_end": False,
                "current_period_end": pe_iso,
                "status": (getattr(sub_obj, "status", None) or "active"),
                "lookup_key": lookup_key_from_subscription(sub_obj),
            }
        )

    @app.post("/create-portal-session", include_in_schema=False)
    async def create_portal_session(
        request: Request,
        family_id: Optional[int] = Form(None),
        session_id: Optional[str] = Form(None),
        flow: Optional[str] = Form(None),
        target_lookup: Optional[str] = Form(None),  # ignored; monthly↔annual uses /switch-billing-interval
    ):
        """
        Open the Stripe Customer Portal.

        Preferred: authenticated request + family_id (owner) → customer from billing_customers.
        Legacy: session_id from Checkout success query string.

        Optional flow (BalanceWhiz action → Stripe portal deep link when supported):
        - payment → payment_method_update
        - invoices / (empty) → standard portal homepage
        Cancel / keep use /schedule-subscription-cancel and /resume-subscription
        (period-end only; not the portal). Monthly↔annual uses /switch-billing-interval.

        return_url is always built server-side from APP_PUBLIC_BASE_URL → /settings/billing.
        Hosted portal link prominence / button copy (e.g. “Don’t cancel”) are Stripe-controlled.
        """
        _require_stripe()
        domain = _require_public_base()

        customer: Optional[str] = None
        customer_account: Optional[str] = None
        stripe_subscription_id: Optional[str] = None
        # Server-built from APP_PUBLIC_BASE_URL — never accept a client-supplied return URL.
        return_url = _billing_page_url(domain, portal_return=True)
        flow_key = (flow or "").strip().lower()
        if flow_key == "cycle":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Monthly and annual billing are switched in BalanceWhiz, not the Stripe portal.",
            )
        if flow_key in ("cancel", "keep"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cancellation is scheduled in BalanceWhiz at the end of the paid period, not in the Stripe portal.",
            )

        try:
            if family_id is not None:
                if session_factory is None:
                    raise HTTPException(
                        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                        detail="Billing database session is not configured.",
                    )
                user_id = _auth_user_id(request)
                from .billing_entitlement import stripe_customer_id_for_family
                from .main import BillingCustomer, BillingSubscription, require_family_owner
                from sqlalchemy import select

                with session_factory() as db:
                    require_family_owner(db=db, family_id=int(family_id), user_id=int(user_id))
                    customer = stripe_customer_id_for_family(db, family_id=int(family_id))
                    if not customer:
                        # Fall back to the owner's billing customer even before a sub row links
                        row = db.execute(
                            select(BillingCustomer).where(BillingCustomer.user_id == int(user_id))
                        ).scalar_one_or_none()
                        customer = (row.stripe_customer_id or "").strip() if row else None
                    sub_row = db.execute(
                        select(BillingSubscription).where(BillingSubscription.family_id == int(family_id))
                    ).scalar_one_or_none()
                    if sub_row is not None:
                        stripe_subscription_id = (sub_row.stripe_subscription_id or "").strip() or None
                if not customer:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="No Stripe customer on file for this family yet. Complete checkout first.",
                    )
                return_url = _billing_page_url(
                    domain,
                    family_id=int(family_id),
                    portal_return=True,
                )
                if not stripe_subscription_id and customer:
                    stripe_subscription_id = _active_subscription_id_for_customer(str(customer))
            else:
                checkout_session_id = (session_id or "").strip()
                if not checkout_session_id:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="family_id or session_id is required.",
                    )
                checkout_session = stripe.checkout.Session.retrieve(checkout_session_id)
                customer = getattr(checkout_session, "customer", None)
                customer_account = getattr(checkout_session, "customer_account", None)
                if not customer and not customer_account:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="Checkout session has no customer yet. Complete payment first.",
                    )
                sub_ref = getattr(checkout_session, "subscription", None)
                if isinstance(sub_ref, str) and sub_ref.strip():
                    stripe_subscription_id = sub_ref.strip()
                elif sub_ref is not None:
                    stripe_subscription_id = (getattr(sub_ref, "id", None) or "").strip() or None

            def _after_completion() -> dict[str, Any]:
                return {
                    "type": "redirect",
                    "redirect": {"return_url": return_url},
                }

            def _flow_data_for_action() -> Optional[dict[str, Any]]:
                # Stripe has no invoice-history deep link; keep/open portal homepage.
                if flow_key == "payment":
                    return {"type": "payment_method_update", "after_completion": _after_completion()}
                return None

            portal_params: dict[str, Any] = {"return_url": return_url}
            if customer:
                portal_params["customer"] = customer
            elif customer_account:
                portal_params["customer_account"] = customer_account

            flow_data = _flow_data_for_action()
            if flow_data:
                portal_params["flow_data"] = flow_data

            try:
                portal_session = stripe.billing_portal.Session.create(**portal_params)
            except stripe.error.StripeError as flow_err:
                err_msg = getattr(getattr(flow_err, "error", None), "message", None) or str(flow_err)
                # Deep link can fail if portal config disables that feature.
                if flow_data:
                    logger.warning(
                        "Portal deep-link flow=%s type=%s failed (%s); falling back to homepage",
                        flow_key,
                        flow_data.get("type"),
                        err_msg,
                    )
                    portal_params.pop("flow_data", None)
                    portal_session = stripe.billing_portal.Session.create(**portal_params)
                else:
                    raise
        except HTTPException:
            raise
        except stripe.error.StripeError as e:
            logger.exception("Stripe portal session create failed")
            msg = getattr(getattr(e, "error", None), "message", None) or str(e)
            return JSONResponse(
                status_code=status.HTTP_400_BAD_REQUEST,
                content={"error": {"message": msg}},
            )
        except Exception as e:
            logger.exception("Portal session create failed")
            return JSONResponse(
                status_code=status.HTTP_400_BAD_REQUEST,
                content={"error": {"message": str(e)}},
            )

        if not portal_session.url:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Stripe did not return a Customer Portal URL.",
            )
        if _wants_json(request):
            return JSONResponse({"url": portal_session.url})
        return RedirectResponse(url=portal_session.url, status_code=303)

    @app.post("/webhook", include_in_schema=False)
    async def stripe_webhook(request: Request):
        """
        Stripe webhook endpoint. Set STRIPE_WEBHOOK_SECRET from the Dashboard or
        `stripe listen --forward-to .../webhook`.
        Persists entitlement into billing_* tables (idempotent by event id).
        """
        _require_stripe()
        payload = await request.body()
        webhook_secret = _webhook_secret()
        event: Optional[Any] = None

        if webhook_secret:
            sig_header = request.headers.get("stripe-signature") or request.headers.get("Stripe-Signature")
            if not sig_header:
                return JSONResponse(status_code=400, content={"error": "Missing Stripe-Signature header"})
            try:
                event = stripe.Webhook.construct_event(payload, sig_header, webhook_secret)
            except ValueError:
                logger.warning("Stripe webhook: invalid payload")
                return JSONResponse(status_code=400, content={"error": "Invalid payload"})
            except stripe.error.SignatureVerificationError:
                logger.warning("Stripe webhook: signature verification failed")
                return JSONResponse(status_code=400, content={"error": "Invalid signature"})
        else:
            # Local/dev only — do not skip verification in production.
            import json

            try:
                data = json.loads(payload.decode("utf-8"))
                event = stripe.Event.construct_from(data, stripe.api_key)
            except Exception:
                logger.exception("Stripe webhook: failed to parse event without signature")
                return JSONResponse(status_code=400, content={"error": "Invalid payload"})

        event_type = event["type"] if isinstance(event, dict) else getattr(event, "type", None)
        event_id = event.get("id") if isinstance(event, dict) else getattr(event, "id", None)
        logger.info("Stripe webhook received: %s (%s)", event_type, event_id)

        if session_factory is None:
            logger.error("Stripe webhook: session_factory not configured; skipping DB persistence")
            return JSONResponse({"status": "success", "persisted": False})

        from .billing_entitlement import handle_stripe_event

        try:
            with session_factory() as db:
                handle_stripe_event(db, event, logger)
                db.commit()
        except Exception:
            logger.exception("Stripe webhook DB persistence failed for %s", event_id)
            # Return 500 so Stripe retries; signature was valid.
            return JSONResponse(status_code=500, content={"error": "Webhook persistence failed"})

        return JSONResponse({"status": "success", "persisted": True})
