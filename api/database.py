from datetime import datetime, timezone
from typing import Generator
import logging
import os
import re
import uuid

from dotenv import load_dotenv
from sqlalchemy import Boolean, Column, Index, Integer, String, Text, create_engine
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.pool import NullPool
from sqlalchemy.types import TIMESTAMP

logger = logging.getLogger(__name__)
load_dotenv()


def _build_database_url() -> str:
    url = os.getenv("DATABASE_URL", "")
    return re.sub(r"^postgres(ql)?://", "postgresql+psycopg://", url)


def _database_connect_timeout() -> int:
    raw = os.getenv("DATABASE_CONNECT_TIMEOUT", "5")
    try:
        return max(1, int(raw))
    except ValueError:
        logger.warning(
            "Invalid DATABASE_CONNECT_TIMEOUT=%r; falling back to 5 seconds.",
            raw,
        )
        return 5


# NullPool is intentional for Vercel serverless - each request gets a fresh
# connection rather than sharing a pool across short-lived function instances.
# If you migrate to a persistent server, swap to QueuePool with pool_size=5.
engine = create_engine(
    _build_database_url(),
    poolclass=NullPool,
    echo=False,
    connect_args={"connect_timeout": _database_connect_timeout()},
)

SessionLocal = sessionmaker(
    autocommit=False, autoflush=False, bind=engine, expire_on_commit=False
)


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String(255), unique=True, nullable=False, index=True)
    hashed_password = Column(String(255), nullable=False)
    full_name = Column(String(255), nullable=True)
    is_active = Column(Boolean, default=True)
    email_verified = Column(Boolean, default=False)
    created_at = Column(
        TIMESTAMP(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at = Column(
        TIMESTAMP(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
    # Password hint - never the actual password
    master_hint = Column(String(255), nullable=True)
    # Salt for client-side PBKDF2 key derivation
    vault_salt = Column(
        String(64), nullable=False, default=lambda: uuid.uuid4().hex + uuid.uuid4().hex
    )


class VaultItem(Base):
    __tablename__ = "vault_items"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    category = Column(String(64), default="login")  # login, card, note, identity
    # All sensitive fields are AES-256-GCM encrypted client-side before storage
    encrypted_data = Column(Text, nullable=False)
    favicon_url = Column(String(512), nullable=True)
    is_favourite = Column(Boolean, default=False)
    is_deleted = Column(Boolean, default=False, nullable=False)
    deleted_at = Column(TIMESTAMP(timezone=True), nullable=True)
    created_at = Column(
        TIMESTAMP(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at = Column(
        TIMESTAMP(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    __table_args__ = (
        Index("ix_vault_items_user_deleted_updated", "user_id", "is_deleted", "updated_at"),
        Index("ix_vault_items_user_deleted_category_updated", "user_id", "is_deleted", "category", "updated_at"),
        Index("ix_vault_items_user_deleted_favourite_updated", "user_id", "is_deleted", "is_favourite", "updated_at"),
    )


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    action = Column(String(64), nullable=False)
    ip_address = Column(String(64), nullable=True)
    user_agent = Column(String(512), nullable=True)
    created_at = Column(
        TIMESTAMP(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    token_hash = Column(String(255), nullable=False, unique=True, index=True)
    expires_at = Column(TIMESTAMP(timezone=True), nullable=False)
    created_at = Column(
        TIMESTAMP(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    revoked = Column(Boolean, default=False)


class AuthToken(Base):
    __tablename__ = "auth_tokens"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    token_hash = Column(String(255), nullable=False, unique=True, index=True)
    purpose = Column(String(64), nullable=False, index=True)
    expires_at = Column(TIMESTAMP(timezone=True), nullable=False)
    created_at = Column(
        TIMESTAMP(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    consumed_at = Column(TIMESTAMP(timezone=True), nullable=True)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
