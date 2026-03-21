"""
routes/vault.py — Vault CRUD with Redis caching and ETag support.
"""

import hashlib
import logging
from datetime import datetime, timezone
from typing import Annotated, Literal, Optional
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy import func
from sqlalchemy.orm import Session

from database import get_db, VaultItem, AuditLog
from schemas import (
    VaultItemCreate,
    VaultItemUpdate,
    VaultItemResponse,
    PaginatedVaultResponse,
)
from deps import CurrentUser, DBUser
from cache import (
    get_cached_vault_list,
    set_cached_vault_list,
    invalidate_vault_list,
    get_cached_vault_item,
    set_cached_vault_item,
    invalidate_vault_item,
)
from limiter import limiter, get_client_ip

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/vault", tags=["vault"])

ITEM_NOT_FOUND_MSG = "Item not found"
MAX_PAGE_SIZE = 100
VAULT_ITEM_LIMIT = 1000


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


def _item_to_dict(item) -> dict:
    """Full serialisation including encrypted_data — used for single-item responses."""
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


def _item_to_summary_dict(item) -> dict:
    """Excludes encrypted_data — used for list responses to minimise payload."""
    return {
        "id": str(item.id),
        "name": item.name,
        "category": item.category,
        "favicon_url": item.favicon_url,
        "is_favourite": item.is_favourite,
        "is_deleted": item.is_deleted,
        "deleted_at": item.deleted_at.isoformat() if item.deleted_at else None,
        "created_at": item.created_at.isoformat() if item.created_at else None,
        "updated_at": item.updated_at.isoformat() if item.updated_at else None,
    }


def _make_etag(data: dict) -> str:
    # Stable ETag from total count + page params + most recent updated_at
    raw = f"{data['total']}:{data['page']}:{data['page_size']}"
    if data["items"]:
        raw += f":{data['items'][0].get('updated_at', '')}"
    return f'"{hashlib.md5(raw.encode()).hexdigest()}"'


def _log_action(db: Session, user_id, action: str, request: Request) -> None:
    db.add(
        AuditLog(
            user_id=user_id,
            action=action,
            ip_address=get_client_ip(request),
            user_agent=request.headers.get("user-agent"),
        )
    )


def _sanitise_search(search: str) -> str:
    """Strip LIKE metacharacters to prevent pattern-based ReDoS via ILIKE.

    PostgreSQL's ILIKE treats % (any sequence), _ (any single char), and \
    (escape) as special. Removing them is safe — users searching for a name
    don't need regex-style wildcards.
    """
    return search.replace("\\", "").replace("%", "").replace("_", "")


# Export — always hits DB, no cache, strictly rate-limited, audited

@router.get("/export/json")
@limiter.limit("3/minute")
def export_vault(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    current_user: DBUser,
):
    items = (
        db.query(VaultItem)
        .filter(VaultItem.user_id == current_user.id, VaultItem.is_deleted.is_(False))
        .all()
    )

    _log_action(db, current_user.id, "VAULT_EXPORT", request)
    db.commit()

    logger.info(f"VAULT_EXPORT user={current_user.id} items={len(items)}")
    return {
        "export_version": "1.0",
        "user_email": current_user.email,
        "vault_salt": current_user.vault_salt,
        "items": [
            {
                "id": str(item.id),
                "name": item.name,
                "category": item.category,
                "encrypted_data": item.encrypted_data,
                "favicon_url": item.favicon_url,
                "is_favourite": item.is_favourite,
                "created_at": item.created_at.isoformat(),
            }
            for item in items
        ],
    }


# List — cached, paginated, ETag support, encrypted_data excluded

