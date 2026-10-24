"""Vault and session regression checks using isolated in-memory databases."""

import inspect
import os
import unittest
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import patch
from uuid import UUID, uuid4

from fastapi import HTTPException, Request, Response
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

# Import application models without connecting to the configured database/cache.
with patch.dict(os.environ, {
    "DATABASE_URL": "postgresql+psycopg://test:test@localhost/cipheria_test",
    "REDIS_ENABLED": "false",
    "JWT_SECRET": "isolated-vault-tests-only-not-a-production-secret-0123456789",
}):
    from database import AuditLog, RefreshToken, User, VaultItem
    from deps import get_current_token_user
    from routes import auth, vault
    from schemas import (
        ChangeMasterPasswordRequest,
        PaginatedVaultResponse,
        VaultItemUpdate,
        VerifyMasterPasswordRequest,
    )


USER_ID = UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
FIRST_ITEM_ID = UUID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1")
SECOND_ITEM_ID = UUID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2")


class VaultUpdateTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:")
        self.addCleanup(self.engine.dispose)
        VaultItem.__table__.create(self.engine)
        self.db = Session(self.engine)
        self.addCleanup(self.db.close)
        self.user = SimpleNamespace(id=USER_ID)
        self.original_date = datetime(2025, 1, 1, tzinfo=UTC)
        for index, item_id in enumerate((FIRST_ITEM_ID, SECOND_ITEM_ID), start=1):
            self.db.add(VaultItem(
                id=item_id, user_id=self.user.id, name=f"Login {index}",
                category="login", encrypted_data="encrypted.payload",
                updated_at=self.original_date,
            ))
        self.db.commit()
        for name in ("invalidate_vault_item", "invalidate_vault_list", "set_cached_vault_item",
                     "set_cached_vault_list", "get_cached_sidebar_counts_for_user"):
            patcher = patch.object(vault, name, return_value=None)
            patcher.start()
            self.addCleanup(patcher.stop)
        patcher = patch.object(vault, "get_cached_vault_list", return_value=None)
        patcher.start()
        self.addCleanup(patcher.stop)

    def update(self, **changes):
        return vault.update_item(SECOND_ITEM_ID, VaultItemUpdate(**changes), self.db, self.user)

    def test_favourite_toggle_preserves_timestamp_and_list_order_after_reload(self):
        for favourite in (True, False):
            with self.subTest(favourite=favourite):
                result = self.update(is_favourite=favourite)
                self.assertEqual(result["is_favourite"], favourite)
                self.db.expire_all()
                item = self.db.get(VaultItem, SECOND_ITEM_ID)
                self.assertEqual(item.updated_at.replace(tzinfo=UTC), self.original_date)
                listing = self.list_items()
                self.assertEqual([item["id"] for item in listing["items"]], [str(FIRST_ITEM_ID), str(SECOND_ITEM_ID)])

    def test_content_edit_updates_timestamp(self):
        self.update(name="Renamed login", encrypted_data="new.payload")
        item = self.db.get(VaultItem, SECOND_ITEM_ID)
        self.assertGreater(item.updated_at.replace(tzinfo=UTC), self.original_date)
        self.assertEqual(item.name, "Renamed login")
        self.assertEqual(item.encrypted_data, "new.payload")

    def test_combined_content_and_favourite_edit_updates_timestamp(self):
        self.update(name="Renamed login", is_favourite=True)
        item = self.db.get(VaultItem, SECOND_ITEM_ID)
        self.assertTrue(item.is_favourite)
        self.assertGreater(item.updated_at.replace(tzinfo=UTC), self.original_date)

    def list_items(self, **overrides):
        params = {
            "category": None, "search": None, "favourites_only": False,
            "deleted_only": False, "page": 1, "page_size": 50,
        }
        return vault.list_items(self.db, self.user, **(params | overrides))

    def test_search_preserves_literal_characters(self):
        for name, term in (("Work_account", "_"), ("100% saved", "%"), ("domain\\account", "\\")):
            with self.subTest(term=term):
                self.update(name=name)
                listing = self.list_items(search=term)
                self.assertEqual([item["id"] for item in listing["items"]], [str(SECOND_ITEM_ID)])

    def test_search_is_case_insensitive(self):
        self.update(name="GitHub personal")
        self.assertEqual(self.list_items(search="GITHUB")["total"], 1)

    def test_encrypted_search_batches_keep_ciphertext_through_response_validation(self):
        metadata = PaginatedVaultResponse.model_validate(self.list_items()).model_dump()
        self.assertNotIn("encrypted_data", metadata["items"][0])
        full = PaginatedVaultResponse.model_validate(self.list_items(include_encrypted_data=True)).model_dump()
        self.assertEqual(full["items"][0]["encrypted_data"], "encrypted.payload")

    def test_unlock_serializes_rows_with_ciphertext_and_required_counts(self):
        counts = {"all": 2, "login": 2, "card": 0, "note": 0, "identity": 0, "favourites": 0, "trash": 0}
        with patch.object(auth, "get_cached_sidebar_counts_for_user", return_value=counts):
            response = auth._build_unlock_response(self.db, self.user).model_dump(mode="json")
        self.assertEqual(response["items"][0]["encrypted_data"], "encrypted.payload")
        self.assertEqual(response["sidebar_counts"], counts)

    def test_search_batches_respect_owner_category_favourites_and_trash(self):
        self.db.add(VaultItem(
            user_id=UUID("cccccccc-cccc-4ccc-8ccc-cccccccccccc"), name="Other user's login",
            category="login", encrypted_data="other.payload",
        ))
        self.db.commit()
        self.update(is_favourite=True)
        listing = self.list_items(include_encrypted_data=True, category="login", favourites_only=True)
        self.assertEqual([item["id"] for item in listing["items"]], [str(SECOND_ITEM_ID)])
        self.assertEqual(self.list_items(include_encrypted_data=True, category="card")["total"], 0)
        self.assertEqual(self.list_items(include_encrypted_data=True, deleted_only=True)["total"], 0)

    def test_encrypted_batches_do_not_reuse_or_populate_metadata_cache(self):
        with patch.object(vault, "get_cached_vault_list") as get_cache, patch.object(vault, "set_cached_vault_list") as set_cache:
            self.list_items(include_encrypted_data=True)
            get_cache.assert_not_called()
            set_cache.assert_not_called()


class SessionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.verifier = 'a' * 64
        cls.password_hash = auth.hash_password(cls.verifier)

    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:")
        self.addCleanup(self.engine.dispose)
        for model in (User, RefreshToken, AuditLog, VaultItem):
            model.__table__.create(self.engine)
        self.db = Session(self.engine)
        self.addCleanup(self.db.close)
        self.user = User(id=USER_ID, email="sessions@example.com", hashed_password=self.password_hash)
        self.db.add(self.user)
        self.db.commit()
        self.request = Request({"type": "http", "headers": [], "client": ("127.0.0.1", 1234)})
        for name in ("_warm_caches", "invalidate_user", "invalidate_all_vault"):
            patcher = patch.object(auth, name)
            patcher.start()
            self.addCleanup(patcher.stop)

    def start(self, user=None):
        tokens = auth._start_session(self.db, user or self.user)
        self.db.commit()
        return tokens[:2]

    def subject(self, access):
        return get_current_token_user(HTTPAuthorizationCredentials(scheme="Bearer", credentials=access), self.db)

    def refresh(self, cookie):
        return inspect.unwrap(auth.refresh)(self.request, Response(), self.db, cookie)

    def revoke_others(self, access, verifier=None):
        return inspect.unwrap(auth.revoke_other_sessions)(
            VerifyMasterPasswordRequest(master_password_verifier=verifier or self.verifier),
            self.request, self.db, self.user, self.subject(access),
        )

    def assert_unauthorized(self, callback):
        with self.assertRaises(HTTPException) as error:
            callback()
        self.assertEqual(error.exception.status_code, 401)

    def test_refresh_keeps_session_id_and_rejects_replay(self):
        access, cookie = self.start()
        original = self.subject(access)
        response = self.refresh(cookie)
        self.assertEqual(self.subject(response.access_token).session_id, original.session_id)
        self.assertEqual(self.db.query(RefreshToken).count(), 1)
        self.assertEqual(self.subject(access).session_id, original.session_id)
        self.assert_unauthorized(lambda: self.refresh(cookie))

    def test_revoke_others_denies_access_and_refresh_but_preserves_current_and_unrelated_users(self):
        access, cookie = self.start()
        other_access, other_cookie = self.start()
        stranger = User(id=uuid4(), email="other@example.com", hashed_password=self.password_hash)
        self.db.add(stranger)
        unrelated, _ = self.start(stranger)
        self.revoke_others(access)
        self.assertEqual(self.subject(access).id, self.user.id)
        self.assertEqual(self.subject(unrelated).id, stranger.id)
        self.assert_unauthorized(lambda: self.subject(other_access))
        self.assert_unauthorized(lambda: self.refresh(other_cookie))
        self.assertEqual(self.subject(self.refresh(cookie).access_token).id, self.user.id)

    def test_wrong_master_password_cannot_revoke_sessions(self):
        access, _ = self.start()
        other, _ = self.start()
        self.assert_unauthorized(lambda: self.revoke_others(access, 'b' * 64))
        self.assertEqual(self.subject(other).id, self.user.id)

    def test_logout_revokes_current_access_token_and_refresh_cookie(self):
        access, cookie = self.start()
        inspect.unwrap(auth.logout)(self.request, Response(), self.db, cookie)
        self.assert_unauthorized(lambda: self.subject(access))
        self.assert_unauthorized(lambda: self.refresh(cookie))

    def test_missing_expired_foreign_and_revoked_sessions_are_rejected(self):
        access, _ = self.start()
        sid = self.subject(access).session_id
        for claims in ({"sub": str(self.user.id)}, {"sub": str(self.user.id), "sid": str(uuid4())},
                       {"sub": str(uuid4()), "sid": str(sid)}):
            with self.subTest(claims=claims):
                self.assert_unauthorized(lambda claims=claims: self.subject(auth.create_access_token(claims)))
        row = self.db.get(RefreshToken, sid)
        row.expires_at = datetime.now(UTC) - timedelta(seconds=1)
        self.db.commit()
        self.assert_unauthorized(lambda: self.subject(access))
        row.expires_at = datetime.now(UTC) + timedelta(days=1)
        row.revoked = True
        self.db.commit()
        self.assert_unauthorized(lambda: self.subject(access))

    def test_disabled_and_deleted_accounts_cannot_use_existing_access_tokens(self):
        access, _ = self.start()
        self.user.is_active = False
        self.db.commit()
        self.assert_unauthorized(lambda: self.subject(access))
        self.db.delete(self.user)
        self.db.commit()
        self.assert_unauthorized(lambda: self.subject(access))

    def test_legacy_refresh_cookie_upgrades_existing_row_to_session_bound_access(self):
        cookie = auth.create_refresh_token({"sub": str(self.user.id)})
        row = RefreshToken(user_id=self.user.id, token_hash=auth.hash_refresh_token(cookie),
                           expires_at=datetime.now(UTC) + timedelta(days=1))
        self.db.add(row)
        self.db.commit()
        self.assertEqual(self.subject(self.refresh(cookie).access_token).session_id, row.id)

    def test_master_password_change_revokes_other_sessions_and_preserves_current(self):
        access, _ = self.start()
        other, _ = self.start()
        item = VaultItem(user_id=self.user.id, name="Login", encrypted_data="old-ciphertext")
        self.db.add(item)
        self.db.commit()
        body = ChangeMasterPasswordRequest(
            current_master_password_verifier=self.verifier, new_master_password_verifier='b' * 64,
            new_vault_salt='c' * 64, items=[{"id": item.id, "encrypted_data": "rotated-ciphertext-with-history"}],
        )
        inspect.unwrap(auth.change_master_password)(body, self.request, self.db, self.user, self.subject(access))
        self.assertEqual(self.subject(access).id, self.user.id)
        self.assert_unauthorized(lambda: self.subject(other))
        self.assertEqual(self.db.get(VaultItem, item.id).encrypted_data, "rotated-ciphertext-with-history")


if __name__ == "__main__":
    unittest.main()
