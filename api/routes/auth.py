from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from datetime import datetime, timedelta, timezone
from jose import JWTError
from typing import Annotated

from database import get_db, User, AuditLog, RefreshToken
from crypto import (
    hash_password, verify_password,
    create_access_token, create_refresh_token, decode_token,
    hash_refresh_token, generate_salt, REFRESH_TOKEN_EXPIRE_DAYS
)
from schemas import RegisterRequest, LoginRequest, TokenResponse, RefreshRequest, UserResponse
from deps import get_current_user_from_db

router = APIRouter(prefix="/auth", tags=["auth"])


def log_action(db: Session, user_id, action: str, request: Request):
    entry = AuditLog(
        user_id=user_id,
        action=action,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    db.add(entry)


@router.post("/register", response_model=TokenResponse, status_code=201, responses={400: {"description": "Email already registered"}})
def register(body: RegisterRequest, request: Request, db: Annotated[Session, Depends(get_db)]):
    if db.query(User).filter(User.email == body.email).first():
        raise HTTPException(status_code=400, detail="Email already registered")

    user = User(
        email=body.email,
        hashed_password=hash_password(body.password),
        full_name=body.full_name,
        master_hint=body.master_hint,
        vault_salt=generate_salt(32),
    )
    db.add(user)
    db.commit()

    access_token = create_access_token({"sub": str(user.id)})
    refresh_token = create_refresh_token({"sub": str(user.id)})

    rt = RefreshToken(
        user_id=user.id,
        token_hash=hash_refresh_token(refresh_token),
        expires_at=datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS),
    )
    db.add(rt)
    log_action(db, user.id, "REGISTER", request)
    db.commit()

    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        vault_salt=user.vault_salt,
    )


@router.post("/login", response_model=TokenResponse, responses={401: {"description": "Invalid email or password"}})
def login(body: LoginRequest, request: Request, db: Annotated[Session, Depends(get_db)]):
    user = db.query(User).filter(User.email == body.email).first()
    # Check is_active and password in one condition to avoid leaking account state
    if not user or not user.is_active or not verify_password(body.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    access_token = create_access_token({"sub": str(user.id)})
    refresh_token = create_refresh_token({"sub": str(user.id)})

    rt = RefreshToken(
        user_id=user.id,
        token_hash=hash_refresh_token(refresh_token),
        expires_at=datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS),
    )
    db.add(rt)
    log_action(db, user.id, "LOGIN", request)
    db.commit()

    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        vault_salt=user.vault_salt,
    )


@router.post("/refresh", response_model=TokenResponse, responses={401: {"description": "Invalid or expired refresh token"}})
def refresh(body: RefreshRequest, db: Annotated[Session, Depends(get_db)]):
    try:
        payload = decode_token(body.refresh_token)
        if payload.get("type") != "refresh":
            raise HTTPException(status_code=401, detail="Invalid token type")
        user_id = payload.get("sub")
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid refresh token")

    token_hash = hash_refresh_token(body.refresh_token)
    stored = db.query(RefreshToken).filter(
        RefreshToken.token_hash == token_hash,
        RefreshToken.revoked == False,
        RefreshToken.expires_at > datetime.now(timezone.utc),
    ).first()

    if not stored:
        raise HTTPException(status_code=401, detail="Refresh token expired or revoked")

    stored.revoked = True
    user = db.query(User).filter(User.id == user_id).first()
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="Account not found or disabled")

    new_access = create_access_token({"sub": user_id})
    new_refresh = create_refresh_token({"sub": user_id})

    new_rt = RefreshToken(
        user_id=user_id,
        token_hash=hash_refresh_token(new_refresh),
        expires_at=datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS),
    )
    db.add(new_rt)
    db.commit()

    return TokenResponse(
        access_token=new_access,
        refresh_token=new_refresh,
        vault_salt=user.vault_salt,
    )


@router.post("/logout")
def logout(body: RefreshRequest, db: Annotated[Session, Depends(get_db)]):
    token_hash = hash_refresh_token(body.refresh_token)
    stored = db.query(RefreshToken).filter(RefreshToken.token_hash == token_hash).first()
    if stored:
        stored.revoked = True
        db.commit()
    return {"message": "Logged out"}


@router.get("/me", response_model=UserResponse)
def me(current_user: Annotated[User, Depends(get_current_user_from_db)]):
    return current_user
