"""
deps.py - FastAPI dependency providers with Redis cache integration.

get_current_user_from_db checks Redis before hitting the DB:
  Cache HIT  -> returns a CachedUser model
  Cache MISS -> hits the DB, caches the result, and returns a User ORM object

Routes that need to write to the DB should declare DBUser, which always
hits the DB and returns a real SQLAlchemy User instance.
"""

import logging
import uuid
from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import InvalidTokenError
from sqlalchemy.orm import Session

from cache import get_cached_user, set_cached_user
from crypto import decode_token
from database import User, get_db
from user_cache import CachedUser, deserialize_cached_user, serialize_cached_user

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
    except InvalidTokenError:
        raise auth_exception()


def get_current_user_from_db(
    token_user: Annotated[TokenUser, Depends(get_current_token_user)],
    db: Annotated[Session, Depends(get_db)],
) -> CachedUser | User:
    user_id = str(token_user.id)

    cached = get_cached_user(user_id)
    if cached:
        logger.debug("user cache HIT id=%s", user_id)
        try:
            cached_user = deserialize_cached_user(token_user.id, cached)
        except (AttributeError, TypeError, ValueError) as exc:
            logger.warning("Corrupt user cache entry id=%s: %s", user_id, exc)
        else:
            if not cached_user.is_active:
                raise auth_exception()
            return cached_user

    logger.debug("user cache MISS id=%s", user_id)
    user = db.query(User).filter(User.id == token_user.id).first()
    if not user or not user.is_active:
        raise auth_exception()

    set_cached_user(user_id, serialize_cached_user(user))
    return user


def get_current_db_user(
    token_user: Annotated[TokenUser, Depends(get_current_token_user)],
    db: Annotated[Session, Depends(get_db)],
) -> User:
    user = db.query(User).filter(User.id == token_user.id).first()
    if not user or not user.is_active:
        raise auth_exception()
    return user


CurrentSubject = Annotated[TokenUser, Depends(get_current_token_user)]
DBUser = Annotated[User, Depends(get_current_db_user)]
