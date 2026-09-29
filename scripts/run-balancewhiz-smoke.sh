#!/usr/bin/env bash
# Run the local BalanceWhiz smoke test.
#
#   scripts/run-balancewhiz-smoke.sh
#
# Uses a fresh SQLite file under e2e/.smoke-run, bot accounts at example.com,
# and no Stripe, Resend, production database, or personal account.
# Do not point this at staging or production.

set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PY="$ROOT/e2e/.venv/bin/python"
VENV_PY="$ROOT/e2e/.venv/bin"
START=$(date +%s)
FAIL=0

unset DATABASE_URL STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET RESEND_API_KEY RESEND_FROM \
  CONTACT_SMTP_HOST CONTACT_SMTP_USER CONTACT_SMTP_PASSWORD CONTACT_EMAIL_TO CONTACT_EMAIL_FROM \
  PLATFORM_ADMIN_EMAILS STAGING_AUTH_EMAIL_ALLOWLIST APP_PUBLIC_BASE_URL CORS_ORIGINS MAINT_TOKEN

export PLAYWRIGHT_BROWSERS_PATH="$ROOT/e2e/.playwright-browsers"

if [[ ! -x "$PY" ]]; then
  echo "Setting up the local smoke-test tools (first run only)..."
  /usr/bin/python3 -m venv "$ROOT/e2e/.venv"
  "$VENV_PY/pip" install -q -r "$ROOT/backend/requirements.txt" pytest pytest-playwright playwright httpx
fi

if ! "$PY" -c "import httpx, playwright, pytest" >/dev/null 2>&1; then
  "$VENV_PY/pip" install -q httpx pytest pytest-playwright playwright
fi

if ! "$VENV_PY/playwright" install chromium; then
  echo "Could not install the local browser used by the smoke test."
  exit 1
fi

FORECAST_LOG="$ROOT/e2e/.smoke-run/forecast.log"
LIFECYCLE_LOG="$ROOT/e2e/.smoke-run/lifecycle.log"
SMOKE_LOG="$ROOT/e2e/.smoke-run/playwright.log"
mkdir -p "$ROOT/e2e/.smoke-run"

echo "Checking forecast math..."
"$PY" -m pytest "$ROOT/backend/tests/test_forecast_balance.py" "$ROOT/backend/tests/test_smoke_guard.py" -q --tb=short >"$FORECAST_LOG" 2>&1
FORECAST_CODE=$?

echo "Checking lifecycle emails..."
"$PY" -m pytest "$ROOT/backend/tests/test_trial_lifecycle_emails.py" -q --tb=short >"$LIFECYCLE_LOG" 2>&1
LIFECYCLE_CODE=$?

echo "Running the smoke suite..."
(
  cd "$ROOT/e2e"
  "$PY" -m pytest
) >"$SMOKE_LOG" 2>&1
SMOKE_CODE=$?

echo
if [[ $FORECAST_CODE -eq 0 ]]; then
  printf 'FORECAST MATH\n\n✓ Projected balance\n\n'
else
  printf 'FORECAST MATH\n\n✗ Projected balance\n\n'
  FAIL=1
fi
if [[ -f "$ROOT/e2e/.smoke-run/summary.txt" ]]; then
  cat "$ROOT/e2e/.smoke-run/summary.txt"
else
  echo "BALANCEWHIZ SMOKE TEST"
  echo
  echo "The suite did not finish."
  FAIL=1
fi

if [[ $LIFECYCLE_CODE -eq 0 ]]; then
  printf 'LIFECYCLE EMAILS\n\n✓ Trial ending, trial expired, and annual renewal\n\n'
else
  printf 'LIFECYCLE EMAILS\n\n✗ Trial ending, trial expired, and annual renewal\n\n'
  FAIL=1
fi

if [[ $FORECAST_CODE -ne 0 || $LIFECYCLE_CODE -ne 0 || $SMOKE_CODE -ne 0 ]]; then
  FAIL=1
  echo
  echo "Technical details"
  echo
  if [[ $FORECAST_CODE -ne 0 ]]; then
    echo "Forecast math"
    cat "$FORECAST_LOG"
    echo
  fi
  if [[ $LIFECYCLE_CODE -ne 0 ]]; then
    echo "Lifecycle emails"
    cat "$LIFECYCLE_LOG"
    echo
  fi
  if [[ -s "$ROOT/e2e/.smoke-run/failures.txt" ]]; then
    cat "$ROOT/e2e/.smoke-run/failures.txt"
    echo
  fi
  if [[ $SMOKE_CODE -ne 0 ]]; then
    echo "Playwright output"
    cat "$SMOKE_LOG"
    echo
  fi
  echo "Screenshots and traces (saved when a browser test fails):"
  find "$ROOT/e2e/test-results" -type f \( -name '*.png' -o -name '*.zip' \) 2>/dev/null || true
  echo "Server log: e2e/.smoke-run/server.log"
fi

END=$(date +%s)
echo
echo "Runtime: about $((END - START)) seconds"
echo "Command: scripts/run-balancewhiz-smoke.sh"
exit $FAIL
