"""
routes/auth.py — Auth routes with Redis cache integration.
"""

import logging
import os
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response
from jwt import InvalidTokenError
from sqlalchemy import func
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from audit import log_action
from cache import (
    invalidate_all_vault,
    invalidate_user,
    set_cached_user,
)
from crypto import (
    REFRESH_TOKEN_EXPIRE_DAYS,
    create_access_token,
    create_refresh_token,
    decode_token,
    generate_salt,
    hash_password,
    hash_refresh_token,
    verify_password,
)
from database import AuditLog, AuthToken, RefreshToken, User, VaultItem, get_db
from deps import CurrentSubject, DBUser, get_current_user_from_db
from limiter import limiter
from mailer import build_app_url, send_email
from schemas import (
    ChangeMasterPasswordRequest,
    DeleteAccountRequest,
    LoginChallengeRequest,
    LoginChallengeResponse,
    LoginRequest,
    MessageResponse,
    RegisterRequest,
    TokenResponse,
    UnlockedVaultResponse,
    UpdateProfileRequest,
    UserResponse,
    VerifyEmailRequest,
    VerifyEmailResponse,
    VerifyMasterPasswordRequest,
)
from user_cache import serialize_cached_user
from vault_counts import get_cached_sidebar_counts_for_user

logger = logging.getLogger(__name__)

INVALID_EMAIL_OR_PASSWORD = "Invalid email or password"
INVALID_MASTER_PASSWORD = "Invalid master password"

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


def _warm_caches(user: User) -> None:
    """Prime the cached user profile and vault salt after auth."""
    user_id = str(user.id)
    set_cached_user(
        user_id,
        serialize_cached_user(user),
    )


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


def _verify_master_password(user: User, verifier: str) -> bool:
    return bool(user.hashed_password and verify_password(verifier, user.hashed_password))


def _start_session(db: Session, user: User) -> tuple[str, str]:
    session_id = uuid.uuid4()
    refresh_token = create_refresh_token({"sub": str(user.id)})
    token_hash = hash_refresh_token(refresh_token)
    db.add(RefreshToken(
        id=session_id, user_id=user.id, token_hash=token_hash,
        expires_at=datetime.now(UTC) + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS),
    ))
    access_token = create_access_token({"sub": str(user.id), "sid": str(session_id)})
    return access_token, refresh_token


def _revoke_other_sessions(db: Session, user_id: uuid.UUID, session_id: uuid.UUID) -> None:
    db.query(RefreshToken).filter(
        RefreshToken.user_id == user_id,
        RefreshToken.id != session_id,
        RefreshToken.revoked.is_(False),
    ).update({RefreshToken.revoked: True}, synchronize_session=False)


def _build_auth_response(user: User | dict[str, Any], access_token: str) -> TokenResponse:
    user = UserResponse.model_validate(user)
    return TokenResponse(
        access_token=access_token,
        vault_salt=user.vault_salt,
        user=user,
    )


def _build_unlock_response(db: Session, user: User) -> UnlockedVaultResponse:
    rows = (
        db.query(
            VaultItem.id,
            VaultItem.name,
            VaultItem.category,
            VaultItem.encrypted_data,
            VaultItem.is_favourite,
            VaultItem.is_deleted,
            VaultItem.deleted_at,
            VaultItem.created_at,
            VaultItem.updated_at,
            func.count(VaultItem.id).over().label("total_count"),
        )
        .filter(
            VaultItem.user_id == user.id,
            VaultItem.is_deleted.is_(False),
        )
        .order_by(VaultItem.updated_at.desc(), VaultItem.id.asc())
        .limit(UNLOCK_PAGE_SIZE)
        .all()
    )
    total = int(rows[0].total_count) if rows else 0

    return UnlockedVaultResponse(
        items=rows,
        total=total,
        page=1,
        page_size=UNLOCK_PAGE_SIZE,
        total_pages=-(-total // UNLOCK_PAGE_SIZE) if total else 0,
        sidebar_counts=get_cached_sidebar_counts_for_user(db, user.id),
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
            AuthToken.expires_at > datetime.now(UTC),
        )
        .first()
    )
    if not stored:
        raise HTTPException(status_code=400, detail="Invalid or expired token")

    stored.consumed_at = datetime.now(UTC)
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

    access_token, refresh_token = _start_session(db, user)
    verify_token = _issue_auth_token(
        db,
        user.id,
        "verify_email",
        datetime.now(UTC) + timedelta(hours=EMAIL_VERIFY_EXPIRE_HOURS),
    )
    log_action(db, user.id, "REGISTER", request)
    db.commit()

    _warm_caches(user)
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

    access_token, refresh_token = _start_session(db, user)
    log_action(db, user.id, "LOGIN", request)

    # Prune stale revoked tokens to keep the refresh_tokens table lean.
    # Done at login so cost is amortised — not on every request.
    _prune_revoked_tokens(db, user.id)

    db.commit()

    _warm_caches(user)
    _set_refresh_cookie(response, refresh_token)

    logger.info(f"LOGIN user={user.id}")
    return _build_auth_response(user, access_token)


