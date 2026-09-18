#!/usr/bin/env python3
"""One-time complimentary-access grandfathering for existing production accounts.

Default mode is read-only (--report). Nothing is written unless --apply is passed
against the production Neon host.

This is not application logic. New registrations keep complimentary_access=false
via the users table default. Re-running --apply only updates the user IDs captured
in complimentary_access_grandfather on the first apply; it never adds later signups.

Does not read or write Stripe. Does not update billing_customers, billing_subscriptions,
transactions, families, or any user column other than:
  complimentary_access, complimentary_access_expires_at
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from urllib.parse import unquote, urlparse

PRODUCTION_HOST_NEEDLE = "ep-ancient-union-and21kx9-pooler"
STAGING_HOST_NEEDLE = "ep-polished-boat-ando6x8y-pooler"
BILLABLE_STATUSES = ("active", "trialing", "past_due", "unpaid")

ENSURE_COLUMNS_SQL = """
ALTER TABLE users ADD COLUMN IF NOT EXISTS complimentary_access BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS complimentary_access_expires_at TIMESTAMPTZ;
"""

ENSURE_LEDGER_SQL = """
CREATE TABLE IF NOT EXISTS complimentary_access_grandfather (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
"""

SNAPSHOT_SQL = """
INSERT INTO complimentary_access_grandfather (user_id)
SELECT u.id
FROM users u
WHERE NOT EXISTS (SELECT 1 FROM complimentary_access_grandfather LIMIT 1);
"""

APPLY_SQL = """
UPDATE users AS u
SET complimentary_access = TRUE,
    complimentary_access_expires_at = NULL
FROM complimentary_access_grandfather AS g
WHERE u.id = g.user_id
  AND (
    u.complimentary_access IS DISTINCT FROM TRUE
    OR u.complimentary_access_expires_at IS NOT NULL
  );
"""

VERIFY_SQL = """
SELECT
  (SELECT COUNT(*) FROM complimentary_access_grandfather) AS snapshotted,
  (SELECT COUNT(*) FROM users u
     JOIN complimentary_access_grandfather g ON g.user_id = u.id
    WHERE u.complimentary_access IS TRUE
      AND u.complimentary_access_expires_at IS NULL) AS snapshotted_ok,
  (SELECT COUNT(*) FROM users) AS users_total,
  (SELECT COUNT(*) FROM users WHERE complimentary_access IS TRUE) AS complimentary_true,
  (SELECT COUNT(*) FROM users
    WHERE complimentary_access IS TRUE
      AND complimentary_access_expires_at IS NULL) AS complimentary_indefinite;
"""


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def load_database_url() -> str:
    raw = (os.environ.get("DATABASE_URL") or "").strip()
    if raw:
        return raw
    env_path = repo_root() / "backend" / ".env"
    if env_path.is_file():
        for line in env_path.read_text().splitlines():
            s = line.strip()
            if not s or s.startswith("#") or not s.startswith("DATABASE_URL="):
                continue
            return s.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit("DATABASE_URL is not set (env or backend/.env).")


def sqlalchemy_url_to_psycopg(url: str) -> str:
    if url.startswith("postgresql+psycopg://"):
        return "postgresql://" + url[len("postgresql+psycopg://") :]
    if url.startswith("postgresql+psycopg2://"):
        return "postgresql://" + url[len("postgresql+psycopg2://") :]
    return url


def database_host(url: str) -> str:
    parsed = urlparse(sqlalchemy_url_to_psycopg(url))
    return unquote(parsed.hostname or "")


def require_production_host(host: str) -> None:
    h = (host or "").lower()
    if STAGING_HOST_NEEDLE in h:
        raise SystemExit(f"Refusing: DATABASE_URL host looks like staging ({host}).")
    if PRODUCTION_HOST_NEEDLE not in h:
        raise SystemExit(
            f"Refusing: DATABASE_URL host is {host or '(empty)'}, expected production "
            f"({PRODUCTION_HOST_NEEDLE})."
        )


def connect(url: str):
    import psycopg
    from psycopg.rows import dict_row

    return psycopg.connect(sqlalchemy_url_to_psycopg(url), row_factory=dict_row)


def table_exists(cur, name: str) -> bool:
    cur.execute("SELECT to_regclass(%s) AS reg", (f"public.{name}",))
    row = cur.fetchone()
    return bool(row and row.get("reg"))


def column_exists(cur, table: str, column: str) -> bool:
    cur.execute(
        """
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = %s
          AND column_name = %s
        """,
        (table, column),
    )
    return cur.fetchone() is not None


def report(cur) -> dict:
    out: dict = {}
    cur.execute("SELECT COUNT(*) AS n FROM users")
    out["users_total"] = int(cur.fetchone()["n"])

    has_comp = column_exists(cur, "users", "complimentary_access")
    has_exp = column_exists(cur, "users", "complimentary_access_expires_at")
    out["complimentary_columns_present"] = bool(has_comp and has_exp)
    if has_comp:
        cur.execute("SELECT COUNT(*) AS n FROM users WHERE complimentary_access IS TRUE")
        out["already_complimentary"] = int(cur.fetchone()["n"])
        if has_exp:
            cur.execute(
                """
                SELECT COUNT(*) AS n FROM users
                WHERE complimentary_access IS TRUE
                  AND complimentary_access_expires_at IS NULL
                """
            )
            out["already_complimentary_indefinite"] = int(cur.fetchone()["n"])
            cur.execute(
                """
                SELECT COUNT(*) AS n FROM users
                WHERE complimentary_access IS TRUE
                  AND complimentary_access_expires_at IS NOT NULL
                """
            )
            out["already_complimentary_expiring"] = int(cur.fetchone()["n"])
        else:
            out["already_complimentary_indefinite"] = out["already_complimentary"]
            out["already_complimentary_expiring"] = 0
    else:
        out["already_complimentary"] = 0
        out["already_complimentary_indefinite"] = 0
        out["already_complimentary_expiring"] = 0

    out["would_receive"] = out["users_total"]
    out["would_change"] = out["users_total"] - out["already_complimentary_indefinite"]

    has_customers = table_exists(cur, "billing_customers")
    has_subs = table_exists(cur, "billing_subscriptions")
    out["billing_tables_present"] = bool(has_customers and has_subs)

    if has_customers:
        cur.execute("SELECT COUNT(*) AS n FROM billing_customers")
        out["billing_customers"] = int(cur.fetchone()["n"])
        cur.execute(
            """
            SELECT COUNT(DISTINCT user_id) AS n
            FROM billing_customers
            WHERE stripe_customer_id IS NOT NULL
              AND BTRIM(stripe_customer_id) <> ''
            """
        )
        out["users_with_stripe_customer"] = int(cur.fetchone()["n"])
    else:
        out["billing_customers"] = 0
        out["users_with_stripe_customer"] = 0

    if has_subs:
        cur.execute("SELECT COUNT(*) AS n FROM billing_subscriptions")
        out["billing_subscriptions"] = int(cur.fetchone()["n"])
        cur.execute(
            """
            SELECT COUNT(*) AS n FROM billing_subscriptions
            WHERE stripe_subscription_id IS NOT NULL
              AND BTRIM(stripe_subscription_id) <> ''
            """
        )
        out["subscriptions_with_stripe_id"] = int(cur.fetchone()["n"])
        cur.execute(
            """
            SELECT LOWER(COALESCE(BTRIM(status), '')) AS status,
                   COUNT(*) AS n,
                   COUNT(*) FILTER (WHERE cancel_at_period_end IS TRUE) AS cancel_at_period_end
            FROM billing_subscriptions
            GROUP BY 1
            ORDER BY n DESC, status
            """
        )
        out["subscription_status_counts"] = [dict(r) for r in cur.fetchall()]
        cur.execute(
            """
            SELECT COUNT(*) AS n FROM billing_subscriptions
            WHERE LOWER(COALESCE(BTRIM(status), '')) = ANY(%s)
            """,
            (list(BILLABLE_STATUSES),),
        )
        out["potentially_billable_subscriptions"] = int(cur.fetchone()["n"])
        cur.execute(
            """
            SELECT COUNT(DISTINCT fm.user_id) AS n
            FROM family_members fm
            JOIN billing_subscriptions bs ON bs.family_id = fm.family_id
            WHERE fm.is_family_owner IS TRUE
              AND bs.stripe_subscription_id IS NOT NULL
              AND BTRIM(bs.stripe_subscription_id) <> ''
            """
        )
        out["users_with_stripe_subscription"] = int(cur.fetchone()["n"])
        cur.execute(
            """
            SELECT COUNT(DISTINCT fm.user_id) AS n
            FROM family_members fm
            JOIN billing_subscriptions bs ON bs.family_id = fm.family_id
            WHERE fm.is_family_owner IS TRUE
              AND LOWER(COALESCE(BTRIM(bs.status), '')) = ANY(%s)
            """,
            (list(BILLABLE_STATUSES),),
        )
        out["users_with_potentially_billable_subscription"] = int(cur.fetchone()["n"])
        cur.execute(
            """
            SELECT u.id,
                   u.email,
                   f.id AS family_id,
                   f.name AS family_name,
                   bs.status,
                   bs.lookup_key,
                   bs.cancel_at_period_end,
                   bs.stripe_subscription_id,
                   bs.current_period_end
            FROM users u
            JOIN family_members fm ON fm.user_id = u.id AND fm.is_family_owner IS TRUE
            JOIN families f ON f.id = fm.family_id
            JOIN billing_subscriptions bs ON bs.family_id = f.id
            WHERE LOWER(COALESCE(BTRIM(bs.status), '')) = ANY(%s)
            ORDER BY u.id, f.id
            """,
            (list(BILLABLE_STATUSES),),
        )
        out["potentially_billable_rows"] = [dict(r) for r in cur.fetchall()]
    else:
        out["billing_subscriptions"] = 0
        out["subscriptions_with_stripe_id"] = 0
        out["subscription_status_counts"] = []
        out["potentially_billable_subscriptions"] = 0
        out["users_with_stripe_subscription"] = 0
        out["users_with_potentially_billable_subscription"] = 0
        out["potentially_billable_rows"] = []

    if table_exists(cur, "complimentary_access_grandfather"):
        cur.execute("SELECT COUNT(*) AS n FROM complimentary_access_grandfather")
        out["ledger_rows"] = int(cur.fetchone()["n"])
    else:
        out["ledger_rows"] = 0

    if table_exists(cur, "transactions"):
        cur.execute("SELECT COUNT(*) AS n FROM transactions")
        out["transactions"] = int(cur.fetchone()["n"])
    else:
        out["transactions"] = None

    return out


def print_report(host: str, data: dict) -> None:
    print(f"Database host: {host}")
    print(f"Complimentary columns present: {data['complimentary_columns_present']}")
    print(f"Billing tables present: {data['billing_tables_present']}")
    print()
    print("ACCOUNTS")
    print(f"  Total production accounts that would receive complimentary access: {data['would_receive']}")
    print(f"  Already marked complimentary: {data['already_complimentary']}")
    print(f"    indefinite (expires_at null): {data['already_complimentary_indefinite']}")
    print(f"    with an expiration: {data['already_complimentary_expiring']}")
    print(f"  Accounts whose two complimentary fields would change on apply: {data['would_change']}")
    print(f"  Existing grandfather ledger rows: {data['ledger_rows']}")
    print()
    print("STRIPE (database only — no Stripe API calls, no cancels/refunds)")
    print(f"  Users with a Stripe customer id: {data['users_with_stripe_customer']}")
    print(f"  Users with a Stripe subscription id: {data['users_with_stripe_subscription']}")
    print(
        "  Users with an active or potentially billable subscription "
        f"(status in {', '.join(BILLABLE_STATUSES)}): "
        f"{data['users_with_potentially_billable_subscription']}"
    )
    print(f"  billing_customers rows: {data['billing_customers']}")
    print(f"  billing_subscriptions rows: {data['billing_subscriptions']}")
    if data["subscription_status_counts"]:
        print("  Subscription status breakdown:")
        for row in data["subscription_status_counts"]:
            extra = ""
            if int(row.get("cancel_at_period_end") or 0):
                extra = f" ({row['cancel_at_period_end']} cancel_at_period_end)"
            print(f"    {row['status'] or '(blank)'}: {row['n']}{extra}")
    if data["potentially_billable_rows"]:
        print()
        print("  Potentially billable subscriptions to review separately:")
        for row in data["potentially_billable_rows"]:
            cap = " cancel_at_period_end" if row.get("cancel_at_period_end") else ""
            print(
                f"    user #{row['id']} {row['email']} | family #{row['family_id']} "
                f"{row['family_name']} | {row['status']} {row.get('lookup_key') or ''} | "
                f"{row['stripe_subscription_id']}{cap}"
            )
    print()
    print("INTENDED APPLY SQL (not executed in --report)")
    print(ENSURE_COLUMNS_SQL.strip())
    print(ENSURE_LEDGER_SQL.strip())
    print(SNAPSHOT_SQL.strip())
    print(APPLY_SQL.strip())


def apply(conn, cur) -> int:
    cur.execute(ENSURE_COLUMNS_SQL)
    cur.execute(ENSURE_LEDGER_SQL)
    cur.execute(SNAPSHOT_SQL)
    snap = cur.rowcount if cur.rowcount is not None and cur.rowcount >= 0 else 0
    cur.execute(APPLY_SQL)
    updated = cur.rowcount if cur.rowcount is not None and cur.rowcount >= 0 else 0
    conn.commit()
    cur.execute(VERIFY_SQL)
    verify = cur.fetchone()
    print(f"Ledger insert rowcount (0 on re-run): {snap}")
    print(f"Users updated this run: {updated}")
    print("Post-apply verification:")
    for k, v in verify.items():
        print(f"  {k}: {v}")
    if int(verify["snapshotted"]) != int(verify["snapshotted_ok"]):
        raise SystemExit("Verification failed: not every snapshotted account is complimentary with null expiration.")
    return updated


def main() -> int:
    parser = argparse.ArgumentParser(description="One-time production complimentary-access grandfathering.")
    parser.add_argument("--report", action="store_true", help="Read-only counts (default).")
    parser.add_argument("--apply", action="store_true", help="Write complimentary flags for snapshotted production users.")
    parser.add_argument(
        "--i-understand-this-is-production",
        action="store_true",
        dest="confirm_prod",
        help="Required with --apply.",
    )
    args = parser.parse_args()
    do_apply = bool(args.apply)
    if do_apply and not args.confirm_prod:
        raise SystemExit("Refusing --apply without --i-understand-this-is-production.")

    url = load_database_url()
    host = database_host(url)
    require_production_host(host)

    conn = connect(url)
    try:
        cur = conn.cursor()
        data = report(cur)
        print_report(host, data)
        if not do_apply:
            print()
            print("No writes performed.")
            return 0
        print()
        print("APPLYING grandfather backfill…")
        apply(conn, cur)
        print("Apply complete. Stripe tables were not modified.")
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
