import os
from slowapi import Limiter
from slowapi.util import get_remote_address

# If REDIS_URL is set (Upstash in prod), use Redis for shared state across
# serverless instances. Falls back to in-memory for local development.
_redis_url = os.getenv("REDIS_URL")

limiter = Limiter(
    key_func=get_remote_address,
    default_limits=["200/minute"],
    storage_uri=_redis_url if _redis_url else "memory://",
)