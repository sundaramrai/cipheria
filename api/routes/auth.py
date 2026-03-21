"""
routes/auth.py — Auth routes with Redis cache integration.
"""

import os
import uuid
import secrets
import logging
from datetime import datetime, timedelta, timezone
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response, Cookie
from jose import JWTError
from sqlalchemy import func
from sqlalchemy.orm import Session

from database import get_db, User, AuditLog, RefreshToken, VaultItem, AuthToken
from crypto import (
    hash_password,
    verify_password,
    generate_salt,
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_refresh_token,
    REFRESH_TOKEN_EXPIRE_DAYS,
)
from schemas import (
    RegisterRequest,
    LoginChallengeRequest,
    LoginChallengeResponse,
    LoginRequest,
    TokenResponse,
    UserResponse,
    VerifyEmailRequest,
    UpdateProfileRequest,
    ChangeMasterPasswordRequest,
    DeleteAccountRequest,
    VerifyMasterPasswordRequest,
    MessageResponse,
    UnlockedVaultResponse,
)
from deps import get_current_user_from_db, DBUser
from cache import (
    get_cached_refresh_token,
    cache_refresh_token_valid,
    revoke_refresh_token_cache,
    is_token_blacklisted,
    invalidate_user,
    invalidate_all_vault,
    set_cached_user,
)
from limiter import limiter, get_client_ip
from mailer import send_email, build_app_url

logger = logging.getLogger(__name__)

INVALID_EMAIL_OR_PASSWORD = "Invalid email or password"

router = APIRouter(prefix="/auth", tags=["auth"])

IS_PROD = os.getenv("ENVIRONMENT", "production") == "production"

AUTH_COOKIE_PATH = "/"
_RT_TTL_SECONDS = REFRESH_TOKEN_EXPIRE_DAYS * 24 * 3600
EMAIL_VERIFY_EXPIRE_HOURS = 24
UNLOCK_PAGE_SIZE = 50


def _set_refresh_cookie(response: Response, token: str) -> None:
    # HttpOnly — never exposed to JS
    response.set_cookie(
        key="refresh_token",
        value=token,
        httponly=True,
        secure=IS_PROD,
        samesite="none" if IS_PROD else "lax",  # none required for cross-origin
        max_age=_RT_TTL_SECONDS,
        path=AUTH_COOKIE_PATH,
    )


def _clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(
        key="refresh_token",
        path=AUTH_COOKIE_PATH,
        httponly=True,
        secure=IS_PROD,
        samesite="none" if IS_PROD else "lax",
    )


def _log_action(db: Session, user_id, action: str, request: Request) -> None:
    db.add(
        AuditLog(
            user_id=user_id,
            action=action,
            ip_address=get_client_ip(request),
            user_agent=request.headers.get("user-agent"),
        )
    )


def _warm_caches(user: User, token_hash: str) -> None:
    """Prime user profile, vault salt, and refresh token validity after auth."""
    user_id = str(user.id)
    set_cached_user(
        user_id,
        _user_cache_dict(user),
    )
    cache_refresh_token_valid(token_hash, user_id, _RT_TTL_SECONDS)


def _prune_revoked_tokens(db: Session, user_id) -> None:
    """Delete revoked refresh tokens for a user to keep the table lean.
    Called at login so the cleanup cost is amortised across natural usage.
    """
    db.query(RefreshToken).filter(
        RefreshToken.user_id == user_id,
        RefreshToken.revoked,
    ).delete(synchronize_session=False)


def _hash_action_token(token: str) -> str:
    return hash_refresh_token(token)


def _user_cache_dict(user: User) -> dict:
    return {
        "id": str(user.id),
        "email": user.email,
        "full_name": user.full_name,
        "vault_salt": user.vault_salt,
        "master_hint": user.master_hint,
        "email_verified": user.email_verified,
        "created_at": user.created_at.isoformat() if user.created_at else None,
        "is_active": user.is_active,
    }


