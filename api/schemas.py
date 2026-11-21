from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field

HEX_64_REGEX = "^[0-9a-fA-F]{64}$"


# Auth

class KeyEnvelope(BaseModel):
    model_config = {"extra": "forbid"}
    version: Literal[2]
    vault_id: UUID
    key_id: UUID
    kdf: Literal["PBKDF2-SHA256"]
    iterations: Literal[600000]
    salt: str = Field(..., pattern="^[a-f0-9]{64}$")
    wrapped_key: str = Field(..., pattern=r"^[A-Za-z0-9+/]{16}\.[A-Za-z0-9+/]{64}$")

class RegisterRequest(BaseModel):
    email: EmailStr
    key_envelope: KeyEnvelope | None = None
    vault_salt: str = Field(..., min_length=64, max_length=64, pattern=HEX_64_REGEX)
    master_password_verifier: str = Field(..., min_length=64, max_length=64, pattern=HEX_64_REGEX)
    full_name: str | None = Field(None, max_length=128)
    master_hint: str | None = Field(None, max_length=256)


class LoginChallengeRequest(BaseModel):
    email: EmailStr


class LoginChallengeResponse(BaseModel):
    vault_salt: str
    version: Literal[1, 2] = 1


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
    key_envelope: KeyEnvelope | None = None
    master_hint: str | None = None
    email_verified: bool = False
    created_at: datetime

    model_config = {"from_attributes": True}


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
    revision: int = Field(..., ge=1)
    encrypted_data: str = Field(..., min_length=1, max_length=100_000)


class ChangeMasterPasswordRequest(BaseModel):
    current_master_password_verifier: str = Field(..., min_length=64, max_length=64, pattern=HEX_64_REGEX)
    new_vault_salt: str = Field(..., min_length=64, max_length=64, pattern=HEX_64_REGEX)
    new_master_password_verifier: str = Field(..., min_length=64, max_length=64, pattern=HEX_64_REGEX)
    master_hint: str | None = Field(None, max_length=256)
    items: list[MasterPasswordItemUpdate] = Field(default_factory=list)
    key_envelope: KeyEnvelope | None = None


class DeleteAccountRequest(BaseModel):
    master_password_verifier: str = Field(..., min_length=64, max_length=64, pattern=HEX_64_REGEX)


class VerifyMasterPasswordRequest(BaseModel):
    master_password_verifier: str = Field(..., min_length=64, max_length=64, pattern=HEX_64_REGEX)


# Vault Items

class VaultItemCreate(BaseModel):
    id: UUID | None = None
    name: str = Field(..., min_length=1, max_length=255)
    category: str = Field(default="login", pattern="^(login|card|note|identity)$")
    encrypted_data: str = Field(..., min_length=1, max_length=100_000)
    is_favourite: bool = False


class VaultItemUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=255)
    category: str | None = Field(None, pattern="^(login|card|note|identity)$")
    encrypted_data: str | None = Field(None, min_length=1, max_length=100_000)
    is_favourite: bool | None = None


class VaultImportItem(VaultItemCreate):
    model_config = {"extra": "forbid"}
    encrypted_data: str = Field(
        ..., max_length=100_000,
        pattern=r"^(v2\.)?[A-Za-z0-9+/]{16}\.[A-Za-z0-9+/]+={0,2}$",
    )
    created_at: datetime


class VaultImportRequest(BaseModel):
    model_config = {"extra": "forbid"}
    operation_id: UUID
    destination_salt: str = Field(..., pattern=HEX_64_REGEX)
    items: list[VaultImportItem] = Field(..., min_length=1, max_length=1000)


class VaultImportResponse(BaseModel):
    imported_count: int


class VaultItemSummary(BaseModel):
    # Metadata only — no encrypted_data, used by list endpoint
    id: UUID
    revision: int
    name: str
    category: str
    is_favourite: bool
    is_deleted: bool = False
    deleted_at: datetime | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


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
