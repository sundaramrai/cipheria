import assert from 'node:assert/strict';
import test from 'node:test';
import { generatePassword, withPasswordHistory, encryptData, decryptData } from '../lib/crypto.ts';
import { passwordStrength } from '../lib/passwordStrength.ts';

const defaults = { length: 20, uppercase: true, lowercase: true, numbers: true, symbols: true };

test('history records replaced passwords only, preserves edits, and keeps the last five', () => {
  let payload = withPasswordHistory({ password: 'first' });
  assert.deepEqual(payload.password_history, []);
  for (let index = 0; index < 8; index++) {
    const previous = structuredClone(payload);
    const next = withPasswordHistory({ password: String(index) }, payload);
    assert.deepEqual(payload, previous);
    assert.equal(next.password_history[0].password, previous.password);
    assert.ok(Number.isFinite(Date.parse(next.password_history[0].replaced_at)));
    payload = next;
  }
  assert.deepEqual(payload.password_history.map(entry => entry.password), ['6', '5', '4', '3', '2']);
  assert.deepEqual(withPasswordHistory({ password: '7', username: 'changed' }, payload).password_history, payload.password_history);
  assert.deepEqual(withPasswordHistory({ notes: 'a note' }, payload), { notes: 'a note' });
});

test('password history survives encrypted export and master-key rotation', async () => {
  const makeKey = () => crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const oldKey = await makeKey();
  const newKey = await makeKey();
  const payload = withPasswordHistory({ password: 'new-password' }, { password: 'old-password' });
  const exported = await encryptData(payload, oldKey);
  assert.ok(!exported.includes('old-password'));
  const rotated = await encryptData(await decryptData(exported, oldKey), newKey);
  assert.deepEqual(await decryptData(rotated, newKey), payload);
  await assert.rejects(decryptData(rotated, oldKey));
  assert.deepEqual(await decryptData(exported, oldKey), payload);
});

test('generated passwords respect length and include each enabled character type', () => {
  for (const length of [8, 20, 128]) {
    for (let attempt = 0; attempt < 20; attempt++) {
      const password = generatePassword({ ...defaults, length });
      assert.equal(password.length, length);
      for (const required of [/[A-Z]/, /[a-z]/, /[0-9]/, /[^A-Za-z0-9]/]) assert.match(password, required);
    }
  }
});

test('disabling symbols produces only letters and numbers', () => {
  for (let attempt = 0; attempt < 20; attempt++) {
    assert.match(generatePassword({ ...defaults, symbols: false }), /^[A-Za-z0-9]{20}$/);
  }
});

test('invalid generator settings are rejected', () => {
  for (const length of [0, 3, 4, 7, 129, 12.5, Number.NaN]) {
    assert.throws(() => generatePassword({ ...defaults, length }), RangeError);
  }
  assert.throws(() => generatePassword({ ...defaults, uppercase: false, lowercase: false, numbers: false, symbols: false }), RangeError);
});

test('common patterns do not receive a strong rating just for mixing character types', () => {
  for (const password of ['Password123!', '12345678', 'qwerty123', 'aaaaaaaaaaaaaaaaaaaa']) {
    const result = passwordStrength(password);
    assert.ok(result.score <= 1);
    assert.ok(result.feedback.length > 0);
  }
});

test('a long random password receives a high estimate', () => {
  assert.equal(passwordStrength('7m!Za$4Qp9@Vw2#Lx8&N').score, 4);
});
