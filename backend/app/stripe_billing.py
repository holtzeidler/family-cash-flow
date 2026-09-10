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
                detail="APP_PUBLIC_BASE_URL is required for Stripe Checkout redirects.",
            )
        return base

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

        from .billing_entitlement import get_or_create_stripe_customer_for_user
        from .main import BillingSubscription, User, require_family_owner

        try:
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

            # Product model: app-side trial only — do not set subscription_data.trial_period_days.
            session = stripe.checkout.Session.create(
                mode="subscription",
                customer=stripe_customer_id,
                client_reference_id=str(int(family_id)),
                line_items=[
                    {
                        "quantity": 1,
                        "price": prices.data[0].id,
                    }
                ],
                metadata=bw_meta,
                subscription_data={
                    "metadata": {
                        "bw_product_code": PRODUCT_CODE,
                        "bw_lookup_key": key,
                        "bw_billing_frequency": frequency_storage_value(key),
                        "bw_user_id": str(int(user_id)),
                        "bw_family_id": str(int(family_id)),
                    }
                },
                success_url=(
                    domain
                    + "/settings/?section=billing&checkout=success"
                    + "&session_id={CHECKOUT_SESSION_ID}"
                    + f"&frequency={frequency_storage_value(key)}"
                    + f"&family_id={int(family_id)}"
                ),
                cancel_url=domain + f"/settings/?section=billing&checkout=canceled&family_id={int(family_id)}",
            )
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

    @app.post("/create-portal-session", include_in_schema=False)
    async def create_portal_session(
        request: Request,
        family_id: Optional[int] = Form(None),
        session_id: Optional[str] = Form(None),
    ):
        """
        Open the Stripe Customer Portal.

        Preferred: authenticated request + family_id (owner) → customer from billing_customers.
        Legacy: session_id from Checkout success query string.
        """
        _require_stripe()
        domain = _require_public_base()

        customer: Optional[str] = None
        customer_account: Optional[str] = None
        return_url = domain + "/settings/?section=billing"

        try:
            if family_id is not None:
                if session_factory is None:
                    raise HTTPException(
                        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                        detail="Billing database session is not configured.",
                    )
                user_id = _auth_user_id(request)
                from .billing_entitlement import stripe_customer_id_for_family
                from .main import BillingCustomer, require_family_owner
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
                if not customer:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="No Stripe customer on file for this family yet. Complete checkout first.",
                    )
                return_url = domain + f"/settings/?section=billing&family_id={int(family_id)}"
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

            portal_params: dict[str, Any] = {"return_url": return_url}
            if customer:
                portal_params["customer"] = customer
            elif customer_account:
                portal_params["customer_account"] = customer_account

            portal_session = stripe.billing_portal.Session.create(**portal_params)
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
