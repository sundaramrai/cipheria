"""
database.py — Sync SQLAlchemy with PostgreSQL
"""

from sqlalchemy import create_engine, Column, String, Text, Boolean, Integer, Index, text
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
import ssl
import certifi
from dotenv import load_dotenv

logger = logging.getLogger(__name__)
load_dotenv()


def _build_database_url() -> str:
    url = os.getenv("DATABASE_URL", "")
    return re.sub(r'^postgres(ql)?://', 'postgresql+psycopg://', url)


def _build_ssl_context():
    if "neon.tech" not in os.getenv("DATABASE_URL", ""):
        return None

    ctx = ssl.create_default_context(cafile=certifi.where())
    ctx.check_hostname = True
    ctx.verify_mode = ssl.CERT_REQUIRED
    ctx.minimum_version = ssl.TLSVersion.TLSv1_2
    return ctx


_ssl_ctx = _build_ssl_context()

engine = create_engine(
    _build_database_url(),
    connect_args={"sslmode": "require"} if _ssl_ctx else {},
    poolclass=NullPool,
    echo=False,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine, expire_on_commit=False)

# Base class for models
class Base(DeclarativeBase):
    pass

# Models

class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String(255), unique=True, nullable=False, index=True)
    hashed_password = Column(String(255), nullable=False)
    full_name = Column(String(255), nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(TIMESTAMP(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(TIMESTAMP(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    # Master password hint (never the actual password)
    master_hint = Column(String(255), nullable=True)
    # Salt for client-side key derivation
    vault_salt = Column(String(64), nullable=False, default=lambda: uuid.uuid4().hex + uuid.uuid4().hex)


class VaultItem(Base):
    __tablename__ = "vault_items"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    name = Column(String(255), nullable=False)           # site/app name (plaintext for search)
    category = Column(String(64), default="login")       # login, card, note, identity
    # All sensitive fields are AES-256-GCM encrypted client-side before storage
    encrypted_data = Column(Text, nullable=False)        # JSON blob: {username, password, url, notes, ...}
    favicon_url = Column(String(512), nullable=True)
    is_favourite = Column(Boolean, default=False)
    created_at = Column(TIMESTAMP(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(TIMESTAMP(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        # Covers: WHERE user_id = ? ORDER BY updated_at DESC
        Index('ix_vault_items_user_updated', 'user_id', 'updated_at'),
    )


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    action = Column(String(64), nullable=False)
    ip_address = Column(String(64), nullable=True)
    user_agent = Column(String(512), nullable=True)
    created_at = Column(TIMESTAMP(timezone=True), default=lambda: datetime.now(timezone.utc))


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    token_hash = Column(String(255), nullable=False, unique=True)
    expires_at = Column(TIMESTAMP(timezone=True), nullable=False)
    created_at = Column(TIMESTAMP(timezone=True), default=lambda: datetime.now(timezone.utc))
    revoked = Column(Boolean, default=False)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def create_tables():
    Base.metadata.create_all(bind=engine)
    # pg_trgm powers fast ILIKE '%term%' via GIN index
    # Only runs in development; run the SQL below manually on Neon prod:
    #   CREATE EXTENSION IF NOT EXISTS pg_trgm;
    #   CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_vault_items_name_trgm
    #     ON vault_items USING gin (name gin_trgm_ops);
    try:
        with engine.connect() as conn:
            conn.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
            conn.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_vault_items_name_trgm "
                "ON vault_items USING gin (name gin_trgm_ops)"
            ))
            conn.commit()
    except Exception as e:
        print(f"Warning: Could not create pg_trgm index: {e}")