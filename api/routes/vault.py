"""
routes/vault.py — Vault CRUD with Redis caching layer.

Cache flow:
  GET  /vault        → check Redis → HIT: return instantly / MISS: query DB → write cache
  GET  /vault/{id}   → check Redis → HIT: return instantly / MISS: query DB → write cache
  POST /vault        → insert DB → invalidate list cache
  PATCH /vault/{id}  → update DB → invalidate item + list cache
  DELETE /vault/{id} → delete DB → invalidate item + list cache
  GET  /vault/export → always DB (no cache — full export is rare + large)

Latency improvement:
  Before: every request → Neon TCP roundtrip ~80-150 ms
  After:  cache HIT     → Upstash Redis ~1-5 ms  (95%+ of list/get requests)
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import Annotated, Optional
from uuid import UUID
import logging

from database import get_db, VaultItem
from schemas import (
    VaultItemCreate,
    VaultItemUpdate,
    VaultItemResponse,
    VaultItemSummary,
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
    invalidate_all_vault,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/vault", tags=["vault"])

ITEM_NOT_FOUND_MSG = "Item not found"
MAX_PAGE_SIZE = 100


# Serialisation helpers


def _item_to_dict(item) -> dict:
    """Convert a VaultItem ORM row (or named-tuple from column-query) to a plain dict."""
    return {
        "id": str(item.id),
        "name": item.name,
        "category": item.category,
        "encrypted_data": item.encrypted_data,
        "favicon_url": item.favicon_url,
        "is_favourite": item.is_favourite,
        "created_at": item.created_at.isoformat() if item.created_at else None,
        "updated_at": item.updated_at.isoformat() if item.updated_at else None,
    }


# Export (no cache — rare, large, full fidelity required)


@router.get("/export/json")
def export_vault(
    db: Annotated[Session, Depends(get_db)],
    current_user: DBUser,
):
    items = db.query(VaultItem).filter(VaultItem.user_id == current_user.id).all()
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


# List vault items — cached, paginated
@router.get("", response_model=PaginatedVaultResponse)
def list_items(
    db: Annotated[Session, Depends(get_db)],
    current_user: CurrentUser,
    category: Annotated[Optional[str], Query()] = None,
    search: Annotated[Optional[str], Query(max_length=128)] = None,
    favourites_only: Annotated[bool, Query()] = False,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=MAX_PAGE_SIZE)] = 50,
):
    user_id = str(current_user.id)

    # Cache HIT
    # Skip search queries from cache (dynamic, low repetition → not worth caching)
    if not search:
        cached = get_cached_vault_list(
            user_id, category, search, favourites_only, page, page_size
        )
        if cached is not None:
            logger.debug(f"vault:list cache HIT  user={user_id}")
            return cached

    # Cache MISS → query DB
    logger.debug(f"vault:list cache MISS user={user_id}")

    q = db.query(
        VaultItem.id,
        VaultItem.name,
        VaultItem.category,
        VaultItem.encrypted_data,
        VaultItem.favicon_url,
        VaultItem.is_favourite,
        VaultItem.created_at,
        VaultItem.updated_at,
    ).filter(VaultItem.user_id == current_user.id)

    if category:
        q = q.filter(VaultItem.category == category)
    if search:
        q = q.filter(VaultItem.name.ilike(f"%{search}%"))
    if favourites_only:
        q = q.filter(VaultItem.is_favourite.is_(True))

    total = q.count()
    rows = (
        q.order_by(VaultItem.updated_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    items_data = [_item_to_dict(r) for r in rows]

    result = {
        "items": items_data,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": -(-total // page_size),
    }

    # Only cache non-search results (search results change unpredictably)
    if not search:
        set_cached_vault_list(
            user_id, category, search, favourites_only, page, page_size, result
        )

    return result


# Get single vault item — cached


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

    # Cache HIT
    cached = get_cached_vault_item(user_id, item_key)
    if cached is not None:
        logger.debug(f"vault:item cache HIT  user={user_id} item={item_key}")
        return cached

    # Cache MISS → DB
    logger.debug(f"vault:item cache MISS user={user_id} item={item_key}")
    item = (
        db.query(VaultItem)
        .filter(
            VaultItem.id == item_id,
            VaultItem.user_id == current_user.id,
        )
        .first()
    )
    if not item:
        raise HTTPException(status_code=404, detail=ITEM_NOT_FOUND_MSG)

    data = _item_to_dict(item)
    set_cached_vault_item(user_id, item_key, data)
    return data


# Create vault item — invalidates list cache


@router.post("", response_model=VaultItemResponse, status_code=201)
def create_item(
    body: VaultItemCreate,
    db: Annotated[Session, Depends(get_db)],
    current_user: CurrentUser,
):
    user_id = str(current_user.id)

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

    # New item → all list pages are stale
    invalidate_vault_list(user_id)
    logger.debug(f"vault:list cache BUSTED (create) user={user_id}")

    data = _item_to_dict(item)
    # Pre-warm item cache so the next GET /{id} is a cache hit
    set_cached_vault_item(user_id, str(item.id), data)

    return data


# Update vault item — invalidates item + list cache


@router.patch(
    "/{item_id}",
    response_model=VaultItemResponse,
    responses={404: {"description": ITEM_NOT_FOUND_MSG}},
)
def update_item(
    item_id: UUID,
    body: VaultItemUpdate,
    db: Annotated[Session, Depends(get_db)],
    current_user: CurrentUser,
):
    user_id = str(current_user.id)
    item_key = str(item_id)

    item = (
        db.query(VaultItem)
        .filter(
            VaultItem.id == item_id,
            VaultItem.user_id == current_user.id,
        )
        .first()
    )
    if not item:
        raise HTTPException(status_code=404, detail=ITEM_NOT_FOUND_MSG)

    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(item, field, value)
    db.commit()

    # Bust stale caches immediately
    invalidate_vault_item(user_id, item_key)
    invalidate_vault_list(user_id)
    logger.debug(f"vault cache BUSTED (update) user={user_id} item={item_key}")

    data = _item_to_dict(item)
    # Re-warm item cache with fresh data
    set_cached_vault_item(user_id, item_key, data)

    return data


# Delete vault item — invalidates item + list cache


@router.delete(
    "/{item_id}", status_code=204, responses={404: {"description": ITEM_NOT_FOUND_MSG}}
)
def delete_item(
    item_id: UUID,
    db: Annotated[Session, Depends(get_db)],
    current_user: CurrentUser,
):
    user_id = str(current_user.id)
    item_key = str(item_id)

    item = (
        db.query(VaultItem)
        .filter(
            VaultItem.id == item_id,
            VaultItem.user_id == current_user.id,
        )
        .first()
    )
    if not item:
        raise HTTPException(status_code=404, detail=ITEM_NOT_FOUND_MSG)

    db.delete(item)
    db.commit()

    invalidate_vault_item(user_id, item_key)
    invalidate_vault_list(user_id)
    logger.debug(f"vault cache BUSTED (delete) user={user_id} item={item_key}")
