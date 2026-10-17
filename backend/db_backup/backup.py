"""Nightly backup of the production Neon database into Render Postgres.

This is a one-shot command for the Render cron job family-cash-flow-db-backup.
It only reads from Neon. It writes only to the Render backup database.

One run does three things:
1. Dumps Neon (SOURCE_DATABASE_URL) with pg_dump into a custom-format file.
2. Saves that file in backup_archive.dumps on the Render database, then prunes
   old dumps. Kept: every dump from the last KEEP_DAILY days, plus the oldest
   dump of each of the last KEEP_MONTHLY months.
3. Restores the dump over the mirror tables in the Render database's public
   schema, in one transaction. The mirror is a ready-to-use copy for failover.

Safety:
- Refuses a backup URL on neon.tech or on the same host as the source.
- Refuses a source whose host does not contain EXPECTED_SOURCE_HOST.
- Skips the mirror refresh, and exits 1, when users, families, or transactions
  shrank below half of what the mirror already holds. That keeps a wiped or
  corrupted Neon from overwriting the last good mirror. The dump is still
  archived. Set FORCE_MIRROR_REFRESH=1 for one run to accept the shrink.
- A failed restore rolls back and leaves the previous mirror in place.

Never logs connection strings or passwords.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import logging
import os
import subprocess
import sys
import tempfile
from urllib.parse import urlparse, urlunparse

logger = logging.getLogger("balancewhiz.db_backup")

ARCHIVE_SCHEMA = "backup_archive"
GUARDED_TABLES = ("users", "families", "transactions")
SHRINK_RATIO = 0.5
MIN_ROWS_FOR_SHRINK_CHECK = 10
KEEP_DAILY = 30
KEEP_MONTHLY = 12
MAX_ARCHIVE_BYTES = 500 * 1024 * 1024


def normalize_url(raw: str) -> str:
    url = (raw or "").strip()
    for prefix in ("postgresql+psycopg://", "postgresql+psycopg2://", "postgres://"):
        if url.startswith(prefix):
            return "postgresql://" + url[len(prefix) :]
    return url


def host_of(url: str) -> str:
    return (urlparse(normalize_url(url)).hostname or "").lower()


def unpooled(url: str) -> str:
    """Neon's pooler does not support pg_dump reliably; use the direct endpoint."""
    url = normalize_url(url)
    parsed = urlparse(url)
    host = parsed.hostname or ""
    first, dot, rest = host.partition(".")
    if not first.endswith("-pooler"):
        return url
    direct = first[: -len("-pooler")] + dot + rest
    return urlunparse(parsed._replace(netloc=parsed.netloc.replace(host, direct, 1)))


def refusal_reason(source_url: str, backup_url: str, expected_source_host: str) -> str:
    """Empty when this run may proceed."""
    source_host = host_of(source_url)
    backup_host = host_of(backup_url)
    if not source_host:
        return "SOURCE_DATABASE_URL is not set"
    if not backup_host:
        return "BACKUP_DATABASE_URL is not set"
    if "neon.tech" in backup_host:
        return "BACKUP_DATABASE_URL points at Neon; it must be the Render backup database"
    if source_host.replace("-pooler", "") == backup_host.replace("-pooler", ""):
        return "source and backup are the same host"
    expected = (expected_source_host or "").strip().lower()
    if not expected:
        return "EXPECTED_SOURCE_HOST is not set"
    if expected.replace("-pooler", "") not in source_host:
        return "SOURCE_DATABASE_URL host does not match EXPECTED_SOURCE_HOST"
    return ""


def shrink_problems(mirror_counts: dict[str, int], source_counts: dict[str, int]) -> list[str]:
    problems = []
    for table in GUARDED_TABLES:
        before = mirror_counts.get(table, 0)
        after = source_counts.get(table, 0)
        if before >= MIN_ROWS_FOR_SHRINK_CHECK and after < before * SHRINK_RATIO:
            problems.append(f"{table}: mirror has {before} rows, Neon has {after}")
    return problems


def ids_to_prune(rows: list[tuple[int, dt.datetime]], now: dt.datetime) -> list[int]:
    """rows are (id, created_at). Returns the ids outside the retention policy."""
    keep: set[int] = set()
    daily_cutoff = now - dt.timedelta(days=KEEP_DAILY)
    oldest_in_month: dict[tuple[int, int], tuple[dt.datetime, int]] = {}
    for row_id, created in rows:
        if created >= daily_cutoff:
            keep.add(row_id)
        month = (created.year, created.month)
        if month not in oldest_in_month or created < oldest_in_month[month][0]:
            oldest_in_month[month] = (created, row_id)
    for month in sorted(oldest_in_month, reverse=True)[:KEEP_MONTHLY]:
        keep.add(oldest_in_month[month][1])
    return sorted(row_id for row_id, _ in rows if row_id not in keep)


def _run(args: list[str]) -> subprocess.CompletedProcess:
    result = subprocess.run(args, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"{args[0]} failed: {result.stderr.strip()[-2000:]}")
    return result


