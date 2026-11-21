import { test, expect } from '@playwright/test';

// Synthetic secrets only. Do not enable traces/screenshots for vault journeys.
const master = 'Disposable-browser-test-password-723!';

test('document CSP has fresh nonces, blocks injected scripts, and preserves navigation', async ({ page }) => {
  await page.addInitScript(() => {
    window.__cspCanary = 0;
    window.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', event => {
      window.__cspViolations.push(event.effectiveDirective);
    });
  });
  // Inject into the delivered HTML, so this exercises the document parser's
  // CSP boundary rather than DevTools' privileged script execution context.
  await page.route('http://127.0.0.1:3318/', async route => {
    const response = await route.fetch();
    const body = (await response.text()).replace('<head>', '<head><script>window.__cspCanary = 1</script>');
    await route.fulfill({ response, body });
  }, { times: 1 });
  const header = process.env.CSP_REPORT_ONLY === '1'
    ? 'content-security-policy-report-only' : 'content-security-policy';
  const first = await page.goto('/');
  const policy = first.headers()[header];
  const nonce = policy.match(/'nonce-([^']+)'/)[1];
  expect(first.headers()['cache-control']).toContain('no-store');
  expect(await page.locator('script[nonce]').first().evaluate(script => script.nonce)).toBe(nonce);
  expect(await page.evaluate(() => window.__cspCanary)).toBe(process.env.CSP_REPORT_ONLY === '1' ? 1 : 0);
  if (process.env.CSP_REPORT_ONLY !== '1') {
    await expect.poll(() => page.evaluate(() => window.__cspViolations)).toContain('script-src-elem');
  }
  // Exercise a client transition, where the original document's CSP survives.
  await page.locator('a[href="/auth"]').first().click();
  await expect(page.locator('#email')).toBeVisible();
  const second = await page.goto('/auth');
  expect(second.headers()[header]).not.toContain(`'nonce-${nonce}'`);
});

test('unsafe API requests require the header and an allowed origin', async ({ request }) => {
  const path = '/api/auth/refresh';
  expect((await request.post(path)).status()).toBe(403);
  expect((await request.post(path, { headers: {
    'X-Requested-With': 'XMLHttpRequest', Origin: 'https://attacker.test',
  } })).status()).toBe(403);
  const response = await request.post(path, { headers: {
    'X-Requested-With': 'XMLHttpRequest', Origin: 'http://127.0.0.1:3318',
  } });
  expect(response.status()).toBe(401);
  expect(response.headers()['set-cookie']).toContain('Max-Age=0');
  expect(response.headers()['cache-control']).toBe('no-store');
});

