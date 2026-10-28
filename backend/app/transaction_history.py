"""Append-only history for one-time transactions and recurring series.

Imported after app.main has finished defining its models. Writes are added to
the caller's session and are not committed here.
"""

from __future__ import annotations

import json
import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Optional

from pydantic import BaseModel
from sqlalchemy import Date, DateTime, ForeignKey, Index, Integer, String, Text, select, text
from sqlalchemy.orm import Mapped, mapped_column

from .main import (
    Account,
    Base,
    Category,
    ExpectedTransaction,
    ExpectedTransactionOverride,
    Transaction,
    User,
    engine,
    settings,
)

SERIES_FIELDS = (
    "account_id",
    "account_name",
    "start_date",
    "end_date",
    "end_count",
    "recurrence",
    "day_of_month",
    "second_day_of_month",
    "second_occurrence_month",
    "description",
    "notes",
    "kind",
    "amount",
    "reimbursable",
    "variable",
    "category_id",
    "category_name",
)

OCCURRENCE_FIELDS = (
    "cancelled",
    "moved_to_date",
    "amount",
    "description",
    "kind",
    "account_id",
    "account_name",
    "category_id",
    "category_name",
    "reimbursable",
    "variable",
)

TRANSACTION_FIELDS = (
    "date",
    "description",
    "notes",
    "kind",
    "amount",
    "category_id",
    "category_name",
    "reimbursable",
)

EARLIER_EDITS_NOTE = "Changes before history was turned on were not recorded."


class TransactionHistory(Base):
    __tablename__ = "transaction_history"
    __table_args__ = (
        Index("ix_transaction_history_subject", "family_id", "subject_type", "subject_id", "created_at"),
        Index("ix_transaction_history_lineage", "family_id", "lineage_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    family_id: Mapped[int] = mapped_column(ForeignKey("families.id", ondelete="CASCADE"), nullable=False, index=True)
    lineage_id: Mapped[str] = mapped_column(String(36), nullable=False)
    subject_type: Mapped[str] = mapped_column(String(32), nullable=False)
    subject_id: Mapped[int] = mapped_column(Integer, nullable=False)
    occurrence_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    related_subject_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    batch_id: Mapped[str] = mapped_column(String(36), nullable=False)
    action: Mapped[str] = mapped_column(String(32), nullable=False)
    actor_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    actor_label: Mapped[str] = mapped_column(String(255), nullable=False)
    actor_kind: Mapped[str] = mapped_column(String(16), nullable=False)
    changes_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=text("CURRENT_TIMESTAMP"))


class TransactionHistoryChangeOut(BaseModel):
    field: str
    before: Optional[Any] = None
    after: Optional[Any] = None


class TransactionHistoryEventOut(BaseModel):
    id: Optional[int] = None
    recorded: bool = True
    created_at: datetime
    action: str
    actor_label: str
    actor_kind: str
    subject_type: str
    subject_id: int
    occurrence_date: Optional[date] = None
    scope: str
    changes: list[TransactionHistoryChangeOut] = []


class TransactionHistoryOut(BaseModel):
    events: list[TransactionHistoryEventOut]
    occurrence_events: list[TransactionHistoryEventOut]
    series_events: list[TransactionHistoryEventOut]
    earlier_edits_note: Optional[str] = None


def new_batch_id() -> str:
    return str(uuid.uuid4())


def new_lineage_id() -> str:
    return str(uuid.uuid4())


def ensure_transaction_history_table() -> None:
    """Create the history table when this process starts. Does not copy existing transactions."""
    with engine.begin() as conn:
        if settings.DATABASE_URL.startswith("sqlite"):
            conn.execute(
                text(
                    "CREATE TABLE IF NOT EXISTS transaction_history ("
                    "id INTEGER PRIMARY KEY AUTOINCREMENT, "
                    "family_id INTEGER NOT NULL, "
                    "lineage_id VARCHAR(36) NOT NULL, "
                    "subject_type VARCHAR(32) NOT NULL, "
                    "subject_id INTEGER NOT NULL, "
                    "occurrence_date DATE, "
                    "related_subject_id INTEGER, "
                    "batch_id VARCHAR(36) NOT NULL, "
                    "action VARCHAR(32) NOT NULL, "
                    "actor_user_id INTEGER, "
                    "actor_label VARCHAR(255) NOT NULL, "
                    "actor_kind VARCHAR(16) NOT NULL, "
                    "changes_json TEXT NOT NULL DEFAULT '[]', "
                    "created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP"
                    ")"
                )
            )
        else:
            conn.execute(
                text(
                    "CREATE TABLE IF NOT EXISTS transaction_history ("
                    "id SERIAL PRIMARY KEY, "
                    "family_id INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE, "
                    "lineage_id VARCHAR(36) NOT NULL, "
                    "subject_type VARCHAR(32) NOT NULL, "
                    "subject_id INTEGER NOT NULL, "
                    "occurrence_date DATE, "
                    "related_subject_id INTEGER, "
                    "batch_id VARCHAR(36) NOT NULL, "
                    "action VARCHAR(32) NOT NULL, "
                    "actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL, "
                    "actor_label VARCHAR(255) NOT NULL, "
                    "actor_kind VARCHAR(16) NOT NULL, "
                    "changes_json TEXT NOT NULL DEFAULT '[]', "
                    "created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()"
                    ")"
                )
            )
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_transaction_history_subject "
                "ON transaction_history (family_id, subject_type, subject_id, created_at)"
            )
        )
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_transaction_history_lineage "
                "ON transaction_history (family_id, lineage_id)"
            )
        )


