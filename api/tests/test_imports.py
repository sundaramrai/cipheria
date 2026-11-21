"""Import atomicity/retry checks; set TEST_DATABASE_URL for real PostgreSQL races."""

import asyncio
import inspect
import os
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Request
from sqlalchemy import create_engine, event, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

with patch.dict(os.environ, {
    "DATABASE_URL": "postgresql+psycopg://test:test@localhost/cipheria_test",
    "REDIS_ENABLED": "false",
    "JWT_SECRET": "isolated-import-tests-only-not-a-production-secret-0123456789",
}):
    from database import AuditLog, RefreshToken, User, VaultImport, VaultItem, get_db
    from deps import get_current_db_user
    from routes import auth, vault
    from routes.vault import MAX_IMPORT_BYTES
    from schemas import ChangeMasterPasswordRequest, VaultImportRequest


class ImportTests(unittest.TestCase):
    def make_engine(self):
        return create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)

    def setUp(self):
        self.engine = self.make_engine()
        self.addCleanup(self.engine.dispose)
        for model in (User, VaultItem, VaultImport, AuditLog, RefreshToken):
            model.__table__.create(self.engine)
        self.db = Session(self.engine, expire_on_commit=False)
        self.addCleanup(self.db.close)
        self.user = User(email="destination@example.test", hashed_password="unused", vault_salt="b" * 64)
        self.db.add(self.user)
        self.db.commit()
        self.request = Request({"type": "http", "headers": [], "client": ("127.0.0.1", 1234)})
        self.body = VaultImportRequest(
            operation_id=uuid4(), destination_salt=self.user.vault_salt,
            items=[{
                "name": "Restored login", "category": "login",
                "encrypted_data": "A" * 16 + "." + "B" * 24,
                "is_favourite": True, "created_at": "2026-01-01T00:00:00Z",
            }],
        )
        cache = patch.object(vault, "invalidate_vault_list")
        self.cache = cache.start()
        self.addCleanup(cache.stop)

    def restore(self, body=None, db=None, user=None):
        return inspect.unwrap(vault.import_vault)(body or self.body, self.request, db or self.db, user or self.user)

    def test_import_keeps_destination_identity_and_retry_does_not_duplicate(self):
        self.assertEqual(self.restore().imported_count, 1)
        self.assertEqual(self.restore().imported_count, 1)
        self.assertEqual(self.db.query(VaultItem).count(), 1)
        item = self.db.query(VaultItem).one()
        self.assertEqual(item.user_id, self.user.id)
        self.assertEqual(item.created_at.year, 2026)
        self.assertTrue(item.is_favourite)
        self.assertEqual(self.user.vault_salt, "b" * 64)
        self.assertEqual(self.user.email, "destination@example.test")
        self.assertEqual(self.db.query(AuditLog).count(), 1)
        self.assertEqual(self.db.query(VaultImport).count(), 1)

    def test_receipts_are_account_scoped_and_changed_retry_is_rejected(self):
        self.restore()
        changed = self.body.model_copy(deep=True)
        changed.items[0].name = "Changed request"
        with self.assertRaises(HTTPException) as error:
            self.restore(changed)
        self.assertEqual(error.exception.status_code, 409)
        stranger = User(email="other@example.test", hashed_password="unused", vault_salt="b" * 64)
        self.db.add(stranger)
        self.db.commit()
        self.restore(user=stranger)
        self.assertEqual(self.db.query(VaultItem).filter(VaultItem.user_id == stranger.id).count(), 1)
        self.assertEqual(self.db.query(VaultImport).count(), 2)

    def test_password_change_and_capacity_reject_without_partial_writes(self):
        wrong_salt = self.body.model_copy(update={"destination_salt": "c" * 64})
        with self.assertRaises(HTTPException) as error:
            self.restore(wrong_salt)
        self.assertEqual(error.exception.status_code, 409)
        with patch.object(vault, "VAULT_ITEM_LIMIT", 0), self.assertRaises(HTTPException) as error:
            self.restore()
        self.assertEqual(error.exception.status_code, 400)
        self.assertEqual(self.db.query(VaultItem).count(), 0)
        self.assertEqual(self.db.query(VaultImport).count(), 0)

    def test_failed_transaction_rolls_back_items_and_receipt_and_can_retry(self):
        def fail_after_writes(*args):
            self.db.flush()
            raise RuntimeError("simulated failure after inserts")

        with patch.object(vault, "log_action", side_effect=fail_after_writes), self.assertRaises(RuntimeError):
            self.restore()
        self.assertEqual(self.db.query(VaultItem).count(), 0)
        self.assertEqual(self.db.query(VaultImport).count(), 0)
        self.assertEqual(self.restore().imported_count, 1)

    def test_cache_failure_after_commit_can_be_retried_without_duplicates(self):
        self.cache.side_effect = RuntimeError("simulated cache failure")
        with self.assertRaises(RuntimeError):
            self.restore()
        self.cache.side_effect = None
        self.assertEqual(self.restore().imported_count, 1)
        self.assertEqual(self.db.query(VaultItem).count(), 1)

    def test_streamed_import_limit_rejects_oversize_and_accepts_exact_boundary(self):
        app = FastAPI()
        app.include_router(vault.router)
        app.state.limiter = vault.limiter
        app.dependency_overrides[get_db] = lambda: self.db
        app.dependency_overrides[get_current_db_user] = lambda: self.user
        payload = self.body.model_dump_json().encode()
        for parts, status, count in (
            ([b" " * MAX_IMPORT_BYTES, b" "], 413, 0),
            ([payload, b" " * (MAX_IMPORT_BYTES - len(payload))], 200, 1),
        ):
            with self.subTest(size=sum(map(len, parts))):
                chunks = iter([(parts[0], True), (parts[1], False)])
                messages = []

                async def receive(chunks=chunks):
                    body, more = next(chunks)
                    return {"type": "http.request", "body": body, "more_body": more}

                async def send(message, messages=messages):
                    messages.append(message)

                asyncio.run(app({
                    "type": "http", "method": "POST", "path": "/vault/import/json",
                    "query_string": b"", "headers": [(b"content-type", b"application/json")],
                    "client": ("127.0.0.1", 1234), "scheme": "http", "server": ("localhost", 8000),
                }, receive, send))
                self.assertEqual(messages[0]["status"], status)
                self.assertEqual(self.db.query(VaultItem).count(), count)


