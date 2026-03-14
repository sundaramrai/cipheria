from sqlalchemy import ( create_engine, Column, String, Text, Boolean, Integer, Index, text )
from sqlalchemy.orm import DeclarativeBase, sessionmaker, Session
from sqlalchemy.types import TIMESTAMP
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.pool import NullPool
from datetime import datetime, timezone
from typing import Generator
import logging
import uuid
import os
import re
from dotenv import load_dotenv

logger = logging.getLogger(__name__)
load_dotenv()


def _build_database_url() -> str:
    url = os.getenv("DATABASE_URL", "")
    return re.sub(r"^postgres(ql)?://", "postgresql+psycopg://", url)


# NullPool is intentional for Vercel serverless — each request gets a fresh
# connection rather than sharing a pool across short-lived function instances.
# If you migrate to a persistent server, swap to QueuePool with pool_size=5.
engine = create_engine(
    _build_database_url(),
    poolclass=NullPool,
    echo=False,
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
    created_at = Column(
        TIMESTAMP(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at = Column(
        TIMESTAMP(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
    # Password hint — never the actual password
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
    created_at = Column(
        TIMESTAMP(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at = Column(
        TIMESTAMP(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    __table_args__ = (
        Index("ix_vault_items_user_updated", "user_id", "updated_at"),
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


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def create_tables():
    Base.metadata.create_all(bind=engine)
    # pg_trgm enables fast ILIKE search via GIN index
    # In production on Neon, run manually:
    #   CREATE EXTENSION IF NOT EXISTS pg_trgm;
    #   CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_vault_items_name_trgm
    #     ON vault_items USING gin (name gin_trgm_ops);
    try:
        with engine.connect() as conn:
            conn.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
            conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_vault_items_name_trgm "
                    "ON vault_items USING gin (name gin_trgm_ops)"
                )
            )
            conn.commit()
    except Exception as e:
        logger.warning(f"Could not create pg_trgm index: {e}")