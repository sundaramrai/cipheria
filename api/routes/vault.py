from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import Annotated, Optional
from uuid import UUID

from database import get_db, VaultItem
from schemas import VaultItemCreate, VaultItemUpdate, VaultItemResponse, VaultItemSummary, PaginatedVaultResponse
from deps import CurrentUser, DBUser

router = APIRouter(prefix="/vault", tags=["vault"])

ITEM_NOT_FOUND_MSG = "Item not found"
MAX_PAGE_SIZE = 100


# export encrypted vault data
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


# list vault items — metadata only, paginated
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
    q = db.query(
        VaultItem.id,
        VaultItem.name,
        VaultItem.category,
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
    items = q.order_by(VaultItem.updated_at.desc()).offset((page - 1) * page_size).limit(page_size).all()

    return PaginatedVaultResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=-(-total // page_size),  # ceiling division
    )


# get single vault item with encrypted_data
@router.get("/{item_id}", response_model=VaultItemResponse, responses={404: {"description": ITEM_NOT_FOUND_MSG}})
def get_item(
    item_id: UUID,
    db: Annotated[Session, Depends(get_db)],
    current_user: CurrentUser,
):
    item = db.query(VaultItem).filter(
        VaultItem.id == item_id,
        VaultItem.user_id == current_user.id,
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail=ITEM_NOT_FOUND_MSG)
    return item


# create vault item
@router.post("", response_model=VaultItemResponse, status_code=201)
def create_item(
    body: VaultItemCreate,
    db: Annotated[Session, Depends(get_db)],
    current_user: CurrentUser,
):
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
    return item


# update vault item
@router.patch("/{item_id}", response_model=VaultItemResponse, responses={404: {"description": ITEM_NOT_FOUND_MSG}})
def update_item(
    item_id: UUID,
    body: VaultItemUpdate,
    db: Annotated[Session, Depends(get_db)],
    current_user: CurrentUser,
):
    item = db.query(VaultItem).filter(
        VaultItem.id == item_id,
        VaultItem.user_id == current_user.id,
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail=ITEM_NOT_FOUND_MSG)

    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(item, field, value)

    db.commit()
    return item


# delete vault item
@router.delete("/{item_id}", status_code=204, responses={404: {"description": ITEM_NOT_FOUND_MSG}})
def delete_item(
    item_id: UUID,
    db: Annotated[Session, Depends(get_db)],
    current_user: CurrentUser,
):
    item = db.query(VaultItem).filter(
        VaultItem.id == item_id,
        VaultItem.user_id == current_user.id,
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail=ITEM_NOT_FOUND_MSG)

    db.delete(item)
    db.commit()