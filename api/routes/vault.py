"""
Vault CRUD with Redis caching.
"""

import logging
from datetime import UTC, datetime
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import func
from sqlalchemy.orm import Session

from audit import log_action
from cache import (
    get_cached_vault_item,
    get_cached_vault_list,
    invalidate_vault_item,
    invalidate_vault_list,
    set_cached_vault_item,
    set_cached_vault_list,
)
from database import VaultItem, get_db
from deps import CurrentSubject, DBUser
from limiter import limiter
from schemas import (
    PaginatedVaultResponse,
    VaultItemCreate,
    VaultItemResponse,
    VaultItemSummary,
    VaultItemUpdate,
)
from vault_counts import get_cached_sidebar_counts_for_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/vault", tags=["vault"])

ITEM_NOT_FOUND_MSG = "Item not found"
MAX_PAGE_SIZE = 100
VAULT_ITEM_LIMIT = 1000


@router.get("/export/json")
@limiter.limit("3/minute")
def export_vault(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    current_user: DBUser,
    include_deleted: Annotated[bool, Query()] = False,
):
    filters = [VaultItem.user_id == current_user.id]
    if not include_deleted:
        filters.append(VaultItem.is_deleted.is_(False))
    items = db.query(VaultItem).filter(*filters).all()

    log_action(db, current_user.id, "VAULT_EXPORT", request)
    db.commit()

    logger.info("VAULT_EXPORT user=%s items=%s", current_user.id, len(items))
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
                "is_favourite": item.is_favourite,
                "created_at": item.created_at.isoformat(),
            }
            for item in items
        ],
    }


@router.get("", response_model=PaginatedVaultResponse)
def list_items(
    db: Annotated[Session, Depends(get_db)],
    current_user: CurrentSubject,
    category: Annotated[Literal["login", "card", "note", "identity"] | None, Query()] = None,
    search: Annotated[str | None, Query(max_length=128)] = None,
    favourites_only: Annotated[bool, Query()] = False,
    deleted_only: Annotated[bool, Query()] = False,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=MAX_PAGE_SIZE)] = 50,
    include_encrypted_data: Annotated[bool, Query()] = False,
):
    user_id = str(current_user.id)
    clean_search = search or None
    cacheable = not (clean_search or include_encrypted_data)

    cached = None
    if cacheable:
        cached = get_cached_vault_list(
            user_id, category, clean_search, favourites_only, deleted_only, page, page_size
        )
    if cached is not None:
        logger.debug("vault:list cache HIT user=%s", user_id)
        return cached

    logger.debug("vault:list cache MISS user=%s", user_id)

    filters = [
        VaultItem.user_id == current_user.id,
        VaultItem.is_deleted.is_(deleted_only),
    ]
    if category:
        filters.append(VaultItem.category == category)
    if clean_search:
        filters.append(VaultItem.name.icontains(clean_search, autoescape=True))
    if favourites_only:
        filters.append(VaultItem.is_favourite.is_(True))

    rows = (
        db.query(
            VaultItem.id,
            VaultItem.name,
            VaultItem.category,
            VaultItem.is_favourite,
            VaultItem.is_deleted,
            VaultItem.deleted_at,
            VaultItem.created_at,
            VaultItem.updated_at,
            func.count(VaultItem.id).over().label("total_count"),
            *([VaultItem.encrypted_data] if include_encrypted_data else []),
        )
        .filter(*filters)
        .order_by(VaultItem.updated_at.desc(), VaultItem.id.asc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )

    if rows:
        total = int(rows[0].total_count)
    elif page == 1:
        total = 0
    else:
        total = (
            db.query(func.count(VaultItem.id))
            .filter(*filters)
            .scalar()
        ) or 0

    item_model = VaultItemResponse if include_encrypted_data else VaultItemSummary
    result = {
        "items": [item_model.model_validate(row).model_dump(mode="json") for row in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": -(-total // page_size),
        "sidebar_counts": None if clean_search else get_cached_sidebar_counts_for_user(db, current_user.id),
    }

    if cacheable:
        set_cached_vault_list(
            user_id, category, clean_search, favourites_only, deleted_only, page, page_size, result
        )

    return result


@router.get(
    "/{item_id}",
    response_model=VaultItemResponse,
    responses={404: {"description": ITEM_NOT_FOUND_MSG}},
)
def get_item(
    item_id: UUID,
    db: Annotated[Session, Depends(get_db)],
    current_user: CurrentSubject,
):
    user_id = str(current_user.id)
    item_key = str(item_id)

    cached = get_cached_vault_item(user_id, item_key)
    if cached is not None:
        logger.debug("vault:item cache HIT user=%s item=%s", user_id, item_key)
        return cached

    logger.debug("vault:item cache MISS user=%s item=%s", user_id, item_key)
    item = (
        db.query(VaultItem)
        .filter(VaultItem.id == item_id, VaultItem.user_id == current_user.id)
        .first()
    )
    if not item:
        raise HTTPException(status_code=404, detail=ITEM_NOT_FOUND_MSG)

    data = VaultItemResponse.model_validate(item).model_dump(mode="json")
    set_cached_vault_item(user_id, item_key, data)
    return data


@router.post(
    "",
    response_model=VaultItemResponse,
    status_code=201,
    responses={400: {"description": f"Vault item limit of {VAULT_ITEM_LIMIT} reached"}},
)
def create_item(
    body: VaultItemCreate,
    db: Annotated[Session, Depends(get_db)],
    current_user: DBUser,
):
    user_id = str(current_user.id)
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
        is_favourite=body.is_favourite,
    )
    db.add(item)
    db.commit()
    db.refresh(item)

    invalidate_vault_list(user_id)
    logger.debug("vault:list cache busted (create) user=%s", user_id)

    data = VaultItemResponse.model_validate(item).model_dump(mode="json")
    set_cached_vault_item(user_id, str(item.id), data)
    return data


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

    updates = body.model_dump(exclude_unset=True)
    if set(updates) == {"is_favourite"}:
        # Explicitly preserve the content timestamp instead of running onupdate.
        db.query(VaultItem).filter(VaultItem.id == item.id).update(
            {VaultItem.is_favourite: updates["is_favourite"], VaultItem.updated_at: VaultItem.updated_at},
            synchronize_session=False,
        )
    else:
        for field, value in updates.items():
            setattr(item, field, value)
    db.commit()
    db.refresh(item)

    invalidate_vault_item(user_id, item_key)
    invalidate_vault_list(user_id)
    logger.debug("vault cache busted (update) user=%s item=%s", user_id, item_key)

    data = VaultItemResponse.model_validate(item).model_dump(mode="json")
    set_cached_vault_item(user_id, item_key, data)
    return data


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
    item.deleted_at = datetime.now(UTC)
    db.commit()

    invalidate_vault_item(user_id, item_key)
    invalidate_vault_list(user_id)
    logger.debug("vault cache busted (soft delete) user=%s item=%s", user_id, item_key)


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

    if item.is_deleted:
        active_count = (
            db.query(func.count(VaultItem.id))
            .filter(VaultItem.user_id == current_user.id, VaultItem.is_deleted.is_(False))
            .scalar()
        )
        if active_count >= VAULT_ITEM_LIMIT:
            raise HTTPException(
                status_code=400,
                detail=f"Vault item limit of {VAULT_ITEM_LIMIT} reached",
            )

    item.is_deleted = False
    item.deleted_at = None
    db.commit()
    db.refresh(item)

    invalidate_vault_item(user_id, item_key)
    invalidate_vault_list(user_id)
    data = VaultItemResponse.model_validate(item).model_dump(mode="json")
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
