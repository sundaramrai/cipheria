import assert from 'node:assert/strict';
import test from 'node:test';
import { itemMatchesSearch, loadSearchItems } from '../lib/vaultSearch.ts';
import { decryptData, encryptData } from '../lib/crypto.ts';

test('search matches names, websites and usernames literally without searching passwords', () => {
  const item = {
    name: 'Work_100%', search_fields: { username: 'Jane@example.com', url: 'https://github.com' },
  };
  for (const term of ['work_', '100%', 'JANE@', 'github.com', '']) {
    assert.equal(itemMatchesSearch(item, term), true);
  }
  assert.equal(itemMatchesSearch(item, 'does-not-exist'), false);
  assert.equal(itemMatchesSearch({ name: 'Work', decrypted: { password: 'secret-only' } }, 'secret-only'), false);
});

test('search loads later pages and retains only searchable decrypted fields', async () => {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const encrypted_data = await encryptData({ username: 'jane', url: 'https://example.com', password: 'secret-only', password_history: [{ password: 'previous-secret', replaced_at: '2026-01-01' }] }, key);
  const firstPage = Array.from({ length: 100 }, (_, id) => ({ id: String(id), category: 'note', name: 'Note' }));
  const calls = [];
  const items = await loadSearchItems(async page => {
    calls.push(page);
    return { items: page === 1 ? firstPage : [{ id: '101', name: 'Personal', category: 'login', encrypted_data }], total_pages: 2 };
  }, encrypted => decryptData(encrypted, key), new AbortController().signal);
  assert.deepEqual(calls, [1, 2]);
  assert.equal(items.length, 101);
  const matches = items.filter(item => itemMatchesSearch(item, 'example.com'));
  assert.deepEqual(matches.map(item => item.id), ['101']);
  assert.equal(matches[0].decrypted, undefined);
  assert.deepEqual(matches[0].search_fields, { username: 'jane', url: 'https://example.com' });
  assert.ok(!JSON.stringify(items).includes('secret-only'));
  assert.ok(!JSON.stringify(items).includes('previous-secret'));
});

test('cancelling a search discards results returned after cancellation', async () => {
  const controller = new AbortController();
  let decrypted = false;
  await assert.rejects(loadSearchItems(async () => {
    controller.abort();
    return { items: [{ category: 'login', encrypted_data: 'payload' }], total_pages: 1 };
  }, async () => { decrypted = true; return {}; }, controller.signal), { name: 'AbortError' });
  assert.equal(decrypted, false);
});

test('an unreadable login reports failure instead of silently omitting it', async () => {
  await assert.rejects(loadSearchItems(async () => ({
    items: [{ category: 'login', encrypted_data: 'corrupt' }], total_pages: 1,
  }), async () => { throw new Error('Unable to decrypt'); }, new AbortController().signal), /Unable to decrypt/);
});

test('locking while decryption is in progress discards the completed batch', async () => {
  const controller = new AbortController();
  await assert.rejects(loadSearchItems(async () => ({
    items: [{ category: 'login', encrypted_data: 'payload' }], total_pages: 1,
  }), async () => {
    controller.abort();
    return { username: 'jane', url: 'https://example.com' };
  }, controller.signal), { name: 'AbortError' });
});
