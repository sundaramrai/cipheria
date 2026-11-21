import { test, expect } from '@playwright/test';

const master = 'Disposable-conflict-test-password-723!';

async function unlock(page, password = master) {
  await page.getByPlaceholder('Master password', { exact: true }).fill(password);
  const response = page.waitForResponse('**/api/auth/unlock');
  await page.getByRole('button', { name: 'Unlock Vault', exact: true }).click();
  expect((await response).status()).toBe(200);
}

async function edit(page, title, notes, expectedNotes) {
  await page.locator('button[data-vault-item-id]:visible').filter({ has: page.getByText(title, { exact: true }) }).click();
  await page.getByRole('button', { name: 'Edit item', exact: true }).click();
  if (expectedNotes !== undefined) await expect(page.locator('#form-notes')).toHaveValue(expectedNotes);
  await page.locator('#form-notes').fill(notes);
}

async function save(page, expected = 200) {
  const response = page.waitForResponse(value => value.url().includes('/api/vault/') && value.request().method() === 'PATCH');
  await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
  expect((await response).status()).toBe(expected);
}

test('two tabs preserve edits, reject stale key rotation, and rewrap passwords', async ({ page, context }) => {
  test.setTimeout(120_000);
  await page.goto('/auth');
  await page.getByRole('button', { name: 'Create Account', exact: true }).click();
  await page.locator('#email').fill(`conflicts-${crypto.randomUUID()}@example.com`);
  await page.locator('#masterPassword').fill(master);
  await page.locator('#confirmMasterPassword').fill(master);
  const registration = page.waitForResponse('**/api/auth/register');
  await page.locator('button[type=submit]').click();
  const initialUser = (await (await registration).json()).user;
  await page.waitForURL('**/dashboard');
  await page.getByRole('button', { name: 'Add your first item', exact: true }).click();
  await page.locator('#form-name').fill('Concurrent note');
  await page.getByRole('button', { name: 'Note', exact: true }).click();
  await page.locator('#form-notes').fill('Initial synthetic note');
  await page.getByRole('button', { name: 'Save to Vault', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Add Item', exact: true })).toHaveCount(0);
  await edit(page, 'Concurrent note', 'Unsaved local draft');

  const other = await context.newPage();
  await other.goto('/dashboard');
  await unlock(other);
  await edit(other, 'Concurrent note', 'Newer saved note');
  await save(other);
  await save(page, 412);
  await expect(page.locator('#form-notes')).toHaveValue('Unsaved local draft');
  await expect(page.getByRole('button', { name: 'Save Changes', exact: true })).toBeDisabled();
  await page.locator('#form-name').fill('');
  await page.getByRole('button', { name: 'Save as a separate item', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Edit Item', exact: true })).toBeVisible();
  await page.locator('#form-name').fill('Concurrent note');
  await page.getByRole('button', { name: 'Save as a separate item', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Edit Item', exact: true })).toHaveCount(0);
  await expect(page.locator('button[data-vault-item-id]:visible').filter({ hasText: 'Concurrent note (copy)' })).toHaveCount(1);

  await edit(page, 'Concurrent note', 'Draft to discard', 'Newer saved note');
  await edit(other, 'Concurrent note', 'Latest saved note');
  await save(other);
  await save(page, 412);
  // Verify this control fits the normal mobile dialog without horizontal overflow.
  await page.setViewportSize({ width: 390, height: 844 });
  const conflict = page.getByRole('alert').filter({ hasText: 'Your edits are still here' });
  await expect(conflict).toBeVisible();
  const bounds = await conflict.boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  await page.getByRole('button', { name: 'Discard edits and reload', exact: true }).click();
  await expect(page.locator('#form-notes')).toHaveValue('Latest saved note');
  await expect(conflict).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save Changes', exact: true })).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Edit Item', exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 1000 });

  // Pause the prepared key rotation while the other tab saves.
  const prepared = Promise.withResolvers();
  const release = Promise.withResolvers();
  await page.route('**/api/auth/master-password', async route => {
    prepared.resolve();
    await release.promise;
    await route.continue();
  }, { times: 1 });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('#settings-current-master-password').fill(master);
  const nextPassword = 'Replacement-conflict-test-password-723!';
  await page.locator('#settings-new-master-password').fill(nextPassword);
  await page.locator('#settings-confirm-master-password').fill(nextPassword);
  const failedChange = page.waitForResponse('**/api/auth/master-password');
  await page.getByRole('button', { name: 'Rotate vault key', exact: true }).click();
  await prepared.promise;
  try {
    await edit(other, 'Concurrent note', 'Saved during password preparation');
    await save(other);
  } finally { release.resolve(); }
  expect((await failedChange).status()).toBe(412);
  await expect(page.locator('#settings-new-master-password')).toHaveValue(nextPassword);
  await expect(page.getByRole('button', { name: 'Change Master Password', exact: true })).toBeEnabled();
  const changed = page.waitForResponse('**/api/auth/master-password');
  await page.getByRole('button', { name: 'Change Master Password', exact: true }).click();
  const changedResponse = await changed;
  expect(changedResponse.status()).toBe(200);
  const updatedUser = await changedResponse.json();
  expect(changedResponse.request().postDataJSON().items).toEqual([]);
  expect(updatedUser.key_envelope.key_id).toBe(initialUser.key_envelope.key_id);
  await unlock(page, nextPassword);
  await page.locator('button[data-vault-item-id]:visible').filter({ has: page.getByText('Concurrent note', { exact: true }) }).click();
  await expect(page.getByText('Saved during password preparation', { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(other.getByPlaceholder('Master password', { exact: true })).toBeVisible();

  // A new lock must cancel an unlock already waiting for its response, even
  // when the account and key metadata have not changed.
  const unlockPrepared = Promise.withResolvers();
  const unlockRelease = Promise.withResolvers();
  await other.route('**/api/auth/unlock', async route => {
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    unlockPrepared.resolve();
    await unlockRelease.promise;
    await route.fulfill({ response });
  }, { times: 1 });
  await other.getByPlaceholder('Master password', { exact: true }).fill(nextPassword);
  await other.getByRole('button', { name: 'Unlock Vault', exact: true }).click();
  await unlockPrepared.promise;
  await other.evaluate(() => {
    window.dispatchEvent(new CustomEvent('cipheria-auth', { detail: {
      id: crypto.randomUUID(), tabId: 'pending-unlock-test', type: 'lock',
    } }));
  });
  unlockRelease.resolve();
  await expect(other.getByRole('button', { name: 'Unlock Vault', exact: true })).toBeEnabled();
  await expect(other.getByRole('heading', { name: 'Vault Locked', exact: true })).toBeVisible();
  await unlock(other, nextPassword);
  await expect(other.locator('button[data-vault-item-id]:visible').filter({ hasText: 'Concurrent note (copy)' })).toHaveCount(1);

  // A profile-only event must also lock the old key; do not depend on receiving
  // the separate lock notification sent during a normal password change.
  await edit(page, 'Concurrent note', 'Draft cleared by a key change');
  await other.evaluate(user => {
    const channel = new BroadcastChannel('cipheria-auth');
    channel.postMessage({ id: crypto.randomUUID(), tabId: 'profile-only-test', type: 'user-updated',
      user: { ...user, vault_salt: 'f'.repeat(64) } });
    channel.close();
  }, updatedUser);
  await expect(page.getByPlaceholder('Master password', { exact: true })).toBeVisible();
  await expect(page.locator('#form-notes')).toHaveCount(0);
});
