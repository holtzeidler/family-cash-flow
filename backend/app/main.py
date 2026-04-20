from __future__ import annotations

import logging
from collections import defaultdict
from datetime import date, datetime, timedelta
from decimal import Decimal
from enum import Enum
from pathlib import Path
from typing import Annotated, Literal, Optional, Sequence
from urllib.parse import urlparse

from fastapi import Cookie, Depends, FastAPI, HTTPException, Query, Response, status
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import bcrypt
from jose import jwt
from pydantic import BaseModel, EmailStr, Field, field_validator
from pydantic_settings import BaseSettings
from sqlalchemy import Date as SA_Date
from sqlalchemy import Enum as SAEnum
from sqlalchemy import Boolean, Integer, UniqueConstraint
from sqlalchemy import ForeignKey
from sqlalchemy import String
from sqlalchemy import delete, func, select, text
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship, sessionmaker
from sqlalchemy.types import Numeric


class Settings(BaseSettings):
    ENV: str = "development"
    PORT: int = 8000

    DATABASE_URL: str = "sqlite:///./data/app.db"

    JWT_SECRET: str = "change-me-in-production"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_MINUTES: int = 1440
    CORS_ORIGINS: str = ""

    @field_validator("DATABASE_URL", mode="after")
    @classmethod
    def normalize_postgres_driver(cls, v: str) -> str:
        # Bare postgresql:// makes SQLAlchemy use psycopg2; we depend on psycopg v3 only.
        if v.startswith("sqlite"):
            return v
        if v.startswith("postgresql+") or v.startswith("postgres+"):
            return v
        if v.startswith("postgresql://"):
            return "postgresql+psycopg://" + v[len("postgresql://") :]
        if v.startswith("postgres://"):
            return "postgresql+psycopg://" + v[len("postgres://") :]
        return v


settings = Settings(_env_file=Path(__file__).resolve().parents[1] / ".env", _env_file_encoding="utf-8")

logger = logging.getLogger(__name__)


class Base(DeclarativeBase):
    pass


class TransactionKind(str, Enum):
    income = "income"
    expense = "expense"


class AccountType(str, Enum):
    checking = "checking"
    savings = "savings"
    credit_card = "credit_card"
    cash = "cash"
    other = "other"


class Recurrence(str, Enum):
    once = "once"
    weekly = "weekly"
    monthly = "monthly"
    twice_monthly = "twice_monthly"  # two fixed days per month (start day + second day)
    semiannual = "semiannual"  # twice yearly / every 6 months
    yearly = "yearly"


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())

    memberships: Mapped[list[FamilyMember]] = relationship(back_populates="user")


class Family(Base):
    __tablename__ = "families"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255), index=True)
    created_at: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())

    memberships: Mapped[list[FamilyMember]] = relationship(back_populates="family")
    accounts: Mapped[list[Account]] = relationship(back_populates="family")
    categories: Mapped[list[Category]] = relationship(back_populates="family")
    transactions: Mapped[list[Transaction]] = relationship(back_populates="family")


class FamilyMember(Base):
    __tablename__ = "family_members"

    family_id: Mapped[int] = mapped_column(ForeignKey("families.id"), nullable=False, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, primary_key=True)
    role: Mapped[str] = mapped_column(String(50), nullable=False, default="member")

    family: Mapped[Family] = relationship(back_populates="memberships")
    user: Mapped[User] = relationship(back_populates="memberships")

class Category(Base):
    __tablename__ = "categories"

    id: Mapped[int] = mapped_column(primary_key=True)
    family_id: Mapped[int] = mapped_column(ForeignKey("families.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    parent_id: Mapped[Optional[int]] = mapped_column(ForeignKey("categories.id"), nullable=True, index=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    fg_color: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    bg_color: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)

    family: Mapped[Family] = relationship(back_populates="categories")


class Transaction(Base):
    __tablename__ = "transactions"

    id: Mapped[int] = mapped_column(primary_key=True)
    family_id: Mapped[int] = mapped_column(ForeignKey("families.id"), nullable=False, index=True)

    date: Mapped[date] = mapped_column(SA_Date, nullable=False, index=True)
    description: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    vendor: Mapped[Optional[str]] = mapped_column(String(255), nullable=True, index=True)
    raw_description: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    kind: Mapped[TransactionKind] = mapped_column(SAEnum(TransactionKind), nullable=False, default=TransactionKind.expense)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    reimbursable: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # Imported transactions are analysis-only: visible/editable but excluded from balance math.
    imported: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    import_batch_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)
    imported_at: Mapped[Optional[datetime]] = mapped_column(nullable=True)

    category_id: Mapped[Optional[int]] = mapped_column(ForeignKey("categories.id"), nullable=True, index=True)
    account_id: Mapped[Optional[int]] = mapped_column(ForeignKey("accounts.id"), nullable=True, index=True)

    family: Mapped[Family] = relationship(back_populates="transactions")


class Account(Base):
    __tablename__ = "accounts"

    id: Mapped[int] = mapped_column(primary_key=True)
    family_id: Mapped[int] = mapped_column(ForeignKey("families.id"), nullable=False, index=True)

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    type: Mapped[AccountType] = mapped_column(SAEnum(AccountType), nullable=False, default=AccountType.checking)
    starting_balance: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    starting_balance_date: Mapped[date] = mapped_column(SA_Date, nullable=False, default=date.today)

    created_at: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())

    family: Mapped[Family] = relationship(back_populates="accounts")


class ExpectedTransaction(Base):
    __tablename__ = "expected_transactions"

    id: Mapped[int] = mapped_column(primary_key=True)
    family_id: Mapped[int] = mapped_column(ForeignKey("families.id"), nullable=False, index=True)

    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), nullable=False, index=True)
    created_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)

    start_date: Mapped[date] = mapped_column(SA_Date, nullable=False, index=True)
    end_date: Mapped[Optional[date]] = mapped_column(SA_Date, nullable=True, index=True)
    recurrence: Mapped[Recurrence] = mapped_column(SAEnum(Recurrence), nullable=False, default=Recurrence.once)
    # For recurrence=twice_monthly: second calendar day-of-month (1–31); first day is start_date.day.
    second_day_of_month: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    description: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    notes: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    kind: Mapped[TransactionKind] = mapped_column(SAEnum(TransactionKind), nullable=False, default=TransactionKind.expense)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    reimbursable: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    variable: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    category_id: Mapped[Optional[int]] = mapped_column(ForeignKey("categories.id"), nullable=True, index=True)

    created_at: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())


class ExpectedTransactionOverride(Base):
    __tablename__ = "expected_transaction_overrides"

    id: Mapped[int] = mapped_column(primary_key=True)
    expected_transaction_id: Mapped[int] = mapped_column(
        ForeignKey("expected_transactions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    occurrence_date: Mapped[date] = mapped_column(SA_Date, nullable=False, index=True)

    # If cancelled=True, the base expected instance is removed from effective schedule.
    cancelled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # Effective values when cancelled=False; if a field is NULL, we fall back to the base expected transaction.
    account_id: Mapped[Optional[int]] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), nullable=True, index=True)
    kind: Mapped[Optional[TransactionKind]] = mapped_column(SAEnum(TransactionKind), nullable=True)
    amount: Mapped[Optional[Decimal]] = mapped_column(Numeric(12, 2), nullable=True)
    description: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    reimbursable: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    moved_to_date: Mapped[Optional[date]] = mapped_column(SA_Date, nullable=True, index=True)
    category_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("categories.id", ondelete="CASCADE"), nullable=True, index=True
    )
    # When set, overrides series `variable` (estimate / italic) for this occurrence only.
    variable: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)

    created_at: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())

    __table_args__ = (UniqueConstraint("expected_transaction_id", "occurrence_date", name="uq_expected_instance"),)


class ReconciledDay(Base):
    __tablename__ = "reconciled_days"

    id: Mapped[int] = mapped_column(primary_key=True)
    family_id: Mapped[int] = mapped_column(ForeignKey("families.id", ondelete="CASCADE"), nullable=False, index=True)
    date: Mapped[date] = mapped_column(SA_Date, nullable=False, index=True)
    reconciled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    updated_at: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now(), onupdate=func.now())

    __table_args__ = (UniqueConstraint("family_id", "date", name="uq_reconciled_day"),)


engine = create_engine(settings.DATABASE_URL, connect_args={"check_same_thread": False} if settings.DATABASE_URL.startswith("sqlite") else {})
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def hash_password(password: str) -> str:
    hashed = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt())
    return hashed.decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))


def create_access_token(*, user_id: int) -> str:
    now = datetime.utcnow()
    exp = now + timedelta(minutes=settings.ACCESS_TOKEN_MINUTES)
    payload = {"sub": str(user_id), "iat": int(now.timestamp()), "exp": int(exp.timestamp())}
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def get_current_user_id(access_token: Annotated[Optional[str], Cookie(alias="access_token")] ) -> int:
    if not access_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    try:
        payload = jwt.decode(access_token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
        sub = payload.get("sub")
        if sub is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
        return int(sub)
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid session")


def require_family_member(*, db, family_id: int, user_id: int) -> None:
    membership = db.execute(
        select(FamilyMember).where(FamilyMember.family_id == family_id, FamilyMember.user_id == user_id)
    ).scalar_one_or_none()
    if membership is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a family member")


class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=200)
    name: Optional[str] = None


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class UserOut(BaseModel):
    id: int
    email: EmailStr
    name: Optional[str] = None


class AuthMeOut(BaseModel):
    user: UserOut


class RegisterOut(BaseModel):
    user: UserOut


class FamilyCreateIn(BaseModel):
    name: str = Field(min_length=1, max_length=255)


class FamilyOut(BaseModel):
    id: int
    name: str
    role: str


class CategoryIn(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    parent_id: Optional[int] = Field(default=None, description="Optional parent category id (header).")


class CategoryOut(BaseModel):
    id: int
    name: str
    parent_id: Optional[int] = None
    sort_order: int = 0
    fg_color: Optional[str] = None
    bg_color: Optional[str] = None
    has_children: bool = False


class CategoryUpdateIn(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    fg_color: Optional[str] = Field(default=None, max_length=20)
    bg_color: Optional[str] = Field(default=None, max_length=20)
    sort_order: Optional[int] = None


class CategoryGroupIn(BaseModel):
    id: int = Field(description="Parent category id")
    children: list[int] = Field(default_factory=list, description="Child category ids in desired order")


class CategoryReorderIn(BaseModel):
    # Backward compatible: allow the old flat payload, but prefer `groups`.
    ordered_ids: Optional[list[int]] = Field(default=None, description="(Legacy) Category IDs in desired display order")
    groups: Optional[list[CategoryGroupIn]] = Field(default=None, description="Parent blocks with child ordering")


class CategoryMergeIn(BaseModel):
    from_id: int
    to_id: int
    to_name: Optional[str] = None


class CategoryMergeOut(BaseModel):
    from_id: int
    to_id: int
    moved_transactions: int
    moved_expected: int
    moved_overrides: int


class ReconciledDaysOut(BaseModel):
    month: str
    dates: list[date]


class ReconciledDayUpsertIn(BaseModel):
    date: date
    reconciled: bool = True


class LowBalanceFirstHitOut(BaseModel):
    threshold: Decimal
    start: date
    days: int
    mode: str
    hit_date: Optional[date] = None
    hit_balance: Optional[Decimal] = None


class HighBalanceFirstHitOut(BaseModel):
    ceiling: Decimal
    start: date
    days: int
    mode: str
    hit_date: Optional[date] = None
    hit_balance: Optional[Decimal] = None


class TransactionIn(BaseModel):
    date: date
    description: str = Field(default="", max_length=500)
    notes: Optional[str] = Field(default=None, max_length=500)
    kind: TransactionKind
    amount: Decimal = Field(gt=0)
    category_id: Optional[int] = None
    account_id: Optional[int] = None
    reimbursable: bool = False


class TransactionOut(BaseModel):
    id: int
    date: date
    description: str
    vendor: Optional[str] = None
    raw_description: Optional[str] = None
    notes: Optional[str] = None
    kind: TransactionKind
    amount: Decimal
    category: Optional[str] = None
    category_id: Optional[int] = None
    account_id: Optional[int] = None
    reimbursable: bool = False
    imported: bool = False


class TransactionsListOut(BaseModel):
    items: list[TransactionOut]
    totals: dict[str, Decimal]


class TransactionsImportIn(BaseModel):
    class TransactionImportItemIn(BaseModel):
        date: date
        description: str = Field(default="", max_length=500)
        vendor: Optional[str] = Field(default=None, max_length=255)
        raw_description: Optional[str] = Field(default=None, max_length=500)
        notes: Optional[str] = Field(default=None, max_length=500)
        kind: TransactionKind
        amount: Decimal = Field(gt=0)
        category_id: Optional[int] = None
        account_id: Optional[int] = None
        reimbursable: bool = False

    items: list[TransactionImportItemIn]


class TransactionsImportOut(BaseModel):
    created: int
    batch_id: str


class TransactionsImportUndoIn(BaseModel):
    batch_id: str


class TransactionsImportUndoOut(BaseModel):
    deleted: int


class AccountIn(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    type: AccountType = AccountType.checking
    starting_balance: Decimal
    starting_balance_date: date


class AccountUpdateIn(BaseModel):
    starting_balance: Decimal
    starting_balance_date: date


class AccountOut(BaseModel):
    id: int
    name: str
    type: AccountType
    starting_balance: Decimal
    starting_balance_date: date


class ExpectedTransactionIn(BaseModel):
    account_id: int
    start_date: date
    end_date: Optional[date] = None
    recurrence: Recurrence = Recurrence.monthly
    # Required when recurrence is twice_monthly: second day of month (1–31), must differ from start_date.day.
    second_day_of_month: Optional[int] = Field(default=None, ge=1, le=31)

    description: str = Field(default="", max_length=500)
    notes: Optional[str] = Field(default=None, max_length=500)
    kind: TransactionKind = TransactionKind.expense
    amount: Decimal = Field(gt=0)
    reimbursable: bool = False
    variable: bool = False

    category_id: Optional[int] = None


class ExpectedTransactionOut(BaseModel):
    id: int
    account: str
    account_id: int
    start_date: date
    end_date: Optional[date]
    recurrence: Recurrence
    second_day_of_month: Optional[int] = None
    description: str
    notes: Optional[str] = None
    kind: TransactionKind
    amount: Decimal
    reimbursable: bool = False
    variable: bool = False
    category: Optional[str]
    category_id: Optional[int] = None
    created_by: int
    # First display/cash-flow date on or after "today", same rules as expected-calendar (cancels + moved_to_date).
    next_occurrence_date: Optional[date] = None
    # Effective values for that next calendar occurrence (override-aware; matches expected-calendar).
    next_occurrence_amount: Optional[Decimal] = None
    next_occurrence_variable: Optional[bool] = None
    next_occurrence_kind: Optional[TransactionKind] = None
    next_occurrence_description: Optional[str] = None


def _validate_expected_transaction_recurrence(payload: ExpectedTransactionIn) -> None:
    if payload.recurrence == Recurrence.twice_monthly:
        if payload.second_day_of_month is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="second_day_of_month is required for twice monthly recurrence",
            )
        if payload.second_day_of_month == payload.start_date.day:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Second day of month must differ from the start date's day of month",
            )
    elif payload.second_day_of_month is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="second_day_of_month is only valid when recurrence is twice monthly",
        )


