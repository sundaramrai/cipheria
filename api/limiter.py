import os
from fastapi import Request
from slowapi import Limiter
from slowapi.util import get_remote_address

_redis_url = os.getenv("REDIS_URL")
TRUST_PROXY_HEADERS = (
    os.getenv("TRUST_PROXY_HEADERS", "true" if os.getenv("VERCEL") else "false")
    .lower()
    == "true"
)


def get_client_ip(request: Request) -> str:
    if TRUST_PROXY_HEADERS:
        forwarded_for = request.headers.get("x-forwarded-for")
        if forwarded_for:
            return forwarded_for.split(",")[0].strip()

        real_ip = request.headers.get("x-real-ip")
        if real_ip:
            return real_ip.strip()

    return get_remote_address(request)


# Use Redis for shared state across serverless instances, memory for local dev
limiter = Limiter(
    key_func=get_client_ip,
    default_limits=["200/minute"],
    storage_uri=_redis_url if _redis_url else "memory://",
)
