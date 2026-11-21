"""Revision/key guards, including real concurrent PostgreSQL transactions."""

import inspect
import os
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

from fastapi import HTTPException, Request, Response
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session
from test_imports import postgres_test_engine

from database import AuditLog, RefreshToken, User, VaultItem
from routes import auth, vault
from schemas import ChangeMasterPasswordRequest, VaultItemCreate, VaultItemUpdate
from vault_writes import item_etag


class RevisionTests(unittest.TestCase):
    def make_engine(self):
        return create_engine("sqlite:///:memory:")

    def setUp(self):
        self.engine = self.make_engine()
        self.addCleanup(self.engine.dispose)
        for model in (User, VaultItem, AuditLog, RefreshToken):
            model.__table__.create(self.engine)
        self.db = Session(self.engine, expire_on_commit=False)
        self.addCleanup(self.db.close)
        self.user = User(email="revision@example.test", hashed_password="unused", vault_salt="a" * 64)
        self.db.add(self.user)
        self.db.flush()
        self.item = VaultItem(user_id=self.user.id, name="Original", encrypted_data="original.payload")
        self.db.add(self.item)
        self.db.commit()
        self.item_id = self.item.id
        self.request = Request({"type": "http", "headers": [], "client": ("127.0.0.1", 1234)})
        for module, names in ((vault, ("invalidate_vault_item", "invalidate_vault_list", "set_cached_vault_item")),
                              (auth, ("invalidate_user", "invalidate_all_vault"))):
            for name in names:
                patcher = patch.object(module, name)
                patcher.start()
                self.addCleanup(patcher.stop)

    def update(self, revision=1, salt="a" * 64, db=None, user=None, **changes):
        return vault.update_item(self.item_id, VaultItemUpdate(**(changes or {"name": "Updated"})),
                                 db or self.db, user or self.user, Response(),
                                 item_etag(self.item_id, revision), salt)

    def assert_status(self, status, callback):
        with self.assertRaises(HTTPException) as raised:
            callback()
        self.assertEqual(raised.exception.status_code, status)
        self.db.rollback()

    def test_success_returns_new_revision_and_stale_save_cannot_overwrite(self):
        response = Response()
        result = vault.update_item(self.item.id, VaultItemUpdate(name="Newer"), self.db, self.user,
                                   response, item_etag(self.item.id, 1), self.user.vault_salt)
        self.assertEqual(result["revision"], 2)
        self.assertEqual(response.headers["etag"], item_etag(self.item.id, 2))
        self.assert_status(412, lambda: self.update(name="Stale"))
        self.assertEqual(self.db.get(VaultItem, self.item.id).name, "Newer")

    def test_reply_keeps_its_own_revision_when_another_save_follows_commit(self):
        original_commit = self.db.commit

        def commit_then_save():
            original_commit()
            with Session(self.engine) as other:
                item = other.get(VaultItem, self.item_id)
                item.name = "Later save"
                item.encrypted_data = "later.payload"
                item.revision += 1
                other.commit()

        with patch.object(self.db, "commit", side_effect=commit_then_save):
            result = self.update(encrypted_data="my.payload")
        self.assertEqual(result["revision"], 2)
        self.assertEqual(result["encrypted_data"], "my.payload")
        self.db.expire_all()
        self.assertEqual(self.db.get(VaultItem, self.item_id).revision, 3)
        self.assertEqual(self.db.get(VaultItem, self.item_id).encrypted_data, "later.payload")

    def test_all_mutations_require_revision_and_stale_delete_restore_permanent_fail(self):
        self.update()
        for mutate in (vault.delete_item, vault.delete_item_permanently):
            self.assert_status(412, lambda mutate=mutate: mutate(self.item.id, self.db, self.user,
                                                  item_etag(self.item.id, 1), self.user.vault_salt))
        self.assert_status(412, lambda: vault.restore_item(self.item.id, self.db, self.user, Response(),
                                                         item_etag(self.item.id, 1), self.user.vault_salt))
        for header in (None, "*", f'W/{item_etag(self.item.id, 2)}'):
            self.assert_status(428 if header in (None, "*") else 412, lambda header=header: vault.update_item(
                self.item.id, VaultItemUpdate(name="Bad"), self.db, self.user, Response(), header, self.user.vault_salt))
        self.assertFalse(self.db.get(VaultItem, self.item.id).is_deleted)

    def test_delete_restore_and_favourite_each_advance_revision(self):
        vault.delete_item(self.item.id, self.db, self.user, item_etag(self.item.id, 1), self.user.vault_salt)
        result = vault.restore_item(self.item.id, self.db, self.user, Response(), item_etag(self.item.id, 2), self.user.vault_salt)
        self.assertEqual(result["revision"], 3)
        self.assertEqual(self.update(revision=3, is_favourite=True)["revision"], 4)
        self.assert_status(409, lambda: vault.delete_item_permanently(self.item.id, self.db, self.user,
                                                                   item_etag(self.item.id, 4), self.user.vault_salt))

    def test_old_key_and_missing_key_cannot_create_or_update(self):
        for salt, status in ((None, 428), ("c" * 64, 409)):
            self.assert_status(status, lambda salt=salt: self.update(salt=salt))
            self.assert_status(status, lambda salt=salt: vault.create_item(
                VaultItemCreate(name="Wrong key", encrypted_data="bad.payload"), self.db, self.user, Response(), salt))
        self.assertEqual(self.db.query(VaultItem).count(), 1)

    def test_foreign_item_is_not_disclosed_even_with_matching_revision(self):
        stranger = User(email="other@example.test", hashed_password="unused", vault_salt="a" * 64)
        self.db.add(stranger)
        self.db.commit()
        self.assert_status(404, lambda: self.update(user=stranger))

    def password_body(self, revision=1):
        return ChangeMasterPasswordRequest(current_master_password_verifier="d" * 64,
            new_master_password_verifier="e" * 64, new_vault_salt="c" * 64,
            items=[{"id": self.item_id, "revision": revision, "encrypted_data": "new-key.payload"}])

    def change_password(self, db=None, user=None, revision=1):
        return inspect.unwrap(auth.change_master_password)(self.password_body(revision), self.request,
            db or self.db, user or self.user, SimpleNamespace(session_id=uuid4()))

    def test_password_change_rejects_stale_snapshot_without_touching_keys(self):
        self.user.hashed_password = auth.hash_password("d" * 64)
        self.db.commit()
        self.update(encrypted_data="new-edit.payload")
        self.assert_status(412, self.change_password)
        self.assertEqual(self.db.get(User, self.user.id).vault_salt, "a" * 64)
        self.assertEqual(self.db.get(VaultItem, self.item.id).encrypted_data, "new-edit.payload")


