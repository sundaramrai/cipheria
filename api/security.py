"""Browser request boundaries for the same-origin web application."""

from urllib.parse import urlsplit

from starlette.datastructures import Headers, MutableHeaders
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send


def parse_allowed_origins(raw: str) -> list[str]:
    origins = []
    for entry in raw.split(","):
        origin = entry.strip().rstrip("/")
        if not origin:
            continue
        parsed = urlsplit(origin)
        if (
            parsed.scheme not in {"http", "https"}
            or not parsed.hostname
            or parsed.username is not None
            or parsed.password is not None
            or parsed.path
            or parsed.query
            or parsed.fragment
            or "*" in origin
        ):
            raise ValueError("ALLOWED_ORIGINS must contain exact HTTP(S) origins")
        # Accessing port also rejects malformed port configuration at startup.
        _ = parsed.port
        origins.append(origin)
    return origins


class BrowserSecurityMiddleware:
    def __init__(self, app: ASGIApp, allowed_origins: list[str]):
        self.app = app
        self.allowed_origins = frozenset(allowed_origins)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def secured_send(message):
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                headers["Cache-Control"] = "no-store"
                headers["X-Content-Type-Options"] = "nosniff"
                headers["Referrer-Policy"] = "no-referrer"
                headers["X-Frame-Options"] = "DENY"
            await send(message)

        if scope["method"] not in {"GET", "HEAD", "OPTIONS"}:
            headers = Headers(scope=scope)
            origin = headers.get("origin")
            # A custom header forces browser preflight. Non-browser clients may
            # omit Origin, but must deliberately send the header as well.
            if (
                headers.get("x-requested-with") != "XMLHttpRequest"
                or (origin is not None and origin not in self.allowed_origins)
                or (origin is None and headers.get("sec-fetch-site") == "cross-site")
            ):
                response = JSONResponse({"detail": "Request origin or CSRF header rejected"}, status_code=403)
                await response(scope, receive, secured_send)
                return
        await self.app(scope, receive, secured_send)
