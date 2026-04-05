from __future__ import annotations

import logging
from collections import defaultdict
from datetime import date, datetime, timedelta
from decimal import Decimal
from enum import Enum
from pathlib import Path
from typing import Annotated, Literal, Optional
from urllib.parse import urlparse

from fastapi import Cookie, Depends, FastAPI, HTTPException, Response, status
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

    family: Mapped[Family] = relationship(back_populates="categories")


class Transaction(Base):
    __tablename__ = "transactions"

    id: Mapped[int] = mapped_column(primary_key=True)
    family_id: Mapped[int] = mapped_column(ForeignKey("families.id"), nullable=False, index=True)

    date: Mapped[date] = mapped_column(SA_Date, nullable=False, index=True)
    description: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    notes: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    kind: Mapped[TransactionKind] = mapped_column(SAEnum(TransactionKind), nullable=False, default=TransactionKind.expense)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)

    category_id: Mapped[Optional[int]] = mapped_column(ForeignKey("categories.id"), nullable=True, index=True)

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
    category_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("categories.id", ondelete="CASCADE"), nullable=True, index=True
    )

    created_at: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())

    __table_args__ = (UniqueConstraint("expected_transaction_id", "occurrence_date", name="uq_expected_instance"),)


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


class CategoryOut(BaseModel):
    id: int
    name: str


class TransactionIn(BaseModel):
    date: date
    description: str = Field(default="", max_length=500)
    notes: Optional[str] = Field(default=None, max_length=500)
    kind: TransactionKind
    amount: Decimal = Field(gt=0)
    category_id: Optional[int] = None


class TransactionOut(BaseModel):
    id: int
    date: date
    description: str
    notes: Optional[str] = None
    kind: TransactionKind
    amount: Decimal
    category: Optional[str] = None
    category_id: Optional[int] = None


class TransactionsListOut(BaseModel):
    items: list[TransactionOut]
    totals: dict[str, Decimal]


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

    category_id: Optional[int] = None


class ExpectedTransactionOut(BaseModel):
    id: int
    account: str
    start_date: date
    end_date: Optional[date]
    recurrence: Recurrence
    second_day_of_month: Optional[int] = None
    description: str
    notes: Optional[str] = None
    kind: TransactionKind
    amount: Decimal
    category: Optional[str]
    created_by: int


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
    category_id: Optional[int] = None


class ApplyFromOccurrenceIn(BaseModel):
    account_id: int
    kind: TransactionKind
    amount: Decimal = Field(gt=0)
    description: str = Field(default="", max_length=500)
    category_id: Optional[int] = None


class ApplyFromOccurrenceOut(BaseModel):
    mode: Literal["updated_in_place", "split"]
    future_series_id: int
    ended_series_id: Optional[int] = None


class ExpectedCalendarItemOut(BaseModel):
    expected_transaction_id: int
    date: date
    account_id: int
    account: str
    kind: TransactionKind
    amount: Decimal
    description: str
    notes: Optional[str] = None
    category_id: Optional[int] = None
    category: Optional[str] = None


class ExpectedCalendarOut(BaseModel):
    month: str
    items: list[ExpectedCalendarItemOut]


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
if settings.CORS_ORIGINS:
    origins = _parse_cors_origins(settings.CORS_ORIGINS)
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
        "cors_middleware_enabled": bool(raw.strip() and parsed),
        "cors_allow_origins": parsed,
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


@app.get("/api/families/{family_id}/categories", response_model=list[CategoryOut])
def list_categories(
    family_id: int,
    access_token: Annotated[Optional[str], Cookie(alias="access_token")] = None,
    db=Depends(get_db),
):
    user_id = get_current_user_id(access_token)
    require_family_member(db=db, family_id=family_id, user_id=user_id)
    rows = db.execute(select(Category).where(Category.family_id == family_id).order_by(Category.name.asc())).scalars().all()
    return [CategoryOut(id=r.id, name=r.name) for r in rows]