class ExpectedInstanceOverrideIn(BaseModel):
    # Cancel removes this occurrence from the effective schedule.
    action: Literal["cancel", "update"] = "update"

    account_id: Optional[int] = None
    kind: Optional[TransactionKind] = None
    amount: Optional[Decimal] = None
    description: Optional[str] = None
    reimbursable: Optional[bool] = None
    moved_to_date: Optional[date] = None
    category_id: Optional[int] = None
    variable: Optional[bool] = None


class ApplyFromOccurrenceIn(BaseModel):
    account_id: int
    kind: TransactionKind
    amount: Decimal = Field(gt=0)
    description: str = Field(default="", max_length=500)
    reimbursable: Optional[bool] = None
    category_id: Optional[int] = None
    notes: Optional[str] = Field(default=None, max_length=500)
    recurrence: Optional[Recurrence] = None
    second_day_of_month: Optional[int] = Field(default=None, ge=1, le=31)
    variable: bool = False


class ApplyFromOccurrenceOut(BaseModel):
    mode: Literal["updated_in_place", "split"]
    future_series_id: int
    ended_series_id: Optional[int] = None


class EndFromOccurrenceOut(BaseModel):
    mode: Literal["ended", "deleted"]
    expected_id: Optional[int] = None
    ended_at: Optional[date] = None


class ExpectedCalendarItemOut(BaseModel):
    expected_transaction_id: int
    date: date
    # For moved occurrences, this is the original scheduled date used to key overrides.
    # For normal occurrences, occurrence_date == date.
    occurrence_date: date
    account_id: int
    account: str
    kind: TransactionKind
    amount: Decimal
    description: str
    notes: Optional[str] = None
    reimbursable: bool = False
    category_id: Optional[int] = None
    category: Optional[str] = None
    variable: bool = False


class ExpectedCalendarOut(BaseModel):
    month: str
    items: list[ExpectedCalendarItemOut]


class CategoryTotalsLineOut(BaseModel):
    category_id: Optional[int] = None
    category_name: str
    income_actual: Decimal = Decimal("0")
    expense_actual: Decimal = Decimal("0")
    income_estimated: Decimal = Decimal("0")
    expense_estimated: Decimal = Decimal("0")


class CategoryTotalsReportOut(BaseModel):
    start_date: date
    end_date: date
    mode: Literal["actual", "actual_plus_estimated"]
    as_of: date
    lines: list[CategoryTotalsLineOut]
    sum_income_actual: Decimal = Decimal("0")
    sum_expense_actual: Decimal = Decimal("0")
    sum_income_estimated: Decimal = Decimal("0")
    sum_expense_estimated: Decimal = Decimal("0")


class ProjectionDailyOut(BaseModel):
    date: date
    net_cashflow: Decimal
    total_balance: Decimal

    # Present only when requested via query parameter.
    account_cashflow: Optional[dict[int, Decimal]] = None
    account_balance: Optional[dict[int, Decimal]] = None


class ProjectionOut(BaseModel):
    start: date
    days: int
    accounts: list[AccountOut]
    daily: list[ProjectionDailyOut]


class CalendarDayBalanceOut(BaseModel):
    date: date
    start: str
    tx_net: str
    end: str


class CalendarMonthDailyOut(BaseModel):
    month: str
    mode: str
    days: list[CalendarDayBalanceOut]


def _parse_cors_origins(raw: str) -> list[str]:
    """Split comma-separated origins; normalize full URLs to scheme+host (GitHub Pages Origin has no path)."""
    out: list[str] = []
    for part in raw.split(","):
        part = part.strip()
        if not part:
            continue
        parsed = urlparse(part)
        if parsed.scheme and parsed.netloc:
            out.append(f"{parsed.scheme}://{parsed.netloc}")
        else:
            out.append(part)
    return out


app = FastAPI(title="Family Cash Flow")
origins = _parse_cors_origins(settings.CORS_ORIGINS or "")
# Always allow the GitHub Pages frontend origin so the app works
# even if the Render env var is missing/misconfigured.
default_web_origins = ["https://holtzeidler.github.io"]
if settings.ENV != "production":
    default_web_origins += [
        "http://localhost:3000",
        "http://localhost:5173",
        "http://localhost:8000",
    ]
origins = [o for o in [*origins, *default_web_origins] if o]
origins = list(dict.fromkeys(origins))  # de-dupe, preserve order
if origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )


@app.get("/api/debug/public-config", include_in_schema=False)
def public_debug_config():
    """
    Safe diagnostics for GitHub Pages + Render cookie/CORS issues.
    Does not expose secrets.
    """
    raw = settings.CORS_ORIGINS or ""
    parsed = _parse_cors_origins(raw) if raw.strip() else []
    return {
        "env": settings.ENV,
        "cors_middleware_enabled": True,
        "cors_allow_origins": origins,
        "cors_origins_configured": bool(raw.strip()),
        "auth_cookie_samesite": "none" if settings.ENV == "production" else "lax",
        "auth_cookie_secure": settings.ENV == "production",
        "note": "GitHub Pages -> Render needs ENV=production so Set-Cookie uses SameSite=None; Secure.",
    }


@app.on_event("startup")
def startup_populate_schema():
    # For a starter app we create tables on startup.
    # In a production app you'd typically use migrations (Alembic).
    if settings.DATABASE_URL.startswith("sqlite"):
        # Supports sqlite:///./data/app.db style.
        db_path = settings.DATABASE_URL.split("sqlite:///")[-1]
        if db_path:
            Path(db_path).expanduser().resolve().parent.mkdir(parents=True, exist_ok=True)
    Base.metadata.create_all(bind=engine)
    _ensure_account_starting_balance_date_column()
    _ensure_notes_columns()
    _ensure_expected_second_day_column()
    _ensure_recurrence_enum_extensions_postgres()
    _ensure_category_color_columns()
    _ensure_reimbursable_columns()
    _ensure_expected_variable_column()
    _ensure_expected_moved_to_date_column()
    _ensure_expected_override_variable_column()
    _ensure_category_sort_order_column()
    _ensure_category_parent_id_column()
    _ensure_transaction_account_id_column()
    _ensure_transaction_imported_column()
    _ensure_transaction_import_batch_columns()
    _ensure_transaction_vendor_columns()
    _ensure_reconciled_days_table()


