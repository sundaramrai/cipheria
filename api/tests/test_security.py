import unittest
from unittest.mock import patch

from fastapi import Response

from security import parse_allowed_origins


class SecurityTests(unittest.TestCase):
    def test_origin_configuration_rejects_wildcards_and_urls_with_paths(self):
        for origin in ("*", "https://*.example.test", "https://example.test/path", "https://user@example.test",
                       "https://example.test?query=1", "https://example.test#fragment", "null", "https://x:bad"):
            with self.subTest(origin=origin), self.assertRaises(ValueError):
                parse_allowed_origins(origin)
        self.assertEqual(parse_allowed_origins(" https://example.test/, http://localhost:3000 "),
                         ["https://example.test", "http://localhost:3000"])

    def test_production_cookie_is_secure_httponly_and_lax(self):
        from routes import auth
        with patch.object(auth, "IS_PROD", True):
            response = Response()
            auth._set_refresh_cookie(response, "synthetic-token")
            cookie = response.headers["set-cookie"]
            for attribute in ("Secure", "HttpOnly", "SameSite=lax", "Path=/"):
                self.assertIn(attribute, cookie)
            self.assertNotIn("Domain=", cookie)

    def test_unconfigured_mailer_does_not_log_verification_secrets(self):
        import mailer
        with patch.object(mailer, "SMTP_HOST", None), self.assertLogs("mailer", "WARNING") as logs:
            self.assertFalse(mailer.send_email("private@example.test", "Verification", "token=secret-canary"))
        self.assertNotIn("secret-canary", str(logs.output))
        self.assertNotIn("private@example.test", str(logs.output))
