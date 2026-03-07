import sys
import os

sys.path.insert(0, os.path.dirname(__file__))

from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from limiter import limiter
from routes.auth import router as auth_router
from routes.vault import router as vault_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    if os.getenv("ENVIRONMENT", "production") == "development":
        from database import create_tables
        try:
            create_tables()
        except Exception as e:
            print(f"Warning: Could not create tables: {e}")

    from cache import cache_ping, get_redis
    if get_redis():
        ok = cache_ping()
        print(f"Redis cache: {'connected' if ok else 'ping failed — degraded mode'}")
    else:
        print("Redis cache: not configured — all requests will hit DB")

    yield


app = FastAPI(
    title="Cipheria API",
    description="Secure serverless password manager backend",
    version="1.0.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
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
_allowed_origin_regex = os.getenv(
    "ALLOWED_ORIGIN_REGEX",
    r"https://.*\.vercel\.app|chrome-extension://.*|moz-extension://.*",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_origin_regex=_allowed_origin_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
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