def _ensure_transaction_imported_column() -> None:
    """Lightweight startup migration: mark analysis-only imported transactions."""
    with engine.begin() as conn:
        table = "transactions"
        if settings.DATABASE_URL.startswith("sqlite"):
            cols = conn.execute(text(f"PRAGMA table_info({table})")).fetchall()
            has_col = any(str(row[1]) == "imported" for row in cols)
            if not has_col:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN imported BOOLEAN NOT NULL DEFAULT 0"))
        else:
            conn.execute(text(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS imported BOOLEAN"))
            conn.execute(text(f"UPDATE {table} SET imported = FALSE WHERE imported IS NULL"))


def _ensure_transaction_import_batch_columns() -> None:
    """Lightweight startup migration: track import batches for undo."""
    with engine.begin() as conn:
        table = "transactions"
        if settings.DATABASE_URL.startswith("sqlite"):
            cols = conn.execute(text(f"PRAGMA table_info({table})")).fetchall()
            has_batch = any(str(row[1]) == "import_batch_id" for row in cols)
            has_at = any(str(row[1]) == "imported_at" for row in cols)
            if not has_batch:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN import_batch_id TEXT"))
            if not has_at:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN imported_at DATETIME"))
        else:
            conn.execute(text(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS import_batch_id VARCHAR(64)"))
            conn.execute(text(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS imported_at TIMESTAMP"))


def _ensure_transaction_vendor_columns() -> None:
    """Lightweight startup migration: vendor + raw_description for reporting."""
    with engine.begin() as conn:
        table = "transactions"
        if settings.DATABASE_URL.startswith("sqlite"):
            cols = conn.execute(text(f"PRAGMA table_info({table})")).fetchall()
            has_vendor = any(str(row[1]) == "vendor" for row in cols)
            has_raw = any(str(row[1]) == "raw_description" for row in cols)
            if not has_vendor:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN vendor VARCHAR(255)"))
            if not has_raw:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN raw_description VARCHAR(500)"))
        else:
            conn.execute(text(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS vendor VARCHAR(255)"))
            conn.execute(text(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS raw_description VARCHAR(500)"))


def _ensure_expected_moved_to_date_column() -> None:
    """Lightweight startup migration: allow moving a single expected occurrence to a new date."""
    with engine.begin() as conn:
        table = "expected_transaction_overrides"
        if settings.DATABASE_URL.startswith("sqlite"):
            cols = conn.execute(text(f"PRAGMA table_info({table})")).fetchall()
            has_col = any(str(row[1]) == "moved_to_date" for row in cols)
            if not has_col:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN moved_to_date DATE"))
        else:
            conn.execute(text(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS moved_to_date DATE"))


def _ensure_expected_override_variable_column() -> None:
    """Lightweight startup migration: per-occurrence variable (estimate) override."""
    with engine.begin() as conn:
        table = "expected_transaction_overrides"
        if settings.DATABASE_URL.startswith("sqlite"):
            cols = conn.execute(text(f"PRAGMA table_info({table})")).fetchall()
            has_col = any(str(row[1]) == "variable" for row in cols)
            if not has_col:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN variable BOOLEAN"))
        else:
            conn.execute(text(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS variable BOOLEAN"))


def _ensure_reconciled_days_table() -> None:
    """Lightweight startup migration: create reconciled_days table if missing."""
    with engine.begin() as conn:
        if settings.DATABASE_URL.startswith("sqlite"):
            conn.execute(
                text(
                    "CREATE TABLE IF NOT EXISTS reconciled_days ("
                    "id INTEGER PRIMARY KEY, "
                    "family_id INTEGER NOT NULL, "
                    "date DATE NOT NULL, "
                    "reconciled BOOLEAN NOT NULL DEFAULT 1, "
                    "updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, "
                    "CONSTRAINT uq_reconciled_day UNIQUE (family_id, date)"
                    ")"
                )
            )
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_reconciled_days_family_id ON reconciled_days (family_id)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_reconciled_days_date ON reconciled_days (date)"))
        else:
            conn.execute(
                text(
                    "CREATE TABLE IF NOT EXISTS reconciled_days ("
                    "id SERIAL PRIMARY KEY, "
                    "family_id INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE, "
                    "date DATE NOT NULL, "
                    "reconciled BOOLEAN NOT NULL DEFAULT TRUE, "
                    "updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), "
                    "CONSTRAINT uq_reconciled_day UNIQUE (family_id, date)"
                    ")"
                )
            )
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_reconciled_days_family_id ON reconciled_days (family_id)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_reconciled_days_date ON reconciled_days (date)"))


def _ensure_account_starting_balance_date_column():
    """
    Lightweight startup migration for existing deployments.
    """
    with engine.begin() as conn:
        if settings.DATABASE_URL.startswith("sqlite"):
            cols = conn.execute(text("PRAGMA table_info(accounts)")).fetchall()
            has_col = any(str(row[1]) == "starting_balance_date" for row in cols)
            if not has_col:
                conn.execute(text("ALTER TABLE accounts ADD COLUMN starting_balance_date DATE"))
        else:
            conn.execute(text("ALTER TABLE accounts ADD COLUMN IF NOT EXISTS starting_balance_date DATE"))

        conn.execute(
            text(
                "UPDATE accounts "
                "SET starting_balance_date = COALESCE(starting_balance_date, DATE(created_at), CURRENT_DATE) "
                "WHERE starting_balance_date IS NULL"
            )
        )


def _ensure_notes_columns() -> None:
    """Lightweight startup migration: optional notes on transactions and expected_transactions."""
    with engine.begin() as conn:
        for table in ("transactions", "expected_transactions"):
            if settings.DATABASE_URL.startswith("sqlite"):
                cols = conn.execute(text(f"PRAGMA table_info({table})")).fetchall()
                has_notes = any(str(row[1]) == "notes" for row in cols)
                if not has_notes:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN notes VARCHAR(500)"))
            else:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS notes VARCHAR(500)"))


def _ensure_expected_second_day_column() -> None:
    """Add second_day_of_month for twice_monthly recurrence."""
    with engine.begin() as conn:
        if settings.DATABASE_URL.startswith("sqlite"):
            cols = conn.execute(text("PRAGMA table_info(expected_transactions)")).fetchall()
            has_col = any(str(row[1]) == "second_day_of_month" for row in cols)
            if not has_col:
                conn.execute(text("ALTER TABLE expected_transactions ADD COLUMN second_day_of_month INTEGER"))
        else:
            conn.execute(text("ALTER TABLE expected_transactions ADD COLUMN IF NOT EXISTS second_day_of_month INTEGER"))


def _ensure_recurrence_enum_extensions_postgres() -> None:
    """Add new recurrence enum labels on PostgreSQL if the DB predates them."""
    if not settings.DATABASE_URL.startswith("postgresql"):
        return
    log = logging.getLogger(__name__)
    with engine.begin() as conn:
        row = conn.execute(
            text(
                "SELECT t.typname FROM pg_type t "
                "JOIN pg_enum e ON t.oid = e.enumtypid "
                "WHERE e.enumlabel = 'monthly' LIMIT 1"
            )
        ).fetchone()
        if not row:
            return
        typname = row[0]
        for label in ("weekly", "twice_monthly"):
            exists = conn.execute(
                text(
                    "SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid "
                    "WHERE t.typname = :tn AND e.enumlabel = :lb"
                ),
                {"tn": typname, "lb": label},
            ).fetchone()
            if exists:
                continue
            try:
                conn.execute(text(f'ALTER TYPE "{typname}" ADD VALUE \'{label}\''))
            except Exception:
                try:
                    conn.execute(text(f"ALTER TYPE {typname} ADD VALUE '{label}'"))
                except Exception:
                    log.warning(
                        "Could not ALTER TYPE to add %s recurrence; Postgres may reject inserts until fixed.",
                        label,
                    )


def _ensure_category_color_columns() -> None:
    """Lightweight startup migration for per-category label styling."""
    with engine.begin() as conn:
        if settings.DATABASE_URL.startswith("sqlite"):
            cols = conn.execute(text("PRAGMA table_info(categories)")).fetchall()
            has_fg = any(str(row[1]) == "fg_color" for row in cols)
            has_bg = any(str(row[1]) == "bg_color" for row in cols)
            if not has_fg:
                conn.execute(text("ALTER TABLE categories ADD COLUMN fg_color VARCHAR(20)"))
            if not has_bg:
                conn.execute(text("ALTER TABLE categories ADD COLUMN bg_color VARCHAR(20)"))
        else:
            conn.execute(text("ALTER TABLE categories ADD COLUMN IF NOT EXISTS fg_color VARCHAR(20)"))
            conn.execute(text("ALTER TABLE categories ADD COLUMN IF NOT EXISTS bg_color VARCHAR(20)"))


def _ensure_category_sort_order_column() -> None:
    """Lightweight startup migration: add sort_order for draggable category ordering."""
    with engine.begin() as conn:
        if settings.DATABASE_URL.startswith("sqlite"):
            cols = conn.execute(text("PRAGMA table_info(categories)")).fetchall()
            has_col = any(str(row[1]) == "sort_order" for row in cols)
            if not has_col:
                conn.execute(text("ALTER TABLE categories ADD COLUMN sort_order INTEGER"))
            conn.execute(text("UPDATE categories SET sort_order = COALESCE(sort_order, 0)"))
        else:
            conn.execute(text("ALTER TABLE categories ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0"))
            conn.execute(text("UPDATE categories SET sort_order = COALESCE(sort_order, 0)"))


def _ensure_category_parent_id_column() -> None:
    """Lightweight startup migration: add parent_id for header/subcategory grouping."""
    with engine.begin() as conn:
        if settings.DATABASE_URL.startswith("sqlite"):
            cols = conn.execute(text("PRAGMA table_info(categories)")).fetchall()
            has_col = any(str(row[1]) == "parent_id" for row in cols)
            if not has_col:
                conn.execute(text("ALTER TABLE categories ADD COLUMN parent_id INTEGER"))
        else:
            conn.execute(text("ALTER TABLE categories ADD COLUMN IF NOT EXISTS parent_id INTEGER"))


def _ensure_transaction_account_id_column() -> None:
    """Lightweight startup migration: store account_id on actual transactions for filtering."""
    with engine.begin() as conn:
        table = "transactions"
        if settings.DATABASE_URL.startswith("sqlite"):
            cols = conn.execute(text(f"PRAGMA table_info({table})")).fetchall()
            has_col = any(str(row[1]) == "account_id" for row in cols)
            if not has_col:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN account_id INTEGER"))
        else:
            conn.execute(text(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS account_id INTEGER"))


def _ensure_reimbursable_columns() -> None:
    """Lightweight startup migration: add reimbursable flags to transactions and schedules."""
    with engine.begin() as conn:
        if settings.DATABASE_URL.startswith("sqlite"):
            for table in ("transactions", "expected_transactions", "expected_transaction_overrides"):
                cols = conn.execute(text(f"PRAGMA table_info({table})")).fetchall()
                has_col = any(str(row[1]) == "reimbursable" for row in cols)
                if not has_col:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN reimbursable BOOLEAN"))
                conn.execute(text(f"UPDATE {table} SET reimbursable = COALESCE(reimbursable, 0)"))
            return

        conn.execute(text("ALTER TABLE transactions ADD COLUMN IF NOT EXISTS reimbursable BOOLEAN NOT NULL DEFAULT FALSE"))
        conn.execute(text("ALTER TABLE expected_transactions ADD COLUMN IF NOT EXISTS reimbursable BOOLEAN NOT NULL DEFAULT FALSE"))
        conn.execute(text("ALTER TABLE expected_transaction_overrides ADD COLUMN IF NOT EXISTS reimbursable BOOLEAN"))
        conn.execute(text("UPDATE transactions SET reimbursable = COALESCE(reimbursable, FALSE)"))
        conn.execute(text("UPDATE expected_transactions SET reimbursable = COALESCE(reimbursable, FALSE)"))


def _ensure_expected_variable_column() -> None:
    """Lightweight startup migration: variable (estimate) flag on recurring series."""
    with engine.begin() as conn:
        if settings.DATABASE_URL.startswith("sqlite"):
            cols = conn.execute(text("PRAGMA table_info(expected_transactions)")).fetchall()
            has_col = any(str(row[1]) == "variable" for row in cols)
            if not has_col:
                conn.execute(text("ALTER TABLE expected_transactions ADD COLUMN variable BOOLEAN"))
            conn.execute(text("UPDATE expected_transactions SET variable = COALESCE(variable, 0)"))
        else:
            conn.execute(text("ALTER TABLE expected_transactions ADD COLUMN IF NOT EXISTS variable BOOLEAN NOT NULL DEFAULT FALSE"))
            conn.execute(text("UPDATE expected_transactions SET variable = COALESCE(variable, FALSE)"))


@app.post("/api/auth/register", status_code=status.HTTP_201_CREATED, response_model=RegisterOut)
def register(payload: RegisterIn, response: Response, db=Depends(get_db)):
    existing = db.execute(select(User).where(User.email == payload.email)).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")
    user = User(email=str(payload.email), name=payload.name, password_hash=hash_password(payload.password))
    db.add(user)
    db.commit()
    db.refresh(user)

    token = create_access_token(user_id=user.id)
    response.set_cookie(
        key="access_token",
        value=token,
        httponly=True,
        samesite="none" if settings.ENV == "production" else "lax",
        secure=settings.ENV == "production",
        path="/",
    )
    return {"user": UserOut(id=user.id, email=user.email, name=user.name)}


@app.post("/api/auth/login")
def login(payload: LoginIn, db=Depends(get_db)):
    user = db.execute(select(User).where(User.email == payload.email)).scalar_one_or_none()
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    token = create_access_token(user_id=user.id)
    resp = Response(status_code=status.HTTP_200_OK)
    resp.set_cookie(
        key="access_token",
        value=token,
        httponly=True,
        samesite="none" if settings.ENV == "production" else "lax",
        secure=settings.ENV == "production",
        path="/",
    )
    return resp


@app.post("/api/auth/logout")
def logout(response: Response):
    response.delete_cookie(key="access_token", path="/")
    return {"ok": True}


@app.get("/api/auth/me", response_model=AuthMeOut)
def me(access_token: Annotated[Optional[str], Cookie(alias="access_token")] = None, db=Depends(get_db)):
    user_id = get_current_user_id(access_token)
    user = db.execute(select(User).where(User.id == user_id)).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    return AuthMeOut(user=UserOut(id=user.id, email=user.email, name=user.name))


@app.get("/api/families", response_model=list[FamilyOut])
def list_families(access_token: Annotated[Optional[str], Cookie(alias="access_token")] = None, db=Depends(get_db)):
    user_id = get_current_user_id(access_token)
    stmt = (
        select(Family, FamilyMember.role)
        .join(FamilyMember, FamilyMember.family_id == Family.id)
        .where(FamilyMember.user_id == user_id)
        .order_by(Family.created_at.desc())
    )
    rows = db.execute(stmt).all()
    return [FamilyOut(id=row[0].id, name=row[0].name, role=row[1]) for row in rows]


@app.post("/api/families", response_model=FamilyOut)
def create_family(payload: FamilyCreateIn, access_token: Annotated[Optional[str], Cookie(alias="access_token")] = None, db=Depends(get_db)):
    user_id = get_current_user_id(access_token)
    family = Family(name=payload.name)
    db.add(family)
    db.flush()
    member = FamilyMember(family_id=family.id, user_id=user_id, role="admin")
    db.add(member)
    db.commit()
    db.refresh(family)
    return FamilyOut(id=family.id, name=family.name, role=member.role)


def _seed_default_categories_if_empty(db, family_id: int) -> None:
    """
    Seed a starter Group (parent) -> Category (child) list.
    Groups are top-level categories (parent_id NULL). Children live under a group.
    Only runs when the family has zero categories.
    """
    existing = db.execute(select(func.count(Category.id)).where(Category.family_id == family_id)).scalar_one() or 0
    if existing > 0:
        return

    # Starter set (can be edited/reordered later).
    defaults: dict[str, list[str]] = {
        "Recommended": ["Coffee Shops", "Fun Money"],
        "Bills & Utilities": ["Garbage", "Water", "Gas & Electric", "Internet & Cable", "Phone"],
        "Food & Dining": ["Groceries", "Restaurants & Bars"],
        "Travel & Lifestyle": ["Travel & Vacation", "Entertainment & Recreation"],
        "Transfers": ["Transfer"],
    }

    sort_parent = 0
    for group_name, child_names in defaults.items():
        parent = Category(family_id=family_id, name=group_name, parent_id=None, sort_order=sort_parent)
        db.add(parent)
        db.flush()
        for idx, nm in enumerate(child_names):
            db.add(Category(family_id=family_id, name=nm, parent_id=parent.id, sort_order=idx))
        sort_parent += 1
    db.commit()


def _auto_merge_transfers_category_if_needed(db, family_id: int) -> None:
    """
    Safety cleanup for legacy data where both "Transfers" and "Transfer" exist and
    some transactions still point at the older/plural category.
    """
    cats = (
        db.execute(select(Category).where(Category.family_id == family_id))
        .scalars()
        .all()
    )
    if not cats:
        return
    by_norm = {}
    for c in cats:
        nm = (c.name or "").strip().lower()
        if nm:
            by_norm.setdefault(nm, []).append(c)

    # Prefer singular "transfer" as the destination if present.
    dst = (by_norm.get("transfer") or [None])[0]
    src = (by_norm.get("transfers") or [None])[0]
    if not dst or not src or int(dst.id) == int(src.id):
        return

    # Repoint references.
    db.execute(
        text("UPDATE transactions SET category_id = :to_id WHERE family_id = :fid AND category_id = :from_id"),
        {"to_id": int(dst.id), "fid": int(family_id), "from_id": int(src.id)},
    )
    db.execute(
        text("UPDATE expected_transactions SET category_id = :to_id WHERE family_id = :fid AND category_id = :from_id"),
        {"to_id": int(dst.id), "fid": int(family_id), "from_id": int(src.id)},
    )
    db.execute(
        text(
            "UPDATE expected_transaction_overrides "
            "SET category_id = :to_id "
            "WHERE expected_transaction_id IN (SELECT id FROM expected_transactions WHERE family_id = :fid) "
            "AND category_id = :from_id"
        ),
        {"to_id": int(dst.id), "fid": int(family_id), "from_id": int(src.id)},
    )
    db.commit()


@app.get("/api/families/{family_id}/categories", response_model=list[CategoryOut])
def list_categories(
    family_id: int,
    access_token: Annotated[Optional[str], Cookie(alias="access_token")] = None,
    db=Depends(get_db),
):
    user_id = get_current_user_id(access_token)
    require_family_member(db=db, family_id=family_id, user_id=user_id)
    _seed_default_categories_if_empty(db=db, family_id=family_id)
    _auto_merge_transfers_category_if_needed(db=db, family_id=family_id)
    rows = (
        db.execute(
            select(Category)
            .where(Category.family_id == family_id)
            .order_by(Category.sort_order.asc(), Category.name.asc(), Category.id.asc())
        )
        .scalars()
        .all()
    )

    by_id: dict[int, Category] = {r.id: r for r in rows}
    children_by_parent: dict[int, list[Category]] = {}
    top_level: list[Category] = []
    for r in rows:
        pid = int(r.parent_id) if r.parent_id is not None else None
        if pid is not None and pid in by_id:
            children_by_parent.setdefault(pid, []).append(r)
        else:
            top_level.append(r)

    def _k(c: Category):
        return (int(c.sort_order or 0), str(c.name or ""), int(c.id))

    top_level.sort(key=_k)
    for pid in list(children_by_parent.keys()):
        children_by_parent[pid].sort(key=_k)

    out: list[CategoryOut] = []
    for p in top_level:
        kids = children_by_parent.get(p.id, [])
        out.append(
            CategoryOut(
                id=p.id,
                name=p.name,
                parent_id=None,
                sort_order=p.sort_order or 0,
                fg_color=p.fg_color,
                bg_color=p.bg_color,
                has_children=len(kids) > 0,
            )
        )
        for c in kids:
            out.append(
                CategoryOut(
                    id=c.id,
                    name=c.name,
                    parent_id=p.id,
                    sort_order=c.sort_order or 0,
                    fg_color=c.fg_color,
                    bg_color=c.bg_color,
                    has_children=False,
                )
            )
    return out


@app.post("/api/families/{family_id}/categories", response_model=CategoryOut)
def create_category(
    family_id: int,
    payload: CategoryIn,
    access_token: Annotated[Optional[str], Cookie(alias="access_token")] = None,
    db=Depends(get_db),
):
    user_id = get_current_user_id(access_token)
    require_family_member(db=db, family_id=family_id, user_id=user_id)
    parent_id: Optional[int] = int(payload.parent_id) if payload.parent_id is not None else None
    if parent_id is not None:
        parent = db.execute(select(Category).where(Category.id == parent_id, Category.family_id == family_id)).scalar_one_or_none()
        if parent is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid parent category")
    max_sort = db.execute(
        select(func.coalesce(func.max(Category.sort_order), 0)).where(Category.family_id == family_id, Category.parent_id == parent_id)
    ).scalar_one()
    category = Category(family_id=family_id, name=payload.name, parent_id=parent_id, sort_order=int(max_sort) + 1)
    db.add(category)
    db.commit()
    db.refresh(category)
    has_children = False
    return CategoryOut(
        id=category.id,
        name=category.name,
        parent_id=category.parent_id,
        sort_order=category.sort_order or 0,
        fg_color=category.fg_color,
        bg_color=category.bg_color,
        has_children=has_children,
    )


@app.put("/api/families/{family_id}/categories/{category_id}", response_model=CategoryOut)
def update_category(
    family_id: int,
    category_id: int,
    payload: CategoryUpdateIn,
    access_token: Annotated[Optional[str], Cookie(alias="access_token")] = None,
    db=Depends(get_db),
):
    user_id = get_current_user_id(access_token)
    require_family_member(db=db, family_id=family_id, user_id=user_id)

    cat = db.execute(select(Category).where(Category.id == category_id, Category.family_id == family_id)).scalar_one_or_none()
    if cat is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found")

    if payload.name is not None:
        cat.name = payload.name.strip()

    if payload.fg_color is not None:
        v = payload.fg_color.strip()
        cat.fg_color = v if v else None
    if payload.bg_color is not None:
        v = payload.bg_color.strip()
        cat.bg_color = v if v else None

    if payload.sort_order is not None:
        cat.sort_order = int(payload.sort_order)

    db.commit()
    db.refresh(cat)
    has_children = (
        db.execute(select(func.count(Category.id)).where(Category.family_id == family_id, Category.parent_id == cat.id)).scalar_one() or 0
    ) > 0
    return CategoryOut(
        id=cat.id,
        name=cat.name,
        parent_id=cat.parent_id,
        sort_order=cat.sort_order or 0,
        fg_color=cat.fg_color,
        bg_color=cat.bg_color,
        has_children=has_children,
    )


@app.post("/api/families/{family_id}/categories/reorder", response_model=list[CategoryOut])
def reorder_categories(
    family_id: int,
    payload: CategoryReorderIn,
    access_token: Annotated[Optional[str], Cookie(alias="access_token")] = None,
    db=Depends(get_db),
):
    user_id = get_current_user_id(access_token)
    require_family_member(db=db, family_id=family_id, user_id=user_id)

    # Preferred: hierarchical reorder via groups.
    if payload.groups is not None:
        groups = payload.groups
        parent_ids = [int(g.id) for g in groups]
        all_ids: list[int] = []
        for g in groups:
            all_ids.append(int(g.id))
            for cid in g.children:
                all_ids.append(int(cid))
        if len(all_ids) != len(set(all_ids)):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Duplicate category ids in payload")

        rows = db.execute(select(Category).where(Category.family_id == family_id, Category.id.in_(all_ids))).scalars().all()
        cats_by_id = {c.id: c for c in rows}
        if len(cats_by_id) != len(all_ids):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="One or more category ids are invalid for this family")

        # Validate parents are top-level (or will become top-level). We do not support nested depth > 2.
        for pid in parent_ids:
            if pid not in cats_by_id:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid parent id")

        for p_idx, g in enumerate(groups):
            pid = int(g.id)
            parent = cats_by_id[pid]
            parent.parent_id = None
            parent.sort_order = p_idx
            for c_idx, cid in enumerate(g.children):
                child = cats_by_id[int(cid)]
                child.parent_id = pid
                child.sort_order = c_idx

        db.commit()
        return list_categories(family_id=family_id, access_token=access_token, db=db)

    # Legacy: flat reorder via ordered_ids.
    if not payload.ordered_ids:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No reorder payload provided")
    ids = [int(x) for x in payload.ordered_ids]
    if len(ids) != len(set(ids)):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Duplicate category ids in payload")

    rows = db.execute(select(Category).where(Category.family_id == family_id, Category.id.in_(ids))).scalars().all()
    cats_by_id = {c.id: c for c in rows}
    if len(cats_by_id) != len(ids):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="One or more category ids are invalid for this family")

    for idx, cid in enumerate(ids):
        cats_by_id[cid].sort_order = idx

    db.commit()
    return list_categories(family_id=family_id, access_token=access_token, db=db)


@app.post("/api/families/{family_id}/categories/merge", response_model=CategoryMergeOut)
def merge_categories(
    family_id: int,
    payload: CategoryMergeIn,
    access_token: Annotated[Optional[str], Cookie(alias="access_token")] = None,
    db=Depends(get_db),
):
    user_id = get_current_user_id(access_token)
    require_family_member(db=db, family_id=family_id, user_id=user_id)

    if payload.from_id == payload.to_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="from_id and to_id must differ")

    src = db.execute(select(Category).where(Category.family_id == family_id, Category.id == payload.from_id)).scalar_one_or_none()
    dst = db.execute(select(Category).where(Category.family_id == family_id, Category.id == payload.to_id)).scalar_one_or_none()
    if src is None or dst is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found")

    if payload.to_name is not None and payload.to_name.strip():
        dst.name = payload.to_name.strip()

    moved_tx = db.execute(
        text("UPDATE transactions SET category_id = :to_id WHERE family_id = :fid AND category_id = :from_id"),
        {"to_id": int(dst.id), "fid": int(family_id), "from_id": int(src.id)},
    ).rowcount or 0
    moved_exp = db.execute(
        text("UPDATE expected_transactions SET category_id = :to_id WHERE family_id = :fid AND category_id = :from_id"),
        {"to_id": int(dst.id), "fid": int(family_id), "from_id": int(src.id)},
    ).rowcount or 0
    moved_ovr = db.execute(
        text(
            "UPDATE expected_transaction_overrides "
            "SET category_id = :to_id "
            "WHERE expected_transaction_id IN (SELECT id FROM expected_transactions WHERE family_id = :fid) "
            "AND category_id = :from_id"
        ),
        {"to_id": int(dst.id), "fid": int(family_id), "from_id": int(src.id)},
    ).rowcount or 0

    db.delete(src)
    db.commit()

    return CategoryMergeOut(
        from_id=int(payload.from_id),
        to_id=int(payload.to_id),
        moved_transactions=int(moved_tx),
        moved_expected=int(moved_exp),
        moved_overrides=int(moved_ovr),
    )


@app.get("/api/families/{family_id}/reconciled-days", response_model=ReconciledDaysOut)
def list_reconciled_days(
    family_id: int,
    month: str,
    access_token: Annotated[Optional[str], Cookie(alias="access_token")] = None,
    db=Depends(get_db),
):
    user_id = get_current_user_id(access_token)
    require_family_member(db=db, family_id=family_id, user_id=user_id)

    start, end = _month_range(month)
    rows = (
        db.execute(
            select(ReconciledDay)
            .where(
                ReconciledDay.family_id == family_id,
                ReconciledDay.date >= start,
                ReconciledDay.date < end,
                ReconciledDay.reconciled == True,  # noqa: E712
            )
            .order_by(ReconciledDay.date.asc())
        )
        .scalars()
        .all()
    )
    return ReconciledDaysOut(month=month, dates=[r.date for r in rows])


@app.post("/api/families/{family_id}/reconciled-days", response_model=ReconciledDaysOut)
def upsert_reconciled_day(
    family_id: int,
    payload: ReconciledDayUpsertIn,
    access_token: Annotated[Optional[str], Cookie(alias="access_token")] = None,
    db=Depends(get_db),
):
    user_id = get_current_user_id(access_token)
    require_family_member(db=db, family_id=family_id, user_id=user_id)

    existing = db.execute(
        select(ReconciledDay).where(ReconciledDay.family_id == family_id, ReconciledDay.date == payload.date)
    ).scalar_one_or_none()
    if existing is None:
        existing = ReconciledDay(family_id=family_id, date=payload.date, reconciled=bool(payload.reconciled))
        db.add(existing)
    else:
        existing.reconciled = bool(payload.reconciled)

    db.commit()

    month = f"{payload.date.year:04d}-{payload.date.month:02d}"
    return list_reconciled_days(family_id=family_id, month=month, access_token=access_token, db=db)


@app.get("/api/families/{family_id}/accounts", response_model=list[AccountOut])
def list_accounts(
    family_id: int,
    access_token: Annotated[Optional[str], Cookie(alias="access_token")] = None,
    db=Depends(get_db),
):
    user_id = get_current_user_id(access_token)
    require_family_member(db=db, family_id=family_id, user_id=user_id)
    rows = db.execute(select(Account).where(Account.family_id == family_id).order_by(Account.name.asc())).scalars().all()
    return [
        AccountOut(
            id=r.id,
            name=r.name,
            type=r.type,
            starting_balance=r.starting_balance,
            starting_balance_date=r.starting_balance_date or r.created_at.date(),
        )
        for r in rows
    ]


@app.post("/api/families/{family_id}/accounts", response_model=AccountOut)
def create_account(
    family_id: int,
    payload: AccountIn,
    access_token: Annotated[Optional[str], Cookie(alias="access_token")] = None,
    db=Depends(get_db),
):
    user_id = get_current_user_id(access_token)
    require_family_member(db=db, family_id=family_id, user_id=user_id)

    # Quick sanity: category/account belong to same family is guaranteed by FK constraints.
    account = Account(
        family_id=family_id,
        name=payload.name,
        type=payload.type,
        starting_balance=payload.starting_balance,
        starting_balance_date=payload.starting_balance_date,
    )
    db.add(account)
    db.commit()
    db.refresh(account)
    return AccountOut(
        id=account.id,
        name=account.name,
        type=account.type,
        starting_balance=account.starting_balance,
        starting_balance_date=account.starting_balance_date or account.created_at.date(),
    )


@app.put("/api/families/{family_id}/accounts/{account_id}", response_model=AccountOut)
def update_account_starting_balance(
    family_id: int,
    account_id: int,
    payload: AccountUpdateIn,
    access_token: Annotated[Optional[str], Cookie(alias="access_token")] = None,
    db=Depends(get_db),
):
    user_id = get_current_user_id(access_token)
    require_family_member(db=db, family_id=family_id, user_id=user_id)
    account = db.execute(
        select(Account).where(Account.id == account_id, Account.family_id == family_id)
    ).scalar_one_or_none()
    if account is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")

    account.starting_balance = payload.starting_balance
    account.starting_balance_date = payload.starting_balance_date
    db.commit()
    db.refresh(account)
    return AccountOut(
        id=account.id,
        name=account.name,
        type=account.type,
        starting_balance=account.starting_balance,
        starting_balance_date=account.starting_balance_date or account.created_at.date(),
    )


@app.get("/api/families/{family_id}/expected-transactions", response_model=list[ExpectedTransactionOut])
def list_expected_transactions(
    family_id: int,
    access_token: Annotated[Optional[str], Cookie(alias="access_token")] = None,
    db=Depends(get_db),
):
    user_id = get_current_user_id(access_token)
    require_family_member(db=db, family_id=family_id, user_id=user_id)

    stmt = (
        select(
            ExpectedTransaction,
            Account.name.label("account_name"),
            Category.name.label("category_name"),
        )
        .join(Account, Account.id == ExpectedTransaction.account_id)
        .join(Category, Category.id == ExpectedTransaction.category_id, isouter=True)
        .where(ExpectedTransaction.family_id == family_id)
        .order_by(ExpectedTransaction.start_date.desc(), ExpectedTransaction.id.desc())
    )
    rows = db.execute(stmt).all()

    tx_ids = [tx.id for tx, _, _ in rows]
    override_by_key = _override_map_for_expected_ids(db, tx_ids)
    today = date.today()

    result: list[ExpectedTransactionOut] = []
    for tx, account_name, category_name in rows:
        next_eff, n_amt, n_var, n_kind, n_desc = _next_occurrence_api_extensions(tx, override_by_key, today)
        result.append(
            ExpectedTransactionOut(
                id=tx.id,
                account=account_name,
                account_id=tx.account_id,
                start_date=tx.start_date,
                end_date=tx.end_date,
                recurrence=tx.recurrence,
                second_day_of_month=tx.second_day_of_month,
                description=tx.description,
                notes=tx.notes,
                kind=tx.kind,
                amount=tx.amount,
                reimbursable=bool(getattr(tx, "reimbursable", False)),
                variable=bool(getattr(tx, "variable", False)),
                category=category_name,
                category_id=tx.category_id,
                created_by=tx.created_by_user_id,
                next_occurrence_date=next_eff,
                next_occurrence_amount=n_amt,
                next_occurrence_variable=n_var,
                next_occurrence_kind=n_kind,
                next_occurrence_description=n_desc,
            )
        )
    return result


@app.post("/api/families/{family_id}/expected-transactions", response_model=ExpectedTransactionOut)
def create_expected_transaction(
    family_id: int,
    payload: ExpectedTransactionIn,
    access_token: Annotated[Optional[str], Cookie(alias="access_token")] = None,
    db=Depends(get_db),
):
    user_id = get_current_user_id(access_token)
    require_family_member(db=db, family_id=family_id, user_id=user_id)

    account = db.execute(select(Account).where(Account.id == payload.account_id, Account.family_id == family_id)).scalar_one_or_none()
    if account is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid account for this family")

    category_name: Optional[str] = None
    if payload.category_id is not None:
        category = db.execute(select(Category).where(Category.id == payload.category_id, Category.family_id == family_id)).scalar_one_or_none()
        if category is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid category for this family")
        category_name = category.name

    if payload.end_date is not None and payload.end_date < payload.start_date:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="end_date cannot be before start_date")

    _validate_expected_transaction_recurrence(payload)

    tx = ExpectedTransaction(
        family_id=family_id,
        account_id=payload.account_id,
        created_by_user_id=user_id,
        start_date=payload.start_date,
        end_date=payload.end_date,
        recurrence=payload.recurrence,
        second_day_of_month=payload.second_day_of_month if payload.recurrence == Recurrence.twice_monthly else None,
        description=payload.description,
        notes=payload.notes.strip() if payload.notes and payload.notes.strip() else None,
        kind=payload.kind,
        amount=payload.amount,
        reimbursable=payload.reimbursable,
        variable=payload.variable,
        category_id=payload.category_id,
    )
    db.add(tx)
    db.commit()
    db.refresh(tx)

    ovr_map = _override_map_for_expected_ids(db, [tx.id])
    next_eff, n_amt, n_var, n_kind, n_desc = _next_occurrence_api_extensions(tx, ovr_map, date.today())

    return ExpectedTransactionOut(
        id=tx.id,
        account=account.name,
        account_id=tx.account_id,
        start_date=tx.start_date,
        end_date=tx.end_date,
        recurrence=tx.recurrence,
        second_day_of_month=tx.second_day_of_month,
        description=tx.description,
        notes=tx.notes,
        kind=tx.kind,
        amount=tx.amount,
        reimbursable=bool(getattr(tx, "reimbursable", False)),
        variable=bool(getattr(tx, "variable", False)),
        category=category_name,
        category_id=tx.category_id,
        created_by=tx.created_by_user_id,
        next_occurrence_date=next_eff,
        next_occurrence_amount=n_amt,
        next_occurrence_variable=n_var,
        next_occurrence_kind=n_kind,
        next_occurrence_description=n_desc,
    )


@app.put("/api/families/{family_id}/expected-transactions/{expected_id}", response_model=ExpectedTransactionOut)
def update_expected_transaction(
    family_id: int,
    expected_id: int,
    payload: ExpectedTransactionIn,
    access_token: Annotated[Optional[str], Cookie(alias="access_token")] = None,
    db=Depends(get_db),
):
    user_id = get_current_user_id(access_token)
    require_family_member(db=db, family_id=family_id, user_id=user_id)

    tx = db.execute(
        select(ExpectedTransaction).where(
            ExpectedTransaction.id == expected_id,
            ExpectedTransaction.family_id == family_id,
        )
    ).scalar_one_or_none()
    if tx is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Expected transaction not found")

    account = db.execute(select(Account).where(Account.id == payload.account_id, Account.family_id == family_id)).scalar_one_or_none()
    if account is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid account for this family")

    category_name: Optional[str] = None
    if payload.category_id is not None:
        category = db.execute(select(Category).where(Category.id == payload.category_id, Category.family_id == family_id)).scalar_one_or_none()
        if category is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid category for this family")
        category_name = category.name

    if payload.end_date is not None and payload.end_date < payload.start_date:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="end_date cannot be before start_date")

    _validate_expected_transaction_recurrence(payload)

    tx.account_id = payload.account_id
    tx.start_date = payload.start_date
    tx.end_date = payload.end_date
    tx.recurrence = payload.recurrence
    tx.second_day_of_month = payload.second_day_of_month if payload.recurrence == Recurrence.twice_monthly else None
    tx.description = payload.description
    tx.notes = payload.notes.strip() if payload.notes and payload.notes.strip() else None
    tx.kind = payload.kind
    tx.amount = payload.amount
    tx.reimbursable = payload.reimbursable
    tx.variable = payload.variable
    tx.category_id = payload.category_id

    db.commit()
    db.refresh(tx)

    ovr_map = _override_map_for_expected_ids(db, [tx.id])
    next_eff, n_amt, n_var, n_kind, n_desc = _next_occurrence_api_extensions(tx, ovr_map, date.today())

    return ExpectedTransactionOut(
        id=tx.id,
        account=account.name,
        account_id=tx.account_id,
        start_date=tx.start_date,
        end_date=tx.end_date,
        recurrence=tx.recurrence,
        second_day_of_month=tx.second_day_of_month,
        description=tx.description,
        notes=tx.notes,
        kind=tx.kind,
        amount=tx.amount,
        reimbursable=bool(getattr(tx, "reimbursable", False)),
        variable=bool(getattr(tx, "variable", False)),
        category=category_name,
        category_id=tx.category_id,
        created_by=tx.created_by_user_id,
        next_occurrence_date=next_eff,
        next_occurrence_amount=n_amt,
        next_occurrence_variable=n_var,
        next_occurrence_kind=n_kind,
        next_occurrence_description=n_desc,
    )


@app.delete("/api/families/{family_id}/expected-transactions/{expected_id}")
def delete_expected_transaction(
    family_id: int,
    expected_id: int,
    access_token: Annotated[Optional[str], Cookie(alias="access_token")] = None,
    db=Depends(get_db),
):
    user_id = get_current_user_id(access_token)
    require_family_member(db=db, family_id=family_id, user_id=user_id)

    tx = db.execute(
        select(ExpectedTransaction).where(
            ExpectedTransaction.id == expected_id,
            ExpectedTransaction.family_id == family_id,
        )
    ).scalar_one_or_none()
    if tx is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Expected transaction not found")

    db.delete(tx)
    db.commit()
    return {"ok": True}


@app.post("/api/families/{family_id}/expected-transactions/{expected_id}/instances/{occurrence_date}")
def upsert_expected_instance_override(
    family_id: int,
    expected_id: int,
    occurrence_date: date,
    payload: ExpectedInstanceOverrideIn,
    access_token: Annotated[Optional[str], Cookie(alias="access_token")] = None,
    db=Depends(get_db),
):
    user_id = get_current_user_id(access_token)
    require_family_member(db=db, family_id=family_id, user_id=user_id)

    tx = db.execute(
        select(ExpectedTransaction).where(
            ExpectedTransaction.id == expected_id,
            ExpectedTransaction.family_id == family_id,
        )
    ).scalar_one_or_none()
    if tx is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Expected transaction not found")

    if payload.action == "cancel":
        account_id = None
        kind = None
        amount = None
        description = None
        reimbursable = None
        moved_to_date = None
        category_id = None
    else:
        if payload.account_id is None or payload.kind is None or payload.amount is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="account_id, kind, and amount are required for update")
        account_id = payload.account_id
        kind = payload.kind
        amount = payload.amount
        description = payload.description
        reimbursable = payload.reimbursable
        moved_to_date = payload.moved_to_date
        category_id = payload.category_id

        account = db.execute(select(Account).where(Account.id == account_id, Account.family_id == family_id)).scalar_one_or_none()
        if account is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid account for this family")
        if category_id is not None:
            category = db.execute(select(Category).where(Category.id == category_id, Category.family_id == family_id)).scalar_one_or_none()
            if category is None:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid category for this family")

    existing = db.execute(
        select(ExpectedTransactionOverride).where(
            ExpectedTransactionOverride.expected_transaction_id == expected_id,
            ExpectedTransactionOverride.occurrence_date == occurrence_date,
        )
    ).scalar_one_or_none()

    if existing is None:
        existing = ExpectedTransactionOverride(
            expected_transaction_id=expected_id,
            occurrence_date=occurrence_date,
        )
        db.add(existing)

    existing.cancelled = payload.action == "cancel"
    existing.account_id = account_id
    existing.kind = kind
    existing.amount = amount
    existing.description = description
    existing.reimbursable = reimbursable
    existing.moved_to_date = moved_to_date
    existing.category_id = category_id
    if payload.action == "cancel":
        existing.variable = None
    elif "variable" in payload.model_fields_set:
        existing.variable = payload.variable

    db.commit()
    db.refresh(existing)
    return {"ok": True}


@app.delete("/api/families/{family_id}/expected-transactions/{expected_id}/instances/{occurrence_date}")
def delete_expected_instance_override(
    family_id: int,
    expected_id: int,
    occurrence_date: date,
    access_token: Annotated[Optional[str], Cookie(alias="access_token")] = None,
    db=Depends(get_db),
):
    user_id = get_current_user_id(access_token)
    require_family_member(db=db, family_id=family_id, user_id=user_id)

    existing = db.execute(
        select(ExpectedTransactionOverride).join(ExpectedTransaction, ExpectedTransaction.id == ExpectedTransactionOverride.expected_transaction_id).where(
            ExpectedTransaction.family_id == family_id,
            ExpectedTransactionOverride.expected_transaction_id == expected_id,
            ExpectedTransactionOverride.occurrence_date == occurrence_date,
        )
    ).scalar_one_or_none()

    if existing is not None:
        db.delete(existing)
        db.commit()

    return {"ok": True}


@app.post(
    "/api/families/{family_id}/expected-transactions/{expected_id}/apply-from-occurrence/{occurrence_date}",
    response_model=ApplyFromOccurrenceOut,
)
def apply_expected_from_occurrence(
    family_id: int,
    expected_id: int,
    occurrence_date: date,
    payload: ApplyFromOccurrenceIn,
    access_token: Annotated[Optional[str], Cookie(alias="access_token")] = None,
    db=Depends(get_db),
):
    """
    Apply new amount/account/description to this occurrence and all future occurrences of the series.
    Splits the recurring row: past occurrences keep the old template; from `occurrence_date` forward uses the payload.
    For changes that start at the series start_date, updates the row in place.
    One-time (recurrence=once) schedules should use the per-instance override endpoint instead.
    """
    user_id = get_current_user_id(access_token)
    require_family_member(db=db, family_id=family_id, user_id=user_id)

    tx = db.execute(
        select(ExpectedTransaction).where(
            ExpectedTransaction.id == expected_id,
            ExpectedTransaction.family_id == family_id,
        )
    ).scalar_one_or_none()
    if tx is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Expected transaction not found")

    if tx.recurrence == Recurrence.once:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Use per-instance override for one-time expected transactions",
        )

    account = db.execute(select(Account).where(Account.id == payload.account_id, Account.family_id == family_id)).scalar_one_or_none()
    if account is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid account for this family")

    category_id = payload.category_id
    if category_id is not None:
        category = db.execute(select(Category).where(Category.id == category_id, Category.family_id == family_id)).scalar_one_or_none()
        if category is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid category for this family")

    if occurrence_date < tx.start_date:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="occurrence_date is before series start")
    if tx.end_date is not None and occurrence_date > tx.end_date:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="occurrence_date is after series end")

    hits = _expected_occurrences_in_range(
        start_date=tx.start_date,
        end_date=tx.end_date,
        recurrence=tx.recurrence,
        range_start=occurrence_date,
        range_end_exclusive=occurrence_date + timedelta(days=1),
        second_day_of_month=tx.second_day_of_month,
    )
    if occurrence_date not in hits:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Date is not a scheduled occurrence for this series")

    eff_rec = payload.recurrence if payload.recurrence is not None else tx.recurrence
    if eff_rec == Recurrence.once:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot apply-from-occurrence when resulting recurrence is once; use per-instance override",
        )

    if eff_rec == Recurrence.twice_monthly:
        eff_second = payload.second_day_of_month if payload.second_day_of_month is not None else tx.second_day_of_month
    else:
        eff_second = None

    if "notes" in payload.model_fields_set:
        eff_notes = payload.notes.strip() if payload.notes and payload.notes.strip() else None
    else:
        eff_notes = tx.notes

    eff_reimb = bool(payload.reimbursable) if "reimbursable" in payload.model_fields_set else bool(getattr(tx, "reimbursable", False))
    eff_variable = bool(payload.variable)

    validate_payload = ExpectedTransactionIn(
        account_id=payload.account_id,
        start_date=occurrence_date,
        end_date=tx.end_date,
        recurrence=eff_rec,
        second_day_of_month=eff_second,
        description=payload.description,
        notes=eff_notes,
        kind=payload.kind,
        amount=payload.amount,
        reimbursable=eff_reimb,
        variable=eff_variable,
        category_id=category_id,
    )
    _validate_expected_transaction_recurrence(validate_payload)

    db.execute(
        delete(ExpectedTransactionOverride).where(
            ExpectedTransactionOverride.expected_transaction_id == expected_id,
            ExpectedTransactionOverride.occurrence_date >= occurrence_date,
        )
    )

    if occurrence_date == tx.start_date:
        tx.account_id = validate_payload.account_id
        tx.kind = validate_payload.kind
        tx.amount = validate_payload.amount
        tx.description = validate_payload.description
        tx.reimbursable = validate_payload.reimbursable
        tx.category_id = validate_payload.category_id
        tx.recurrence = validate_payload.recurrence
        tx.second_day_of_month = validate_payload.second_day_of_month
        tx.notes = validate_payload.notes
        tx.variable = validate_payload.variable
        db.commit()
        db.refresh(tx)
        return ApplyFromOccurrenceOut(mode="updated_in_place", future_series_id=tx.id, ended_series_id=None)

    prev_occ = _occurrence_immediately_before(
        start_date=tx.start_date,
        series_end_date=tx.end_date,
        recurrence=tx.recurrence,
        occurrence_date=occurrence_date,
        second_day_of_month=tx.second_day_of_month,
    )
    if prev_occ is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Could not resolve previous occurrence for split")

    old_end = tx.end_date
    tx.end_date = prev_occ

    new_tx = ExpectedTransaction(
        family_id=family_id,
        account_id=validate_payload.account_id,
        created_by_user_id=user_id,
        start_date=occurrence_date,
        end_date=old_end,
        recurrence=validate_payload.recurrence,
        second_day_of_month=validate_payload.second_day_of_month,
        description=validate_payload.description,
        notes=validate_payload.notes,
        kind=validate_payload.kind,
        amount=validate_payload.amount,
        reimbursable=validate_payload.reimbursable,
        variable=validate_payload.variable,
        category_id=validate_payload.category_id,
    )
    db.add(new_tx)
    db.commit()
    db.refresh(new_tx)

    return ApplyFromOccurrenceOut(mode="split", future_series_id=new_tx.id, ended_series_id=tx.id)


@app.post(
    "/api/families/{family_id}/expected-transactions/{expected_id}/end-from-occurrence/{occurrence_date}",
    response_model=EndFromOccurrenceOut,
)
def end_expected_from_occurrence(
    family_id: int,
    expected_id: int,
    occurrence_date: date,
    access_token: Annotated[Optional[str], Cookie(alias="access_token")] = None,
    db=Depends(get_db),
):
    """
    Delete this occurrence and all future occurrences by ending the series before `occurrence_date`.
    Keeps historical occurrences intact.
    """
    user_id = get_current_user_id(access_token)
    require_family_member(db=db, family_id=family_id, user_id=user_id)

    tx = db.execute(
        select(ExpectedTransaction).where(
            ExpectedTransaction.id == expected_id,
            ExpectedTransaction.family_id == family_id,
        )
    ).scalar_one_or_none()
    if tx is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Expected transaction not found")

    if tx.recurrence == Recurrence.once:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Not a recurring transaction")

    if occurrence_date < tx.start_date:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="occurrence_date is before series start")
    if tx.end_date is not None and occurrence_date > tx.end_date:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="occurrence_date is after series end")

    hits = _expected_occurrences_in_range(
        start_date=tx.start_date,
        end_date=tx.end_date,
        recurrence=tx.recurrence,
        range_start=occurrence_date,
        range_end_exclusive=occurrence_date + timedelta(days=1),
        second_day_of_month=tx.second_day_of_month,
    )
    if occurrence_date not in hits:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Date is not a scheduled occurrence for this series")

    prev_occ = _occurrence_immediately_before(
        start_date=tx.start_date,
        series_end_date=tx.end_date,
        recurrence=tx.recurrence,
        occurrence_date=occurrence_date,
        second_day_of_month=tx.second_day_of_month,
    )

    # Delete overrides at/after occurrence_date: they are irrelevant once we end the series.
    db.execute(
        delete(ExpectedTransactionOverride).where(
            ExpectedTransactionOverride.expected_transaction_id == expected_id,
            ExpectedTransactionOverride.occurrence_date >= occurrence_date,
        )
    )

    if prev_occ is None:
        # No previous occurrence => nothing historical to keep; delete the series row entirely.
        db.delete(tx)
        db.commit()
        return EndFromOccurrenceOut(mode="deleted", expected_id=None, ended_at=None)

    tx.end_date = prev_occ
    db.commit()
    db.refresh(tx)
    return EndFromOccurrenceOut(mode="ended", expected_id=tx.id, ended_at=tx.end_date)


def _build_expected_calendar_items(
    *,
    expected_rows: Sequence[ExpectedTransaction],
    accounts_by_id: dict[int, Account],
    categories_by_id: dict[int, Category],
    override_map: dict[tuple[int, date], ExpectedTransactionOverride],
    range_start: date,
    range_end_exclusive: date,
) -> list[ExpectedCalendarItemOut]:
    items: list[ExpectedCalendarItemOut] = []
    for tx in expected_rows:
        occ_dates = _expected_occurrences_in_range(
            start_date=tx.start_date,
            end_date=tx.end_date,
            recurrence=tx.recurrence,
            range_start=range_start,
            range_end_exclusive=range_end_exclusive,
            second_day_of_month=tx.second_day_of_month,
        )

        for occ in occ_dates:
            ovr = override_map.get((tx.id, occ))
            if ovr is not None and ovr.cancelled:
                continue

            eff_account_id = (ovr.account_id if ovr is not None and ovr.account_id is not None else tx.account_id)
            eff_kind = (ovr.kind if ovr is not None and ovr.kind is not None else tx.kind)
            eff_amount = (ovr.amount if ovr is not None and ovr.amount is not None else tx.amount)
            eff_description = (ovr.description if ovr is not None and ovr.description is not None else tx.description)
            eff_reimbursable = (
                ovr.reimbursable
                if ovr is not None and ovr.reimbursable is not None
                else bool(getattr(tx, "reimbursable", False))
            )
            eff_category_id = (ovr.category_id if ovr is not None and ovr.category_id is not None else tx.category_id)
            eff_variable = bool(getattr(tx, "variable", False))
            if ovr is not None and getattr(ovr, "variable", None) is not None:
                eff_variable = bool(ovr.variable)

            acc = accounts_by_id.get(eff_account_id)
            if acc is None:
                continue
            cat = categories_by_id.get(eff_category_id) if eff_category_id is not None else None

            eff_date = ovr.moved_to_date if (ovr is not None and ovr.moved_to_date is not None) else occ
            # If moved outside the current range, skip; it will appear when viewing that month.
            if eff_date < range_start or eff_date >= range_end_exclusive:
                continue

            items.append(
                ExpectedCalendarItemOut(
                    expected_transaction_id=tx.id,
                    date=eff_date,
                    occurrence_date=occ,
                    account_id=eff_account_id,
                    account=acc.name,
                    kind=eff_kind,
                    amount=eff_amount,
                    description=eff_description,
                    notes=tx.notes,
                    reimbursable=bool(eff_reimbursable),
                    category_id=eff_category_id,
                    category=cat.name if cat is not None else None,
                    variable=bool(eff_variable),
                )
            )

    return items


@app.get("/api/families/{family_id}/expected-calendar", response_model=ExpectedCalendarOut)
def expected_calendar(
    family_id: int,
    month: str,
    access_token: Annotated[Optional[str], Cookie(alias="access_token")] = None,
    db=Depends(get_db),
):
    user_id = get_current_user_id(access_token)
    require_family_member(db=db, family_id=family_id, user_id=user_id)

    start_date, end_date = _month_range(month)

    account_rows = db.execute(select(Account).where(Account.family_id == family_id)).scalars().all()
    accounts_by_id: dict[int, Account] = {a.id: a for a in account_rows}

    category_rows = db.execute(select(Category).where(Category.family_id == family_id)).scalars().all()
    categories_by_id: dict[int, Category] = {c.id: c for c in category_rows}

    expected_rows = db.execute(select(ExpectedTransaction).where(ExpectedTransaction.family_id == family_id)).scalars().all()

    overrides = db.execute(
        select(ExpectedTransactionOverride).join(
            ExpectedTransaction,
            ExpectedTransaction.id == ExpectedTransactionOverride.expected_transaction_id,
        ).where(
            ExpectedTransaction.family_id == family_id,
            ExpectedTransactionOverride.occurrence_date >= start_date,
            ExpectedTransactionOverride.occurrence_date < end_date,
        )
    ).scalars().all()

    override_map: dict[tuple[int, date], ExpectedTransactionOverride] = {
        (o.expected_transaction_id, o.occurrence_date): o for o in overrides
    }

    items = _build_expected_calendar_items(
        expected_rows=expected_rows,
        accounts_by_id=accounts_by_id,
        categories_by_id=categories_by_id,
        override_map=override_map,
        range_start=start_date,
        range_end_exclusive=end_date,
    )

    return ExpectedCalendarOut(month=month, items=items)


@app.get("/api/families/{family_id}/reports/category-totals", response_model=CategoryTotalsReportOut)
def category_totals_report(
    family_id: int,
    start_date: Annotated[date, Query(description="Inclusive range start (YYYY-MM-DD).")],
    end_date: Annotated[date, Query(description="Inclusive range end (YYYY-MM-DD).")],
    mode: Annotated[Literal["actual", "actual_plus_estimated"], Query()] = "actual",
    access_token: Annotated[Optional[str], Cookie(alias="access_token")] = None,
    db=Depends(get_db),
):
    """
    Totals by category over a date range. ``actual_plus_estimated`` uses posted transactions
    through ``as_of`` (UTC calendar date) and scheduled expected occurrences after ``as_of``
    through ``end_date`` (same rules as expected-calendar).
    """
    user_id = get_current_user_id(access_token)
    require_family_member(db=db, family_id=family_id, user_id=user_id)

    if end_date < start_date:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="end_date cannot be before start_date")
    span_days = (end_date - start_date).days + 1
    if span_days > 4000:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Date range cannot exceed 4000 days")

    as_of = datetime.utcnow().date()
    range_end_exclusive = end_date + timedelta(days=1)

    agg: dict[Optional[int], dict[str, object]] = defaultdict(
        lambda: {
            "name": "Select Category",
            "income_actual": Decimal("0"),
            "expense_actual": Decimal("0"),
            "income_estimated": Decimal("0"),
            "expense_estimated": Decimal("0"),
        }
    )

    def add_actual_row(category_id: Optional[int], category_name: str, kind: TransactionKind, amount: Decimal) -> None:
        bucket = agg[category_id]
        bucket["name"] = category_name
        if kind == TransactionKind.income:
            bucket["income_actual"] = bucket["income_actual"] + amount  # type: ignore[operator]
        else:
            bucket["expense_actual"] = bucket["expense_actual"] + amount  # type: ignore[operator]

    def add_estimated_row(category_id: Optional[int], category_name: str, kind: TransactionKind, amount: Decimal) -> None:
        bucket = agg[category_id]
        bucket["name"] = category_name
        if kind == TransactionKind.income:
            bucket["income_estimated"] = bucket["income_estimated"] + amount  # type: ignore[operator]
        else:
            bucket["expense_estimated"] = bucket["expense_estimated"] + amount  # type: ignore[operator]

    # --- Actual transactions (always the portion through min(end_date, as_of)) ---
    actual_end_inclusive = min(end_date, as_of)
    actual_end_exclusive = actual_end_inclusive + timedelta(days=1)
    if start_date <= actual_end_inclusive:
        tx_rows = db.execute(
            select(Transaction, Category.name.label("category_name"))
            .join(Category, Category.id == Transaction.category_id, isouter=True)
            .where(
                Transaction.family_id == family_id,
                Transaction.date >= start_date,
                Transaction.date < actual_end_exclusive,
            )
        ).all()
        for tx, category_name in tx_rows:
            nm = category_name or "Select Category"
            add_actual_row(tx.category_id, nm, tx.kind, tx.amount)

    # --- Estimated expected occurrences (only in actual_plus_estimated, future slice) ---
    if mode == "actual_plus_estimated":
        estimate_start = max(start_date, as_of + timedelta(days=1))
        if estimate_start <= end_date:
            account_rows = db.execute(select(Account).where(Account.family_id == family_id)).scalars().all()
            accounts_by_id: dict[int, Account] = {a.id: a for a in account_rows}

            category_rows = db.execute(select(Category).where(Category.family_id == family_id)).scalars().all()
            categories_by_id: dict[int, Category] = {c.id: c for c in category_rows}

            expected_rows = db.execute(select(ExpectedTransaction).where(ExpectedTransaction.family_id == family_id)).scalars().all()

            overrides = db.execute(
                select(ExpectedTransactionOverride).join(
                    ExpectedTransaction,
                    ExpectedTransaction.id == ExpectedTransactionOverride.expected_transaction_id,
                ).where(ExpectedTransaction.family_id == family_id)
            ).scalars().all()
            override_map: dict[tuple[int, date], ExpectedTransactionOverride] = {
                (o.expected_transaction_id, o.occurrence_date): o for o in overrides
            }

            est_items = _build_expected_calendar_items(
                expected_rows=expected_rows,
                accounts_by_id=accounts_by_id,
                categories_by_id=categories_by_id,
                override_map=override_map,
                range_start=estimate_start,
                range_end_exclusive=range_end_exclusive,
            )
            for it in est_items:
                nm = it.category or "Select Category"
                add_estimated_row(it.category_id, nm, it.kind, it.amount)

    lines: list[CategoryTotalsLineOut] = []
    sum_income_actual = Decimal("0")
    sum_expense_actual = Decimal("0")
    sum_income_estimated = Decimal("0")
    sum_expense_estimated = Decimal("0")

    for cid in sorted(agg.keys(), key=lambda x: (x is None, x or 0)):
        b = agg[cid]
        ia = b["income_actual"]  # type: ignore[assignment]
        ea = b["expense_actual"]  # type: ignore[assignment]
        ie = b["income_estimated"]  # type: ignore[assignment]
        ee = b["expense_estimated"]  # type: ignore[assignment]
        nm = str(b["name"])
        lines.append(
            CategoryTotalsLineOut(
                category_id=cid,
                category_name=nm,
                income_actual=ia,
                expense_actual=ea,
                income_estimated=ie,
                expense_estimated=ee,
            )
        )
        sum_income_actual += ia
        sum_expense_actual += ea
        sum_income_estimated += ie
        sum_expense_estimated += ee

    # Hide categories with all zeros (shouldn't happen often)
    lines = [ln for ln in lines if any((ln.income_actual, ln.expense_actual, ln.income_estimated, ln.expense_estimated))]

    lines.sort(
        key=lambda ln: (ln.expense_actual + ln.expense_estimated + ln.income_actual + ln.income_estimated),
        reverse=True,
    )

    return CategoryTotalsReportOut(
        start_date=start_date,
        end_date=end_date,
        mode=mode,
        as_of=as_of,
        lines=lines,
        sum_income_actual=sum_income_actual,
        sum_expense_actual=sum_expense_actual,
        sum_income_estimated=sum_income_estimated,
        sum_expense_estimated=sum_expense_estimated,
    )


def _last_day_of_month(year: int, month: int) -> int:
    # Avoids external date libs; clamps to the last day when a month is shorter.
    import calendar

    return calendar.monthrange(year, month)[1]


def _add_months(d: date, months: int) -> date:
    # Adds months, clamping the day-of-month to keep the date valid.
    total_months = (d.year * 12 + (d.month - 1)) + months
    new_year = total_months // 12
    new_month = (total_months % 12) + 1
    new_day = min(d.day, _last_day_of_month(new_year, new_month))
    return date(new_year, new_month, new_day)


def _date_on_day_in_month(year: int, month: int, day: int) -> date:
    last = _last_day_of_month(year, month)
    return date(year, month, min(day, last))


def _iter_twice_monthly_occurrences(
    start_date: date,
    series_end_date: Optional[date],
    day1: int,
    day2: int,
):
    """Chronological occurrences on two fixed calendar days each month (day-of-month 1–31, clamped)."""
    y, m = start_date.year, start_date.month
    for _ in range(2400):
        for d in sorted({_date_on_day_in_month(y, m, day1), _date_on_day_in_month(y, m, day2)}):
            if d < start_date:
                continue
            if series_end_date is not None and d > series_end_date:
                return
            yield d
        if m == 12:
            y, m = y + 1, 1
        else:
            m += 1


def _expected_occurrences_in_range(
    *,
    start_date: date,
    end_date: Optional[date],
    recurrence: Recurrence,
    range_start: date,
    range_end_exclusive: date,
    second_day_of_month: Optional[int] = None,
) -> list[date]:
    if recurrence == Recurrence.once:
        if start_date < range_end_exclusive and start_date >= range_start and (end_date is None or start_date <= end_date):
            return [start_date]
        return []

    if recurrence == Recurrence.weekly:
        occurrences_w: list[date] = []
        current_w = start_date
        while current_w < range_start:
            current_w += timedelta(days=7)
            if end_date is not None and current_w > end_date:
                return []

        while current_w < range_end_exclusive:
            if end_date is not None and current_w > end_date:
                break
            if current_w >= range_start:
                occurrences_w.append(current_w)
            current_w += timedelta(days=7)
        return occurrences_w

    if recurrence == Recurrence.twice_monthly:
        if second_day_of_month is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="second_day_of_month is required for twice monthly recurrence",
            )
        out_tm: list[date] = []
        for d in _iter_twice_monthly_occurrences(start_date, end_date, start_date.day, second_day_of_month):
            if d >= range_end_exclusive:
                break
            if d >= range_start:
                out_tm.append(d)
        return out_tm

    if recurrence == Recurrence.monthly:
        step_months = 1
    elif recurrence == Recurrence.semiannual:
        step_months = 6
    elif recurrence == Recurrence.yearly:
        step_months = 12
    else:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported recurrence")

    occurrences: list[date] = []
    current = start_date

    # Fast-forward to range_start.
    while current < range_start:
        current = _add_months(current, step_months)
        if end_date is not None and current > end_date:
            return []

    while current < range_end_exclusive:
        if end_date is not None and current > end_date:
            break
        if current >= range_start:
            occurrences.append(current)
        current = _add_months(current, step_months)

    return occurrences


def _override_map_for_expected_ids(db, expected_ids: list[int]) -> dict[tuple[int, date], ExpectedTransactionOverride]:
    if not expected_ids:
        return {}
    rows = db.execute(
        select(ExpectedTransactionOverride).where(ExpectedTransactionOverride.expected_transaction_id.in_(expected_ids))
    ).scalars().all()
    return {(o.expected_transaction_id, o.occurrence_date): o for o in rows}


def _next_occurrence_snapshot_on_or_after(
    *,
    tx: ExpectedTransaction,
    on_or_after: date,
    override_by_key: dict[tuple[int, date], ExpectedTransactionOverride],
) -> Optional[tuple[date, date, Decimal, bool, TransactionKind, str]]:
    """
    First occurrence on or after on_or_after (by display/cash-flow date).
    Returns (display_date, scheduled_occurrence_date, amount, variable, kind, description) or None.
    Matches expected-calendar override rules.
    """
    horizon_end = on_or_after + timedelta(days=1100)
    occ_dates = _expected_occurrences_in_range(
        start_date=tx.start_date,
        end_date=tx.end_date,
        recurrence=tx.recurrence,
        range_start=tx.start_date,
        range_end_exclusive=horizon_end,
        second_day_of_month=tx.second_day_of_month,
    )
    for occ in occ_dates:
        ovr = override_by_key.get((tx.id, occ))
        if ovr is not None and ovr.cancelled:
            continue
        eff_date = ovr.moved_to_date if (ovr is not None and ovr.moved_to_date is not None) else occ
        if eff_date < on_or_after:
            continue
        eff_amount = ovr.amount if (ovr is not None and ovr.amount is not None) else tx.amount
        eff_kind = ovr.kind if (ovr is not None and ovr.kind is not None) else tx.kind
        eff_description = ovr.description if (ovr is not None and ovr.description is not None) else tx.description
        eff_variable = bool(getattr(tx, "variable", False))
        if ovr is not None and getattr(ovr, "variable", None) is not None:
            eff_variable = bool(ovr.variable)
        return (eff_date, occ, eff_amount, eff_variable, eff_kind, eff_description)
    return None


def _next_effective_occurrence_on_or_after(
    *,
    tx: ExpectedTransaction,
    on_or_after: date,
    override_by_key: dict[tuple[int, date], ExpectedTransactionOverride],
) -> Optional[date]:
    snap = _next_occurrence_snapshot_on_or_after(tx=tx, on_or_after=on_or_after, override_by_key=override_by_key)
    return snap[0] if snap else None


def _next_occurrence_api_extensions(
    tx: ExpectedTransaction,
    override_by_key: dict[tuple[int, date], ExpectedTransactionOverride],
    on_or_after: date,
) -> tuple[Optional[date], Optional[Decimal], Optional[bool], Optional[TransactionKind], Optional[str]]:
    snap = _next_occurrence_snapshot_on_or_after(tx=tx, on_or_after=on_or_after, override_by_key=override_by_key)
    if snap is None:
        return (None, None, None, None, None)
    eff_date, _occ, eff_amount, eff_variable, eff_kind, eff_description = snap
    return (eff_date, eff_amount, eff_variable, eff_kind, eff_description)


def _occurrence_immediately_before(
    *,
    start_date: date,
    series_end_date: Optional[date],
    recurrence: Recurrence,
    occurrence_date: date,
    second_day_of_month: Optional[int] = None,
) -> Optional[date]:
    """
    Last scheduled occurrence strictly before `occurrence_date` in the same series.
    Used when splitting a recurring series so `end_date` stays aligned with the recurrence pattern
    (e.g. month-end days), not merely calendar day - 1.
    """
    if recurrence == Recurrence.once or occurrence_date <= start_date:
        return None
    if recurrence == Recurrence.weekly:
        prev_w: Optional[date] = None
        current_w = start_date
        while current_w < occurrence_date:
            if series_end_date is not None and current_w > series_end_date:
                return prev_w
            prev_w = current_w
            current_w += timedelta(days=7)
            if series_end_date is not None and current_w > series_end_date:
                break
        return prev_w

    if recurrence == Recurrence.twice_monthly:
        if second_day_of_month is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="second_day_of_month is required for twice monthly recurrence",
            )
        prev_tm: Optional[date] = None
        for d in _iter_twice_monthly_occurrences(start_date, series_end_date, start_date.day, second_day_of_month):
            if d >= occurrence_date:
                return prev_tm
            prev_tm = d
        return prev_tm

    if recurrence == Recurrence.monthly:
        step_months = 1
    elif recurrence == Recurrence.semiannual:
        step_months = 6
    elif recurrence == Recurrence.yearly:
        step_months = 12
    else:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported recurrence")

    prev: Optional[date] = None
    current = start_date
    while current < occurrence_date:
        if series_end_date is not None and current > series_end_date:
            return prev
        prev = current
        current = _add_months(current, step_months)
        if series_end_date is not None and current > series_end_date:
            break
    return prev


def _calendar_month_daily_balances(
    *,
    db,
    family_id: int,
    month: str,
    mode: Literal["both", "actual", "expected"],
) -> list[CalendarDayBalanceOut]:
    """
    One pooled running balance: starting balances apply on their day, then each day's end balance
    feeds the next day. Simulates from the earliest relevant date through the end of `month`.
    """
    month_start, month_end_excl = _month_range(month)
    last_day = month_end_excl - timedelta(days=1)

    account_rows = list(db.execute(select(Account).where(Account.family_id == family_id)).scalars().all())
    if not account_rows:
        return []

    min_acc = min((a.starting_balance_date or a.created_at.date()) for a in account_rows)
    first_tx = db.execute(
        select(func.min(Transaction.date)).where(Transaction.family_id == family_id, Transaction.imported == False)  # noqa: E712
    ).scalar_one_or_none()
    first_expected = db.execute(select(func.min(ExpectedTransaction.start_date)).where(ExpectedTransaction.family_id == family_id)).scalar_one_or_none()
    global_start = min_acc
    if first_tx is not None:
        global_start = min(global_start, first_tx)
    if first_expected is not None:
        global_start = min(global_start, first_expected)

    actual_by_date: dict[date, Decimal] = defaultdict(lambda: Decimal("0"))
    if mode in ("both", "actual"):
        tx_rows = db.execute(
            select(Transaction).where(
                Transaction.family_id == family_id,
                Transaction.imported == False,  # noqa: E712
                Transaction.date >= global_start,
                Transaction.date <= last_day,
            )
        ).scalars().all()
        for tx in tx_rows:
            signed = tx.amount if tx.kind == TransactionKind.income else -tx.amount
            actual_by_date[tx.date] += signed

    expected_by_date: dict[date, Decimal] = defaultdict(lambda: Decimal("0"))
    if mode in ("both", "expected"):
        accounts_by_id: dict[int, Account] = {a.id: a for a in account_rows}
        expected_rows = db.execute(select(ExpectedTransaction).where(ExpectedTransaction.family_id == family_id)).scalars().all()
        overrides = db.execute(
            select(ExpectedTransactionOverride).join(
                ExpectedTransaction,
                ExpectedTransaction.id == ExpectedTransactionOverride.expected_transaction_id,
            ).where(
                ExpectedTransaction.family_id == family_id,
                ExpectedTransactionOverride.occurrence_date >= global_start,
                ExpectedTransactionOverride.occurrence_date < month_end_excl,
            )
        ).scalars().all()
        override_map: dict[tuple[int, date], ExpectedTransactionOverride] = {
            (o.expected_transaction_id, o.occurrence_date): o for o in overrides
        }
        for tx in expected_rows:
            occ_dates = _expected_occurrences_in_range(
                start_date=tx.start_date,
                end_date=tx.end_date,
                recurrence=tx.recurrence,
                range_start=global_start,
                range_end_exclusive=month_end_excl,
                second_day_of_month=tx.second_day_of_month,
            )
            for occ in occ_dates:
                if occ > last_day:
                    continue
                ovr = override_map.get((tx.id, occ))
                if ovr is not None and ovr.cancelled:
                    continue
                eff_account_id = ovr.account_id if ovr is not None and ovr.account_id is not None else tx.account_id
                eff_kind = ovr.kind if ovr is not None and ovr.kind is not None else tx.kind
                eff_amount = ovr.amount if ovr is not None and ovr.amount is not None else tx.amount
                if accounts_by_id.get(eff_account_id) is None:
                    continue
                signed = eff_amount if eff_kind == TransactionKind.income else -eff_amount
                eff_date = ovr.moved_to_date if (ovr is not None and getattr(ovr, "moved_to_date", None) is not None) else occ
                if eff_date < global_start or eff_date > last_day:
                    continue
                expected_by_date[eff_date] += signed

    carry = Decimal("0")
    start_adds: dict[date, Decimal] = defaultdict(lambda: Decimal("0"))
    for a in account_rows:
        sd = a.starting_balance_date or a.created_at.date()
        bal = a.starting_balance
        if sd < global_start:
            carry += bal
        elif global_start <= sd <= last_day:
            start_adds[sd] += bal

    out: list[CalendarDayBalanceOut] = []
    d = global_start
    while d <= last_day:
        day_start = carry + start_adds.get(d, Decimal("0"))
        if mode == "both":
            tx_net = actual_by_date.get(d, Decimal("0")) + expected_by_date.get(d, Decimal("0"))
        elif mode == "actual":
            tx_net = actual_by_date.get(d, Decimal("0"))
        else:
            tx_net = expected_by_date.get(d, Decimal("0"))
        day_end = day_start + tx_net
        if d >= month_start:
            out.append(
                CalendarDayBalanceOut(
                    date=d,
                    start=str(day_start),
                    tx_net=str(tx_net),
                    end=str(day_end),
                )
            )
        carry = day_end
        d += timedelta(days=1)

    return out


def _pooled_daily_balance_first_hit_impl(
    *,
    db,
    family_id: int,
    start_date: date,
    days: int,
    level: Decimal,
    mode: Literal["both", "actual", "expected"],
    crossing: Literal["lte", "gte"],
) -> tuple[Optional[date], Optional[Decimal]]:
    """
    Find the first date strictly after start_date where pooled end-of-day balance crosses `level`
    (<= for "lte", >= for "gte"). Same pooled balance model as calendar-month-daily.
    """
    if days <= 0 or days > 4000:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="days out of allowed range")
    range_end_excl = start_date + timedelta(days=days + 1)
    last_day = range_end_excl - timedelta(days=1)

    account_rows = list(db.execute(select(Account).where(Account.family_id == family_id)).scalars().all())
    if not account_rows:
        return None, None

    min_acc = min((a.starting_balance_date or a.created_at.date()) for a in account_rows)
    first_tx = db.execute(
        select(func.min(Transaction.date)).where(Transaction.family_id == family_id, Transaction.imported == False)  # noqa: E712
    ).scalar_one_or_none()
    first_expected = db.execute(select(func.min(ExpectedTransaction.start_date)).where(ExpectedTransaction.family_id == family_id)).scalar_one_or_none()
    global_start = min_acc
    if first_tx is not None:
        global_start = min(global_start, first_tx)
    if first_expected is not None:
        global_start = min(global_start, first_expected)

    actual_by_date: dict[date, Decimal] = defaultdict(lambda: Decimal("0"))
    if mode in ("both", "actual"):
        tx_rows = db.execute(
            select(Transaction).where(
                Transaction.family_id == family_id,
                Transaction.imported == False,  # noqa: E712
                Transaction.date >= global_start,
                Transaction.date <= last_day,
            )
        ).scalars().all()
        for tx in tx_rows:
            signed = tx.amount if tx.kind == TransactionKind.income else -tx.amount
            actual_by_date[tx.date] += signed

    expected_by_date: dict[date, Decimal] = defaultdict(lambda: Decimal("0"))
    if mode in ("both", "expected"):
        accounts_by_id: dict[int, Account] = {a.id: a for a in account_rows}
        expected_rows = db.execute(select(ExpectedTransaction).where(ExpectedTransaction.family_id == family_id)).scalars().all()
        overrides = db.execute(
            select(ExpectedTransactionOverride).join(
                ExpectedTransaction,
                ExpectedTransaction.id == ExpectedTransactionOverride.expected_transaction_id,
            ).where(
                ExpectedTransaction.family_id == family_id,
                ExpectedTransactionOverride.occurrence_date >= global_start,
                ExpectedTransactionOverride.occurrence_date < range_end_excl,
            )
        ).scalars().all()
        override_map: dict[tuple[int, date], ExpectedTransactionOverride] = {
            (o.expected_transaction_id, o.occurrence_date): o for o in overrides
        }
        for tx in expected_rows:
            occ_dates = _expected_occurrences_in_range(
                start_date=tx.start_date,
                end_date=tx.end_date,
                recurrence=tx.recurrence,
                range_start=global_start,
                range_end_exclusive=range_end_excl,
                second_day_of_month=tx.second_day_of_month,
            )
            for occ in occ_dates:
                if occ > last_day:
                    continue
                ovr = override_map.get((tx.id, occ))
                if ovr is not None and ovr.cancelled:
                    continue
                eff_account_id = ovr.account_id if ovr is not None and ovr.account_id is not None else tx.account_id
                eff_kind = ovr.kind if ovr is not None and ovr.kind is not None else tx.kind
                eff_amount = ovr.amount if ovr is not None and ovr.amount is not None else tx.amount
                if accounts_by_id.get(eff_account_id) is None:
                    continue
                signed = eff_amount if eff_kind == TransactionKind.income else -eff_amount
                eff_date = ovr.moved_to_date if (ovr is not None and getattr(ovr, "moved_to_date", None) is not None) else occ
                if eff_date < global_start or eff_date > last_day:
                    continue
                expected_by_date[eff_date] += signed

    carry = Decimal("0")
    start_adds: dict[date, Decimal] = defaultdict(lambda: Decimal("0"))
    for a in account_rows:
        sd = a.starting_balance_date or a.created_at.date()
        bal = a.starting_balance
        if sd < global_start:
            carry += bal
        elif global_start <= sd <= last_day:
            start_adds[sd] += bal

    d = global_start
    hit_date: Optional[date] = None
    hit_balance: Optional[Decimal] = None
    while d <= last_day:
        day_start = carry + start_adds.get(d, Decimal("0"))
        if mode == "both":
            tx_net = actual_by_date.get(d, Decimal("0")) + expected_by_date.get(d, Decimal("0"))
        elif mode == "actual":
            tx_net = actual_by_date.get(d, Decimal("0"))
        else:
            tx_net = expected_by_date.get(d, Decimal("0"))
        day_end = day_start + tx_net
        carry = day_end
        crossed = day_end <= level if crossing == "lte" else day_end >= level
        if d > start_date and hit_date is None and crossed:
            hit_date = d
            hit_balance = day_end
            break
        d += timedelta(days=1)

    return hit_date, hit_balance


