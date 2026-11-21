import inspect
import os
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

from fastapi import HTTPException, Request, Response
from pydantic import ValidationError
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from test_imports import postgres_test_engine

from database import AuditLog, RefreshToken, User, VaultItem
from routes import auth, vault
from schemas import ChangeMasterPasswordRequest, KeyEnvelope, VaultItemUpdate
from vault_writes import item_etag


class VaultKeyTests(unittest.TestCase):
    def make_engine(self):
        return create_engine('sqlite:///:memory:')

    def setUp(self):
        self.engine = self.make_engine()
        self.addCleanup(self.engine.dispose)
        for model in (User, VaultItem, AuditLog, RefreshToken):
            model.__table__.create(self.engine)
        self.db = Session(self.engine, expire_on_commit=False)
        self.addCleanup(self.db.close)
        self.user = User(email='keys@example.test', hashed_password=auth.hash_password('a' * 64), vault_salt='b' * 64)
        self.db.add(self.user)
        self.db.flush()
        self.item = VaultItem(user_id=self.user.id, name='Legacy', encrypted_data='old.payload')
        self.db.add(self.item)
        self.db.commit()
        self.item_id = self.item.id
        self.envelope = {'version': 2, 'vault_id': str(uuid4()), 'key_id': str(uuid4()), 'kdf': 'PBKDF2-SHA256',
                             'iterations': 600000, 'salt': 'c' * 64, 'wrapped_key': 'A' * 16 + '.' + 'A' * 64}
        for name in ('invalidate_user', 'invalidate_all_vault'):
            patcher = patch.object(auth, name)
            patcher.start()
            self.addCleanup(patcher.stop)

    def change(self, db=None, user=None, **overrides):
        params = {'current_master_password_verifier': 'a' * 64, 'new_master_password_verifier': 'a' * 64,
                      'new_vault_salt': 'c' * 64, 'key_envelope': self.envelope,
                      'items': [{'id': self.item_id, 'revision': 1, 'encrypted_data': 'v2.' + 'A' * 16 + '.' + 'A' * 32}]}
        body = ChangeMasterPasswordRequest(**(params | overrides))
        return inspect.unwrap(auth.change_master_password)(body, Request({'type': 'http', 'headers': []}),
            db or self.db, user or self.user, SimpleNamespace(session_id=uuid4()))

    def test_migration_is_complete_and_rewrap_leaves_ciphertext_and_revisions_untouched(self):
        self.change()
        original = self.item.encrypted_data, self.item.revision
        rewrapped = self.envelope | {'salt': 'd' * 64, 'wrapped_key': 'B' * 16 + '.' + 'B' * 64}
        self.change(items=[], new_vault_salt='d' * 64, key_envelope=rewrapped)
        self.assertEqual((self.item.encrypted_data, self.item.revision), original)
        self.assertEqual(self.user.key_envelope['key_id'], self.envelope['key_id'])

    def test_stale_migration_preserves_legacy_keys_and_data(self):
        self.item.revision = 2
        self.db.commit()
        with self.assertRaises(HTTPException) as raised:
            self.change()
        self.assertEqual(raised.exception.status_code, 412)
        self.assertIsNone(self.user.key_envelope)
        self.assertEqual(self.item.encrypted_data, 'old.payload')

    def test_rotation_requires_every_item_and_prevents_format_downgrade(self):
        self.change()
        rotated = self.envelope | {'key_id': str(uuid4()), 'salt': 'd' * 64}
        for overrides in ({'items': [], 'key_envelope': rotated}, {'items': [], 'key_envelope': None}):
            with self.assertRaises(HTTPException):
                self.change(new_vault_salt='d' * 64, **overrides)
            self.db.rollback()
        self.assertEqual(self.user.key_envelope['key_id'], self.envelope['key_id'])

    def test_invalid_or_unbounded_key_envelopes_fail_before_key_updates(self):
        for patch_values in ({'iterations': 1}, {'iterations': 2 ** 31}, {'version': 3}, {'wrapped_key': 'bad'}):
            with self.assertRaises(ValidationError):
                KeyEnvelope.model_validate(self.envelope | patch_values)


@unittest.skipUnless(os.getenv('TEST_DATABASE_URL'), 'Set TEST_DATABASE_URL for PostgreSQL key tests')
class PostgresVaultKeyTests(VaultKeyTests):
    def make_engine(self):
        return postgres_test_engine(self)

    def test_rewrap_and_edit_cannot_discard_a_newer_payload(self):
        self.change()
        user_id = self.user.id
        self.db.rollback()
        barrier = threading.Barrier(2)

        def rewrapper():
            with Session(self.engine) as db:
                user = db.get(User, user_id)
                barrier.wait(timeout=5)
                self.change(db=db, user=user, items=[], new_vault_salt='d' * 64,
                            key_envelope=self.envelope | {'salt': 'd' * 64})
                return 200

        latest = 'v2.' + 'B' * 16 + '.' + 'B' * 32

        def editor():
            with Session(self.engine) as db:
                user = db.get(User, user_id)
                barrier.wait(timeout=5)
                try:
                    vault.update_item(self.item_id, VaultItemUpdate(encrypted_data=latest), db, user,
                                      Response(), item_etag(self.item_id, 2), 'c' * 64)
                    return 200
                except HTTPException as error:
                    return error.status_code

        with ThreadPoolExecutor(max_workers=2) as pool:
            first, second = pool.submit(rewrapper), pool.submit(editor)
            self.assertEqual(first.result(timeout=10), 200)
            outcome = second.result(timeout=10)
        self.assertIn(outcome, (200, 409))
        self.db.expire_all()
        self.assertEqual(self.db.get(User, user_id).vault_salt, 'd' * 64)
        item = self.db.get(VaultItem, self.item_id)
        self.assertEqual(item.revision, 3 if outcome == 200 else 2)
        if outcome == 200:
            self.assertEqual(item.encrypted_data, latest)
