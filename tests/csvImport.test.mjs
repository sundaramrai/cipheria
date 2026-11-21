import assert from 'node:assert/strict';
import test from 'node:test';
import { mapCsvRows, parseCsv, suggestCsvMapping } from '../lib/csvImport.ts';
import { buildImportRequest, prepareImportItems, selectImportItems } from '../lib/vaultImport.ts';
import { decryptData, encryptData } from '../lib/crypto.ts';

// Synthetic fixtures follow documented/source layouts; they are not personal browser exports.
const fixtures = {
  chrome: 'name,url,username,password,note\r\nExample,https://example.test,alice,secret-01,remember this\r\n',
  edge: 'name,url,username,password\r\nExample,https://example.test,alice,secret-01\r\n',
  firefox: '"url","username","password","httpRealm","formActionOrigin","guid","timeCreated","timeLastUsed","timePasswordChanged"\r\n"https://example.test","alice","secret-01","","https://example.test/login","fake-guid","123","456","789"\r\n',
  apple: 'Title,URL,Username,Password,Notes,OTPAuth\nExample,https://example.test,alice,secret-01,remember this,\n',
};
const review = source => { const table = parseCsv(source); return mapCsvRows(table, suggestCsvMapping(table)); };
const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);

test('documented browser layouts map login fields and derive absent titles', () => {
  for (const [browser, fixture] of Object.entries(fixtures)) {
    const result = review(fixture);
    assert.equal(result.issues.length, 0, browser);
    assert.equal(result.items.length, 1, browser);
    assert.equal(result.items[0].payload.password, 'secret-01', browser);
    assert.equal(result.items[0].payload.username, 'alice', browser);
    assert.equal(result.items[0].payload.url, 'https://example.test', browser);
    assert.equal(result.items[0].name, browser === 'firefox' ? 'example.test' : 'Example');
    assert.deepEqual(result.omittedColumns, []);
  }
  assert.equal(review(fixtures.chrome).items[0].payload.notes, 'remember this');
  assert.ok(review(fixtures.firefox).ignoredMetadata.includes('guid'));
});

test('BOM, case, quotes, commas, Unicode, multiline values and password whitespace are preserved', () => {
  const result = review('\uFEFF PASSWORD ,URL,USERNAME,NAME,NOTES\r\n"  p,""q""\n=1+1  ",https://example.test,,日本語,"line one\nline two"\r\n');
  assert.equal(result.items[0].payload.password, '  p,"q"\n=1+1  ');
  assert.equal(result.items[0].payload.username, '');
  assert.equal(result.items[0].name, '日本語');
  assert.equal(result.items[0].payload.notes, 'line one\nline two');
});

test('manual mapping supports reordered custom headers and reports omitted credential columns', () => {
  const table = parseCsv('Site,Secret,Account,Description,SecondFactor\nhttps://example.test,secret-02,alice,notes,otpauth://test-only\n');
  const result = mapCsvRows(table, { name: -1, url: 0, password: 1, username: 2, notes: 3 });
  assert.equal(result.items[0].name, 'example.test');
  assert.deepEqual(result.omittedColumns, ['SecondFactor']);
  assert.throws(() => mapCsvRows(table, { name: 1, url: 0, password: 1, username: 2, notes: 3 }), /different column/);
});

test('invalid records are reported without including their passwords and valid records remain selectable', () => {
  const result = review('name,url,username,password\nGood,https://example.test,,fine-password\nBad,https://example.test,bob,\nBad columns,https://example.test,bob,private-extra-field,unexpected\n,not-a-url,bob,private-no-title\nHuge,https://example.test,bob,' + 'x'.repeat(80_000));
  assert.equal(result.items.length, 1);
  assert.deepEqual(result.issues.map(issue => issue.row), [3, 4, 5, 6]);
  assert.equal(JSON.stringify(result.issues).includes('private-'), false);
});

test('malformed quoting, ambiguous headers, missing mappings and excessive records fail safely', () => {
  for (const source of ['name,url,password\nA,https://example.test,"unterminated', 'Password,password\na,b', ',password\na,b']) {
    assert.throws(() => parseCsv(source));
  }
  assert.throws(() => review('site,secret\na,b'), /Map Password/);
  assert.throws(() => parseCsv('name,url,password\n' + 'A,https://example.test,p\n'.repeat(1001)), /1000/);
});

test('CSV preview and API request retain ciphertext only and preserve exact values after decryption', async () => {
  const mapped = review(fixtures.chrome);
  const preview = await prepareImportItems(mapped.items, key, [], new AbortController().signal);
  const request = buildImportRequest(preview, 'b'.repeat(64), true, new Set([0]));
  assert.deepEqual(await decryptData(request.items[0].encrypted_data, key), mapped.items[0].payload);
  for (const value of ['secret-01', 'alice', 'remember this', 'https://example.test']) {
    assert.equal(JSON.stringify(preview).includes(value), false);
    assert.equal(JSON.stringify(request).includes(value), false);
  }
  assert.equal('sourceRow' in request.items[0], false);
});

test('selection and duplicate skipping retain a selected copy when the first source copy is deselected', async () => {
  const { items } = review(fixtures.chrome);
  const preview = await prepareImportItems([items[0], items[0]], key, [], new AbortController().signal);
  assert.equal(preview.duplicateCount, 1);
  assert.equal(selectImportItems(preview, true, new Set([1])).length, 1);
  assert.equal(selectImportItems(preview, true, new Set([0, 1])).length, 1);
  assert.equal(selectImportItems(preview, false, new Set([0, 1])).length, 2);
  assert.throws(() => buildImportRequest(preview, 'b'.repeat(64), true, new Set()), /no new items/);
  const existing = [{ ...items[0], encrypted_data: await encryptData(items[0].payload, key) }];
  const repeated = await prepareImportItems([items[0], items[0]], key, existing, new AbortController().signal);
  assert.equal(selectImportItems(repeated, true, new Set([1])).length, 0);
});

test('CSV preparation discards work after cancellation', async () => {
  const controller = new AbortController();
  const pending = prepareImportItems(review(fixtures.chrome).items, key, [], controller.signal);
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
});

test('browser imports match existing entries with empty password history and optional fields', async () => {
  const { items } = review(fixtures.edge);
  const existing = [{ ...items[0], encrypted_data: await encryptData({
    username: 'alice', password: 'secret-01', url: 'https://example.test', password_history: [],
  }, key) }];
  const preview = await prepareImportItems(items, key, existing, new AbortController().signal);
  assert.equal(preview.duplicateCount, 1);
  assert.equal(selectImportItems(preview, true).length, 0);
});
