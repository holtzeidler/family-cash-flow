# BalanceWhiz smoke test

Local safety check for the public site, login, forecast, reports, billing prices, and a view-only account. It does not open Stripe Checkout, send email, or touch a hosted database.

From the repo root:

```bash
scripts/run-balancewhiz-smoke.sh
```

The command creates `e2e/.venv` on the first run, starts a local API on `127.0.0.1:8765` with a fresh SQLite file in `e2e/.smoke-run`, and prints a short pass/fail summary. Screenshots and traces are saved under `e2e/test-results` when a browser test fails.