def _verify_master_password(user: User, verifier: str) -> bool:
    return bool(user.hashed_password and verify_password(verifier, user.hashed_password))


def _sidebar_counts(db: Session, user_id) -> dict:
    counts = db.query(
        func.count(VaultItem.id)
        .filter(
            VaultItem.user_id == user_id,
            VaultItem.is_deleted.is_(False),
        )
        .label("all"),
        func.count(VaultItem.id)
        .filter(
            VaultItem.user_id == user_id,
            VaultItem.is_deleted.is_(False),
            VaultItem.category == "login",
        )
        .label("login"),
        func.count(VaultItem.id)
        .filter(
            VaultItem.user_id == user_id,
            VaultItem.is_deleted.is_(False),
            VaultItem.category == "card",
        )
        .label("card"),
        func.count(VaultItem.id)
        .filter(
            VaultItem.user_id == user_id,
            VaultItem.is_deleted.is_(False),
            VaultItem.category == "note",
        )
        .label("note"),
        func.count(VaultItem.id)
        .filter(
            VaultItem.user_id == user_id,
            VaultItem.is_deleted.is_(False),
            VaultItem.category == "identity",
        )
        .label("identity"),
        func.count(VaultItem.id)
        .filter(
            VaultItem.user_id == user_id,
            VaultItem.is_deleted.is_(False),
            VaultItem.is_favourite.is_(True),
        )
        .label("favourites"),
        func.count(VaultItem.id)
        .filter(
            VaultItem.user_id == user_id,
            VaultItem.is_deleted.is_(True),
        )
        .label("trash"),
    ).one()

    return {
        "all": counts.all,
        "login": counts.login,
        "card": counts.card,
        "note": counts.note,
        "identity": counts.identity,
        "favourites": counts.favourites,
        "trash": counts.trash,
    }


def _serialize_unlock_item(item: VaultItem) -> dict:
    return {
        "id": str(item.id),
        "name": item.name,
        "category": item.category,
        "encrypted_data": item.encrypted_data,
        "favicon_url": item.favicon_url,
        "is_favourite": item.is_favourite,
        "is_deleted": item.is_deleted,
        "deleted_at": item.deleted_at.isoformat() if item.deleted_at else None,
        "created_at": item.created_at.isoformat() if item.created_at else None,
        "updated_at": item.updated_at.isoformat() if item.updated_at else None,
    }


def _build_auth_response(user: User, access_token: str) -> TokenResponse:
    return TokenResponse(
        access_token=access_token,
        vault_salt=user.vault_salt,
        user=UserResponse.model_validate(user),
    )


