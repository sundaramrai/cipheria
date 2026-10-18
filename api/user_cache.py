from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel


class CachedUser(BaseModel):
    id: UUID
    email: str
    full_name: str | None = None
    is_active: bool = True
    email_verified: bool = False
    master_hint: str | None = None
    vault_salt: str
    created_at: datetime | None = None


def serialize_cached_user(user: Any) -> dict[str, Any]:
    return {
        "id": str(user.id),
        "email": user.email,
        "full_name": user.full_name,
        "is_active": user.is_active,
        "email_verified": user.email_verified,
        "master_hint": user.master_hint,
        "vault_salt": user.vault_salt,
        "created_at": user.created_at.isoformat() if user.created_at else None,
    }


def deserialize_cached_user(user_id: UUID, cached: dict[str, Any]) -> CachedUser:
    created_at = cached.get("created_at")
    return CachedUser(
        id=user_id,
        email=cached.get("email", ""),
        full_name=cached.get("full_name"),
        is_active=cached.get("is_active", True),
        email_verified=cached.get("email_verified", False),
        master_hint=cached.get("master_hint"),
        vault_salt=cached.get("vault_salt", ""),
        created_at=datetime.fromisoformat(created_at) if created_at else None,
    )
