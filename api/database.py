import os
import re
import uuid
import logging
from datetime import datetime, timezone
from typing import Generator
from dotenv import load_dotenv
from sqlalchemy import create_engine, Column, String, Boolean, Integer, Index, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker, Session
from sqlalchemy.types import TIMESTAMP
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.pool import NullPool

load_dotenv()
logger = logging.getLogger(__name__)

# constants
DEFAULT_ID_GENERATOR = "gen_random_uuid()"
DEFAULT_TIMESTAMP = "now()"

# build database url
def build_database_url() -> str:
    url = os.getenv("DATABASE_URL", "")
    if not url:
        raise RuntimeError("DATABASE_URL not set")
    url = re.sub(r'^postgres(ql)?://', 'postgresql+psycopg://', url)
    if "neon.tech" in url and "sslmode" not in url:
        url += ("&" if "?" in url else "?") + "sslmode=require"
    return url

DATABASE_URL = build_database_url()

# engine
engine = create_engine(
    DATABASE_URL,
    poolclass=NullPool, # serverless safe
    pool_pre_ping=True, # detect dead connections
    execution_options={"compiled_cache_size": 500}, # query cache
    echo=False
)

# session
SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False, expire_on_commit=False)

# base
class Base(DeclarativeBase):
    pass

# user model
class User(Base):
    __tablename__ = "users"
    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text(DEFAULT_ID_GENERATOR))
    email = Column(String(255), unique=True, nullable=False, index=True)
    hashed_password = Column(String(255), nullable=False)
    full_name = Column(String(255))
    is_active = Column(Boolean, default=True)
    created_at = Column(TIMESTAMP(timezone=True), server_default=text(DEFAULT_TIMESTAMP))
    updated_at = Column(TIMESTAMP(timezone=True), server_default=text(DEFAULT_TIMESTAMP), onupdate=datetime.now(timezone.utc))
    master_hint = Column(String(255))
    vault_salt = Column(String(64), nullable=False, default=lambda: uuid.uuid4().hex + uuid.uuid4().hex)

# vault item model
class VaultItem(Base):
    __tablename__ = "vault_items"
    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text(DEFAULT_ID_GENERATOR))
    user_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    category = Column(String(64), default="login")
    encrypted_data = Column(JSONB, nullable=False) # encrypted JSON blob
    favicon_url = Column(String(512))
    is_favourite = Column(Boolean, default=False)
    created_at = Column(TIMESTAMP(timezone=True), server_default=text(DEFAULT_TIMESTAMP))
    updated_at = Column(TIMESTAMP(timezone=True), server_default=text(DEFAULT_TIMESTAMP), onupdate=datetime.now(timezone.utc))
    __table_args__ = (
        Index("ix_vault_items_user_updated_desc","user_id",text("updated_at DESC")), # fast vault loading
        Index("ix_vault_items_user_category","user_id","category"), # category filter
        Index("ix_vault_items_user_favourite","user_id","is_favourite") # favourites
    )

# audit log
class AuditLog(Base):
    __tablename__ = "audit_logs"
    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    action = Column(String(64), nullable=False)
    ip_address = Column(String(64))
    user_agent = Column(String(512))
    created_at = Column(TIMESTAMP(timezone=True), server_default=text(DEFAULT_TIMESTAMP))

# refresh token
class RefreshToken(Base):
    __tablename__ = "refresh_tokens"
    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text(DEFAULT_ID_GENERATOR))
    user_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    token_hash = Column(String(255), nullable=False, unique=True)
    expires_at = Column(TIMESTAMP(timezone=True), nullable=False)
    revoked = Column(Boolean, default=False)
    created_at = Column(TIMESTAMP(timezone=True), server_default=text(DEFAULT_TIMESTAMP))

# dependency
def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# create tables and indexes
def create_tables():
    Base.metadata.create_all(bind=engine)
    try:
        with engine.connect() as conn:
            conn.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm")) # search extension
            conn.execute(text("CREATE EXTENSION IF NOT EXISTS pgcrypto")) # uuid generator
            conn.execute(text("""
                CREATE INDEX IF NOT EXISTS ix_vault_items_name_trgm
                ON vault_items USING gin (name gin_trgm_ops)
            """))
            conn.execute(text("""
                CREATE INDEX IF NOT EXISTS ix_vault_items_fav_partial
                ON vault_items (user_id) WHERE is_favourite = true
            """))
            conn.commit()
    except Exception as e:
        logger.warning(f"Index creation failed: {e}")