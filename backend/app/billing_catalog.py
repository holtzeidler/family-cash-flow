"""BalanceWhiz subscription product model (source of truth for app + Stripe).

Product model is COMPLETE for Cash Forecast rebuild:

- One Product: Cash Forecast
- Two Prices (lookup keys must exist in Stripe Dashboard / test mode):
  - cash_forecast_monthly  → $5.99 / month
  - cash_forecast_annual   → $59.99 / year
- Trial: 14-day free trial from account start. Access does not require a card.
  Choosing monthly/annual during the trial creates a Stripe subscription with
  trial_end aligned to the remaining app trial (collects a payment method, $0
  due today). Checkout after the trial charges immediately.

Dashboard setup (test and live, separately):
1. Create Product name "Cash Forecast".
2. Add recurring Price $5.99 USD / month with lookup_key cash_forecast_monthly.
3. Add recurring Price $59.99 USD / year with lookup_key cash_forecast_annual.
4. Enable Customer Portal for payment method update, cancel, invoices.
   Do not let customers switch products/prices in the portal. Monthly vs annual
   uses POST /switch-billing-interval (full new price, no prorations, cycle resets).
"""

from __future__ import annotations

from typing import Any, Literal, Optional

BillingInterval = Literal["month", "year"]

PRODUCT_CODE = "cash_forecast"
PRODUCT_NAME = "Cash Forecast"
PRODUCT_DESCRIPTION = "Forecast checking balance before bills and paychecks land."

# App-side free trial (marketing: "Free for 14 days").
TRIAL_DAYS = 14

# Display amounts in USD (keep marketing / checkout UI in sync).
MONTHLY_AMOUNT_USD = "5.99"
ANNUAL_AMOUNT_USD = "59.99"

LOOKUP_MONTHLY = "cash_forecast_monthly"
LOOKUP_ANNUAL = "cash_forecast_annual"

PRICE_BY_LOOKUP: dict[str, dict[str, Any]] = {
    LOOKUP_MONTHLY: {
        "lookup_key": LOOKUP_MONTHLY,
        "interval": "month",
        "amount_usd": MONTHLY_AMOUNT_USD,
        "display_label": f"${MONTHLY_AMOUNT_USD} / month",
        "frequency_label": "Monthly",
    },
    LOOKUP_ANNUAL: {
        "lookup_key": LOOKUP_ANNUAL,
        "interval": "year",
        "amount_usd": ANNUAL_AMOUNT_USD,
        "display_label": f"${ANNUAL_AMOUNT_USD} / year",
        "frequency_label": "Annual",
    },
}

ALLOWED_PRICE_LOOKUP_KEYS = frozenset(PRICE_BY_LOOKUP.keys())


def catalog_public() -> dict[str, Any]:
    """JSON-serializable catalog for API / debug (no secrets)."""
    return {
        "product_code": PRODUCT_CODE,
        "product_name": PRODUCT_NAME,
        "product_description": PRODUCT_DESCRIPTION,
        "trial_days": TRIAL_DAYS,
        "trial_mode": "app_side",
        "currency": "usd",
        "prices": list(PRICE_BY_LOOKUP.values()),
    }


def price_for_lookup(lookup_key: str) -> Optional[dict[str, Any]]:
    key = (lookup_key or "").strip()
    return PRICE_BY_LOOKUP.get(key)


def frequency_storage_value(lookup_key: str) -> str:
    """localStorage / future DB frequency values: monthly | yearly."""
    info = price_for_lookup(lookup_key)
    if not info:
        return "monthly"
    return "yearly" if info["interval"] == "year" else "monthly"
