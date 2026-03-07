"""
deps.py — FastAPI dependency providers with Redis cache integration.

get_current_user_from_db checks Redis before hitting the DB:
  Cache HIT  → ~2 ms
  Cache MISS → ~80-150 ms DB query, result written to cache
"""

from typing import Annotated
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from jose import JWTError
import uuid
import logging
from datetime import datetime, timezone
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
) -> User:
    user_id = str(token_user.id)

    cached = get_cached_user(user_id)
    if cached:
        logger.debug(f"user cache HIT id={user_id}")
        fake_user = User(
            id=token_user.id,
            email=cached.get("email", ""),
            full_name=cached.get("full_name"),
            is_active=cached.get("is_active", True),
            master_hint=cached.get("master_hint"),
            vault_salt=cached.get("vault_salt", ""),
        )
        created_raw = cached.get("created_at")
        if created_raw:
            try:
                fake_user.created_at = datetime.fromisoformat(created_raw)
            except Exception:
                fake_user.created_at = None

        if not fake_user.is_active:
            raise auth_exception()
        return fake_user

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
            "master_hint": user.master_hint,
            "vault_salt": user.vault_salt,
            "created_at": user.created_at.isoformat() if user.created_at else None,
        },
    )
    return user


CurrentUser = Annotated[TokenUser, Depends(get_current_token_user)]
DBUser = Annotated[User, Depends(get_current_user_from_db)]