test('registration, locked reload, CRUD, import/export, and revoking another session', async ({ page, browser, request }) => {
  const email = `browser-${crypto.randomUUID()}@example.com`;
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/auth');
  await page.getByRole('button', { name: 'Create Account', exact: true }).click();
  await page.locator('#email').fill(email);
  await page.locator('#masterPassword').fill(master);
  await page.locator('#confirmMasterPassword').fill(master);
  await page.locator('button[type=submit]').click();
  await page.waitForURL('**/dashboard');
  const cookie = (await page.context().cookies()).find(value => value.name === 'refresh_token');
  expect(cookie.httpOnly).toBe(true);
  expect(cookie.sameSite).toBe('Lax');
  await page.reload();
  await page.getByPlaceholder('Master password', { exact: true }).fill('wrong-password');
  const wrongUnlock = page.waitForResponse('**/api/auth/unlock');
  await page.getByRole('button', { name: 'Unlock Vault', exact: true }).click();
  expect((await wrongUnlock).status()).toBe(401);
  await expect(page.getByRole('button', { name: 'Unlock Vault', exact: true })).toBeEnabled();
  await expect(page.getByPlaceholder('Master password', { exact: true })).toBeVisible();
  await page.getByPlaceholder('Master password', { exact: true }).fill(master);
  const unlocked = page.waitForResponse('**/api/auth/unlock');
  await page.getByRole('button', { name: 'Unlock Vault', exact: true }).click();
  expect((await unlocked).status()).toBe(200);

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Account Settings', exact: true });
  await settings.getByRole('button', { name: 'Rotate vault key', exact: true }).click();
  const notice = page.locator('[role="status"]').filter({ hasText: 'Enter your current master password' });
  await expect(notice).toHaveCount(1);
  await expect(settings.getByRole('status').filter({ hasText: 'Enter your current master password' })).toBeVisible();
  // Hover must reach the toast above the modal and pauses its dismissal timer.
  await notice.hover();
  await page.setViewportSize({ width: 390, height: 844 });
  await notice.hover();
  const toastBounds = await notice.boundingBox();
  expect(toastBounds.x).toBeGreaterThanOrEqual(0);
  expect(toastBounds.x + toastBounds.width).toBeLessThanOrEqual(390);
  expect(toastBounds.y + toastBounds.height).toBeLessThanOrEqual(844);
  await page.keyboard.press('Escape');
  await expect(settings).toHaveCount(0);
  await expect(notice).toBeVisible();
  await expect(notice).toHaveCount(1);
  await page.mouse.move(0, 0);
  await page.setViewportSize({ width: 1440, height: 1000 });

  await page.getByRole('button', { name: 'Add your first item', exact: true }).click();
  await page.locator('#form-name').fill('Synthetic note');
  await page.getByRole('button', { name: 'Note', exact: true }).click();
  await page.locator('#form-notes').fill('Synthetic-secret-canary');
  const created = page.waitForResponse(response => response.url().endsWith('/api/vault') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Save to Vault', exact: true }).click();
  const createdResponse = await created;
  const createdItem = await createdResponse.json();
  expect(createdResponse.status()).toBe(201);
  expect(createdResponse.request().postData()).not.toContain('Synthetic-secret-canary');
  await page.locator('button[data-vault-item-id]:visible').filter({ hasText: 'Synthetic note' }).click();
  await expect(page.getByText('Synthetic-secret-canary', { exact: true }).filter({ visible: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit item', exact: true }).click();
  await page.locator('#form-notes').fill('Edited-synthetic-secret');
  const saved = page.waitForResponse(response => response.url().endsWith(`/api/vault/${createdItem.id}`)
    && response.request().method() === 'PATCH');
  await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
  expect((await saved).status()).toBe(200);
  await expect(page.getByRole('dialog', { name: 'Edit Item', exact: true })).toHaveCount(0);
  await expect(page.getByText('Edited-synthetic-secret', { exact: true }).filter({ visible: true })).toBeVisible();
  // Navigation can finish before the delete response. Trash must refresh when
  // that pending write completes, even if its cached count was initially zero.
  const deleteStarted = Promise.withResolvers();
  const releaseDelete = Promise.withResolvers();
  await page.route(`**/api/vault/${createdItem.id}`, async route => {
    expect(route.request().method()).toBe('DELETE');
    deleteStarted.resolve();
    await releaseDelete.promise;
    await route.continue();
  }, { times: 1 });
  const deleted = page.waitForResponse(response => response.url().endsWith(`/api/vault/${createdItem.id}`)
    && response.request().method() === 'DELETE');
  await page.getByRole('button', { name: 'Move to trash', exact: true }).click();
  await deleteStarted.promise;
  try {
    await page.getByRole('button', { name: /^Trash/ }).click();
  } finally { releaseDelete.resolve(); }
  expect((await deleted).status()).toBe(204);
  await expect(page.locator('button[data-vault-item-id]:visible').filter({ hasText: 'Synthetic note' })).toBeVisible();
  await page.locator('button[data-vault-item-id]:visible').filter({ hasText: 'Synthetic note' }).click();
  await page.getByRole('button', { name: 'Restore item', exact: true }).click();
  await page.getByRole('button', { name: /^All Items/ }).click();

  // A separate account cannot read or mutate another account's item ID.
  const stranger = await request.post('/api/auth/register', {
    headers: { 'X-Requested-With': 'XMLHttpRequest', Origin: 'http://127.0.0.1:3318' },
    data: { email: `stranger-${crypto.randomUUID()}@example.com`, vault_salt: 'a'.repeat(64),
      master_password_verifier: 'b'.repeat(64) },
  });
  expect(stranger.status()).toBe(201);
  const strangerToken = (await stranger.json()).access_token;
  for (const method of ['GET', 'PATCH', 'DELETE']) {
    const response = await request.fetch(`/api/vault/${createdItem.id}`, {
      method, headers: { Authorization: `Bearer ${strangerToken}`,
        'X-Requested-With': 'XMLHttpRequest', Origin: 'http://127.0.0.1:3318',
        'X-Vault-Salt': 'a'.repeat(64), 'If-Match': `"${createdItem.id}:${createdItem.revision}"` },
      ...(method === 'PATCH' ? { data: { name: 'Unauthorized edit' } } : {}),
    });
    expect(response.status()).toBe(404);
  }

  await page.getByRole('button', { name: 'Import Vault', exact: true }).click();
  await page.locator('#import-file').dispatchEvent('cancel', { bubbles: true });
  await expect(page.getByRole('dialog', { name: 'Import Vault', exact: true })).toBeVisible();
  await page.locator('#import-file').setInputFiles({ name: 'synthetic.csv', mimeType: 'text/csv',
    buffer: Buffer.from('name,url,username,password\nBrowser login,https://example.test,synthetic-user,synthetic-password\n') });
  await page.getByRole('button', { name: 'Read CSV', exact: true }).click();
  await page.getByRole('button', { name: 'Preview import', exact: true }).click();
  await page.getByRole('button', { name: 'Import 1 item', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Import Vault', exact: true })).toHaveCount(0);
  const downloadEvent = page.waitForEvent('download', { timeout: 10_000 });
  await page.getByRole('button', { name: 'Export Vault', exact: true }).click();
  const stream = await (await downloadEvent).createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const backup = Buffer.concat(chunks);
  expect(backup.toString()).not.toContain('synthetic-password');
  await page.getByRole('button', { name: 'Import Vault', exact: true }).click();
  await page.locator('#import-format').selectOption('json');
  await page.locator('#import-file').setInputFiles({ name: 'synthetic.json', mimeType: 'application/json', buffer: backup });
  await page.locator('#import-password').fill(master);
  await page.getByRole('button', { name: 'Preview import', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '2 exact duplicates found' })).toBeVisible();
  await page.keyboard.press('Escape');

  const otherContext = await browser.newContext();
  try {
    const other = await otherContext.newPage();
    await other.goto('http://127.0.0.1:3318/auth');
    await other.locator('#email').fill(email);
    await other.locator('#masterPassword').fill(master);
    await other.locator('button[type=submit]').click();
    await other.waitForURL('**/dashboard');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.locator('#settings-session-password').fill(master);
    const revoked = page.waitForResponse('**/api/auth/sessions/revoke-others');
    await page.getByRole('button', { name: 'Sign out other sessions', exact: true }).click();
    expect((await revoked).status()).toBe(200);
    await other.reload();
    await other.waitForURL('**/auth');
    await page.keyboard.press('Escape');
    await page.reload();
    await expect(page.getByPlaceholder('Master password', { exact: true })).toBeVisible();
  } finally { await otherContext.close(); }
  expect(errors).toEqual([]);
});