def _build_unlock_response(db: Session, user: User) -> UnlockedVaultResponse:
    total = (
        db.query(func.count(VaultItem.id))
        .filter(
            VaultItem.user_id == user.id,
            VaultItem.is_deleted.is_(False),
        )
        .scalar()
    ) or 0
    rows = (
        db.query(VaultItem)
        .filter(
            VaultItem.user_id == user.id,
            VaultItem.is_deleted.is_(False),
        )
        .order_by(VaultItem.updated_at.desc())
        .limit(UNLOCK_PAGE_SIZE)
        .all()
    )

    return UnlockedVaultResponse(
        items=[_serialize_unlock_item(item) for item in rows],
        total=total,
        page=1,
        page_size=UNLOCK_PAGE_SIZE,
        total_pages=-(-total // UNLOCK_PAGE_SIZE) if total else 0,
        sidebar_counts=_sidebar_counts(db, user.id),
    )


def _issue_auth_token(
    db: Session,
    user_id,
    purpose: str,
    expires_at: datetime,
) -> str:
    raw_token = secrets.token_urlsafe(32)
    db.add(
        AuthToken(
            user_id=user_id,
            token_hash=_hash_action_token(raw_token),
            purpose=purpose,
            expires_at=expires_at,
        )
    )
    return raw_token


def _consume_auth_token(
    db: Session,
    raw_token: str,
    purpose: str,
) -> AuthToken:
    stored = (
        db.query(AuthToken)
        .filter(
            AuthToken.token_hash == _hash_action_token(raw_token),
            AuthToken.purpose == purpose,
            AuthToken.consumed_at.is_(None),
            AuthToken.expires_at > datetime.now(timezone.utc),
        )
        .first()
    )
    if not stored:
        raise HTTPException(status_code=400, detail="Invalid or expired token")

    stored.consumed_at = datetime.now(timezone.utc)
    return stored


def _send_verification_email(user: User, raw_token: str) -> bool:
    verify_url = build_app_url(f"/auth?mode=verify-email&token={raw_token}")
    return send_email(
        user.email,
        "Verify your Cipheria email",
        (
            "Welcome to Cipheria.\n\n"
            f"Verify your email by opening:\n{verify_url}\n\n"
            f"This link expires in {EMAIL_VERIFY_EXPIRE_HOURS} hours."
        ),
    )


# Register

@router.post(
    "/register",
    response_model=TokenResponse,
    status_code=201,
    responses={400: {"description": "Email already registered"}},
)
@limiter.limit("5/minute")
def register(
    body: RegisterRequest,
    request: Request,
    response: Response,
    db: Annotated[Session, Depends(get_db)],
):
    if db.query(User).filter(User.email == body.email).first():
        raise HTTPException(status_code=400, detail="Email already registered")

    user = User(
        email=body.email,
        hashed_password=hash_password(body.master_password_verifier),
        full_name=body.full_name,
        master_hint=body.master_hint,
        vault_salt=body.vault_salt,
    )
    db.add(user)
    db.flush()

    access_token = create_access_token({"sub": str(user.id)})
    refresh_token = create_refresh_token({"sub": str(user.id)})
    token_hash = hash_refresh_token(refresh_token)

    db.add(
        RefreshToken(
            user_id=user.id,
            token_hash=token_hash,
            expires_at=datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS),
        )
    )
    verify_token = _issue_auth_token(
        db,
        user.id,
        "verify_email",
        datetime.now(timezone.utc) + timedelta(hours=EMAIL_VERIFY_EXPIRE_HOURS),
    )
    _log_action(db, user.id, "REGISTER", request)
    db.commit()

    _warm_caches(user, token_hash)
    _set_refresh_cookie(response, refresh_token)
    if not _send_verification_email(user, verify_token):
        logger.warning("REGISTER verification email not delivered user=%s", user.id)

    logger.info(f"REGISTER user={user.id}")
    return _build_auth_response(user, access_token)


# Login

@router.post(
    "/login/challenge",
    response_model=LoginChallengeResponse,
    responses={401: {"description": "Invalid email or password"}},
)
@limiter.limit("20/minute")
def login_challenge(
    body: LoginChallengeRequest,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
):
    user = db.query(User).filter(User.email == body.email).first()
    vault_salt = user.vault_salt if user and user.is_active else generate_salt()
    return LoginChallengeResponse(vault_salt=vault_salt)

@router.post(
    "/login",
    response_model=TokenResponse,
    responses={401: {"description": "Invalid email or password"}},
)
@limiter.limit("10/minute")
def login(
    body: LoginRequest,
    request: Request,
    response: Response,
    db: Annotated[Session, Depends(get_db)],
):
    # Always hit DB for login — must verify the bcrypt hash
    user = db.query(User).filter(User.email == body.email).first()

    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail=INVALID_EMAIL_OR_PASSWORD)

    if not _verify_master_password(user, body.master_password_verifier):
        raise HTTPException(status_code=401, detail=INVALID_EMAIL_OR_PASSWORD)

    access_token = create_access_token({"sub": str(user.id)})
    refresh_token = create_refresh_token({"sub": str(user.id)})
    token_hash = hash_refresh_token(refresh_token)

    db.add(
        RefreshToken(
            user_id=user.id,
            token_hash=token_hash,
            expires_at=datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS),
        )
    )
    _log_action(db, user.id, "LOGIN", request)

    # Prune stale revoked tokens to keep the refresh_tokens table lean.
    # Done at login so cost is amortised — not on every request.
    _prune_revoked_tokens(db, user.id)

    db.commit()

    _warm_caches(user, token_hash)
    _set_refresh_cookie(response, refresh_token)

    logger.info(f"LOGIN user={user.id}")
    return _build_auth_response(user, access_token)


