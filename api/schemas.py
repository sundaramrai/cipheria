from pydantic import BaseModel, EmailStr, Field, field_validator
from typing import Optional, List
from datetime import datetime
from uuid import UUID


def _validate_favicon_url(v: Optional[str]) -> Optional[str]:
    if v is not None:
        if not (v.startswith('https://') or v.startswith('http://')):
            raise ValueError('favicon_url must be a valid HTTP/S URL')
    return v


# Auth

class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=8, max_length=128)
    full_name: Optional[str] = Field(None, max_length=128)
    master_hint: Optional[str] = Field(None, max_length=256)

    @field_validator('master_hint')
    @classmethod
    def hint_must_not_be_password(cls, v: Optional[str], info) -> Optional[str]:
        if v and info.data.get('password') and v == info.data['password']:
            raise ValueError('Master hint must not be the same as your password')
        return v


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    vault_salt: str


class UserResponse(BaseModel):
    id: UUID
    email: str
    full_name: Optional[str] = None
    vault_salt: str
    master_hint: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


# Vault Items

class VaultItemCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    category: str = Field(default="login", pattern="^(login|card|note|identity)$")
    encrypted_data: str = Field(..., min_length=1, max_length=100_000)
    favicon_url: Optional[str] = Field(None, max_length=512)
    is_favourite: bool = False

    @field_validator('favicon_url')
    @classmethod
    def validate_favicon_url(cls, v: Optional[str]) -> Optional[str]:
        return _validate_favicon_url(v)


class VaultItemUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    category: Optional[str] = Field(None, pattern="^(login|card|note|identity)$")
    encrypted_data: Optional[str] = Field(None, min_length=1, max_length=100_000)
    favicon_url: Optional[str] = Field(None, max_length=512)
    is_favourite: Optional[bool] = None

    @field_validator('favicon_url')
    @classmethod
    def validate_favicon_url(cls, v: Optional[str]) -> Optional[str]:
        return _validate_favicon_url(v)


class VaultItemSummary(BaseModel):
    """Metadata-only response — no encrypted_data. Used by the list endpoint."""
    id: UUID
    name: str
    category: str
    favicon_url: Optional[str] = None
    is_favourite: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class VaultItemResponse(BaseModel):
    """Full response including encrypted_data. Used by create, update and detail endpoints."""
    id: UUID
    name: str
    category: str
    encrypted_data: str
    favicon_url: Optional[str] = None
    is_favourite: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class PaginatedVaultResponse(BaseModel):
    """Paginated wrapper for vault list endpoint."""
    items: List[VaultItemSummary]
    total: int
    page: int
    page_size: int
    total_pages: int