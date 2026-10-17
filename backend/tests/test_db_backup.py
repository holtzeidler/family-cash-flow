"""The nightly backup must never write to Neon and must not overwrite a good mirror with a wiped one."""

from __future__ import annotations

import datetime as dt
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "db_backup"))

from backup import ids_to_prune, refusal_reason, shrink_problems, unpooled  # noqa: E402

NEON = "postgresql://u:p@ep-ancient-union-and21kx9-pooler.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require"
RENDER = "postgresql://u:p@dpg-abc123-a/balancewhiz_backup"
EXPECTED = "ep-ancient-union-and21kx9"


def test_production_neon_to_render_is_allowed():
    assert refusal_reason(NEON, RENDER, EXPECTED) == ""


def test_backup_url_on_neon_is_refused():
    other_neon = "postgresql://u:p@ep-polished-boat-ando6x8y-pooler.c-2.us-east-1.aws.neon.tech/neondb"
    assert "Neon" in refusal_reason(NEON, other_neon, EXPECTED)


def test_same_host_is_refused():
    assert "same host" in refusal_reason(RENDER, RENDER, "dpg-abc123")
    pooled = RENDER.replace("dpg-abc123-a", "dpg-abc123-a-pooler")
    assert "same host" in refusal_reason(pooled, RENDER, "dpg-abc123")


def test_unexpected_source_is_refused():
    staging = "postgresql://u:p@ep-polished-boat-ando6x8y-pooler.neon.tech/neondb"
    assert "EXPECTED_SOURCE_HOST" in refusal_reason(staging, RENDER, EXPECTED)
    assert "EXPECTED_SOURCE_HOST" in refusal_reason(NEON, RENDER, "")


def test_missing_urls_are_refused():
    assert "SOURCE_DATABASE_URL" in refusal_reason("", RENDER, EXPECTED)
    assert "BACKUP_DATABASE_URL" in refusal_reason(NEON, "", EXPECTED)


def test_unpooled_strips_only_the_neon_pooler_suffix():
    assert unpooled(NEON) == (
        "postgresql://u:p@ep-ancient-union-and21kx9.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require"
    )
    assert unpooled(RENDER) == RENDER
    assert unpooled("postgresql+psycopg://u:p@h-pooler.x/db").startswith("postgresql://u:p@h.x/")


def test_sharp_shrink_blocks_mirror_refresh():
    mirror = {"users": 100, "families": 80, "transactions": 5000}
    assert shrink_problems(mirror, {"users": 101, "families": 80, "transactions": 5100}) == []
    problems = shrink_problems(mirror, {"users": 0, "families": 0, "transactions": 0})
    assert len(problems) == 3
    assert "users" in problems[0]


def test_empty_mirror_never_blocks_first_run():
    assert shrink_problems({}, {"users": 3}) == []
    assert shrink_problems({"users": 5}, {"users": 0}) == []


def test_retention_keeps_recent_dailies_and_one_per_month():
    now = dt.datetime(2026, 10, 17, 9, tzinfo=dt.timezone.utc)
    rows = [(i, now - dt.timedelta(days=i)) for i in range(400)]
    pruned = set(ids_to_prune(rows, now))
    kept = {i for i, _ in rows} - pruned
    assert set(range(31)) <= kept
    older = kept - set(range(31))
    months = {(now - dt.timedelta(days=i)).strftime("%Y-%m") for i in older}
    assert len(older) == len(months)
    assert len(kept - set(range(31))) <= 12
    assert 399 in pruned