# Refresh — token rotation with Redis-first validation

@router.post(
    "/refresh",
    response_model=TokenResponse,
    responses={401: {"description": "Invalid or expired refresh token"}},
)
@limiter.limit("20/minute")
def refresh(
    request: Request,
    response: Response,
    db: Annotated[Session, Depends(get_db)],
    refresh_token: Annotated[Optional[str], Cookie()] = None,
):
    def _reject_refresh(detail: str) -> None:
        _clear_refresh_cookie(response)
        raise HTTPException(status_code=401, detail=detail)

    if not refresh_token:
        _reject_refresh("No refresh token")

    try:
        payload = decode_token(refresh_token)
        if payload.get("type") != "refresh":
            _reject_refresh("Invalid token type")
        user_id = payload.get("sub")
        jti = payload.get("jti", "")
    except JWTError:
        _reject_refresh("Invalid refresh token")

    # Validate sub is a well-formed UUID — malformed values cause DB errors
    if not user_id:
        _reject_refresh("Invalid token")
    try:
        uuid.UUID(user_id)
    except ValueError:
        _reject_refresh("Invalid token")

    if is_token_blacklisted(jti):
        _reject_refresh("Refresh token revoked")

    token_hash = hash_refresh_token(refresh_token)
    cached_rt = get_cached_refresh_token(token_hash)

    if cached_rt:
        # Cache confirms this token is valid — skip the initial DB read.
        # We still fetch the row below to mark it revoked, but that query
        # runs after the cache is cleared so concurrent reuse is blocked.
        logger.debug(f"refresh token cache HIT user={user_id}")
        stored = None  # resolved lazily during rotation
    else:
        logger.debug(f"refresh token cache MISS user={user_id}")
        stored = (
            db.query(RefreshToken)
            .filter(
                RefreshToken.token_hash == token_hash,
                ~RefreshToken.revoked,
                RefreshToken.expires_at > datetime.now(timezone.utc),
            )
            .first()
        )
        if not stored:
            _reject_refresh("Refresh token expired or revoked")

    # Revocation order: DB first, then cache
    # Persisting to DB first ensures the token is durably revoked even if the
    # process crashes before the cache write. The reverse order would leave a
    # permanently valid but un-rotatable token if the server dies mid-flight.
    if stored is None:
        stored = (
            db.query(RefreshToken)
            .filter(RefreshToken.token_hash == token_hash)
            .first()
        )
    if stored:
        stored.revoked = True

    user = db.query(User).filter(User.id == user_id).first()
    if not user or not user.is_active:
        db.commit()  # persist DB revocation even if account is gone/disabled
        _reject_refresh("Account not found or disabled")

    new_access = create_access_token({"sub": user_id})
    new_refresh = create_refresh_token({"sub": user_id})
    new_hash = hash_refresh_token(new_refresh)

    db.add(
        RefreshToken(
            user_id=user_id,
            token_hash=new_hash,
            expires_at=datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS),
        )
    )
    _log_action(db, user_id, "TOKEN_REFRESH", request)
    db.commit()  # old token revoked + new token persisted atomically
    # Clear old token from cache only after DB commit succeeds
    revoke_refresh_token_cache(token_hash, jti, _RT_TTL_SECONDS)

    _warm_caches(user, new_hash)
    _set_refresh_cookie(response, new_refresh)

    logger.info(f"TOKEN_REFRESH user={user_id}")
    return _build_auth_response(user, new_access)