def _plain(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, Decimal):
        return str(value.quantize(Decimal("0.01")))
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if hasattr(value, "value"):
        return value.value
    if isinstance(value, bool):
        return value
    return value


def _name(db, model, row_id: Optional[int]) -> Optional[str]:
    if row_id is None:
        return None
    row = db.execute(select(model).where(model.id == int(row_id))).scalar_one_or_none()
    if row is None:
        return None
    text_value = str(getattr(row, "name", "") or "").strip()
    return text_value or None


def actor_label_for(db, user_id: Optional[int]) -> str:
    if not user_id:
        return "Family member"
    user = db.execute(select(User).where(User.id == int(user_id))).scalar_one_or_none()
    if user is None:
        return "Family member"
    first = str(user.first_name or "").strip()
    last = str(user.last_name or "").strip()
    full = f"{first} {last}".strip()
    if full:
        return full[:255]
    name = str(user.name or "").strip()
    if name:
        return name[:255]
    return "Family member"


def snapshot_series(db, tx: ExpectedTransaction) -> dict[str, Any]:
    return {
        "account_id": tx.account_id,
        "account_name": _name(db, Account, tx.account_id),
        "start_date": _plain(tx.start_date),
        "end_date": _plain(tx.end_date),
        "end_count": tx.end_count,
        "recurrence": _plain(tx.recurrence),
        "day_of_month": tx.day_of_month,
        "second_day_of_month": tx.second_day_of_month,
        "second_occurrence_month": tx.second_occurrence_month,
        "description": tx.description,
        "notes": tx.notes,
        "kind": _plain(tx.kind),
        "amount": _plain(tx.amount),
        "reimbursable": bool(tx.reimbursable),
        "variable": bool(tx.variable),
        "category_id": tx.category_id,
        "category_name": _name(db, Category, tx.category_id),
    }


def snapshot_occurrence(db, ovr: Optional[ExpectedTransactionOverride]) -> dict[str, Any]:
    if ovr is None:
        return {
            "cancelled": False,
            "moved_to_date": None,
            "amount": None,
            "description": None,
            "kind": None,
            "account_id": None,
            "account_name": None,
            "category_id": None,
            "category_name": None,
            "reimbursable": None,
            "variable": None,
        }
    return {
        "cancelled": bool(ovr.cancelled),
        "moved_to_date": _plain(ovr.moved_to_date),
        "amount": _plain(ovr.amount),
        "description": ovr.description,
        "kind": _plain(ovr.kind),
        "account_id": ovr.account_id,
        "account_name": _name(db, Account, ovr.account_id),
        "category_id": ovr.category_id,
        "category_name": _name(db, Category, ovr.category_id),
        "reimbursable": ovr.reimbursable,
        "variable": ovr.variable,
    }


def snapshot_transaction(db, tx: Transaction) -> dict[str, Any]:
    return {
        "date": _plain(tx.date),
        "description": tx.description,
        "notes": tx.notes,
        "kind": _plain(tx.kind),
        "amount": _plain(tx.amount),
        "category_id": tx.category_id,
        "category_name": _name(db, Category, tx.category_id),
        "reimbursable": bool(tx.reimbursable),
    }