def _pooled_daily_balance_first_hit(
    *,
    db,
    family_id: int,
    start_date: date,
    days: int,
    threshold: Decimal,
    mode: Literal["both", "actual", "expected"],
) -> LowBalanceFirstHitOut:
    hit_date, hit_balance = _pooled_daily_balance_first_hit_impl(
        db=db,
        family_id=family_id,
        start_date=start_date,
        days=days,
        level=threshold,
        mode=mode,
        crossing="lte",
    )
    return LowBalanceFirstHitOut(
        threshold=threshold,
        start=start_date,
        days=days,
        mode=mode,
        hit_date=hit_date,
        hit_balance=hit_balance,
    )


@app.get("/api/families/{family_id}/calendar-month-daily", response_model=CalendarMonthDailyOut)
def calendar_month_daily(
    family_id: int,
    month: str,
    mode: Literal["both", "actual", "expected"] = "both",
    access_token: Annotated[Optional[str], Cookie(alias="access_token")] = None,
    db=Depends(get_db),
):
    """
    Pooled daily balance for each day in `month`: prior day's end + starting balances on the day + net flows.
    """
    user_id = get_current_user_id(access_token)
    require_family_member(db=db, family_id=family_id, user_id=user_id)

    try:
        _month_range(month)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid month (use YYYY-MM)")

    days = _calendar_month_daily_balances(db=db, family_id=family_id, month=month, mode=mode)
    return CalendarMonthDailyOut(month=month, mode=mode, days=days)


