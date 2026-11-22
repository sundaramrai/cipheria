import { test, expect } from '@playwright/test';
import { deriveKey, deriveMasterPasswordVerifier, encryptData } from '../../lib/crypto.ts';

test('a legacy vault upgrades without losing Trash or old-backup compatibility', async ({ page, request }) => {
  const password = 'Legacy-migration-synthetic-password-723!';
  const salt = 'a'.repeat(64);
  const key = await deriveKey(password, salt);
  const verifier = await deriveMasterPasswordVerifier(password, salt);
  const email = `legacy-${crypto.randomUUID()}@example.com`;
  const headers = { 'X-Requested-With': 'XMLHttpRequest', Origin: 'http://127.0.0.1:3318' };
  const registered = await request.post('/api/auth/register', { headers,
    data: { email, vault_salt: salt, master_password_verifier: verifier } });
  expect(registered.status()).toBe(201);
  const token = (await registered.json()).access_token;
  const entries = [];
  for (const [name, category, payload] of [
    ['Legacy note', 'note', { notes: 'Legacy synthetic protected note' }],
    ['Legacy login', 'login', { username: 'legacy-user', password: 'legacy-secret',
      password_history: [{ password: 'older-secret', replaced_at: '2026-01-01T00:00:00Z' }] }],
  ]) {
    const response = await request.post('/api/vault', { headers: { ...headers,
      Authorization: `Bearer ${token}`, 'X-Vault-Salt': salt },
    data: { name, category, encrypted_data: await encryptData(payload, key) } });
    expect(response.status()).toBe(201);
    entries.push(await response.json());
  }
  expect((await request.delete(`/api/vault/${entries[1].id}`, { headers: { ...headers,
    Authorization: `Bearer ${token}`, 'X-Vault-Salt': salt, 'If-Match': `"${entries[1].id}:1"` } })).status()).toBe(204);
  const oldBackup = Buffer.from(JSON.stringify({ export_version: '1.0', vault_salt: salt, items: entries }));
  await page.goto('/auth');
  await page.locator('#email').fill(email);
  await page.locator('#masterPassword').fill(password);
  await page.locator('button[type=submit]').click();
  await page.waitForURL('**/dashboard');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'Security', exact: true }).click();
  await page.getByRole('button', { name: /^Advanced vault protection/ }).click();
  await page.locator('#settings-protection-password').fill(password);
  let migratedProfile;
  await page.route('**/api/auth/master-password', async route => {
    const committed = await route.fetch();
    expect(committed.status()).toBe(200);
    migratedProfile = await committed.json();
    await route.abort('failed');
  }, { times: 1 });
  await page.getByRole('button', { name: 'Upgrade vault encryption', exact: true }).click();
  await expect(page.getByPlaceholder('Master password', { exact: true })).toBeVisible({ timeout: 15_000 });
  expect(migratedProfile.key_envelope.version).toBe(2);
  expect((await request.post('/api/auth/login', { headers, data: { email, master_password_verifier: verifier } })).status()).toBe(401);
  await page.getByPlaceholder('Master password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Unlock Vault', exact: true }).click();
  await page.getByRole('button', { name: /^Trash/ }).click();
  await page.locator('button[data-vault-item-id]:visible').filter({ hasText: 'Legacy login' }).click();
  await expect(page.getByRole('button', { name: 'Restore item', exact: true })).toBeVisible();
  await expect(page.getByText('legacy-user', { exact: true }).filter({ visible: true }).last()).toBeVisible();
  await page.getByRole('button', { name: /^All Items/ }).click();
  await page.getByRole('button', { name: 'Import Vault', exact: true }).click();
  await page.locator('#import-format').selectOption('json');
  await page.locator('#import-file').setInputFiles({ name: 'legacy.json', mimeType: 'application/json', buffer: oldBackup });
  await page.locator('#import-password').fill(password);
  await page.getByRole('button', { name: 'Preview import', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '1 exact duplicates found' })).toBeVisible();
  await page.getByRole('button', { name: 'Import 1 item', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Import Vault', exact: true })).toHaveCount(0);
  const downloadEvent = page.waitForEvent('download', { timeout: 10_000 });
  await page.getByRole('button', { name: 'Export Vault', exact: true }).click();
  const chunks = [];
  for await (const chunk of await (await downloadEvent).createReadStream()) chunks.push(chunk);
  const exported = JSON.parse(Buffer.concat(chunks).toString());
  expect(exported.export_version).toBe('2.0');
  expect(exported.items).toHaveLength(2);
  expect(exported.items.every(item => item.encrypted_data.startsWith('v2.'))).toBe(true);
  expect(JSON.stringify(exported)).not.toContain('legacy-secret');
});
