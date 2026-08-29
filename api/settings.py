import os
from pathlib import Path

from dotenv import load_dotenv


# Load the application's single environment file before Redis and rate limiting
# are configured, while preserving environment variables supplied at deployment.
_ENV_DIR = Path(__file__).resolve().parent
load_dotenv(_ENV_DIR / ".env")


def is_production() -> bool:
    return os.getenv("ENVIRONMENT", "development").lower() == "production"


def _get_bool_env(name: str) -> bool | None:
    raw = os.getenv(name)
    if raw is None:
        return None
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def redis_enabled() -> bool:
    override = _get_bool_env("REDIS_ENABLED")
    if override is not None:
        return override
    return is_production() or bool(os.getenv("REDIS_URL"))


def get_redis_url() -> str | None:
    if not redis_enabled():
        return None
    return os.getenv("REDIS_URL") or None