@app.get("/api/families/{family_id}/projection", response_model=ProjectionOut)
def projection(
    family_id: int,
    start: Optional[date] = None,
    days: int = 1825,
    include_accounts: bool = False,
    access_token: Annotated[Optional[str], Cookie(alias="access_token")] = None,
    db=Depends(get_db),
):
    user_id = get_current_user_id(access_token)
    require_family_member(db=db, family_id=family_id, user_id=user_id)

    if days <= 0 or days > 4000:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="days out of allowed range")

    range_start = start or datetime.utcnow().date()
    range_end = range_start + timedelta(days=days)

    account_rows = db.execute(
        select(Account).where(Account.family_id == family_id).order_by(Account.name.asc())
    ).scalars().all()
    if not account_rows:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No accounts configured for this family")

    accounts: list[AccountOut] = [
        AccountOut(
            id=a.id,
            name=a.name,
            type=a.type,
            starting_balance=a.starting_balance,
            starting_balance_date=a.starting_balance_date or a.created_at.date(),
        )
        for a in account_rows
    ]

    # Map: date -> account_id -> net cashflow signed amount.
    occurrences_by_date: dict[date, dict[int, Decimal]] = {}

    expected_rows = db.execute(select(ExpectedTransaction).where(ExpectedTransaction.family_id == family_id)).scalars().all()

    overrides = db.execute(
        select(ExpectedTransactionOverride).join(
            ExpectedTransaction,
            ExpectedTransaction.id == ExpectedTransactionOverride.expected_transaction_id,
        ).where(
            ExpectedTransaction.family_id == family_id,
            ExpectedTransactionOverride.occurrence_date >= range_start,
            ExpectedTransactionOverride.occurrence_date < range_end,
        )
    ).scalars().all()
    override_map: dict[tuple[int, date], ExpectedTransactionOverride] = {
        (o.expected_transaction_id, o.occurrence_date): o for o in overrides
    }

    for tx in expected_rows:
        occ_dates = _expected_occurrences_in_range(
            start_date=tx.start_date,
            end_date=tx.end_date,
            recurrence=tx.recurrence,
            range_start=range_start,
            range_end_exclusive=range_end,
            second_day_of_month=tx.second_day_of_month,
        )
        if not occ_dates:
            continue

        for d in occ_dates:
            ovr = override_map.get((tx.id, d))
            if ovr is not None and ovr.cancelled:
                continue

            eff_account_id = ovr.account_id if ovr is not None and ovr.account_id is not None else tx.account_id
            eff_kind = ovr.kind if ovr is not None and ovr.kind is not None else tx.kind
            eff_amount = ovr.amount if ovr is not None and ovr.amount is not None else tx.amount

            signed_amount = eff_amount if eff_kind == TransactionKind.income else -eff_amount
            eff_date = ovr.moved_to_date if (ovr is not None and getattr(ovr, "moved_to_date", None) is not None) else d
            if eff_date < range_start or eff_date >= range_end:
                continue
            by_acc = occurrences_by_date.setdefault(eff_date, {})
            by_acc[eff_account_id] = by_acc.get(eff_account_id, Decimal("0")) + signed_amount

    account_balances: dict[int, Decimal] = {}
    for a in account_rows:
        if a.starting_balance_date < range_start:
            account_balances[a.id] = a.starting_balance
        else:
            account_balances[a.id] = Decimal("0")

    daily: list[ProjectionDailyOut] = []
    for i in range(days):
        current_date = range_start + timedelta(days=i)
        day_occ = occurrences_by_date.get(current_date, {})

        net_cashflow = Decimal("0")
        account_cashflow_map: Optional[dict[int, Decimal]] = {} if include_accounts else None
        account_balance_map: Optional[dict[int, Decimal]] = {} if include_accounts else None

        for a in account_rows:
            if a.starting_balance_date == current_date:
                account_balances[a.id] = account_balances[a.id] + a.starting_balance
            cashflow = day_occ.get(a.id, Decimal("0"))
            net_cashflow += cashflow
            account_balances[a.id] = account_balances[a.id] + cashflow
            if include_accounts:
                # Two separate maps so the frontend can present both.
                account_cashflow_map[a.id] = cashflow  # type: ignore[index]
                account_balance_map[a.id] = account_balances[a.id]  # type: ignore[index]

        total_balance = sum(account_balances.values(), Decimal("0"))
        daily.append(
            ProjectionDailyOut(
                date=current_date,
                net_cashflow=net_cashflow,
                total_balance=total_balance,
                account_cashflow=account_cashflow_map,
                account_balance=account_balance_map,
            )
        )

    return ProjectionOut(start=range_start, days=days, accounts=accounts, daily=daily)


