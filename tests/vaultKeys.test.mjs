import assert from 'node:assert/strict';
import test from 'node:test';
import { createVaultKey, rewrapVaultKey, unlockKey, validateEnvelope } from '../lib/vaultKeys.ts';
import { decryptData, deriveKey, deriveMasterPasswordVerifier, encryptData } from '../lib/crypto.ts';
import { prepareImport } from '../lib/vaultImport.ts';

const password = 'Synthetic-key-test-password';
const created = await createVaultKey(password);
const id = crypto.randomUUID();
const payload = { password: 'synthetic-secret', password_history: [{ password: 'older', replaced_at: '2026-01-01T00:00:00Z' }] };
const ciphertext = await encryptData(payload, created.key, id);

test('random vault keys are non-extractable and bind ciphertext to vault, key and item IDs', async () => {
  assert.equal(created.key.extractable, false);
  await assert.rejects(crypto.subtle.exportKey('raw', created.key));
  assert.deepEqual(await decryptData(ciphertext, await unlockKey(password, created.envelope), id), payload);
  await assert.rejects(decryptData(ciphertext, created.key, crypto.randomUUID()));
  await assert.rejects(decryptData(ciphertext, created.key));
  await assert.rejects(encryptData(payload, created.key));
  const damaged = ciphertext.split('.');
  damaged[2] = (damaged[2][0] === 'A' ? 'B' : 'A') + damaged[2].slice(1);
  await assert.rejects(decryptData(damaged.join('.'), created.key, id));
  const other = await createVaultKey(password);
  await assert.rejects(decryptData(ciphertext, other.key, id));
  await assert.rejects(unlockKey('incorrect', created.envelope));
  await assert.rejects(unlockKey(password, { ...created.envelope, vault_id: crypto.randomUUID() }));
});

test('password changes rewrap the same key without changing item ciphertext or history', async () => {
  const rewrapped = await rewrapVaultKey(password, 'new-synthetic-password', created.envelope);
  assert.equal(rewrapped.key_id, created.envelope.key_id);
  assert.equal(rewrapped.vault_id, created.envelope.vault_id);
  assert.notEqual(rewrapped.salt, created.envelope.salt);
  assert.notEqual(rewrapped.wrapped_key, created.envelope.wrapped_key);
  await assert.rejects(unlockKey(password, rewrapped));
  assert.deepEqual(await decryptData(ciphertext, await unlockKey('new-synthetic-password', rewrapped), id), payload);
  // An earlier export remains protected by the original password and wrapper.
  assert.deepEqual(await decryptData(ciphertext, await unlockKey(password, created.envelope), id), payload);
});

test('key rotation changes ciphertext and preserves data under a new key identifier', async () => {
  const rotated = await createVaultKey(password, created.envelope.vault_id);
  const next = await encryptData(await decryptData(ciphertext, created.key, id), rotated.key, id);
  assert.notEqual(rotated.envelope.key_id, created.envelope.key_id);
  assert.notEqual(next, ciphertext);
  await assert.rejects(decryptData(next, created.key, id));
  assert.deepEqual(await decryptData(next, rotated.key, id), payload);
});

test('KDF parameters are bounded and authentication derivation is separate from legacy encryption', async () => {
  for (const patch of [{ iterations: 1 }, { iterations: 2 ** 31 }, { version: 3 }, { salt: 'bad' }, { wrapped_key: 'bad' }]) {
    assert.throws(() => validateEnvelope({ ...created.envelope, ...patch }));
  }
  assert.notEqual(await deriveMasterPasswordVerifier(password, created.envelope.salt, 2),
    await deriveMasterPasswordVerifier(password, created.envelope.salt, 1));
  const legacy = await deriveKey(password, created.envelope.salt);
  await assert.rejects(decryptData(ciphertext, legacy, id));
});

test('version 2 backups restore into another vault with fresh IDs and destination-bound ciphertext', async () => {
  const destination = await createVaultKey('destination-password');
  const source = JSON.stringify({ export_version: '2.0', vault_salt: created.envelope.salt,
    key_envelope: created.envelope, items: [{ id, name: 'Test', category: 'login',
      encrypted_data: ciphertext, is_favourite: true, created_at: '2026-01-01T00:00:00Z' }] });
  const preview = await prepareImport(source, password, destination.key, [], new AbortController().signal);
  assert.notEqual(preview.items[0].id, id);
  assert.deepEqual(await decryptData(preview.items[0].encrypted_data, destination.key, preview.items[0].id), payload);
  await assert.rejects(prepareImport(source, 'incorrect', destination.key, [], new AbortController().signal));
});
