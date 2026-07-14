"""Stripe Checkout + Customer Portal + webhook (subscription billing).

Ports the Stripe Billing quickstart Sinatra sample to FastAPI.
Secrets come from env only — never hardcode API keys.
"""

from __future__ import annotations

import logging
from typing import Any, Optional

import stripe
from fastapi import FastAPI, Form, HTTPException, Request, status
from fastapi.responses import JSONResponse, RedirectResponse

# Lookup keys must match Prices in the Stripe Dashboard (and the checkout page).
ALLOWED_PRICE_LOOKUP_KEYS = frozenset(
    {
        "cash_forecast_monthly",
        "cash_forecast_annual",
    }
)


def register_stripe_routes(app: FastAPI, settings: Any, logger: logging.Logger) -> None:
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

    @app.post("/create-checkout-session", include_in_schema=False)
    async def create_checkout_session(request: Request, lookup_key: str = Form(...)):
        """
        Create a Stripe Checkout Session (subscription) and redirect to Stripe-hosted Checkout.
        Form field: lookup_key (must match a Price lookup_key in Stripe).

        Prefer Accept: application/json → {"url": "..."} so the staging SPA can
        surface errors; otherwise 303 redirect (classic form POST).
        """
        _require_stripe()
        domain = _require_public_base()

        key = (lookup_key or "").strip()
        if key not in ALLOWED_PRICE_LOOKUP_KEYS:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid price lookup_key.",
            )

        try:
            prices = stripe.Price.list(lookup_keys=[key], expand=["data.product"])
            if not prices.data:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"No Stripe Price found for lookup_key={key!r}.",
                )

            session = stripe.checkout.Session.create(
                mode="subscription",
                line_items=[
                    {
                        "quantity": 1,
                        "price": prices.data[0].id,
                    }
                ],
                # Land on Billing settings after payment so status can flip to Active Billing.
                success_url=(
                    domain
                    + "/settings/?section=billing&checkout=success"
                    + "&session_id={CHECKOUT_SESSION_ID}"
                ),
                cancel_url=domain + "/settings/?section=billing&checkout=canceled",
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
        accept = (request.headers.get("accept") or "").lower()
        if "application/json" in accept:
            return JSONResponse({"url": session.url})
        return RedirectResponse(url=session.url, status_code=303)

    @app.post("/create-portal-session", include_in_schema=False)
    async def create_portal_session(session_id: str = Form(...)):
        """
        Open the Stripe Customer Portal using the Checkout Session's customer.

        Demo path: session_id from the success page query string.
        Production: resolve customer from the authenticated user instead.
        """
        _require_stripe()
        domain = _require_public_base()

        checkout_session_id = (session_id or "").strip()
        if not checkout_session_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="session_id is required.",
            )

        try:
            checkout_session = stripe.checkout.Session.retrieve(checkout_session_id)
            return_url = domain

            # Prefer classic Customer objects; fall back to Accounts v2 customer_account
            # if the Checkout Session was created that way (newer Stripe samples).
            customer = getattr(checkout_session, "customer", None)
            customer_account = getattr(checkout_session, "customer_account", None)

            portal_params: dict[str, Any] = {"return_url": return_url}
            if customer:
                portal_params["customer"] = customer
            elif customer_account:
                portal_params["customer_account"] = customer_account
            else:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Checkout session has no customer yet. Complete payment first.",
                )

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
        return RedirectResponse(url=portal_session.url, status_code=303)

    @app.post("/webhook", include_in_schema=False)
    async def stripe_webhook(request: Request):
        """
        Stripe webhook endpoint. Set STRIPE_WEBHOOK_SECRET from the Dashboard or
        `stripe listen --forward-to .../webhook`.
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

        if event_type == "customer.subscription.deleted":
            logger.info("Subscription canceled: %s", event_id)
        elif event_type == "customer.subscription.updated":
            logger.info("Subscription updated: %s", event_id)
        elif event_type == "customer.subscription.created":
            logger.info("Subscription created: %s", event_id)
        elif event_type == "customer.subscription.trial_will_end":
            logger.info("Subscription trial will end: %s", event_id)
        elif event_type == "checkout.session.completed":
            logger.info("Checkout session completed: %s", event_id)
        elif event_type == "entitlements.active_entitlement_summary.updated":
            logger.info("Active entitlement summary updated: %s", event_id)
        else:
            logger.info("Unhandled Stripe event type: %s (%s)", event_type, event_id)

        return JSONResponse({"status": "success"})
