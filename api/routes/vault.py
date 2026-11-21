"""
Vault CRUD with Redis caching.
"""

import hashlib
import logging
from datetime import UTC, datetime
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response
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
from database import User, VaultImport, VaultItem, get_db
from deps import CurrentSubject, DBUser
from limiter import limiter
from schemas import (
    PaginatedVaultResponse,
    VaultImportRequest,
    VaultImportResponse,
    VaultItemCreate,
    VaultItemResponse,
    VaultItemSummary,
    VaultItemUpdate,
)
from vault_counts import get_cached_sidebar_counts_for_user
from vault_writes import item_etag, lock_item, lock_vault, validate_ciphertext

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/vault", tags=["vault"])

ITEM_NOT_FOUND_MSG = "Item not found"
MAX_PAGE_SIZE = 100
VAULT_ITEM_LIMIT = 1000
MAX_IMPORT_BYTES = 3 * 1024 * 1024


@router.post("/import/json", response_model=VaultImportResponse, max_body_size=MAX_IMPORT_BYTES)
@limiter.limit("5/minute")
def import_vault(
    body: VaultImportRequest,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    current_user: DBUser,
):
    # The same row lock is used by password changes and capacity-increasing writes.
    # Refresh the identity-map instance after waiting for a concurrent transaction.
    user = db.query(User).filter(
        User.id == current_user.id, User.is_active.is_(True),
    ).populate_existing().with_for_update().first()
    if not user:
        raise HTTPException(status_code=401, detail="Account unavailable")
    payload_hash = hashlib.sha256(body.model_dump_json(exclude_none=True).encode()).hexdigest()
    receipt = db.get(VaultImport, (user.id, body.operation_id))
    if receipt:
        if receipt.payload_hash != payload_hash:
            raise HTTPException(status_code=409, detail="Import retry differs from the original request")
        # Also repair list invalidation if the original response was interrupted after commit.
        invalidate_vault_list(str(user.id))
        return VaultImportResponse(imported_count=receipt.imported_count)
    if user.vault_salt != body.destination_salt:
        raise HTTPException(status_code=409, detail="Vault password changed. Unlock and prepare the import again.")
    ids = [item.id for item in body.items if item.id]
    if len(ids) != len(set(ids)) or (ids and db.query(VaultItem.id).filter(VaultItem.id.in_(ids)).first()):
        raise HTTPException(status_code=409, detail="Import item identifiers already exist")
    for item in body.items:
        validate_ciphertext(user, item.id, item.encrypted_data)
    count = db.query(func.count(VaultItem.id)).filter(
        VaultItem.user_id == user.id, VaultItem.is_deleted.is_(False),
    ).scalar() or 0
    if count + len(body.items) > VAULT_ITEM_LIMIT:
        raise HTTPException(status_code=400, detail="Import would exceed the 1000 active item limit")
    try:
        db.add_all([VaultItem(user_id=user.id, **item.model_dump()) for item in body.items])
        db.add(VaultImport(
            user_id=user.id, operation_id=body.operation_id,
            payload_hash=payload_hash, imported_count=len(body.items),
        ))
        log_action(db, user.id, "VAULT_IMPORT", request)
        db.commit()
    except Exception:
        db.rollback()
        raise
    invalidate_vault_list(str(user.id))
    return VaultImportResponse(imported_count=len(body.items))


