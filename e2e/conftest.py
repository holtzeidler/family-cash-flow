"""Playwright session for the local smoke suite."""

from __future__ import annotations

import json
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

import pytest
from playwright.sync_api import expect

from smoke_guard import SMOKE_ORIGIN, smoke_run_dir

_RESULTS = []
_SERVER = None
_SERVER_LOG = None


def _title_for(item) -> str:
    mark = item.get_closest_marker("smoke_title")
    if mark and mark.args:
        return str(mark.args[0])
    return item.name.replace("_", " ")


@pytest.fixture(scope="session")
def browser_context_args(browser_context_args):
    return {**browser_context_args, "viewport": {"width": 1280, "height": 800}}


@pytest.fixture(scope="session", autouse=True)
def smoke_server():
    """Start the local API and seed it once for the browser tests."""
    global _SERVER, _SERVER_LOG
    run_dir = smoke_run_dir()
    run_dir.mkdir(parents=True, exist_ok=True)
    log_path = run_dir / "server.log"
    _SERVER_LOG = open(log_path, "w", encoding="utf-8")
    server_script = Path(__file__).resolve().parent / "run_smoke_server.py"
    _SERVER = subprocess.Popen(
        [sys.executable, str(server_script)],
        cwd=str(Path(__file__).resolve().parent),
        stdout=_SERVER_LOG,
        stderr=subprocess.STDOUT,
    )
    deadline = time.time() + 90
    last_error = "server did not become ready"
    while time.time() < deadline:
        if _SERVER.poll() is not None:
            last_error = f"server exited early (see {log_path.name})"
            break
        try:
            with urllib.request.urlopen(SMOKE_ORIGIN + "/api/health", timeout=2) as resp:
                if resp.status == 200:
                    last_error = ""
                    break
        except Exception as exc:
            last_error = str(exc)
            time.sleep(0.4)
    if last_error:
        _stop_server()
        pytest.exit(f"Smoke server did not start. {last_error}", returncode=1)

    seed = subprocess.run(
        [sys.executable, str(Path(__file__).resolve().parent / "seed_smoke.py")],
        cwd=str(Path(__file__).resolve().parent),
        capture_output=True,
        text=True,
    )
    if seed.returncode != 0:
        _stop_server()
        detail = (seed.stderr or seed.stdout or "seed failed").strip()
        pytest.exit(detail, returncode=1)
    yield
    _stop_server()


def _stop_server() -> None:
    global _SERVER, _SERVER_LOG
    if _SERVER is not None and _SERVER.poll() is None:
        _SERVER.terminate()
        try:
            _SERVER.wait(timeout=10)
        except subprocess.TimeoutExpired:
            _SERVER.kill()
    _SERVER = None
    if _SERVER_LOG is not None:
        _SERVER_LOG.close()
        _SERVER_LOG = None


@pytest.fixture(scope="session")
def seed():
    return json.loads((smoke_run_dir() / "seed.json").read_text(encoding="utf-8"))


@pytest.fixture
def guard(page, request):
    from support import PageGuard

    expect.set_options(timeout=20_000)
    page.set_default_timeout(20_000)
    watcher = PageGuard(page)
    request.node._smoke_guard = watcher
    yield watcher
    if not watcher.checked:
        watcher.assert_clean()


def pytest_runtest_makereport(item, call):
    if call.when not in ("setup", "call", "teardown"):
        return
    title = _title_for(item)
    row = next((entry for entry in _RESULTS if entry["nodeid"] == item.nodeid), None)
    if row is None:
        row = {"nodeid": item.nodeid, "title": title, "failed": False, "reason": "", "route": ""}
        _RESULTS.append(row)
    if call.excinfo is not None:
        row["failed"] = True
        message = str(call.excinfo.value).strip().splitlines()
        if message and not row["reason"]:
            row["reason"] = message[0][:500]
        guard = getattr(item, "_smoke_guard", None)
        if guard is not None:
            try:
                row["route"] = guard.page.url
            except Exception:
                pass
            if guard.page_errors:
                row["js"] = guard.page_errors[0]
            if guard.network:
                row["network"] = guard.network[0]
            if guard.console:
                row["console"] = guard.console[0]


def pytest_sessionfinish(session, exitstatus):
    run_dir = smoke_run_dir()
    run_dir.mkdir(parents=True, exist_ok=True)
    if not _RESULTS:
        message = "BALANCEWHIZ SMOKE TEST\n\nThe suite did not finish.\n"
        (run_dir / "summary.txt").write_text(message, encoding="utf-8")
        (run_dir / "failures.txt").write_text("", encoding="utf-8")
        return
    lines = ["BALANCEWHIZ SMOKE TEST", ""]
    passed = 0
    failed = 0
    details = []
    for row in _RESULTS:
        if row["failed"]:
            lines.append("✗ " + row["title"])
            failed += 1
            details.append(row["title"])
            if row.get("route"):
                details.append("Route: " + row["route"])
            if row.get("reason"):
                details.append("Reason: " + row["reason"])
            if row.get("js"):
                details.append("Console error: " + row["js"])
            if row.get("console"):
                details.append("Console error: " + row["console"])
            if row.get("network"):
                details.append("Failed request: " + row["network"])
            details.append("")
        else:
            lines.append("✓ " + row["title"])
            passed += 1
    lines.append("")
    lines.append(f"{passed} passed")
    if failed:
        lines.append(f"{failed} failed")
    (run_dir / "summary.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
    (run_dir / "failures.txt").write_text("\n".join(details), encoding="utf-8")