@unittest.skipUnless(os.getenv("TEST_DATABASE_URL"), "Set TEST_DATABASE_URL for PostgreSQL races")
class PostgresRevisionTests(RevisionTests):
    def make_engine(self):
        return postgres_test_engine(self)

    def test_two_simultaneous_saves_have_one_winner(self):
        user_id, item_id = self.user.id, self.item.id
        self.db.rollback()
        barrier = threading.Barrier(2)

        def worker(name):
            with Session(self.engine) as db:
                user = db.get(User, user_id)
                _stale_item = db.get(VaultItem, item_id)  # Retain stale identity-map state.
                barrier.wait(timeout=5)
                try:
                    return self.update(db=db, user=user, name=name)["revision"]
                except HTTPException as error:
                    return error.status_code
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(worker, ("First", "Second")))
        self.assertEqual(sorted(results), [2, 412])
        self.db.expire_all()
        self.assertEqual(self.db.get(VaultItem, item_id).revision, 2)

    def test_save_waiting_for_password_change_reloads_key_state_and_fails(self):
        self.user.hashed_password = auth.hash_password("d" * 64)
        self.db.commit()
        user_id, item_id = self.user.id, self.item.id
        self.db.rollback()
        changing, attempting, release = threading.Event(), threading.Event(), threading.Event()

        def hold_change(*args):
            changing.set()
            if not release.wait(timeout=5):
                raise RuntimeError("Password change was not released")

        def observe(connection, cursor, statement, parameters, context, many):
            if changing.is_set() and "FOR UPDATE" in statement:
                attempting.set()

        def changer():
            with Session(self.engine) as db:
                return self.change_password(db=db, user=db.get(User, user_id))

        def writer():
            with Session(self.engine) as db:
                user = db.get(User, user_id)
                try:
                    return self.update(db=db, user=user, encrypted_data="obsolete-key.payload")
                except HTTPException as error:
                    return error.status_code

        event.listen(self.engine, "before_cursor_execute", observe)
        try:
            with patch.object(auth, "log_action", side_effect=hold_change), ThreadPoolExecutor(max_workers=2) as pool:
                first = pool.submit(changer)
                try:
                    self.assertTrue(changing.wait(timeout=5))
                    second = pool.submit(writer)
                    self.assertTrue(attempting.wait(timeout=5))
                finally:
                    release.set()
                first.result(timeout=5)
                self.assertEqual(second.result(timeout=5), 409)
        finally:
            event.remove(self.engine, "before_cursor_execute", observe)
        self.db.expire_all()
        self.assertEqual(self.db.get(VaultItem, item_id).encrypted_data, "new-key.payload")

    def test_password_change_waiting_for_save_rejects_old_snapshot(self):
        self.user.hashed_password = auth.hash_password("d" * 64)
        self.db.commit()
        user_id, item_id = self.user.id, self.item_id
        self.db.rollback()
        saving, attempting, release = threading.Event(), threading.Event(), threading.Event()

        def observe(connection, cursor, statement, parameters, context, many):
            if statement.startswith("UPDATE vault_items"):
                saving.set()
                if not release.wait(timeout=5):
                    raise RuntimeError("Save was not released")
            elif saving.is_set() and "FOR UPDATE" in statement:
                attempting.set()

        def writer():
            with Session(self.engine) as db:
                return self.update(db=db, user=db.get(User, user_id), encrypted_data="latest-edit.payload")

        def changer():
            with Session(self.engine) as db:
                try:
                    return self.change_password(db=db, user=db.get(User, user_id))
                except HTTPException as error:
                    return error.status_code

        event.listen(self.engine, "before_cursor_execute", observe)
        try:
            with ThreadPoolExecutor(max_workers=2) as pool:
                first = pool.submit(writer)
                try:
                    self.assertTrue(saving.wait(timeout=5))
                    second = pool.submit(changer)
                    self.assertTrue(attempting.wait(timeout=5))
                finally:
                    release.set()
                self.assertEqual(first.result(timeout=5)["revision"], 2)
                self.assertEqual(second.result(timeout=5), 412)
        finally:
            event.remove(self.engine, "before_cursor_execute", observe)
        self.db.expire_all()
        self.assertEqual(self.db.get(User, user_id).vault_salt, "a" * 64)
        self.assertEqual(self.db.get(VaultItem, item_id).encrypted_data, "latest-edit.payload")