@router.get("/export/json")
@limiter.limit("3/minute")
def export_vault(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    current_user: DBUser,
    include_deleted: Annotated[bool, Query()] = False,
):
    current_user = db.query(User).filter(User.id == current_user.id).populate_existing().with_for_update().one()
    filters = [VaultItem.user_id == current_user.id]
    if not include_deleted:
        filters.append(VaultItem.is_deleted.is_(False))
    items = db.query(VaultItem).filter(*filters).all()

    log_action(db, current_user.id, "VAULT_EXPORT", request)
    db.commit()

    logger.info("VAULT_EXPORT user=%s items=%s", current_user.id, len(items))
    return {
        "export_version": "2.0" if current_user.key_envelope else "1.0",
        "key_envelope": current_user.key_envelope,
        "user_email": current_user.email,
        "vault_salt": current_user.vault_salt,
        "items": [
            {
                "id": str(item.id),
                "revision": item.revision,
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
            VaultItem.revision,
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
    response: Response,
    fresh: Annotated[bool, Query()] = False,
):
    user_id = str(current_user.id)
    item_key = str(item_id)

    cached = None if fresh else get_cached_vault_item(user_id, item_key)
    if cached is not None:
        response.headers["ETag"] = item_etag(item_id, cached["revision"])
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
    response.headers["ETag"] = item_etag(item.id, item.revision)
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
    response: Response,
    vault_salt: Annotated[str | None, Header(alias="X-Vault-Salt")] = None,
):
    owner = lock_vault(db, current_user.id, vault_salt)
    validate_ciphertext(owner, body.id, body.encrypted_data)
    if body.id and db.get(VaultItem, body.id):
        raise HTTPException(status_code=409, detail="Item identifier already exists")
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
        **({"id": body.id} if body.id else {}),
        user_id=current_user.id,
        name=body.name,
        category=body.category,
        encrypted_data=body.encrypted_data,
        is_favourite=body.is_favourite,
    )
    db.add(item)
    db.flush()
    db.refresh(item)
    data = VaultItemResponse.model_validate(item).model_dump(mode="json")
    db.commit()
    response.headers["ETag"] = item_etag(data["id"], data["revision"])

    invalidate_vault_list(user_id)
    logger.debug("vault:list cache busted (create) user=%s", user_id)

    set_cached_vault_item(user_id, data["id"], data)
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
    response: Response,
    if_match: Annotated[str | None, Header()] = None,
    vault_salt: Annotated[str | None, Header(alias="X-Vault-Salt")] = None,
):
    owner = lock_vault(db, current_user.id, vault_salt)
    user_id = str(current_user.id)
    item_key = str(item_id)

    item = lock_item(db, current_user.id, item_id, if_match)
    updates = body.model_dump(exclude_unset=True)
    if updates.get("encrypted_data"):
        validate_ciphertext(owner, item.id, updates["encrypted_data"])
    if any(value is None for value in updates.values()):
        raise HTTPException(status_code=422, detail="Item fields cannot be null")
    if item.is_deleted:
        raise HTTPException(status_code=409, detail="Restore this item before editing it")
    if set(updates) == {"is_favourite"}:
        # Explicitly preserve the content timestamp instead of running onupdate.
        db.query(VaultItem).filter(VaultItem.id == item.id).update(
            {VaultItem.is_favourite: updates["is_favourite"], VaultItem.updated_at: VaultItem.updated_at,
             VaultItem.revision: item.revision + 1},
            synchronize_session=False,
        )
    else:
        for field, value in updates.items():
            setattr(item, field, value)
        item.revision += 1
    db.flush()
    db.refresh(item)
    # Snapshot while the lock is held. Refreshing after commit can attach a
    # later writer's revision to the caller's locally decrypted draft.
    data = VaultItemResponse.model_validate(item).model_dump(mode="json")
    db.commit()
    response.headers["ETag"] = item_etag(data["id"], data["revision"])

    invalidate_vault_item(user_id, item_key)
    invalidate_vault_list(user_id)
    logger.debug("vault cache busted (update) user=%s item=%s", user_id, item_key)

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
    if_match: Annotated[str | None, Header()] = None,
    vault_salt: Annotated[str | None, Header(alias="X-Vault-Salt")] = None,
):
    lock_vault(db, current_user.id, vault_salt)
    user_id = str(current_user.id)
    item_key = str(item_id)

    item = lock_item(db, current_user.id, item_id, if_match)
    item.is_deleted = True
    item.revision += 1
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
    response: Response,
    if_match: Annotated[str | None, Header()] = None,
    vault_salt: Annotated[str | None, Header(alias="X-Vault-Salt")] = None,
):
    lock_vault(db, current_user.id, vault_salt)
    user_id = str(current_user.id)
    item_key = str(item_id)

    item = lock_item(db, current_user.id, item_id, if_match)
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
    item.revision += 1
    item.deleted_at = None
    db.flush()
    db.refresh(item)
    data = VaultItemResponse.model_validate(item).model_dump(mode="json")
    db.commit()
    response.headers["ETag"] = item_etag(data["id"], data["revision"])

    invalidate_vault_item(user_id, item_key)
    invalidate_vault_list(user_id)
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
    if_match: Annotated[str | None, Header()] = None,
    vault_salt: Annotated[str | None, Header(alias="X-Vault-Salt")] = None,
):
    lock_vault(db, current_user.id, vault_salt)
    user_id = str(current_user.id)
    item_key = str(item_id)

    item = lock_item(db, current_user.id, item_id, if_match)
    if not item.is_deleted:
        raise HTTPException(status_code=409, detail="Move this item to trash before deleting it permanently")
    db.delete(item)
    db.commit()

    invalidate_vault_item(user_id, item_key)
    invalidate_vault_list(user_id)