@router.get("", response_model=PaginatedVaultResponse)
def list_items(
    request: Request,
    response: Response,
    db: Annotated[Session, Depends(get_db)],
    current_user: CurrentUser,
    # Literal enum — rejects any value not in the allowed set at the query-param level
    category: Annotated[Optional[Literal["login", "card", "note", "identity"]], Query()] = None,
    search: Annotated[Optional[str], Query(max_length=128)] = None,
    favourites_only: Annotated[bool, Query()] = False,
    deleted_only: Annotated[bool, Query()] = False,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=MAX_PAGE_SIZE)] = 50,
):
    user_id = str(current_user.id)

    # Sanitise search before use — strips LIKE metacharacters (%, _, \)
    # to prevent ReDoS via pathological ILIKE patterns
    clean_search = _sanitise_search(search) if search else None

    # Skip caching for search queries (low repetition, unpredictable key space)
    if not clean_search:
        cached = get_cached_vault_list(
            user_id, category, clean_search, favourites_only, deleted_only, page, page_size
        )
        if cached is not None:
            logger.debug(f"vault:list cache HIT user={user_id}")
            etag = _make_etag(cached)
            if request.headers.get("if-none-match") == etag:
                return Response(status_code=304)
            response.headers["ETag"] = etag
            return cached

    logger.debug(f"vault:list cache MISS user={user_id}")

    q = db.query(
        VaultItem.id,
        VaultItem.name,
        VaultItem.category,
        # encrypted_data intentionally excluded from list — callers fetch
        # individual items via GET /vault/{id} when ciphertext is needed.
        VaultItem.favicon_url,
        VaultItem.is_favourite,
        VaultItem.is_deleted,
        VaultItem.deleted_at,
        VaultItem.created_at,
        VaultItem.updated_at,
    ).filter(VaultItem.user_id == current_user.id, VaultItem.is_deleted.is_(deleted_only))

    if category:
        q = q.filter(VaultItem.category == category)
    if clean_search:
        q = q.filter(VaultItem.name.ilike(f"%{clean_search}%"))
    if favourites_only:
        q = q.filter(VaultItem.is_favourite.is_(True))

    total = q.count()
    rows = (
        q.order_by(VaultItem.updated_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    items_data = [_item_to_summary_dict(r) for r in rows]

    result = {
        "items": items_data,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": -(-total // page_size),
        "sidebar_counts": None if clean_search else _sidebar_counts(db, current_user.id),
    }

    if not clean_search:
        set_cached_vault_list(
            user_id, category, clean_search, favourites_only, deleted_only, page, page_size, result
        )
        etag = _make_etag(result)
        response.headers["ETag"] = etag

    return result


# Get single item — cached, includes encrypted_data

@router.get(
    "/{item_id}",
    response_model=VaultItemResponse,
    responses={404: {"description": ITEM_NOT_FOUND_MSG}},
)
def get_item(
    item_id: UUID,
    db: Annotated[Session, Depends(get_db)],
    current_user: CurrentUser,
):
    user_id = str(current_user.id)
    item_key = str(item_id)

    cached = get_cached_vault_item(user_id, item_key)
    if cached is not None:
        logger.debug(f"vault:item cache HIT user={user_id} item={item_key}")
        return cached

    logger.debug(f"vault:item cache MISS user={user_id} item={item_key}")
    item = (
        db.query(VaultItem)
        .filter(VaultItem.id == item_id, VaultItem.user_id == current_user.id)
        .first()
    )
    if not item:
        raise HTTPException(status_code=404, detail=ITEM_NOT_FOUND_MSG)

    data = _item_to_dict(item)
    set_cached_vault_item(user_id, item_key, data)
    return data


# Create — enforces per-user cap, invalidates list cache, primes item cache

@router.post("", response_model=VaultItemResponse, status_code=201,
    responses={
        400: {"description": f"Vault item limit of {VAULT_ITEM_LIMIT} reached"},
    },
)
def create_item(
    body: VaultItemCreate,
    db: Annotated[Session, Depends(get_db)],
    current_user: DBUser,
):
    user_id = str(current_user.id)

    # Enforce per-user vault item limit to prevent DB storage abuse
    count = (
        db.query(func.count(VaultItem.id))
        .filter(VaultItem.user_id == current_user.id, VaultItem.is_deleted.is_(False))
        .scalar()
    )
    if count >= VAULT_ITEM_LIMIT:
        raise HTTPException(
            status_code=400,
            detail=f"Vault item limit of {VAULT_ITEM_LIMIT} reached",
        )

    item = VaultItem(
        user_id=current_user.id,
        name=body.name,
        category=body.category,
        encrypted_data=body.encrypted_data,
        favicon_url=body.favicon_url,
        is_favourite=body.is_favourite,
    )
    db.add(item)
    db.commit()
    db.refresh(item)  # ensures created_at / updated_at reflect DB-generated values

    invalidate_vault_list(user_id)
    logger.debug(f"vault:list cache busted (create) user={user_id}")

    data = _item_to_dict(item)
    set_cached_vault_item(user_id, str(item.id), data)
    return data


# Update — invalidates item + list cache, re-primes item cache

@router.patch(
    "/{item_id}",
    response_model=VaultItemResponse,
    responses={404: {"description": ITEM_NOT_FOUND_MSG}},
)
def update_item(
    item_id: UUID,
    body: VaultItemUpdate,
    db: Annotated[Session, Depends(get_db)],
    current_user: DBUser,
):
    user_id = str(current_user.id)
    item_key = str(item_id)

    item = (
        db.query(VaultItem)
        .filter(VaultItem.id == item_id, VaultItem.user_id == current_user.id)
        .first()
    )
    if not item:
        raise HTTPException(status_code=404, detail=ITEM_NOT_FOUND_MSG)

    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(item, field, value)
    db.commit()
    db.refresh(item)  # ensures updated_at reflects the DB-generated timestamp

    invalidate_vault_item(user_id, item_key)
    invalidate_vault_list(user_id)
    logger.debug(f"vault cache busted (update) user={user_id} item={item_key}")

    data = _item_to_dict(item)
    set_cached_vault_item(user_id, item_key, data)
    return data


# Delete — invalidates item + list cache

@router.delete(
    "/{item_id}",
    status_code=204,
    responses={404: {"description": ITEM_NOT_FOUND_MSG}},
)
def delete_item(
    item_id: UUID,
    db: Annotated[Session, Depends(get_db)],
    current_user: DBUser,
):
    user_id = str(current_user.id)
    item_key = str(item_id)

    item = (
        db.query(VaultItem)
        .filter(VaultItem.id == item_id, VaultItem.user_id == current_user.id)
        .first()
    )
    if not item:
        raise HTTPException(status_code=404, detail=ITEM_NOT_FOUND_MSG)

    item.is_deleted = True
    item.deleted_at = datetime.now(timezone.utc)
    db.commit()

    invalidate_vault_item(user_id, item_key)
    invalidate_vault_list(user_id)
    logger.debug(f"vault cache busted (soft delete) user={user_id} item={item_key}")


@router.post(
    "/{item_id}/restore",
    response_model=VaultItemResponse,
    responses={404: {"description": ITEM_NOT_FOUND_MSG}},
)
def restore_item(
    item_id: UUID,
    db: Annotated[Session, Depends(get_db)],
    current_user: DBUser,
):
    user_id = str(current_user.id)
    item_key = str(item_id)

    item = (
        db.query(VaultItem)
        .filter(VaultItem.id == item_id, VaultItem.user_id == current_user.id)
        .first()
    )
    if not item:
        raise HTTPException(status_code=404, detail=ITEM_NOT_FOUND_MSG)

    item.is_deleted = False
    item.deleted_at = None
    db.commit()
    db.refresh(item)

    invalidate_vault_item(user_id, item_key)
    invalidate_vault_list(user_id)
    data = _item_to_dict(item)
    set_cached_vault_item(user_id, item_key, data)
    return data


@router.delete(
    "/{item_id}/permanent",
    status_code=204,
    responses={404: {"description": ITEM_NOT_FOUND_MSG}},
)
def delete_item_permanently(
    item_id: UUID,
    db: Annotated[Session, Depends(get_db)],
    current_user: DBUser,
):
    user_id = str(current_user.id)
    item_key = str(item_id)

    item = (
        db.query(VaultItem)
        .filter(VaultItem.id == item_id, VaultItem.user_id == current_user.id)
        .first()
    )
    if not item:
        raise HTTPException(status_code=404, detail=ITEM_NOT_FOUND_MSG)

    db.delete(item)
    db.commit()

    invalidate_vault_item(user_id, item_key)
    invalidate_vault_list(user_id)
