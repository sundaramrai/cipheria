import assert from 'node:assert/strict';
import test from 'node:test';
import { decryptData, deriveKey, encryptData } from '../lib/crypto.ts';
import { buildImportRequest, MAX_EXPORT_BYTES, prepareImport } from '../lib/vaultImport.ts';

const salt = 'a'.repeat(64);
const sourceKey = await deriveKey('source-test-password', salt);
const destinationKey = await deriveKey('different-destination-password', 'b'.repeat(64));
const history = [{ password: 'previous-test-password', replaced_at: '2026-01-01T00:00:00Z' }];
const payloads = [
  { username: 'test-user', password: 'current-test-password', password_history: history, url: 'https://example.test' },
  { cardNumber: 'test-card', cardHolder: 'Test user', expiry: '01/30', cvv: '000' },
  { notes: 'Private test note\nSecond line' },
  { firstName: 'Test', lastName: 'User', phone: 'test-phone', address: 'test-address' },
];
const items = await Promise.all(['login', 'card', 'note', 'identity'].map(async (category, index) => ({
  id: crypto.randomUUID(), name: `Imported ${category}`, category,
  encrypted_data: await encryptData(payloads[index], sourceKey),
  is_favourite: index === 0, created_at: '2026-01-02T03:04:05Z',
})));
const source = JSON.stringify({ export_version: '1.0', vault_salt: salt, user_email: 'source@example.test', items });
const signal = () => new AbortController().signal;

test('restore re-encrypts all categories for another account and preserves history and dates', async () => {
  const preview = await prepareImport(source, 'source-test-password', destinationKey, [], signal());
  const request = buildImportRequest(preview, 'b'.repeat(64), true);
  assert.equal(request.items.length, 4);
  for (let index = 0; index < items.length; index++) {
    const imported = request.items[index];
    assert.deepEqual(await decryptData(imported.encrypted_data, destinationKey), payloads[index]);
    await assert.rejects(decryptData(imported.encrypted_data, sourceKey));
    assert.equal(imported.created_at, items[index].created_at);
    assert.equal(imported.is_favourite, items[index].is_favourite);
    assert.ok(imported.id && imported.id !== items[index].id);
    assert.equal('duplicate' in imported, false);
  }
  for (const secret of ['current-test-password', 'previous-test-password', 'source-test-password', 'test-user', 'Private test note']) {
    assert.equal(JSON.stringify(request).includes(secret), false);
    assert.equal(JSON.stringify(preview).includes(secret), false);
  }
  assert.equal(JSON.stringify(request).includes('source@example.test'), false);
});

test('exact duplicates are compared locally, including within the source file', async () => {
  const existing = [{ ...items[0], encrypted_data: await encryptData(payloads[0], destinationKey) }];
  const duplicated = JSON.stringify({ export_version: '1.0', vault_salt: salt, items: [items[0], items[0], items[1]] });
  const preview = await prepareImport(duplicated, 'source-test-password', destinationKey, existing, signal());
  assert.equal(preview.duplicateCount, 2);
  assert.equal(buildImportRequest(preview, 'b'.repeat(64), true).items.length, 1);
  assert.equal(buildImportRequest(preview, 'b'.repeat(64), false).items.length, 3);
  // Matching names alone must not discard different credentials.
  const changed = [{ ...existing[0], encrypted_data: await encryptData({ password: 'different' }, destinationKey) }];
  const next = await prepareImport(source, 'source-test-password', destinationKey, changed, signal());
  assert.equal(next.duplicateCount, 0);
});

test('wrong password, damaged ciphertext, unsupported payloads and malformed files fail before submission', async () => {
  await assert.rejects(prepareImport(source, 'wrong-test-password', destinationKey, [], signal()), /password is incorrect/);
  for (const invalid of [
    '{', JSON.stringify({ export_version: '2.0' }),
    JSON.stringify({ export_version: '1.0', vault_salt: salt, items: [] }),
    JSON.stringify({ export_version: '1.0', vault_salt: salt, items: [{ ...items[0], category: 'unknown' }] }),
    JSON.stringify({ export_version: '1.0', vault_salt: salt, items: [{ ...items[0], encrypted_data: `${'A'.repeat(16)}.AAAA` }] }),
    JSON.stringify({ export_version: '1.0', vault_salt: salt, items: [{ ...items[0], encrypted_data: await encryptData({ password: { invalid: true } }, sourceKey) }] }),
  ]) await assert.rejects(prepareImport(invalid, 'source-test-password', destinationKey, [], signal()));
});

test('oversized files and empty selections are rejected', async () => {
  await assert.rejects(prepareImport(' '.repeat(MAX_EXPORT_BYTES + 1), '', destinationKey, [], signal()), /2 MiB/);
  assert.throws(() => buildImportRequest({ items: [], duplicateCount: 0 }, salt, true), /no new items/);
});

test('cancellation during key derivation discards the result', async () => {
  const controller = new AbortController();
  const pending = prepareImport(source, 'source-test-password', destinationKey, [], controller.signal);
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
});
