"""Exercise public Vercel paths and local paths through the real ASGI app."""

import asyncio
import importlib.util
import json
import os
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch


def load_app(vercel):
    with patch.dict(os.environ, {
        "DATABASE_URL": "postgresql+psycopg://test:test@localhost/cipheria_test",
        "REDIS_ENABLED": "false",
        "ENVIRONMENT": "development",
        "ALLOWED_ORIGINS": "http://localhost:3000",
        "JWT_SECRET": "isolated-routing-tests-only-not-a-production-secret-0123456789",
        "VERCEL": vercel,
    }):
        spec = importlib.util.spec_from_file_location(
            f"routing_test_app_{vercel or 'local'}",
            Path(__file__).resolve().parents[1] / "index.py",
        )
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module.app


class RoutingTests(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls):
        cls.local_app = load_app("")
        cls.vercel_app = load_app("1")

    def setUp(self):
        from database import get_db

        self.db = Mock()
        self.db.query.return_value.filter.return_value.first.return_value = SimpleNamespace(
            vault_salt="existing-test-vault-salt", is_active=True,
        )
        for app in (self.local_app, self.vercel_app):
            app.dependency_overrides[get_db] = lambda: self.db
            self.addCleanup(app.dependency_overrides.clear)
        cache_patch = patch("cache.get_redis", return_value=None)
        cache_patch.start()
        self.addCleanup(cache_patch.stop)

    async def request(self, app, path, method="GET", body=None):
        messages = []
        body_sent = False

        async def receive():
            nonlocal body_sent
            if not body_sent:
                body_sent = True
                return {
                    "type": "http.request",
                    "body": json.dumps(body).encode() if body is not None else b"",
                    "more_body": False,
                }
            await asyncio.Future()

        async def send(message):
            messages.append(message)

        scope = {
            "type": "http", "asgi": {"version": "3.0", "spec_version": "2.4"},
            "method": method, "scheme": "http", "path": path,
            "raw_path": path.encode(), "query_string": b"", "root_path": "",
            "headers": [(b"content-type", b"application/json")],
            "client": ("127.0.0.1", 12345), "server": ("localhost", 8000),
            "http_version": "1.1",
        }
        await asyncio.wait_for(app(scope, receive, send), timeout=5)
        response = next(message for message in messages if message["type"] == "http.response.start")
        payload = b"".join(message.get("body", b"") for message in messages)
        return response["status"], dict(response["headers"]), payload

    async def test_vercel_health_accepts_the_public_api_prefix(self):
        status, _, body = await self.request(self.vercel_app, "/api/health")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["service"], "cipheria-api")

    async def test_vercel_login_challenge_reaches_the_handler(self):
        status, _, body = await self.request(
            self.vercel_app, "/api/auth/login/challenge", "POST",
            {"email": "person@example.com"},
        )
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["vault_salt"], "existing-test-vault-salt")
        self.db.query.return_value.filter.return_value.first.assert_called_once()

    async def test_vercel_invalid_challenge_returns_validation_error(self):
        status, _, _ = await self.request(
            self.vercel_app, "/api/auth/login/challenge", "POST", {},
        )
        self.assertEqual(status, 422)

    async def test_vercel_trailing_slash_redirect_keeps_the_public_prefix(self):
        status, headers, _ = await self.request(
            self.vercel_app, "/api/auth/login/challenge/", "POST", {},
        )
        self.assertEqual(status, 307)
        self.assertEqual(headers[b"location"], b"http://localhost:8000/api/auth/login/challenge")

    async def test_local_health_remains_unprefixed(self):
        status, _, _ = await self.request(self.local_app, "/health")
        self.assertEqual(status, 200)

    async def test_local_login_challenge_remains_unprefixed(self):
        status, _, body = await self.request(
            self.local_app, "/auth/login/challenge", "POST",
            {"email": "person@example.com"},
        )
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["vault_salt"], "existing-test-vault-salt")

    async def test_vercel_health_also_accepts_an_already_stripped_path(self):
        status, _, _ = await self.request(self.vercel_app, "/health")
        self.assertEqual(status, 200)
