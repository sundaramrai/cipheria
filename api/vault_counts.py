from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from cache import get_cached_sidebar_counts, set_cached_sidebar_counts
from database import VaultItem


def compute_sidebar_counts(db: Session, user_id: Any) -> dict[str, int]:
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


def get_cached_sidebar_counts_for_user(db: Session, user_id: Any) -> dict[str, int]:
    cache_key = str(user_id)
    cached = get_cached_sidebar_counts(cache_key)
    if cached is not None:
        return cached

    counts = compute_sidebar_counts(db, user_id)
    set_cached_sidebar_counts(cache_key, counts)
    return counts
