from typing import Annotated
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from jose import JWTError
import uuid
from database import get_db, User
from crypto import decode_token

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
    user = db.query(User).filter(User.id == token_user.id).first()
    if not user or not user.is_active:
        raise auth_exception()
    return user

CurrentUser = Annotated[TokenUser, Depends(get_current_token_user)]
DBUser = Annotated[User, Depends(get_current_user_from_db)]