# Logout

@router.post("/logout")
@limiter.limit("20/minute")
def logout(
    request: Request,
    response: Response,
    db: Annotated[Session, Depends(get_db)],
    refresh_token: Annotated[Optional[str], Cookie()] = None,
):
    if refresh_token:
        try:
            payload = decode_token(refresh_token)
            jti = payload.get("jti", "")
            user_id = payload.get("sub", "")
            token_hash = hash_refresh_token(refresh_token)

            stored = db.query(RefreshToken).filter(RefreshToken.token_hash == token_hash).first()
            if stored:
                stored.revoked = True

            _log_action(db, user_id, "LOGOUT", request)
            db.commit()

            revoke_refresh_token_cache(token_hash, jti, _RT_TTL_SECONDS)
            invalidate_user(user_id)
            invalidate_all_vault(user_id)
            logger.info(f"LOGOUT user={user_id} — all caches purged")
        except Exception as exc:
            # Malformed or expired token — still clear the cookie.
            # Log so genuine errors (DB down, Redis down) are not silent.
            logger.warning(f"LOGOUT cleanup error (non-fatal): {exc}")

    response.delete_cookie(
        key="refresh_token",
        path=AUTH_COOKIE_PATH,
        httponly=True,
        secure=IS_PROD,
        samesite="none" if IS_PROD else "lax",
    )
    return {"message": "Logged out"}


@router.post(
    "/verify-email",
    response_model=MessageResponse,
    responses={400: {"description": "Invalid or expired token or account not found"}},
)
@limiter.limit("20/minute")
def verify_email(
    body: VerifyEmailRequest,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
):
    token = _consume_auth_token(db, body.token, "verify_email")
    user = db.query(User).filter(User.id == token.user_id).first()
    if not user:
        raise HTTPException(status_code=400, detail="Account not found")

    user.email_verified = True
    _log_action(db, user.id, "EMAIL_VERIFIED", request)
    db.commit()

    set_cached_user(
        str(user.id),
        _user_cache_dict(user),
    )
    return MessageResponse(message="Email verified")


@router.post(
    "/verify-email/request",
    response_model=MessageResponse,
    responses={
        503: {"description": "Verification email could not be sent. Please try again later."}
    },
)
@limiter.limit("5/minute")
def resend_verification_email(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    current_user: DBUser,
):
    if current_user.email_verified:
        return MessageResponse(message="Email is already verified")

    raw_token = _issue_auth_token(
        db,
        current_user.id,
        "verify_email",
        datetime.now(timezone.utc) + timedelta(hours=EMAIL_VERIFY_EXPIRE_HOURS),
    )
    _log_action(db, current_user.id, "VERIFY_EMAIL_SENT", request)
    if not _send_verification_email(current_user, raw_token):
        db.rollback()
        raise HTTPException(
            status_code=503,
            detail="Verification email could not be sent. Please try again later.",
        )
    db.commit()
    return MessageResponse(message="Verification email sent")


@router.post(
    "/unlock",
    response_model=UnlockedVaultResponse,
    responses={401: {"description": "Invalid master password"}},
)
@limiter.limit("20/minute")
def unlock_vault(
    body: VerifyMasterPasswordRequest,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    current_user: DBUser,
):
    if not _verify_master_password(current_user, body.master_password_verifier):
        raise HTTPException(status_code=401, detail="Invalid master password")

    return _build_unlock_response(db, current_user)


@router.post(
    "/forgot-password",
    response_model=MessageResponse,
    responses={400: {"description": "Master password reset is not supported in zero-knowledge mode"}},
)
@limiter.limit("5/minute")
def forgot_password(
    request: Request,
):
    raise HTTPException(
        status_code=400,
        detail="Master password reset is not supported in zero-knowledge mode",
    )