# Refresh — atomic rotation within a stable server-side session

@router.post(
    "/refresh",
    response_model=TokenResponse,
    responses={401: {"description": "Invalid or expired refresh token"}},
)
@limiter.limit("20/minute")
def refresh(  # NOSONAR - token rotation flow is intentionally explicit on this security-sensitive path
    request: Request,
    response: Response,
    db: Annotated[Session, Depends(get_db)],
    refresh_token: Annotated[str | None, Cookie()] = None,
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
    except InvalidTokenError:
        _reject_refresh("Invalid refresh token")

    # Validate sub is a well-formed UUID — malformed values cause DB errors
    if not user_id:
        _reject_refresh("Invalid token")
    try:
        uuid.UUID(user_id)
    except ValueError:
        _reject_refresh("Invalid token")

    token_hash = hash_refresh_token(refresh_token)
    user_uuid = uuid.UUID(user_id)
    stored = db.query(RefreshToken).filter(
        RefreshToken.token_hash == token_hash,
        RefreshToken.user_id == user_uuid,
        RefreshToken.revoked.is_(False),
        RefreshToken.expires_at > datetime.now(UTC),
    ).first()
    if not stored:
        _reject_refresh("Refresh token expired or revoked")
    user = db.query(User).filter(User.id == user_uuid, User.is_active.is_(True)).first()
    if not user:
        _reject_refresh("Account not found or disabled")

    new_refresh = create_refresh_token({"sub": user_id})
    new_hash = hash_refresh_token(new_refresh)
    # Keep a stable session ID; compare-and-swap prevents replay or resurrection.
    rotated = db.query(RefreshToken).filter(
        RefreshToken.id == stored.id,
        RefreshToken.token_hash == token_hash,
        RefreshToken.revoked.is_(False),
        RefreshToken.expires_at > datetime.now(UTC),
    ).update({
        RefreshToken.token_hash: new_hash,
        RefreshToken.expires_at: datetime.now(UTC) + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS),
    }, synchronize_session=False)
    if rotated != 1:
        _reject_refresh("Refresh token expired or revoked")
    new_access = create_access_token({"sub": user_id, "sid": str(stored.id)})
    log_action(db, user_uuid, "TOKEN_REFRESH", request)
    db.commit()
    _warm_caches(user)
    response_model = _build_auth_response(user, new_access)
    _set_refresh_cookie(response, new_refresh)

    logger.info(f"TOKEN_REFRESH user={user_id}")
    return response_model


@router.post("/sessions/revoke-others", response_model=MessageResponse)
@limiter.limit("5/minute")
def revoke_other_sessions(
    body: VerifyMasterPasswordRequest,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    current_user: DBUser,
    subject: CurrentSubject,
):
    if not _verify_master_password(current_user, body.master_password_verifier):
        raise HTTPException(status_code=401, detail=INVALID_MASTER_PASSWORD)
    _revoke_other_sessions(db, current_user.id, subject.session_id)
    log_action(db, current_user.id, "OTHER_SESSIONS_REVOKED", request)
    db.commit()
    return MessageResponse(message="Other sessions signed out. This browser remains signed in.")


