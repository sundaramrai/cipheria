"""
crypto.py — Server-side cryptography utilities.

Note: Vault item *data* is encrypted client-side with AES-256-GCM using a key
derived from the user's master password (PBKDF2-SHA256, 600k iterations) — the
server never sees plaintext passwords or decryption keys.

This module handles:
  - Password hashing (bcrypt) for the auth password
  - JWT creation / verification
  - Generating secure random salts for client key derivation
"""

import os
import secrets
import hashlib
import base64
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
from jose import jwt

# ── Config ────────────────────────────────────────────────────────────────────

SECRET_KEY = os.getenv("JWT_SECRET", secrets.token_hex(32))
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30
REFRESH_TOKEN_EXPIRE_DAYS = 30


def _pre_hash(password: str) -> bytes:
    """SHA-256 + base64 encode before bcrypt to safely handle passwords >72 bytes."""
    digest = hashlib.sha256(password.encode()).digest()
    return base64.b64encode(digest)


# ── Password hashing ──────────────────────────────────────────────────────────

def hash_password(password: str) -> str:
    return bcrypt.hashpw(_pre_hash(password), bcrypt.gensalt(rounds=12)).decode()


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(_pre_hash(plain), hashed.encode())


# ── JWT ───────────────────────────────────────────────────────────────────────

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire, "type": "access"})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def create_refresh_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    to_encode.update({"exp": expire, "type": "refresh"})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> dict:
    return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])


# ── Secure utilities ──────────────────────────────────────────────────────────

def generate_salt(length: int = 32) -> str:
    """Generate a cryptographically secure random salt (hex string)."""
    return secrets.token_hex(length)


def hash_refresh_token(token: str) -> str:
    """Store only a hash of the refresh token in the DB."""
    return hashlib.sha256(token.encode()).hexdigest()
