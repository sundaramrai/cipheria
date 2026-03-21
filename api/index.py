import sys 
import os
import logging

sys.path.insert(0, os.path.dirname(__file__))
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from limiter import limiter
from routes.auth import router as auth_router
from routes.vault import router as vault_router

logger = logging.getLogger("cipheria.api")

IS_PROD = (
    os.getenv("ENVIRONMENT") == "production"
)


def _get_allowed_origins() -> list[str]:
    raw = os.getenv("ALLOWED_ORIGINS")
    if raw:
        origins = [origin.strip() for origin in raw.split(",") if origin.strip()]
        if origins:
            return origins
    if IS_PROD:
        raise RuntimeError(
            "ALLOWED_ORIGINS environment variable must be set in production"
        )
    return ["http://localhost:3000"]


@asynccontextmanager
async def lifespan(app: FastAPI):
    from cache import cache_ping, get_redis
    if get_redis():
        ok = cache_ping()
        logger.info(f"Redis cache: {'connected' if ok else 'ping failed — degraded mode'}")
    else:
        logger.info("Redis cache: not configured — all requests will hit DB")

    logger.info(f"CORS allow_origins={_get_allowed_origins()}")
    yield


app = FastAPI(
    title="Cipheria API",
    description="Secure serverless password manager backend",
    version="1.0.0",
    docs_url=None if IS_PROD else "/docs",
    redoc_url=None if IS_PROD else "/redoc",
    openapi_url=None if IS_PROD else "/openapi.json",
    lifespan=lifespan,
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

# Compress responses over 1KB
app.add_middleware(GZipMiddleware, minimum_size=1000)

_allowed_origins = _get_allowed_origins()

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Requested-With"],
)

# The Vercel Services config mounts this app under /api in production.
# Keep the FastAPI app itself rooted at / so local dev remains simple and
# external routing can add /api without double-prefixing.
app.include_router(auth_router)
app.include_router(vault_router)


@app.get("/health")
async def health():
    from cache import cache_ping, get_redis
    redis_ok = cache_ping() if get_redis() else None
    if redis_ok:
        cache_status = "connected"
    elif redis_ok is None:
        cache_status = "disabled"
    else:
        cache_status = "degraded"
    return {"status": "ok", "service": "cipheria-api", "cache": cache_status}
