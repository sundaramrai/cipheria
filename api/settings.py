import os


def is_production() -> bool:
    return os.getenv("ENVIRONMENT", "development").lower() == "production"


def redis_enabled() -> bool:
    return is_production()


def get_redis_url() -> str | None:
    if not redis_enabled():
        return None
    return os.getenv("REDIS_URL") or None
