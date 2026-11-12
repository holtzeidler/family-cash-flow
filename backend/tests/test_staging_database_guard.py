"""Staging starts only on the staging database. Production and the retired staging branch are refused.

The Neon URLs below are parsed, never opened. Staging is simulated by pointing
APP_PUBLIC_BASE_URL at staging.balancewhiz.com after the app loads. Does not
touch a hosted database, call Stripe, or send email.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "e2e"))

from smoke_guard import (  # noqa: E402
    apply_safe_environment,
    assert_loaded_settings,
    assert_process_is_safe,
    smoke_db_path,
)

_DB = smoke_db_path("balancewhiz-smoke-db-guard.db")
_DB.parent.mkdir(parents=True, exist_ok=True)
for _extra in (_DB, Path(str(_DB) + "-wal"), Path(str(_DB) + "-shm")):
    if _extra.exists():
        _extra.unlink()

apply_safe_environment(_DB)
assert_process_is_safe(_DB)

sys.path.insert(0, str(ROOT / "backend"))
import app.main as main  # noqa: E402
from app import trial_ending_reminders  # noqa: E402

assert_loaded_settings(
    database_url=main.settings.DATABASE_URL,
    env=main.settings.ENV,
    stripe_key=main.settings.STRIPE_SECRET_KEY,
    resend_key=main.settings.RESEND_API_KEY,
    smtp_host=main.settings.CONTACT_SMTP_HOST,
    db_filename=_DB.name,
)

NEW_LABEL = "ep-quiet-meadow-a1b2c3d4"
PASSWORD = "not-a-real-password"


def _neon(host: str, database: str = "neondb") -> str:
    return (
        f"postgresql+psycopg://neondb_owner:{PASSWORD}@{host}.c-2.us-east-1.aws.neon.tech/"
        f"{database}?sslmode=require"
    )


NEW_POOLED = _neon(f"{NEW_LABEL}-pooler")
NEW_DIRECT = _neon(NEW_LABEL)
PROD_POOLED = _neon("ep-ancient-union-and21kx9-pooler")
PROD_DIRECT = _neon("ep-ancient-union-and21kx9")
OLD_POOLED = _neon("ep-polished-boat-ando6x8y-pooler")
OLD_DIRECT = _neon("ep-polished-boat-ando6x8y")


@pytest.fixture
def staging(monkeypatch):
    monkeypatch.setattr(main.settings, "APP_PUBLIC_BASE_URL", "https://staging.balancewhiz.com")
    monkeypatch.setattr(main.settings, "STAGING_DATABASE_HOST", NEW_LABEL)
    return monkeypatch


def _use(monkeypatch, url: str) -> None:
    monkeypatch.setattr(main.settings, "DATABASE_URL", url)


def _refused() -> str:
    with pytest.raises(RuntimeError) as exc:
        main.assert_staging_database_isolated()
    return str(exc.value)


@pytest.mark.parametrize("url", [NEW_POOLED, NEW_DIRECT])
def test_staging_starts_on_the_new_staging_project(staging, url):
    _use(staging, url)
    assert main._database_looks_like_staging()
    main.assert_staging_database_isolated()


@pytest.mark.parametrize("host", ["ep-polished-morning-b5pd52j4-pooler", "ep-polished-morning-b5pd52j4"])
def test_the_default_label_admits_the_staging_project(monkeypatch, host):
    monkeypatch.setattr(main.settings, "APP_PUBLIC_BASE_URL", "https://staging.balancewhiz.com")
    monkeypatch.setattr(
        main.settings, "STAGING_DATABASE_HOST", main.Settings.model_fields["STAGING_DATABASE_HOST"].default
    )
    _use(monkeypatch, _neon(host))
    main.assert_staging_database_isolated()


@pytest.mark.parametrize("url", [PROD_POOLED, PROD_DIRECT, OLD_POOLED, OLD_DIRECT])
def test_staging_refuses_production_and_the_retired_branch(staging, url):
    _use(staging, url)
    assert not main._database_looks_like_staging()
    message = _refused()
    assert "Staging refused to start" in message
    assert PASSWORD not in message
    assert "neon.tech" not in message


def test_a_stale_staging_label_cannot_readmit_the_retired_branch(staging):
    staging.setattr(main.settings, "STAGING_DATABASE_HOST", "ep-polished-boat-ando6x8y-pooler")
    _use(staging, OLD_POOLED)
    _refused()


def test_a_swapped_label_cannot_admit_production(staging):
    staging.setattr(main.settings, "STAGING_DATABASE_HOST", "ep-ancient-union-and21kx9-pooler")
    _use(staging, PROD_POOLED)
    _refused()


def test_a_staging_database_name_cannot_readmit_the_retired_branch(staging):
    _use(staging, _neon("ep-polished-boat-ando6x8y-pooler", database="neondb_staging"))
    _refused()


def test_an_unrecognized_host_is_refused(staging):
    _use(staging, _neon("ep-unknown-host-99999999-pooler"))
    _refused()


def test_production_deployment_is_unchanged(monkeypatch):
    monkeypatch.setattr(main.settings, "APP_PUBLIC_BASE_URL", "https://balancewhiz.com")
    _use(monkeypatch, PROD_POOLED)
    assert main._staging_db_writes_allowed()
    main.assert_staging_database_isolated()


def test_startup_refuses_before_touching_the_database(staging):
    _use(staging, PROD_POOLED)

    def touched(*_args, **_kwargs):
        raise AssertionError("startup touched the database")

    staging.setattr(main.Base.metadata, "create_all", touched)
    with pytest.raises(RuntimeError, match="Staging refused to start"):
        main.startup_populate_schema()


def test_staging_cron_refuses_the_retired_branch_before_touching_it(staging):
    staging.setenv("TRIAL_ENDING_REMINDERS_ENABLED", "1")
    staging.delenv("TRIAL_ENDING_REMINDERS_ALLOW_PRODUCTION", raising=False)
    _use(staging, OLD_POOLED)
    assert trial_ending_reminders.refusal_reason() == "refusing a database that is not the staging database"

    def touched(*_args, **_kwargs):
        raise AssertionError("the cron touched the database")

    staging.setattr(main.Base.metadata, "create_all", touched)
    assert trial_ending_reminders.run(dry_run=True) == 1


def test_staging_cron_runs_on_the_new_staging_project(staging):
    staging.setenv("TRIAL_ENDING_REMINDERS_ENABLED", "1")
    _use(staging, NEW_POOLED)
    assert trial_ending_reminders.refusal_reason() == ""


def test_blueprint_staging_label_matches_the_code_default():
    yaml = pytest.importorskip("yaml")
    default = main.Settings.model_fields["STAGING_DATABASE_HOST"].default
    assert "polished-boat" not in default and "ancient-union" not in default
    spec = yaml.safe_load((ROOT / "render.yaml").read_text())
    labelled = []
    for service in spec["services"]:
        env = {item["key"]: item.get("value") for item in service.get("envVars", [])}
        if "STAGING_DATABASE_HOST" in env:
            labelled.append(service["name"])
            assert service["branch"] == "staging"
            assert env["STAGING_DATABASE_HOST"] == default
    assert sorted(labelled) == ["family-cash-flow-api-staging", "family-cash-flow-trial-reminders-staging"]
