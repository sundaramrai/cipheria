import sys
import os
import logging

sys.path.insert(0, os.path.dirname(__file__))
logger = logging.getLogger("cipheria.api")

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

IS_PROD = (
    os.getenv("ENVIRONMENT") == "production"
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    from cache import cache_ping, get_redis
    if get_redis():
        ok = cache_ping()
        logger.info(f"Redis cache: {'connected' if ok else 'ping failed — degraded mode'}")
    else:
        logger.info("Redis cache: not configured — all requests will hit DB")

    yield


app = FastAPI(
    title="Cipheria API",
    description="Secure serverless password manager backend",
    version="1.0.0",
    docs_url=None if IS_PROD else "/api/docs",
    redoc_url=None if IS_PROD else "/api/redoc",
    openapi_url=None if IS_PROD else "/api/openapi.json",
    lifespan=lifespan,
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

# Compress responses over 1KB
app.add_middleware(GZipMiddleware, minimum_size=1000)

_allowed_origins = [
    o.strip() for o in os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(",")
]
_allowed_origin_regex = os.getenv("ALLOWED_ORIGIN_REGEX", r"^https://cipheria\.vercel\.app$")

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_origin_regex=_allowed_origin_regex,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Requested-With"],
)

app.include_router(auth_router, prefix="/api")
app.include_router(vault_router, prefix="/api")


@app.get("/api/health")
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
