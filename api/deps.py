"""
deps.py — FastAPI dependency providers with Redis cache integration.

get_current_user_from_db checks Redis before hitting the DB:
  Cache HIT  → ~2 ms   — returns a CachedUser (Pydantic model)
  Cache MISS → ~80-150 ms DB query, result written to cache — returns a User ORM object

Both CachedUser and User expose the same read-only attribute surface
(id, email, full_name, is_active, master_hint, vault_salt, created_at).
Routes that need to write to the DB should declare DBUser, which always
hits the DB and returns a real SQLAlchemy User instance.
"""

import uuid
import logging
from datetime import datetime
from typing import Annotated, Optional, Union
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError
from pydantic import BaseModel
from sqlalchemy.orm import Session
from database import get_db, User
from crypto import decode_token
from cache import get_cached_user, set_cached_user

logger = logging.getLogger(__name__)

security = HTTPBearer(auto_error=False)


def auth_exception() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )


# Typed model for the Redis-cached user profile.
# Mirrors the fields written by _warm_caches / set_cached_user in auth.py.
# Returned directly from the cache HIT path — no fake ORM object needed.

class CachedUser(BaseModel):
    """Read-only user profile hydrated from Redis.

    Exposes the same attribute surface as the User ORM model for routes
    that only read user data. Routes that write to the DB must use the
    DBUser dependency, which always hits the DB and returns a real
    SQLAlchemy User instance.
    """
    id: uuid.UUID
    email: str
    full_name: Optional[str] = None
    is_active: bool = True
    email_verified: bool = False
    master_hint: Optional[str] = None
    vault_salt: str
    created_at: Optional[datetime] = None


class TokenUser:
    def __init__(self, user_id: str):
        try:
            self.id = uuid.UUID(user_id)
        except ValueError:
            raise auth_exception()


def get_current_token_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(security)],
) -> TokenUser:
    if credentials is None:
        raise auth_exception()
    try:
        payload = decode_token(credentials.credentials)
        if payload.get("type") != "access":
            raise auth_exception()
        user_id: str | None = payload.get("sub")
        if not user_id:
            raise auth_exception()
        return TokenUser(user_id)
    except JWTError:
        raise auth_exception()


def get_current_user_from_db(
    token_user: Annotated[TokenUser, Depends(get_current_token_user)],
    db: Annotated[Session, Depends(get_db)],
) -> Union[CachedUser, User]:
    user_id = str(token_user.id)

    cached = get_cached_user(user_id)
    if cached:
        logger.debug(f"user cache HIT id={user_id}")
        try:
            cu = CachedUser(
                id=token_user.id,
                email=cached.get("email", ""),
                full_name=cached.get("full_name"),
                is_active=cached.get("is_active", True),
                email_verified=cached.get("email_verified", False),
                master_hint=cached.get("master_hint"),
                vault_salt=cached.get("vault_salt", ""),
                created_at=datetime.fromisoformat(cached["created_at"])
                if cached.get("created_at")
                else None,
            )
        except Exception as exc:
            # Corrupt or stale cache entry — fall through to DB
            logger.warning(f"Corrupt user cache entry id={user_id}: {exc}")
            cu = None

        if cu is not None:
            if not cu.is_active:
                raise auth_exception()
            # Return the Pydantic model directly — no fake ORM object.
            # SQLAlchemy instruments all attribute access on User instances
            # and requires _sa_instance_state, which __new__ does not set up.
            return cu

    logger.debug(f"user cache MISS id={user_id}")
    user = db.query(User).filter(User.id == token_user.id).first()
    if not user or not user.is_active:
        raise auth_exception()

    set_cached_user(
        user_id,
        {
            "id": user_id,
            "email": user.email,
            "full_name": user.full_name,
            "is_active": user.is_active,
            "email_verified": user.email_verified,
            "master_hint": user.master_hint,
            "vault_salt": user.vault_salt,
            "created_at": user.created_at.isoformat() if user.created_at else None,
        },
    )
    return user


def get_current_db_user(
    token_user: Annotated[TokenUser, Depends(get_current_token_user)],
    db: Annotated[Session, Depends(get_db)],
) -> User:
    user = db.query(User).filter(User.id == token_user.id).first()
    if not user or not user.is_active:
        raise auth_exception()
    return user


ReadUser = Annotated[Union[CachedUser, User], Depends(get_current_user_from_db)]
CurrentUser = ReadUser
DBUser = Annotated[User, Depends(get_current_db_user)]