def diff_snapshots(before: Optional[dict[str, Any]], after: Optional[dict[str, Any]]) -> list[dict[str, Any]]:
    allowed = set(SERIES_FIELDS) | set(OCCURRENCE_FIELDS) | set(TRANSACTION_FIELDS) | {"cancelled", "moved_to_date"}
    keys: list[str] = []
    for source in (before, after):
        if not source:
            continue
        for key in source:
            if key in allowed and key not in keys:
                keys.append(key)
    changes: list[dict[str, Any]] = []
    for key in keys:
        old = None if before is None else before.get(key)
        new = None if after is None else after.get(key)
        if old == new:
            continue
        changes.append({"field": key, "before": old, "after": new})
    return changes


def changes_for_create(snapshot: dict[str, Any]) -> list[dict[str, Any]]:
    changes = []
    for key, value in snapshot.items():
        if key not in set(SERIES_FIELDS) | set(TRANSACTION_FIELDS):
            continue
        if value is None or value is False or value == "":
            continue
        changes.append({"field": key, "before": None, "after": value})
    return changes


def lineage_for(db, family_id: int, subject_type: str, subject_id: int) -> Optional[str]:
    return db.execute(
        select(TransactionHistory.lineage_id)
        .where(
            TransactionHistory.family_id == int(family_id),
            TransactionHistory.subject_type == subject_type,
            TransactionHistory.subject_id == int(subject_id),
        )
        .order_by(TransactionHistory.id.desc())
        .limit(1)
    ).scalar_one_or_none()


def append_history(
    db,
    *,
    family_id: int,
    subject_type: str,
    subject_id: int,
    action: str,
    actor_user_id: Optional[int],
    changes: list[dict[str, Any]],
    actor_kind: str = "user",
    occurrence_date: Optional[date] = None,
    related_subject_id: Optional[int] = None,
    batch_id: Optional[str] = None,
    lineage_id: Optional[str] = None,
) -> None:
    """Add one history row to the current session. The caller commits."""
    if action == "updated" and not changes:
        return
    if lineage_id is None:
        lineage_id = lineage_for(db, family_id, subject_type, subject_id) or new_lineage_id()
    if actor_kind == "system":
        label = "Automatic"
    else:
        label = actor_label_for(db, actor_user_id)
    db.add(
        TransactionHistory(
            family_id=int(family_id),
            lineage_id=lineage_id,
            subject_type=subject_type,
            subject_id=int(subject_id),
            occurrence_date=occurrence_date,
            related_subject_id=related_subject_id,
            batch_id=batch_id or new_batch_id(),
            action=action,
            actor_user_id=int(actor_user_id) if actor_user_id else None,
            actor_label=label,
            actor_kind=actor_kind,
            changes_json=json.dumps(changes, separators=(",", ":")),
        )
    )


def on_series_created(
    db,
    tx: ExpectedTransaction,
    actor_user_id: int,
    *,
    batch_id: Optional[str] = None,
    lineage_id: Optional[str] = None,
    related_subject_id: Optional[int] = None,
) -> str:
    lineage = lineage_id or new_lineage_id()
    append_history(
        db,
        family_id=tx.family_id,
        subject_type="expected_series",
        subject_id=tx.id,
        action="created",
        actor_user_id=actor_user_id,
        changes=changes_for_create(snapshot_series(db, tx)),
        batch_id=batch_id,
        lineage_id=lineage,
        related_subject_id=related_subject_id,
    )
    return lineage


def on_series_changed(
    db,
    before: dict[str, Any],
    tx: ExpectedTransaction,
    actor_user_id: int,
    *,
    action: str = "updated",
    batch_id: Optional[str] = None,
    lineage_id: Optional[str] = None,
    related_subject_id: Optional[int] = None,
) -> None:
    append_history(
        db,
        family_id=tx.family_id,
        subject_type="expected_series",
        subject_id=tx.id,
        action=action,
        actor_user_id=actor_user_id,
        changes=diff_snapshots(before, snapshot_series(db, tx)),
        batch_id=batch_id,
        lineage_id=lineage_id,
        related_subject_id=related_subject_id,
    )