@router.post(
    "/reset-password",
    response_model=MessageResponse,
    responses={400: {"description": "Invalid or expired token or account not found"}},
)
@limiter.limit("10/minute")
def reset_password(
    request: Request,
):
    raise HTTPException(
        status_code=400,
        detail="Master password reset is not supported in zero-knowledge mode",
    )


@router.patch(
    "/profile",
    response_model=UserResponse,
    responses={400: {"description": "Master password payload contains an unknown item"}},
)
@limiter.limit("30/minute")
def update_profile(
    body: UpdateProfileRequest,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    current_user: DBUser,
):
    current_user.full_name = body.full_name
    current_user.master_hint = body.master_hint
    _log_action(db, current_user.id, "PROFILE_UPDATED", request)
    db.commit()
    db.refresh(current_user)

    set_cached_user(
        str(current_user.id),
        _user_cache_dict(current_user),
    )
    return current_user


@router.patch(
    "/master-password",
    response_model=UserResponse,
    responses={400: {"description": "All active vault items must be re-encrypted before changing the master password or master password payload contains an unknown item"}},
)
@limiter.limit("5/minute")
def change_master_password(
    body: ChangeMasterPasswordRequest,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    current_user: DBUser,
):
    active_items = (
        db.query(VaultItem)
        .filter(VaultItem.user_id == current_user.id, VaultItem.is_deleted.is_(False))
        .all()
    )
    if len(active_items) != len(body.items):
        raise HTTPException(
            status_code=400,
            detail="All active vault items must be re-encrypted before changing the master password",
        )

    item_map = {str(item.id): item for item in active_items}
    for update in body.items:
        item = item_map.get(str(update.id))
        if not item:
            raise HTTPException(status_code=400, detail="Master password payload contains an unknown item")
        item.encrypted_data = update.encrypted_data

    current_user.hashed_password = hash_password(body.new_master_password_verifier)
    current_user.vault_salt = body.new_vault_salt
    current_user.master_hint = body.master_hint
    _log_action(db, current_user.id, "MASTER_PASSWORD_CHANGED", request)
    db.commit()
    db.refresh(current_user)

    invalidate_user(str(current_user.id))
    invalidate_all_vault(str(current_user.id))
    return current_user


@router.delete(
    "/account",
    response_model=MessageResponse,
    responses={401: {"description": "Invalid password"}, 400: {"description": "Account not found"}},
)
@limiter.limit("3/minute")
def delete_account(
    body: DeleteAccountRequest,
    request: Request,
    response: Response,
    db: Annotated[Session, Depends(get_db)],
    current_user: DBUser,
):
    if not _verify_master_password(current_user, body.master_password_verifier):
        raise HTTPException(status_code=401, detail="Invalid master password")

    user_id = current_user.id
    _log_action(db, user_id, "ACCOUNT_DELETED", request)

    db.query(AuthToken).filter(AuthToken.user_id == user_id).delete(synchronize_session=False)
    db.query(RefreshToken).filter(RefreshToken.user_id == user_id).delete(synchronize_session=False)
    db.query(VaultItem).filter(VaultItem.user_id == user_id).delete(synchronize_session=False)
    db.query(AuditLog).filter(AuditLog.user_id == user_id).delete(synchronize_session=False)
    db.query(User).filter(User.id == user_id).delete(synchronize_session=False)
    db.commit()

    invalidate_user(str(user_id))
    invalidate_all_vault(str(user_id))
    _clear_refresh_cookie(response)
    return MessageResponse(message="Account deleted")


# Me

@router.get(
    "/me",
    response_model=UserResponse,
    responses={401: {"description": "Not authenticated"}},
)
@limiter.limit("60/minute")
def me(
    request: Request,
    current_user: Annotated[User, Depends(get_current_user_from_db)],
):
    return current_user