@app.get("/api/families/{family_id}/low-balance-first", response_model=LowBalanceFirstHitOut)
def low_balance_first(
    family_id: int,
    threshold: Decimal,
    start: Optional[date] = None,
    days: int = 1825,
    mode: Literal["both", "actual", "expected"] = "both",
    access_token: Annotated[Optional[str], Cookie(alias="access_token")] = None,
    db=Depends(get_db),
):
    user_id = get_current_user_id(access_token)
    require_family_member(db=db, family_id=family_id, user_id=user_id)
    s = start or datetime.utcnow().date()
    return _pooled_daily_balance_first_hit(db=db, family_id=family_id, start_date=s, days=days, threshold=threshold, mode=mode)


@app.get("/api/families/{family_id}/high-balance-first", response_model=HighBalanceFirstHitOut)
def high_balance_first(
    family_id: int,
    ceiling: Decimal,
    start: Optional[date] = None,
    days: int = 1825,
    mode: Literal["both", "actual", "expected"] = "both",
    access_token: Annotated[Optional[str], Cookie(alias="access_token")] = None,
    db=Depends(get_db),
):
    user_id = get_current_user_id(access_token)
    require_family_member(db=db, family_id=family_id, user_id=user_id)
    s = start or datetime.utcnow().date()
    hit_date, hit_balance = _pooled_daily_balance_first_hit_impl(
        db=db, family_id=family_id, start_date=s, days=days, level=ceiling, mode=mode, crossing="gte"
    )
    return HighBalanceFirstHitOut(
        ceiling=ceiling,
        start=s,
        days=days,
        mode=mode,
        hit_date=hit_date,
        hit_balance=hit_balance,
    )