def postgres_test_engine(test_case):
    url = make_url(os.environ["TEST_DATABASE_URL"])
    if url.host not in {"127.0.0.1", "localhost"} or url.database != "cipheria_import_test":
        raise RuntimeError("PostgreSQL tests require a local database named cipheria_import_test")
    schema = "vault_test_" + uuid4().hex
    admin = create_engine(url)
    with admin.begin() as connection:
        connection.execute(text(f'CREATE SCHEMA "{schema}"'))

    def cleanup():
        with admin.begin() as connection:
            connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        admin.dispose()

    test_case.addCleanup(cleanup)
    return create_engine(url, connect_args={"options": f"-csearch_path={schema}"})


@unittest.skipUnless(os.getenv("TEST_DATABASE_URL"), "Set TEST_DATABASE_URL to run PostgreSQL integration tests")
class PostgresImportTests(ImportTests):
    def make_engine(self):
        return postgres_test_engine(self)

    def test_concurrent_retries_commit_only_one_batch(self):
        self.db.rollback()
        barrier = threading.Barrier(2)
        user_id = self.user.id

        def worker():
            with Session(self.engine) as db:
                user = db.get(User, user_id)
                barrier.wait(timeout=5)
                return self.restore(db=db, user=user).imported_count

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: worker(), range(2)))
        self.assertEqual(results, [1, 1])
        self.assertEqual(self.db.query(VaultItem).count(), 1)
        self.assertEqual(self.db.query(VaultImport).count(), 1)

    def test_concurrent_distinct_imports_cannot_exceed_capacity(self):
        user_id = self.user.id
        self.db.rollback()
        barrier = threading.Barrier(2)

        def worker():
            with Session(self.engine) as db:
                user = db.get(User, user_id)
                body = self.body.model_copy(update={"operation_id": uuid4()})
                barrier.wait(timeout=5)
                try:
                    self.restore(body=body, db=db, user=user)
                    return 200
                except HTTPException as error:
                    return error.status_code

        with patch.object(vault, "VAULT_ITEM_LIMIT", 1), ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: worker(), range(2)))
        self.assertEqual(sorted(results), [200, 400])
        self.assertEqual(self.db.query(VaultItem).count(), 1)

    def test_import_waiting_for_password_change_reloads_stale_user_and_rejects(self):
        user_id = self.user.id
        self.db.rollback()
        lock_attempted = threading.Event()

        def observed_lock(connection, cursor, statement, parameters, context, many):
            if "FOR UPDATE" in statement:
                lock_attempted.set()

        with Session(self.engine) as changer:
            user = changer.query(User).filter(User.id == user_id).with_for_update().one()
            user.vault_salt = "c" * 64
            changer.flush()
            event.listen(self.engine, "before_cursor_execute", observed_lock)
            try:
                with ThreadPoolExecutor(max_workers=1) as pool:
                    def worker():
                        with Session(self.engine) as db:
                            stale = db.get(User, user_id)
                            try:
                                self.restore(db=db, user=stale)
                            except HTTPException as error:
                                return error.status_code
                    future = pool.submit(worker)
                    try:
                        self.assertTrue(lock_attempted.wait(timeout=5))
                    finally:
                        changer.commit()
                    self.assertEqual(future.result(timeout=5), 409)
            finally:
                event.remove(self.engine, "before_cursor_execute", observed_lock)
        self.assertEqual(self.db.query(VaultItem).count(), 0)

    def test_password_change_waiting_for_import_rechecks_complete_item_coverage(self):
        verifier = "d" * 64
        self.user.hashed_password = auth.hash_password(verifier)
        self.db.commit()
        user_id = self.user.id
        imported = threading.Event()
        finish_import = threading.Event()
        changing = threading.Event()

        def hold_import(*args):
            imported.set()
            if not finish_import.wait(timeout=5):
                raise RuntimeError("Test did not release import transaction")

        def observe(connection, cursor, statement, parameters, context, many):
            if imported.is_set() and "FOR UPDATE" in statement:
                changing.set()

        def import_worker():
            with Session(self.engine) as db:
                return self.restore(db=db, user=db.get(User, user_id))

        def change_worker():
            body = ChangeMasterPasswordRequest(
                current_master_password_verifier=verifier, new_master_password_verifier="e" * 64,
                new_vault_salt="c" * 64, items=[],
            )
            with Session(self.engine) as db:
                try:
                    inspect.unwrap(auth.change_master_password)(body, self.request, db, db.get(User, user_id), None)
                except HTTPException as error:
                    return error.status_code

        event.listen(self.engine, "before_cursor_execute", observe)
        try:
            with patch.object(vault, "log_action", side_effect=hold_import), ThreadPoolExecutor(max_workers=2) as pool:
                first = pool.submit(import_worker)
                try:
                    self.assertTrue(imported.wait(timeout=5))
                    second = pool.submit(change_worker)
                    self.assertTrue(changing.wait(timeout=5))
                finally:
                    finish_import.set()
                self.assertEqual(first.result(timeout=5).imported_count, 1)
                self.assertEqual(second.result(timeout=5), 400)
        finally:
            event.remove(self.engine, "before_cursor_execute", observe)
        self.db.expire_all()
        self.assertEqual(self.db.get(User, user_id).vault_salt, "b" * 64)
        self.assertEqual(self.db.query(VaultItem).count(), 1)