@app.post("/api/families/{family_id}/categories", response_model=CategoryOut)
def create_category(
    family_id: int,
    payload: CategoryIn,
    access_token: Annotated[Optional[str], Cookie(alias="access_token")] = None,
    db=Depends(get_db),
):
    user_id = get_current_user_id(access_token)
    require_family_member(db=db, family_id=family_id, user_id=user_id)
    category = Category(family_id=family_id, name=payload.name)
    db.add(category)
    db.commit()
    db.refresh(category)
    return CategoryOut(id=category.id, name=category.name)


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

    result: list[ExpectedTransactionOut] = []
    for tx, account_name, category_name in rows:
        result.append(
            ExpectedTransactionOut(
                id=tx.id,
                account=account_name,
                start_date=tx.start_date,
                end_date=tx.end_date,
                recurrence=tx.recurrence,
                second_day_of_month=tx.second_day_of_month,
                description=tx.description,
                notes=tx.notes,
                kind=tx.kind,
                amount=tx.amount,
                category=category_name,
                created_by=tx.created_by_user_id,
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
        category_id=payload.category_id,
    )
    db.add(tx)
    db.commit()
    db.refresh(tx)

    return ExpectedTransactionOut(
        id=tx.id,
        account=account.name,
        start_date=tx.start_date,
        end_date=tx.end_date,
        recurrence=tx.recurrence,
        second_day_of_month=tx.second_day_of_month,
        description=tx.description,
        notes=tx.notes,
        kind=tx.kind,
        amount=tx.amount,
        category=category_name,
        created_by=tx.created_by_user_id,
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
    tx.category_id = payload.category_id

    db.commit()
    db.refresh(tx)

    return ExpectedTransactionOut(
        id=tx.id,
        account=account.name,
        start_date=tx.start_date,
        end_date=tx.end_date,
        recurrence=tx.recurrence,
        second_day_of_month=tx.second_day_of_month,
        description=tx.description,
        notes=tx.notes,
        kind=tx.kind,
        amount=tx.amount,
        category=category_name,
        created_by=tx.created_by_user_id,
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
        category_id = None
    else:
        if payload.account_id is None or payload.kind is None or payload.amount is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="account_id, kind, and amount are required for update")
        account_id = payload.account_id
        kind = payload.kind
        amount = payload.amount
        description = payload.description
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
    existing.category_id = category_id

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

    db.execute(
        delete(ExpectedTransactionOverride).where(
            ExpectedTransactionOverride.expected_transaction_id == expected_id,
            ExpectedTransactionOverride.occurrence_date >= occurrence_date,
        )
    )

    if occurrence_date == tx.start_date:
        tx.account_id = payload.account_id
        tx.kind = payload.kind
        tx.amount = payload.amount
        tx.description = payload.description
        tx.category_id = category_id
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
        account_id=payload.account_id,
        created_by_user_id=user_id,
        start_date=occurrence_date,
        end_date=old_end,
        recurrence=tx.recurrence,
        second_day_of_month=tx.second_day_of_month,
        description=payload.description,
        notes=tx.notes,
        kind=payload.kind,
        amount=payload.amount,
        category_id=category_id,
    )
    db.add(new_tx)
    db.commit()
    db.refresh(new_tx)

    return ApplyFromOccurrenceOut(mode="split", future_series_id=new_tx.id, ended_series_id=tx.id)


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

    items: list[ExpectedCalendarItemOut] = []
    for tx in expected_rows:
        occ_dates = _expected_occurrences_in_range(
            start_date=tx.start_date,
            end_date=tx.end_date,
            recurrence=tx.recurrence,
            range_start=start_date,
            range_end_exclusive=end_date,
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
            eff_category_id = (ovr.category_id if ovr is not None and ovr.category_id is not None else tx.category_id)

            acc = accounts_by_id.get(eff_account_id)
            if acc is None:
                continue
            cat = categories_by_id.get(eff_category_id) if eff_category_id is not None else None

            items.append(
                ExpectedCalendarItemOut(
                    expected_transaction_id=tx.id,
                    date=occ,
                    account_id=eff_account_id,
                    account=acc.name,
                    kind=eff_kind,
                    amount=eff_amount,
                    description=eff_description,
                    notes=tx.notes,
                    category_id=eff_category_id,
                    category=cat.name if cat is not None else None,
                )
            )

    return ExpectedCalendarOut(month=month, items=items)


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
    first_tx = db.execute(select(func.min(Transaction.date)).where(Transaction.family_id == family_id)).scalar_one_or_none()
    global_start = min_acc
    if first_tx is not None:
        global_start = min(global_start, first_tx)

    actual_by_date: dict[date, Decimal] = defaultdict(lambda: Decimal("0"))
    if mode in ("both", "actual"):
        tx_rows = db.execute(
            select(Transaction).where(
                Transaction.family_id == family_id,
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
                expected_by_date[occ] += signed

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
            by_acc = occurrences_by_date.setdefault(d, {})
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
    access_token: Annotated[Optional[str], Cookie(alias="access_token")] = None,
    db=Depends(get_db),
):
    user_id = get_current_user_id(access_token)
    require_family_member(db=db, family_id=family_id, user_id=user_id)

    if month:
        start, end = _month_range(month)
    else:
        today = datetime.utcnow().date()
        start, end = _month_range(f"{today.year:04d}-{today.month:02d}")

    # Totals
    income_sum = db.execute(
        select(func.coalesce(func.sum(Transaction.amount), 0)).where(
            Transaction.family_id == family_id,
            Transaction.date >= start,
            Transaction.date < end,
            Transaction.kind == TransactionKind.income,
        )
    ).scalar_one()
    expense_sum = db.execute(
        select(func.coalesce(func.sum(Transaction.amount), 0)).where(
            Transaction.family_id == family_id,
            Transaction.date >= start,
            Transaction.date < end,
            Transaction.kind == TransactionKind.expense,
        )
    ).scalar_one()

    # Items (+ category name)
    stmt = (
        select(Transaction, Category.name.label("category_name"))
        .join(Category, Category.id == Transaction.category_id, isouter=True)
        .where(
            Transaction.family_id == family_id,
            Transaction.date >= start,
            Transaction.date < end,
        )
        .order_by(Transaction.date.desc(), Transaction.id.desc())
    )
    rows = db.execute(stmt).all()

    items: list[TransactionOut] = []
    for tx, category_name in rows:
        items.append(
            TransactionOut(
                id=tx.id,
                date=tx.date,
                description=tx.description,
                notes=tx.notes,
                kind=tx.kind,
                amount=tx.amount,
                category=category_name,
                category_id=tx.category_id,
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

    tx = Transaction(
        family_id=family_id,
        date=payload.date,
        description=payload.description,
        notes=payload.notes.strip() if payload.notes and payload.notes.strip() else None,
        kind=payload.kind,
        amount=payload.amount,
        category_id=payload.category_id,
    )
    db.add(tx)
    db.commit()
    db.refresh(tx)

    return _transaction_out(db, tx)


def _transaction_out(db, tx: Transaction) -> TransactionOut:
    category_name: Optional[str] = None
    if tx.category_id is not None:
        cat = db.execute(select(Category).where(Category.id == tx.category_id)).scalar_one_or_none()
        category_name = cat.name if cat is not None else None
    return TransactionOut(
        id=tx.id,
        date=tx.date,
        description=tx.description,
        notes=tx.notes,
        kind=tx.kind,
        amount=tx.amount,
        category=category_name,
        category_id=tx.category_id,
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

    tx.date = payload.date
    tx.description = payload.description
    tx.notes = payload.notes.strip() if payload.notes and payload.notes.strip() else None
    tx.kind = payload.kind
    tx.amount = payload.amount
    tx.category_id = payload.category_id
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

