"""
crypto.py — Server-side cryptography utilities.

Vault item data is encrypted client-side with AES-256-GCM using a key
derived from the user's master password (PBKDF2-SHA256, 600k iterations).
The server never sees plaintext vault content or decryption keys.

Handles: password hashing (bcrypt), JWT creation/verification,
and secure salt generation for client-side key derivation.
"""

import os
import secrets
import hashlib
import base64
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
from jose import jwt

SECRET_KEY = os.getenv("JWT_SECRET", secrets.token_hex(48))
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30
REFRESH_TOKEN_EXPIRE_DAYS = 30


def _pre_hash(password: str) -> bytes:
    # SHA-256 + base64 encode before bcrypt to safely handle passwords >72 bytes
    digest = hashlib.sha256(password.encode()).digest()
    return base64.b64encode(digest)


def hash_password(password: str) -> str:
    return bcrypt.hashpw(_pre_hash(password), bcrypt.gensalt(rounds=12)).decode()


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(_pre_hash(plain), hashed.encode())


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (
        expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    to_encode.update({"exp": expire, "type": "access"})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def create_refresh_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    to_encode.update({"exp": expire, "type": "refresh", "jti": str(uuid.uuid4())})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> dict:
    return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])


def generate_salt(length: int = 32) -> str:
    return secrets.token_hex(length)


def hash_refresh_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()