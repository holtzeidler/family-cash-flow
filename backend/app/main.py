from __future__ import annotations

import logging
from datetime import date, datetime, timedelta
from decimal import Decimal
from enum import Enum
from pathlib import Path
from typing import Annotated, Literal, Optional

from fastapi import Cookie, Depends, FastAPI, HTTPException, Response, status
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import bcrypt
from jose import jwt
from pydantic import BaseModel, EmailStr, Field
from pydantic_settings import BaseSettings
from sqlalchemy import Date as SA_Date
from sqlalchemy import Enum as SAEnum
from sqlalchemy import Boolean, UniqueConstraint
from sqlalchemy import ForeignKey
from sqlalchemy import String
from sqlalchemy import func, select
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
    monthly = "monthly"
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

    description: Mapped[str] = mapped_column(String(500), nullable=False, default="")
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
    kind: TransactionKind
    amount: Decimal = Field(gt=0)
    category_id: Optional[int] = None


class TransactionOut(BaseModel):
    id: int
    date: date
    description: str
    kind: TransactionKind
    amount: Decimal
    category: Optional[str] = None


class TransactionsListOut(BaseModel):
    items: list[TransactionOut]
    totals: dict[str, Decimal]


class AccountIn(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    type: AccountType = AccountType.checking
    starting_balance: Decimal


class AccountOut(BaseModel):
    id: int
    name: str
    type: AccountType
    starting_balance: Decimal


class ExpectedTransactionIn(BaseModel):
    account_id: int
    start_date: date
    end_date: Optional[date] = None
    recurrence: Recurrence = Recurrence.monthly

    description: str = Field(default="", max_length=500)
    kind: TransactionKind = TransactionKind.expense
    amount: Decimal = Field(gt=0)

    category_id: Optional[int] = None


class ExpectedTransactionOut(BaseModel):
    id: int
    account: str
    start_date: date
    end_date: Optional[date]
    recurrence: Recurrence
    description: str
    kind: TransactionKind
    amount: Decimal
    category: Optional[str]
    created_by: int


class ExpectedInstanceOverrideIn(BaseModel):
    # Cancel removes this occurrence from the effective schedule.
    action: Literal["cancel", "update"] = "update"

    account_id: Optional[int] = None
    kind: Optional[TransactionKind] = None
    amount: Optional[Decimal] = None
    description: Optional[str] = None
    category_id: Optional[int] = None


class ExpectedCalendarItemOut(BaseModel):
    expected_transaction_id: int
    date: date
    account_id: int
    account: str
    kind: TransactionKind
    amount: Decimal
    description: str
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


app = FastAPI(title="Family Cash Flow")
if settings.CORS_ORIGINS:
    origins = [o.strip() for o in settings.CORS_ORIGINS.split(",") if o.strip()]
    if origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=origins,
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )


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
    return [AccountOut(id=r.id, name=r.name, type=r.type, starting_balance=r.starting_balance) for r in rows]


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
    )
    db.add(account)
    db.commit()
    db.refresh(account)
    return AccountOut(id=account.id, name=account.name, type=account.type, starting_balance=account.starting_balance)


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
                description=tx.description,
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

    tx = ExpectedTransaction(
        family_id=family_id,
        account_id=payload.account_id,
        created_by_user_id=user_id,
        start_date=payload.start_date,
        end_date=payload.end_date,
        recurrence=payload.recurrence,
        description=payload.description,
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
        description=tx.description,
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

    tx.account_id = payload.account_id
    tx.start_date = payload.start_date
    tx.end_date = payload.end_date
    tx.recurrence = payload.recurrence
    tx.description = payload.description
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
        description=tx.description,
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


def _expected_occurrences_in_range(
    *,
    start_date: date,
    end_date: Optional[date],
    recurrence: Recurrence,
    range_start: date,
    range_end_exclusive: date,
) -> list[date]:
    if recurrence == Recurrence.once:
        if start_date < range_end_exclusive and start_date >= range_start and (end_date is None or start_date <= end_date):
            return [start_date]
        return []

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
        AccountOut(id=a.id, name=a.name, type=a.type, starting_balance=a.starting_balance) for a in account_rows
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

    account_balances: dict[int, Decimal] = {a.id: a.starting_balance for a in account_rows}

    daily: list[ProjectionDailyOut] = []
    for i in range(days):
        current_date = range_start + timedelta(days=i)
        day_occ = occurrences_by_date.get(current_date, {})

        net_cashflow = Decimal("0")
        account_cashflow_map: Optional[dict[int, Decimal]] = {} if include_accounts else None
        account_balance_map: Optional[dict[int, Decimal]] = {} if include_accounts else None

        for a in account_rows:
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
                kind=tx.kind,
                amount=tx.amount,
                category=category_name,
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

    category_name: Optional[str] = None
    if payload.category_id is not None:
        category = db.execute(
            select(Category).where(Category.id == payload.category_id, Category.family_id == family_id)
        ).scalar_one_or_none()
        if category is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid category for this family")
        category_name = category.name

    tx = Transaction(
        family_id=family_id,
        date=payload.date,
        description=payload.description,
        kind=payload.kind,
        amount=payload.amount,
        category_id=payload.category_id,
    )
    db.add(tx)
    db.commit()
    db.refresh(tx)

    return TransactionOut(
        id=tx.id,
        date=tx.date,
        description=tx.description,
        kind=tx.kind,
        amount=tx.amount,
        category=category_name,
    )


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