def _table_counts(conn) -> dict[str, int]:
    counts = {}
    with conn.cursor() as cur:
        for table in GUARDED_TABLES:
            cur.execute("SELECT to_regclass(%s)", (f"public.{table}",))
            if cur.fetchone()[0] is None:
                continue
            cur.execute(f'SELECT count(*) FROM public."{table}"')
            counts[table] = int(cur.fetchone()[0])
    conn.commit()
    return counts


def _ensure_archive(conn) -> None:
    with conn.cursor() as cur:
        cur.execute(f"CREATE SCHEMA IF NOT EXISTS {ARCHIVE_SCHEMA}")
        cur.execute(
            f"""
            CREATE TABLE IF NOT EXISTS {ARCHIVE_SCHEMA}.dumps (
                id bigserial PRIMARY KEY,
                created_at timestamptz NOT NULL DEFAULT now(),
                source_host text NOT NULL,
                size_bytes bigint NOT NULL,
                sha256 text NOT NULL,
                source_counts jsonb NOT NULL,
                mirror_restored_at timestamptz,
                dump bytea NOT NULL
            )
            """
        )
    conn.commit()


def _archive_dump(conn, path: str, source_host: str, source_counts: dict[str, int]) -> int:
    with open(path, "rb") as fh:
        data = fh.read()
    with conn.cursor() as cur:
        cur.execute(
            f"""
            INSERT INTO {ARCHIVE_SCHEMA}.dumps (source_host, size_bytes, sha256, source_counts, dump)
            VALUES (%s, %s, %s, %s, %s) RETURNING id
            """,
            (source_host, len(data), hashlib.sha256(data).hexdigest(), json.dumps(source_counts), data),
        )
        dump_id = int(cur.fetchone()[0])
        cur.execute(f"SELECT id, created_at FROM {ARCHIVE_SCHEMA}.dumps")
        stale = ids_to_prune(cur.fetchall(), dt.datetime.now(dt.timezone.utc))
        if stale:
            cur.execute(f"DELETE FROM {ARCHIVE_SCHEMA}.dumps WHERE id = ANY(%s)", (stale,))
    conn.commit()
    logger.info("Archived dump id=%s (%s bytes); pruned %s old dumps", dump_id, len(data), len(stale))
    return dump_id


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    import psycopg

    source_url = unpooled(os.environ.get("SOURCE_DATABASE_URL", ""))
    backup_url = normalize_url(os.environ.get("BACKUP_DATABASE_URL", ""))
    reason = refusal_reason(source_url, backup_url, os.environ.get("EXPECTED_SOURCE_HOST", ""))
    if reason:
        logger.error("Backup refused: %s", reason)
        return 2

    source_host = host_of(source_url)
    with psycopg.connect(source_url) as source:
        source.read_only = True
        source_counts = _table_counts(source)
        server_version = source.info.server_version
    logger.info("Neon %s (server %s) counts: %s", source_host, server_version, source_counts)

    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "neon.dump")
        _run(["pg_dump", "--format=custom", "--no-owner", "--no-acl", f"--dbname={source_url}", f"--file={path}"])
        listing = _run(["pg_restore", "--list", path]).stdout
        if " TABLE public users " not in listing:
            logger.error("Dump has no public.users table; not archiving or restoring it")
            return 1
        size = os.path.getsize(path)
        logger.info("pg_dump finished: %s bytes", size)

        with psycopg.connect(backup_url) as backup:
            _ensure_archive(backup)
            dump_id = None
            if size <= MAX_ARCHIVE_BYTES:
                dump_id = _archive_dump(backup, path, source_host, source_counts)
            else:
                logger.error("Dump is larger than %s bytes; not archived. Mirror still refreshes.", MAX_ARCHIVE_BYTES)

            mirror_counts = _table_counts(backup)
            problems = shrink_problems(mirror_counts, source_counts)
            if problems and os.environ.get("FORCE_MIRROR_REFRESH", "").strip() != "1":
                logger.error(
                    "Mirror not refreshed; Neon shrank sharply (%s). The dump was archived. "
                    "If this is expected, rerun with FORCE_MIRROR_REFRESH=1.",
                    "; ".join(problems),
                )
                return 1

            _run(
                [
                    "pg_restore",
                    "--clean",
                    "--if-exists",
                    "--no-owner",
                    "--no-acl",
                    "--single-transaction",
                    "--exit-on-error",
                    f"--dbname={backup_url}",
                    path,
                ]
            )
            restored_counts = _table_counts(backup)
            if dump_id is not None:
                with backup.cursor() as cur:
                    cur.execute(
                        f"UPDATE {ARCHIVE_SCHEMA}.dumps SET mirror_restored_at = now() WHERE id = %s",
                        (dump_id,),
                    )
                backup.commit()
        logger.info("Mirror refreshed; counts now %s", restored_counts)

    return 0 if size <= MAX_ARCHIVE_BYTES else 1


if __name__ == "__main__":
    sys.exit(main())