def _month_range(month: str) -> tuple[date, date]:
    # month in YYYY-MM
    parsed = datetime.strptime(month, "%Y-%m")
    start = date(parsed.year, parsed.month, 1)
    if parsed.month == 12:
        end = date(parsed.year + 1, 1, 1)
    else:
        end = date(parsed.year, parsed.month + 1, 1)
    return start, end


@app.get("/api/families/{family_id}/transactions", response_model=TransactionsListOut)
def list_transactions(
    family_id: int,
    month: Optional[str] = None,
    start_date: Annotated[Optional[date], Query(description="Inclusive range start (YYYY-MM-DD); use with end_date for date-range lists.")] = None,
    end_date: Annotated[Optional[date], Query(description="Inclusive range end (YYYY-MM-DD).")] = None,
    access_token: Annotated[Optional[str], Cookie(alias="access_token")] = None,
    db=Depends(get_db),
):
    user_id = get_current_user_id(access_token)
    require_family_member(db=db, family_id=family_id, user_id=user_id)

    if start_date is not None:
        range_start = start_date
        if end_date is not None:
            if end_date < start_date:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="end_date cannot be before start_date")
            range_end_exclusive = end_date + timedelta(days=1)
        else:
            range_end_exclusive = start_date + timedelta(days=366)
        order_asc = True
    elif month:
        range_start, range_end_exclusive = _month_range(month)
        order_asc = False
    else:
        today = datetime.utcnow().date()
        range_start, range_end_exclusive = _month_range(f"{today.year:04d}-{today.month:02d}")
        order_asc = False

    # Totals
    income_sum = db.execute(
        select(func.coalesce(func.sum(Transaction.amount), 0)).where(
            Transaction.family_id == family_id,
            Transaction.date >= range_start,
            Transaction.date < range_end_exclusive,
            Transaction.kind == TransactionKind.income,
        )
    ).scalar_one()
    expense_sum = db.execute(
        select(func.coalesce(func.sum(Transaction.amount), 0)).where(
            Transaction.family_id == family_id,
            Transaction.date >= range_start,
            Transaction.date < range_end_exclusive,
            Transaction.kind == TransactionKind.expense,
        )
    ).scalar_one()

    # Items (+ category name)
    order_cols = (
        (Transaction.date.asc(), Transaction.id.asc()) if order_asc else (Transaction.date.desc(), Transaction.id.desc())
    )
    stmt = (
        select(Transaction, Category.name.label("category_name"))
        .join(Category, Category.id == Transaction.category_id, isouter=True)
        .where(
            Transaction.family_id == family_id,
            Transaction.date >= range_start,
            Transaction.date < range_end_exclusive,
        )
        .order_by(*order_cols)
    )
    rows = db.execute(stmt).all()

    items: list[TransactionOut] = []
    for tx, category_name in rows:
        items.append(
            TransactionOut(
                id=tx.id,
                date=tx.date,
                description=tx.description,
                vendor=getattr(tx, "vendor", None),
                raw_description=getattr(tx, "raw_description", None),
                notes=tx.notes,
                kind=tx.kind,
                amount=tx.amount,
                category=category_name,
                category_id=tx.category_id,
                account_id=getattr(tx, "account_id", None),
                reimbursable=bool(getattr(tx, "reimbursable", False)),
                imported=bool(getattr(tx, "imported", False)),
            )
        )

    return TransactionsListOut(
        items=items,
        totals={"income": income_sum, "expense": expense_sum, "net": income_sum - expense_sum},
    )


