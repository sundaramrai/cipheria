from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field

HEX_64_REGEX = "^[0-9a-fA-F]{64}$"


# Auth

class RegisterRequest(BaseModel):
    email: EmailStr
    vault_salt: str = Field(..., min_length=64, max_length=64, pattern=HEX_64_REGEX)
    master_password_verifier: str = Field(..., min_length=64, max_length=64, pattern=HEX_64_REGEX)
    full_name: str | None = Field(None, max_length=128)
    master_hint: str | None = Field(None, max_length=256)


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
    full_name: str | None = None
    vault_salt: str
    master_hint: str | None = None
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


class VerifyEmailResponse(BaseModel):
    message: str
    user: UserResponse


class UpdateProfileRequest(BaseModel):
    full_name: str | None = Field(None, max_length=128)
    master_hint: str | None = Field(None, max_length=256)


class MasterPasswordItemUpdate(BaseModel):
    id: UUID
    encrypted_data: str = Field(..., min_length=1, max_length=100_000)


class ChangeMasterPasswordRequest(BaseModel):
    current_master_password_verifier: str = Field(..., min_length=64, max_length=64, pattern=HEX_64_REGEX)
    new_vault_salt: str = Field(..., min_length=64, max_length=64, pattern=HEX_64_REGEX)
    new_master_password_verifier: str = Field(..., min_length=64, max_length=64, pattern=HEX_64_REGEX)
    master_hint: str | None = Field(None, max_length=256)
    items: list[MasterPasswordItemUpdate]


class DeleteAccountRequest(BaseModel):
    master_password_verifier: str = Field(..., min_length=64, max_length=64, pattern=HEX_64_REGEX)


class VerifyMasterPasswordRequest(BaseModel):
    master_password_verifier: str = Field(..., min_length=64, max_length=64, pattern=HEX_64_REGEX)


# Vault Items

class VaultItemCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    category: str = Field(default="login", pattern="^(login|card|note|identity)$")
    encrypted_data: str = Field(..., min_length=1, max_length=100_000)
    is_favourite: bool = False


class VaultItemUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=255)
    category: str | None = Field(None, pattern="^(login|card|note|identity)$")
    encrypted_data: str | None = Field(None, min_length=1, max_length=100_000)
    is_favourite: bool | None = None


class VaultItemSummary(BaseModel):
    # Metadata only — no encrypted_data, used by list endpoint
    id: UUID
    name: str
    category: str
    is_favourite: bool
    is_deleted: bool = False
    deleted_at: datetime | None = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class VaultItemResponse(VaultItemSummary):
    # Full response including encrypted_data, used by create/update/detail
    encrypted_data: str


class VaultSidebarCountsResponse(BaseModel):
    all: int
    login: int
    card: int
    note: int
    identity: int
    favourites: int
    trash: int


class PaginatedVaultResponse(BaseModel):
    items: list[VaultItemResponse | VaultItemSummary]
    total: int
    page: int
    page_size: int
    total_pages: int
    sidebar_counts: VaultSidebarCountsResponse | None = None


class UnlockedVaultResponse(PaginatedVaultResponse):
    items: list[VaultItemResponse]
    sidebar_counts: VaultSidebarCountsResponse