def on_series_deleted(
    db,
    before: dict[str, Any],
    *,
    family_id: int,
    series_id: int,
    actor_user_id: int,
    batch_id: Optional[str] = None,
    lineage_id: Optional[str] = None,
) -> None:
    changes = []
    for key, value in before.items():
        if value is None:
            continue
        changes.append({"field": key, "before": value, "after": None})
    append_history(
        db,
        family_id=family_id,
        subject_type="expected_series",
        subject_id=series_id,
        action="deleted",
        actor_user_id=actor_user_id,
        changes=changes,
        batch_id=batch_id,
        lineage_id=lineage_id,
    )


def on_occurrence_changed(
    db,
    before: dict[str, Any],
    after: dict[str, Any],
    *,
    family_id: int,
    series_id: int,
    occurrence_date: date,
    actor_user_id: int,
    action: str,
    batch_id: Optional[str] = None,
    lineage_id: Optional[str] = None,
) -> None:
    append_history(
        db,
        family_id=family_id,
        subject_type="expected_occurrence",
        subject_id=series_id,
        action=action,
        actor_user_id=actor_user_id,
        changes=diff_snapshots(before, after),
        occurrence_date=occurrence_date,
        batch_id=batch_id,
        lineage_id=lineage_id,
    )


def on_automatic_skips(
    db,
    absorbed: list[dict],
    *,
    family_id: int,
    series_id: int,
    actor_user_id: int,
    batch_id: str,
    lineage_id: str,
) -> None:
    db.flush()
    for item in absorbed or []:
        occ = item.get("occurrence_date")
        if occ is None:
            continue
        row = db.execute(
            select(ExpectedTransactionOverride).where(
                ExpectedTransactionOverride.expected_transaction_id == int(series_id),
                ExpectedTransactionOverride.occurrence_date == occ,
            )
        ).scalar_one_or_none()
        if row is None or not row.cancelled:
            continue
        append_history(
            db,
            family_id=family_id,
            subject_type="expected_occurrence",
            subject_id=series_id,
            action="skipped",
            actor_user_id=actor_user_id,
            actor_kind="system",
            changes=diff_snapshots(item.get("before") or {}, item.get("after") or {}),
            occurrence_date=occ,
            batch_id=batch_id,
            lineage_id=lineage_id,
        )


def on_transaction_created(db, tx: Transaction, actor_user_id: int) -> None:
    append_history(
        db,
        family_id=tx.family_id,
        subject_type="transaction",
        subject_id=tx.id,
        action="created",
        actor_user_id=actor_user_id,
        changes=changes_for_create(snapshot_transaction(db, tx)),
        lineage_id=new_lineage_id(),
    )


def on_transaction_changed(db, before: dict[str, Any], tx: Transaction, actor_user_id: int) -> None:
    append_history(
        db,
        family_id=tx.family_id,
        subject_type="transaction",
        subject_id=tx.id,
        action="updated",
        actor_user_id=actor_user_id,
        changes=diff_snapshots(before, snapshot_transaction(db, tx)),
    )


def on_transaction_deleted(db, before: dict[str, Any], *, family_id: int, transaction_id: int, actor_user_id: int) -> None:
    changes = []
    for key, value in before.items():
        if value is None:
            continue
        changes.append({"field": key, "before": value, "after": None})
    append_history(
        db,
        family_id=family_id,
        subject_type="transaction",
        subject_id=transaction_id,
        action="deleted",
        actor_user_id=actor_user_id,
        changes=changes,
    )


def _event_from_row(row: TransactionHistory, scope: str) -> dict[str, Any]:
    try:
        raw_changes = json.loads(row.changes_json or "[]")
    except json.JSONDecodeError:
        raw_changes = []
    changes = []
    for item in raw_changes if isinstance(raw_changes, list) else []:
        if not isinstance(item, dict) or "field" not in item:
            continue
        changes.append({"field": str(item.get("field")), "before": item.get("before"), "after": item.get("after")})
    return {
        "id": row.id,
        "recorded": True,
        "created_at": row.created_at,
        "action": row.action,
        "actor_label": row.actor_label,
        "actor_kind": row.actor_kind,
        "subject_type": row.subject_type,
        "subject_id": row.subject_id,
        "occurrence_date": row.occurrence_date,
        "scope": scope,
        "changes": changes,
    }


def _sort_events(events: list[dict]) -> list[dict]:
    def key(event: dict):
        stamp = event.get("created_at") or datetime.min
        return (stamp, event.get("id") or 0)

    return sorted(events, key=key, reverse=True)