# Logout

@router.post("/logout")
@limiter.limit("20/minute")
def logout(
    request: Request,
    response: Response,
    db: Annotated[Session, Depends(get_db)],
    refresh_token: Annotated[str | None, Cookie()] = None,
):
    if refresh_token:
        try:
            payload = decode_token(refresh_token)
            user_id = payload.get("sub", "")
            token_hash = hash_refresh_token(refresh_token)

            stored = db.query(RefreshToken).filter(RefreshToken.token_hash == token_hash).first()
            if stored:
                stored.revoked = True

            log_action(db, uuid.UUID(user_id), "LOGOUT", request)
            db.commit()

            invalidate_user(user_id)
            invalidate_all_vault(user_id)
            logger.info(f"LOGOUT user={user_id} — all caches purged")
        except (InvalidTokenError, SQLAlchemyError, TypeError, ValueError) as exc:
            # Malformed or expired token — still clear the cookie.
            # Log so genuine errors (DB down, Redis down) are not silent.
            logger.warning(f"LOGOUT cleanup error (non-fatal): {exc}")

    _clear_refresh_cookie(response)
    return {"message": "Logged out"}


@router.post(
    "/verify-email",
    response_model=VerifyEmailResponse,
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
    log_action(db, user.id, "EMAIL_VERIFIED", request)
    db.commit()

    set_cached_user(
        str(user.id),
        serialize_cached_user(user),
    )
    return VerifyEmailResponse(
        message="Email verified",
        user=UserResponse.model_validate(user),
    )


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
        datetime.now(UTC) + timedelta(hours=EMAIL_VERIFY_EXPIRE_HOURS),
    )
    log_action(db, current_user.id, "VERIFY_EMAIL_SENT", request)
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
    responses={401: {"description": INVALID_MASTER_PASSWORD}},
)
@limiter.limit("20/minute")
def unlock_vault(
    body: VerifyMasterPasswordRequest,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    current_user: DBUser,
):
    if not _verify_master_password(current_user, body.master_password_verifier):
        raise HTTPException(status_code=401, detail=INVALID_MASTER_PASSWORD)

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
    log_action(db, current_user.id, "PROFILE_UPDATED", request)
    db.commit()
    db.refresh(current_user)

    set_cached_user(
        str(current_user.id),
        serialize_cached_user(current_user),
    )
    return current_user


@router.patch(
    "/master-password",
    response_model=UserResponse,
    responses={
        400: {"description": "All vault items must be re-encrypted with unique, known IDs"},
        401: {"description": "Invalid current master password"},
    },
)
@limiter.limit("5/minute")
def change_master_password(
    body: ChangeMasterPasswordRequest,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    current_user: DBUser,
    subject: CurrentSubject,
):
    if not _verify_master_password(current_user, body.current_master_password_verifier):
        raise HTTPException(status_code=401, detail=INVALID_MASTER_PASSWORD)

    vault_items = (
        db.query(VaultItem)
        .filter(VaultItem.user_id == current_user.id)
        .all()
    )
    if (
        len(vault_items) != len(body.items)
        or {item.id for item in vault_items} != {update.id for update in body.items}
    ):
        raise HTTPException(
            status_code=400,
            detail="All vault items, including items in trash, must be re-encrypted before changing the master password",
        )

    item_map = {str(item.id): item for item in vault_items}
    for update in body.items:
        item = item_map.get(str(update.id))
        if not item:
            raise HTTPException(status_code=400, detail="Master password payload contains an unknown item")
        item.encrypted_data = update.encrypted_data

    current_user.hashed_password = hash_password(body.new_master_password_verifier)
    current_user.vault_salt = body.new_vault_salt
    current_user.master_hint = body.master_hint
    _revoke_other_sessions(db, current_user.id, subject.session_id)
    log_action(db, current_user.id, "MASTER_PASSWORD_CHANGED", request)
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
        raise HTTPException(status_code=401, detail=INVALID_MASTER_PASSWORD)

    user_id = current_user.id
    log_action(db, user_id, "ACCOUNT_DELETED", request)

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