@app.post("/api/families/{family_id}/transactions", response_model=TransactionOut)
def create_transaction(
    family_id: int,
    payload: TransactionIn,
    access_token: Annotated[Optional[str], Cookie(alias="access_token")] = None,
    db=Depends(get_db),
):
    user_id = get_current_user_id(access_token)
    require_family_member(db=db, family_id=family_id, user_id=user_id)

    if payload.category_id is not None:
        category = db.execute(
            select(Category).where(Category.id == payload.category_id, Category.family_id == family_id)
        ).scalar_one_or_none()
        if category is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid category for this family")

    if payload.account_id is not None:
        acct = db.execute(select(Account).where(Account.id == payload.account_id, Account.family_id == family_id)).scalar_one_or_none()
        if acct is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid account for this family")

    tx = Transaction(
        family_id=family_id,
        date=payload.date,
        description=payload.description,
        vendor=None,
        raw_description=None,
        notes=payload.notes.strip() if payload.notes and payload.notes.strip() else None,
        kind=payload.kind,
        amount=payload.amount,
        category_id=payload.category_id,
        account_id=payload.account_id,
        reimbursable=payload.reimbursable,
        imported=False,
    )
    db.add(tx)
    db.commit()
    db.refresh(tx)

    return _transaction_out(db, tx)


@app.post("/api/families/{family_id}/transactions/import", response_model=TransactionsImportOut)
def import_transactions(
    family_id: int,
    payload: TransactionsImportIn,
    access_token: Annotated[Optional[str], Cookie(alias="access_token")] = None,
    db=Depends(get_db),
):
    user_id = get_current_user_id(access_token)
    require_family_member(db=db, family_id=family_id, user_id=user_id)

    items = payload.items or []
    if len(items) == 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No items provided")
    if len(items) > 5000:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Too many items (max 5000)")

    # Limit: 5 years back (analysis only, keep DB bounded).
    min_date_allowed = date.today() - timedelta(days=365 * 5)
    for it in items:
        if it.date < min_date_allowed:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Transactions older than 5 years are not allowed (min date {min_date_allowed.isoformat()})",
            )

    # Validate referenced IDs in bulk
    account_ids = {it.account_id for it in items if it.account_id is not None}
    category_ids = {it.category_id for it in items if it.category_id is not None}
    if account_ids:
        ok_accounts = set(
            db.execute(select(Account.id).where(Account.family_id == family_id, Account.id.in_(account_ids))).scalars().all()
        )
        bad = sorted(list(account_ids - ok_accounts))
        if bad:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid account for this family: {bad[0]}")
    if category_ids:
        ok_cats = set(
            db.execute(select(Category.id).where(Category.family_id == family_id, Category.id.in_(category_ids))).scalars().all()
        )
        bad = sorted(list(category_ids - ok_cats))
        if bad:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid category for this family: {bad[0]}")

    import uuid

    batch_id = uuid.uuid4().hex
    now = datetime.utcnow()
    txs: list[Transaction] = []
    for it in items:
        txs.append(
            Transaction(
                family_id=family_id,
                date=it.date,
                description=it.description,
                vendor=(it.vendor.strip() if it.vendor and it.vendor.strip() else None),
                raw_description=(it.raw_description.strip() if it.raw_description and it.raw_description.strip() else None),
                notes=it.notes.strip() if it.notes and it.notes.strip() else None,
                kind=it.kind,
                amount=it.amount,
                category_id=it.category_id,
                account_id=it.account_id,
                reimbursable=it.reimbursable,
                imported=True,
                import_batch_id=batch_id,
                imported_at=now,
            )
        )
    db.add_all(txs)
    db.commit()
    return TransactionsImportOut(created=len(txs), batch_id=batch_id)


@app.post("/api/families/{family_id}/transactions/import/undo", response_model=TransactionsImportUndoOut)
def undo_transactions_import(
    family_id: int,
    payload: TransactionsImportUndoIn,
    access_token: Annotated[Optional[str], Cookie(alias="access_token")] = None,
    db=Depends(get_db),
):
    user_id = get_current_user_id(access_token)
    require_family_member(db=db, family_id=family_id, user_id=user_id)
    batch_id = (payload.batch_id or "").strip()
    if not batch_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="batch_id is required")

    # Delete only imported rows from this batch.
    deleted = db.execute(
        text("DELETE FROM transactions WHERE family_id = :fid AND imported = 1 AND import_batch_id = :bid"),
        {"fid": int(family_id), "bid": batch_id},
    ).rowcount or 0
    db.commit()
    return TransactionsImportUndoOut(deleted=int(deleted))


class ImportedUncategorizedOut(BaseModel):
    items: list[TransactionOut]


class ImportAssignCategoryItemIn(BaseModel):
    id: int
    category_id: int


class ImportAssignCategoriesIn(BaseModel):
    items: list[ImportAssignCategoryItemIn]


class ImportAssignCategoriesOut(BaseModel):
    updated: int


@app.get("/api/families/{family_id}/transactions/import/uncategorized", response_model=ImportedUncategorizedOut)
def list_import_uncategorized(
    family_id: int,
    limit: int = 200,
    access_token: Annotated[Optional[str], Cookie(alias="access_token")] = None,
    db=Depends(get_db),
):
    user_id = get_current_user_id(access_token)
    require_family_member(db=db, family_id=family_id, user_id=user_id)
    limit = max(1, min(int(limit), 500))
    rows = (
        db.execute(
            select(Transaction, Category.name.label("category_name"))
            .join(Category, Category.id == Transaction.category_id, isouter=True)
            .where(Transaction.family_id == family_id, Transaction.imported == True, Transaction.category_id == None)  # noqa: E712
            .order_by(Transaction.date.desc(), Transaction.id.desc())
            .limit(limit)
        )
        .all()
    )
    items: list[TransactionOut] = []
    for tx, category_name in rows:
        items.append(
            TransactionOut(
                id=tx.id,
                date=tx.date,
                description=tx.description,
                vendor=getattr(tx, "vendor", None),
                raw_description=getattr(tx, "raw_description", None),
                notes=tx.notes,
                kind=tx.kind,
                amount=tx.amount,
                category=category_name,
                category_id=tx.category_id,
                account_id=getattr(tx, "account_id", None),
                reimbursable=bool(getattr(tx, "reimbursable", False)),
                imported=bool(getattr(tx, "imported", False)),
            )
        )
    return ImportedUncategorizedOut(items=items)


@app.post("/api/families/{family_id}/transactions/import/assign-categories", response_model=ImportAssignCategoriesOut)
def assign_import_categories(
    family_id: int,
    payload: ImportAssignCategoriesIn,
    access_token: Annotated[Optional[str], Cookie(alias="access_token")] = None,
    db=Depends(get_db),
):
    user_id = get_current_user_id(access_token)
    require_family_member(db=db, family_id=family_id, user_id=user_id)
    items = payload.items or []
    if not items:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No items provided")

    updated = 0
    for it in items:
        tx_id = int(getattr(it, "id", 0) or 0)
        cat_id = int(getattr(it, "category_id", 0) or 0)
        if tx_id <= 0 or cat_id <= 0:
            continue
        # Validate category belongs to family.
        cat = db.execute(select(Category).where(Category.family_id == family_id, Category.id == cat_id)).scalar_one_or_none()
        if cat is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid category for this family")
        # Update only imported transactions in this family.
        rc = (
            db.execute(
                text(
                    "UPDATE transactions SET category_id = :cid "
                    "WHERE id = :tid AND family_id = :fid AND imported = 1"
                ),
                {"cid": cat_id, "tid": tx_id, "fid": family_id},
            ).rowcount
            or 0
        )
        updated += int(rc)
    db.commit()
    return ImportAssignCategoriesOut(updated=updated)


def _transaction_out(db, tx: Transaction) -> TransactionOut:
    category_name: Optional[str] = None
    if tx.category_id is not None:
        cat = db.execute(select(Category).where(Category.id == tx.category_id)).scalar_one_or_none()
        category_name = cat.name if cat is not None else None
    return TransactionOut(
        id=tx.id,
        date=tx.date,
        description=tx.description,
        vendor=getattr(tx, "vendor", None),
        raw_description=getattr(tx, "raw_description", None),
        notes=tx.notes,
        kind=tx.kind,
        amount=tx.amount,
        category=category_name,
        category_id=tx.category_id,
        account_id=getattr(tx, "account_id", None),
        reimbursable=bool(getattr(tx, "reimbursable", False)),
        imported=bool(getattr(tx, "imported", False)),
    )


@app.put("/api/families/{family_id}/transactions/{transaction_id}", response_model=TransactionOut)
def update_transaction(
    family_id: int,
    transaction_id: int,
    payload: TransactionIn,
    access_token: Annotated[Optional[str], Cookie(alias="access_token")] = None,
    db=Depends(get_db),
):
    user_id = get_current_user_id(access_token)
    require_family_member(db=db, family_id=family_id, user_id=user_id)

    tx = db.execute(
        select(Transaction).where(Transaction.id == transaction_id, Transaction.family_id == family_id)
    ).scalar_one_or_none()
    if tx is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Transaction not found")

    if payload.category_id is not None:
        category = db.execute(
            select(Category).where(Category.id == payload.category_id, Category.family_id == family_id)
        ).scalar_one_or_none()
        if category is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid category for this family")

    if payload.account_id is not None:
        acct = db.execute(select(Account).where(Account.id == payload.account_id, Account.family_id == family_id)).scalar_one_or_none()
        if acct is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid account for this family")

    tx.date = payload.date
    tx.description = payload.description
    tx.notes = payload.notes.strip() if payload.notes and payload.notes.strip() else None
    tx.kind = payload.kind
    tx.amount = payload.amount
    tx.category_id = payload.category_id
    tx.account_id = payload.account_id
    tx.reimbursable = payload.reimbursable
    db.commit()
    db.refresh(tx)
    return _transaction_out(db, tx)


@app.delete("/api/families/{family_id}/transactions/{transaction_id}")
def delete_transaction(
    family_id: int,
    transaction_id: int,
    access_token: Annotated[Optional[str], Cookie(alias="access_token")] = None,
    db=Depends(get_db),
):
    user_id = get_current_user_id(access_token)
    require_family_member(db=db, family_id=family_id, user_id=user_id)

    tx = db.execute(
        select(Transaction).where(Transaction.id == transaction_id, Transaction.family_id == family_id)
    ).scalar_one_or_none()
    if tx is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Transaction not found")

    db.delete(tx)
    db.commit()
    return {"ok": True}


def _frontend_dir() -> Path:
    """
    Resolve the repo's `frontend/` folder.

    Walks upward from this file until `frontend/index.html` exists so local dev works
    even if the repo is nested or the working directory differs.
    """
    here = Path(__file__).resolve()
    for p in [here.parent, *here.parents]:
        candidate = p / "frontend"
        if candidate.is_dir() and (candidate / "index.html").is_file():
            return candidate
    # Fallback (same as old behavior): repo root = parent of `backend/`
    return here.parent.parent.parent / "frontend"


@app.get("/", response_class=HTMLResponse, include_in_schema=False)
def root():
    # Prefer serving the SPA entrypoint if it exists.
    index_path = _frontend_dir() / "index.html"
    if index_path.exists():
        return index_path.read_text(encoding="utf-8")
    return "Family Cash Flow"


static_dir = _frontend_dir()
if static_dir.exists():
    app.mount("/", StaticFiles(directory=str(static_dir), html=True), name="static")
else:
    logger.warning(
        "Frontend static directory not found at %s — only the API will work; "
        "open index.html via a server that serves frontend/ or fix the repo layout.",
        static_dir,
    )