def load_history(
    db,
    *,
    family_id: int,
    subject_type: str,
    subject_id: int,
    occurrence_date: Optional[date] = None,
) -> Optional[dict[str, Any]]:
    family_id = int(family_id)
    subject_id = int(subject_id)
    live_series: Optional[ExpectedTransaction] = None
    live_transaction: Optional[Transaction] = None
    if subject_type == "transaction":
        live_transaction = db.execute(
            select(Transaction).where(Transaction.id == subject_id, Transaction.family_id == family_id)
        ).scalar_one_or_none()
    elif subject_type in {"expected_series", "expected_occurrence"}:
        live_series = db.execute(
            select(ExpectedTransaction).where(
                ExpectedTransaction.id == subject_id,
                ExpectedTransaction.family_id == family_id,
            )
        ).scalar_one_or_none()
    else:
        return None

    own_rows = list(
        db.execute(
            select(TransactionHistory)
            .where(
                TransactionHistory.family_id == family_id,
                TransactionHistory.subject_id == subject_id,
                TransactionHistory.subject_type.in_(
                    ["transaction"] if subject_type == "transaction" else ["expected_series", "expected_occurrence"]
                ),
            )
            .order_by(TransactionHistory.id.asc())
        )
        .scalars()
        .all()
    )
    if live_transaction is None and live_series is None and not own_rows:
        return None

    if subject_type == "transaction":
        events = [_event_from_row(row, "transaction") for row in own_rows]
        events = _sort_events(events)
        return {
            "events": events,
            "occurrence_events": [],
            "series_events": [],
            "earlier_edits_note": None,
        }

    lineage_ids = {row.lineage_id for row in own_rows if row.lineage_id}
    related_ids = {subject_id}
    if lineage_ids:
        linked = list(
            db.execute(
                select(TransactionHistory).where(
                    TransactionHistory.family_id == family_id,
                    TransactionHistory.lineage_id.in_(lineage_ids),
                )
            )
            .scalars()
            .all()
        )
    else:
        linked = list(own_rows)
    for row in linked:
        if row.subject_type == "expected_series":
            related_ids.add(row.subject_id)
        if row.related_subject_id:
            related_ids.add(int(row.related_subject_id))

    series_rows = list(
        db.execute(
            select(TransactionHistory)
            .where(
                TransactionHistory.family_id == family_id,
                TransactionHistory.subject_type == "expected_series",
                TransactionHistory.subject_id.in_(related_ids),
            )
            .order_by(TransactionHistory.id.asc())
        )
        .scalars()
        .all()
    )
    series_events = [_event_from_row(row, "series") for row in series_rows]
    created_ids = {row.subject_id for row in series_rows if row.action == "created"}
    synthetic = []
    for series_id in sorted(related_ids):
        if series_id in created_ids:
            continue
        series = db.execute(
            select(ExpectedTransaction).where(
                ExpectedTransaction.id == int(series_id),
                ExpectedTransaction.family_id == family_id,
            )
        ).scalar_one_or_none()
        if series is None:
            continue
        synthetic.append(
            {
                "id": None,
                "recorded": False,
                "created_at": series.created_at,
                "action": "created",
                "actor_label": actor_label_for(db, series.created_by_user_id),
                "actor_kind": "user",
                "subject_type": "expected_series",
                "subject_id": series.id,
                "occurrence_date": None,
                "scope": "series",
                "changes": [],
            }
        )
    series_events.extend(synthetic)
    series_events = _sort_events(series_events)

    occurrence_events: list[dict] = []
    if subject_type == "expected_occurrence" and occurrence_date is not None:
        occ_rows = list(
            db.execute(
                select(TransactionHistory)
                .where(
                    TransactionHistory.family_id == family_id,
                    TransactionHistory.subject_type == "expected_occurrence",
                    TransactionHistory.subject_id.in_(related_ids),
                    TransactionHistory.occurrence_date == occurrence_date,
                )
                .order_by(TransactionHistory.id.asc())
            )
            .scalars()
            .all()
        )
        occurrence_events = _sort_events([_event_from_row(row, "occurrence") for row in occ_rows])

    note = EARLIER_EDITS_NOTE if synthetic else None
    if subject_type == "expected_occurrence":
        combined = _sort_events(occurrence_events + series_events)
    else:
        combined = series_events
    return {
        "events": combined,
        "occurrence_events": occurrence_events,
        "series_events": series_events,
        "earlier_edits_note": note,
    }
