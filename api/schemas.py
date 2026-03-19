from pydantic import BaseModel, EmailStr, Field, field_validator
from typing import Optional, List
from datetime import datetime
from uuid import UUID

HEX_64_REGEX = "^[0-9a-fA-F]{64}$"


def _validate_favicon_url(v: Optional[str]) -> Optional[str]:
    if v is not None and not v.startswith("https://"):
        raise ValueError("favicon_url must be a valid HTTPS URL")
    return v


# Auth

class RegisterRequest(BaseModel):
    email: EmailStr
    vault_salt: str = Field(..., min_length=64, max_length=64, pattern=HEX_64_REGEX)
    master_password_verifier: str = Field(..., min_length=64, max_length=64, pattern=HEX_64_REGEX)
    full_name: Optional[str] = Field(None, max_length=128)
    master_hint: Optional[str] = Field(None, max_length=256)


class LoginChallengeRequest(BaseModel):
    email: EmailStr


class LoginChallengeResponse(BaseModel):
    vault_salt: str


class LoginRequest(BaseModel):
    email: EmailStr
    master_password_verifier: str = Field(..., min_length=64, max_length=64, pattern=HEX_64_REGEX)


class MessageResponse(BaseModel):
    message: str


class UserResponse(BaseModel):
    id: UUID
    email: str
    full_name: Optional[str] = None
    vault_salt: str
    master_hint: Optional[str] = None
    email_verified: bool = False
    created_at: datetime

    class Config:
        from_attributes = True


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    vault_salt: str
    user: UserResponse


class VerifyEmailRequest(BaseModel):
    token: str = Field(..., min_length=16, max_length=512)


class UpdateProfileRequest(BaseModel):
    full_name: Optional[str] = Field(None, max_length=128)
    master_hint: Optional[str] = Field(None, max_length=256)


class MasterPasswordItemUpdate(BaseModel):
    id: UUID
    encrypted_data: str = Field(..., min_length=1, max_length=100_000)


class ChangeMasterPasswordRequest(BaseModel):
    new_vault_salt: str = Field(..., min_length=64, max_length=64, pattern=HEX_64_REGEX)
    new_master_password_verifier: str = Field(..., min_length=64, max_length=64, pattern=HEX_64_REGEX)
    master_hint: Optional[str] = Field(None, max_length=256)
    items: List[MasterPasswordItemUpdate]


class DeleteAccountRequest(BaseModel):
    master_password_verifier: str = Field(..., min_length=64, max_length=64, pattern=HEX_64_REGEX)


class VerifyMasterPasswordRequest(BaseModel):
    master_password_verifier: str = Field(..., min_length=64, max_length=64, pattern=HEX_64_REGEX)


# Vault Items

class VaultItemCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    category: str = Field(default="login", pattern="^(login|card|note|identity)$")
    encrypted_data: str = Field(..., min_length=1, max_length=100_000)
    favicon_url: Optional[str] = Field(None, max_length=512)
    is_favourite: bool = False

    @field_validator("favicon_url")
    @classmethod
    def validate_favicon_url(cls, v: Optional[str]) -> Optional[str]:
        return _validate_favicon_url(v)


class VaultItemUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    category: Optional[str] = Field(None, pattern="^(login|card|note|identity)$")
    encrypted_data: Optional[str] = Field(None, min_length=1, max_length=100_000)
    favicon_url: Optional[str] = Field(None, max_length=512)
    is_favourite: Optional[bool] = None

    @field_validator("favicon_url")
    @classmethod
    def validate_favicon_url(cls, v: Optional[str]) -> Optional[str]:
        return _validate_favicon_url(v)


class VaultItemSummary(BaseModel):
    # Metadata only — no encrypted_data, used by list endpoint
    id: UUID
    name: str
    category: str
    favicon_url: Optional[str] = None
    is_favourite: bool
    is_deleted: bool = False
    deleted_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class VaultItemResponse(BaseModel):
    # Full response including encrypted_data, used by create/update/detail
    id: UUID
    name: str
    category: str
    encrypted_data: str
    favicon_url: Optional[str] = None
    is_favourite: bool
    is_deleted: bool = False
    deleted_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class VaultSidebarCountsResponse(BaseModel):
    all: int
    login: int
    card: int
    note: int
    identity: int
    favourites: int
    trash: int


class PaginatedVaultResponse(BaseModel):
    items: List[VaultItemSummary]
    total: int
    page: int
    page_size: int
    total_pages: int
    sidebar_counts: Optional[VaultSidebarCountsResponse] = None


class UnlockedVaultResponse(BaseModel):
    items: List[VaultItemResponse]
    total: int
    page: int
    page_size: int
    total_pages: int
    sidebar_counts: VaultSidebarCountsResponse
