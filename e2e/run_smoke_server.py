"""Start BalanceWhiz on localhost with a fresh smoke database.

The safe environment is applied before the application is imported so
backend/.env cannot select a hosted database, Stripe, or Resend.
"""

from __future__ import annotations

import socket
import sys
from pathlib import Path

from smoke_guard import (
    SMOKE_PORT,
    apply_safe_environment,
    assert_loaded_settings,
    assert_process_is_safe,
    smoke_db_path,
)


def _port_is_free() -> bool:
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        sock.bind(("127.0.0.1", SMOKE_PORT))
    except OSError:
        return False
    finally:
        sock.close()
    return True


def _remove_db(path: Path) -> None:
    for candidate in (path, Path(str(path) + "-wal"), Path(str(path) + "-shm")):
        if candidate.exists():
            candidate.unlink()


def main() -> None:
    if not _port_is_free():
        raise SystemExit(
            f"Smoke test refused to start: port {SMOKE_PORT} is already in use. "
            "Not attaching to an existing server."
        )
    db_path = smoke_db_path()
    db_path.parent.mkdir(parents=True, exist_ok=True)
    _remove_db(db_path)
    apply_safe_environment(db_path)
    assert_process_is_safe(db_path)

    backend = Path(__file__).resolve().parents[1] / "backend"
    sys.path.insert(0, str(backend))
    from app.main import settings

    assert_loaded_settings(
        database_url=settings.DATABASE_URL,
        env=settings.ENV,
        stripe_key=settings.STRIPE_SECRET_KEY,
        resend_key=settings.RESEND_API_KEY,
        smtp_host=settings.CONTACT_SMTP_HOST,
        db_filename=db_path.name,
    )
    print("Smoke server: local sqlite, Stripe off, email off", flush=True)

    import uvicorn

    uvicorn.run(
        "app.main:app",
        host="127.0.0.1",
        port=SMOKE_PORT,
        log_level="warning",
        access_log=False,
    )


if __name__ == "__main__":
    main()
