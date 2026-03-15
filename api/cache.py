"""
cache.py — Redis caching layer.

Cache keys and TTLs:
  user:{id}                         15 min  (invalidated on logout/account change)
  vault:list:{user_id}:{hash}        5 min
  vault:item:{user_id}:{item_id}    10 min
  rt:valid:{token_hash}             until token expiry
  rt:revoked:{jti}                  until token expiry
  vault_salt:{user_id}              60 min

Vault ciphertext cached in Redis is identical to what is stored in the DB.
User profile cache never includes hashed_password.
On logout/password change all user cache keys are purged immediately.
"""

import os
import json
import hashlib
import logging
from typing import Optional, Any

import redis
from crypto import REFRESH_TOKEN_EXPIRE_DAYS

logger = logging.getLogger(__name__)

# TTLs in seconds
TTL_USER_PROFILE = 15 * 60
TTL_VAULT_LIST = 5 * 60
TTL_VAULT_ITEM = 10 * 60
TTL_VAULT_SALT = 60 * 60
TTL_RT_VALID = REFRESH_TOKEN_EXPIRE_DAYS * 24 * 3600
TTL_TOKEN_BLACKLIST = (REFRESH_TOKEN_EXPIRE_DAYS + 1) * 24 * 3600


def _build_redis_client() -> Optional[redis.Redis]:
    url = os.getenv("REDIS_URL")
    if not url:
        logger.warning("REDIS_URL not set — caching disabled.")
        return None
    try:
        client = redis.from_url(
            url,
            decode_responses=True,
            socket_connect_timeout=2,
            socket_timeout=2,
            retry_on_timeout=True,
            health_check_interval=30,
        )
        client.ping()
        logger.info("Redis connected ✓")
        return client
    except Exception as e:
        logger.error(f"Redis connection failed: {e} — caching disabled.")
        return None


_redis: Optional[redis.Redis] = _build_redis_client()


def get_redis() -> Optional[redis.Redis]:
    return _redis


def _get(key: str) -> Optional[Any]:
    if _redis is None:
        return None
    try:
        raw = _redis.get(key)
        return json.loads(raw) if raw else None
    except Exception as e:
        logger.warning(f"Cache GET error [{key}]: {e}")
        return None


def _set(key: str, value: Any, ttl: int) -> None:
    if _redis is None:
        return
    try:
        _redis.setex(key, ttl, json.dumps(value, default=str))
    except Exception as e:
        logger.warning(f"Cache SET error [{key}]: {e}")


def _delete(*keys: str) -> None:
    if _redis is None:
        return
    try:
        _redis.delete(*keys)
    except Exception as e:
        logger.warning(f"Cache DELETE error {keys}: {e}")


def _delete_pattern(pattern: str) -> None:
    if _redis is None:
        return
    try:
        cursor = 0
        while True:
            cursor, keys = _redis.scan(cursor, match=pattern, count=200)
            if keys:
                _redis.delete(*keys)
            if cursor == 0:
                break
    except Exception as e:
        logger.warning(f"Cache DELETE pattern error [{pattern}]: {e}")


def _vault_list_key(
    user_id: str,
    category: Optional[str],
    search: Optional[str],
    favourites_only: bool,
    deleted_only: bool,
    page: int,
    page_size: int,
) -> str:
    params = f"{category}:{search}:{favourites_only}:{deleted_only}:{page}:{page_size}"
    params_hash = hashlib.md5(params.encode()).hexdigest()[:12]
    return f"vault:list:{user_id}:{params_hash}"


# User profile

def get_cached_user(user_id: str) -> Optional[dict]:
    return _get(f"user:{user_id}")


def set_cached_user(user_id: str, user_dict: dict) -> None:
    safe = {k: v for k, v in user_dict.items() if k != "hashed_password"}
    _set(f"user:{user_id}", safe, TTL_USER_PROFILE)


def invalidate_user(user_id: str) -> None:
    _delete(f"user:{user_id}", f"vault_salt:{user_id}")


# Vault salt

def get_cached_vault_salt(user_id: str) -> Optional[str]:
    data = _get(f"vault_salt:{user_id}")
    return data.get("salt") if data else None


def set_cached_vault_salt(user_id: str, salt: str) -> None:
    _set(f"vault_salt:{user_id}", {"salt": salt}, TTL_VAULT_SALT)


# Vault list

def get_cached_vault_list(
    user_id: str,
    category: Optional[str],
    search: Optional[str],
    favourites_only: bool,
    deleted_only: bool,
    page: int,
    page_size: int,
) -> Optional[dict]:
    key = _vault_list_key(user_id, category, search, favourites_only, deleted_only, page, page_size)
    return _get(key)


def set_cached_vault_list(
    user_id: str,
    category: Optional[str],
    search: Optional[str],
    favourites_only: bool,
    deleted_only: bool,
    page: int,
    page_size: int,
    data: dict,
) -> None:
    key = _vault_list_key(user_id, category, search, favourites_only, deleted_only, page, page_size)
    _set(key, data, TTL_VAULT_LIST)


def invalidate_vault_list(user_id: str) -> None:
    _delete_pattern(f"vault:list:{user_id}:*")


# Vault item

def get_cached_vault_item(user_id: str, item_id: str) -> Optional[dict]:
    return _get(f"vault:item:{user_id}:{item_id}")


def set_cached_vault_item(user_id: str, item_id: str, data: dict) -> None:
    _set(f"vault:item:{user_id}:{item_id}", data, TTL_VAULT_ITEM)


def invalidate_vault_item(user_id: str, item_id: str) -> None:
    _delete(f"vault:item:{user_id}:{item_id}")


def invalidate_all_vault(user_id: str) -> None:
    _delete_pattern(f"vault:list:{user_id}:*")
    _delete_pattern(f"vault:item:{user_id}:*")


# Refresh token

def cache_refresh_token_valid(token_hash: str, user_id: str, ttl_seconds: int) -> None:
    _set(f"rt:valid:{token_hash}", {"user_id": user_id}, ttl_seconds)


def get_cached_refresh_token(token_hash: str) -> Optional[dict]:
    return _get(f"rt:valid:{token_hash}")


def revoke_refresh_token_cache(token_hash: str, jti: str, ttl_seconds: int) -> None:
    _delete(f"rt:valid:{token_hash}")
    _set(f"rt:revoked:{jti}", {"revoked": True}, ttl_seconds)


def is_token_blacklisted(jti: str) -> bool:
    if _redis is None:
        return False
    return _get(f"rt:revoked:{jti}") is not None


# Vault salt fast-path (used on vault unlock)

def get_vault_salt_for_unlock(user_id: str) -> Optional[str]:
    return get_cached_vault_salt(user_id)


def prime_vault_salt(user_id: str, salt: str) -> None:
    set_cached_vault_salt(user_id, salt)


# Health

def cache_ping() -> bool:
    if _redis is None:
        return False
    try:
        return _redis.ping()
    except Exception:
        return False
