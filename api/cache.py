"""
Redis-backed cache helpers.

Key families:
  user:{id}                              15 min
  vault:list:ver:{user_id}              monotonic version counter
  vault:list:{user_id}:{ver}:{hash}      5 min
  vault:sidebar:{user_id}:{ver}          5 min
  vault:item:{user_id}:{item_id}        10 min
  rt:valid:{token_hash}                 until token expiry
  rt:revoked:{jti}                      until token expiry
"""

import hashlib
import json
import logging
from typing import Any, Optional

import redis
from settings import get_redis_url

logger = logging.getLogger(__name__)

TTL_USER_PROFILE = 15 * 60
TTL_VAULT_LIST = 5 * 60
TTL_SIDEBAR_COUNTS = 5 * 60
TTL_VAULT_ITEM = 10 * 60


def _build_redis_client() -> Optional[redis.Redis]:
    url = get_redis_url()
    if not url:
        logger.info("Redis disabled for this environment; caching disabled.")
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
        logger.info("Redis connected")
        return client
    except Exception as exc:
        logger.error("Redis connection failed: %s; caching disabled.", exc)
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
    except Exception as exc:
        logger.warning("Cache GET error [%s]: %s", key, exc)
        return None


def _set(key: str, value: Any, ttl: int) -> None:
    if _redis is None:
        return
    try:
        _redis.setex(key, ttl, json.dumps(value, default=str))
    except Exception as exc:
        logger.warning("Cache SET error [%s]: %s", key, exc)


def _delete(*keys: str) -> None:
    if _redis is None or not keys:
        return
    try:
        _redis.delete(*keys)
    except Exception as exc:
        logger.warning("Cache DELETE error %s: %s", keys, exc)


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
    except Exception as exc:
        logger.warning("Cache DELETE pattern error [%s]: %s", pattern, exc)


def _vault_list_version_key(user_id: str) -> str:
    return f"vault:list:ver:{user_id}"


def _get_vault_list_version(user_id: str) -> int:
    if _redis is None:
        return 1
    try:
        raw = _redis.get(_vault_list_version_key(user_id))
        return int(raw) if raw else 1
    except Exception as exc:
        logger.warning("Cache version read error [vault:list:%s]: %s", user_id, exc)
        return 1


def _bump_vault_list_version(user_id: str) -> None:
    if _redis is None:
        return
    try:
        _redis.incr(_vault_list_version_key(user_id))
    except Exception as exc:
        logger.warning("Cache version bump error [vault:list:%s]: %s", user_id, exc)


def _vault_list_key(
    user_id: str,
    category: Optional[str],
    search: Optional[str],
    favourites_only: bool,
    deleted_only: bool,
    page: int,
    page_size: int,
) -> str:
    version = _get_vault_list_version(user_id)
    params = f"{category}:{search}:{favourites_only}:{deleted_only}:{page}:{page_size}"
    params_hash = hashlib.md5(params.encode()).hexdigest()[:12]
    return f"vault:list:{user_id}:{version}:{params_hash}"


def _sidebar_counts_key(user_id: str) -> str:
    version = _get_vault_list_version(user_id)
    return f"vault:sidebar:{user_id}:{version}"


def get_cached_user(user_id: str) -> Optional[dict]:
    return _get(f"user:{user_id}")


def set_cached_user(user_id: str, user_dict: dict) -> None:
    safe = {key: value for key, value in user_dict.items() if key != "hashed_password"}
    _set(f"user:{user_id}", safe, TTL_USER_PROFILE)


def invalidate_user(user_id: str) -> None:
    _delete(f"user:{user_id}")


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


def get_cached_sidebar_counts(user_id: str) -> Optional[dict]:
    return _get(_sidebar_counts_key(user_id))


def set_cached_sidebar_counts(user_id: str, data: dict) -> None:
    _set(_sidebar_counts_key(user_id), data, TTL_SIDEBAR_COUNTS)


def invalidate_vault_list(user_id: str) -> None:
    _bump_vault_list_version(user_id)


def get_cached_vault_item(user_id: str, item_id: str) -> Optional[dict]:
    return _get(f"vault:item:{user_id}:{item_id}")


def set_cached_vault_item(user_id: str, item_id: str, data: dict) -> None:
    _set(f"vault:item:{user_id}:{item_id}", data, TTL_VAULT_ITEM)


def invalidate_vault_item(user_id: str, item_id: str) -> None:
    _delete(f"vault:item:{user_id}:{item_id}")


def invalidate_all_vault(user_id: str) -> None:
    _bump_vault_list_version(user_id)
    _delete_pattern(f"vault:item:{user_id}:*")


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


def cache_ping() -> bool:
    if _redis is None:
        return False
    try:
        return bool(_redis.ping())
    except Exception:
        return False
