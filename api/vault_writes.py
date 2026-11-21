"""Serialize account writes with key changes and validate item preconditions."""

import base64
import re

from fastapi import HTTPException
from sqlalchemy.orm import Session

from database import User, VaultItem


def validate_ciphertext(user: User, item_id, ciphertext: str) -> None:
    if user.key_envelope:
        validate_v2_ciphertext(item_id, ciphertext)
    elif ciphertext.startswith("v2."):
        raise HTTPException(status_code=409, detail="Upgrade this vault before saving version 2 ciphertext")


def validate_v2_ciphertext(item_id, ciphertext: str) -> None:
    try:
        if not item_id or not re.fullmatch(r"v2\.[A-Za-z0-9+/]{16}\.[A-Za-z0-9+/]+={0,2}", ciphertext):
            raise ValueError("Invalid ciphertext envelope")
        if len(base64.b64decode(ciphertext.split(".")[2], validate=True)) < 16:
            raise ValueError("Missing authentication tag")
    except ValueError:
        raise HTTPException(status_code=422, detail="Version 2 ciphertext and an item ID are required")


def item_etag(item_id, revision: int) -> str:
    return f'"{item_id}:{revision}"'


def lock_vault(db: Session, user_id, vault_salt: str | None) -> User:
    user = db.query(User).filter(
        User.id == user_id, User.is_active.is_(True),
    ).populate_existing().with_for_update().first()
    if not user:
        raise HTTPException(status_code=401, detail="Account unavailable")
    if not vault_salt:
        raise HTTPException(status_code=428, detail="Reload Cipheria before saving; the vault key precondition is required")
    if vault_salt != user.vault_salt:
        raise HTTPException(status_code=409, detail="Vault password changed. Lock and unlock with the current password.")
    return user


def lock_item(db: Session, user_id, item_id, if_match: str | None) -> VaultItem:
    # The caller already holds the account row lock. All item writers, imports
    # and key changes acquire it in the same order and keep it through commit.
    item = db.query(VaultItem).filter(
        VaultItem.id == item_id, VaultItem.user_id == user_id,
    ).populate_existing().with_for_update().first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    if not if_match or if_match.strip() == "*":
        raise HTTPException(status_code=428, detail="Reload this item before saving; its revision is required")
    # A list is legal If-Match syntax. Weak validators never match.
    if item_etag(item.id, item.revision) not in [tag.strip() for tag in if_match.split(",")]:
        raise HTTPException(status_code=412, detail="This item changed elsewhere. Your changes have not been saved.")
    return item
