/**
 * popup.js — Cipheria browser extension popup logic.
 * Uses the Web Crypto API for AES-256-GCM encryption (same as the web app).
 */

const URL = 'https://cipheria.vercel.app'; // ← Production API and web app URL (also used for opening the web app from the extension)
const PBKDF2_ITERATIONS = 600_000;

let cryptoKey = null;
let vaultItems = [];
let currentItem = null;
let currentTabUrl = '';

// Init

async function init() {
  // Get current tab URL for autofill detection
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTabUrl = tab?.url || '';

  let accessToken = sessionStorage.getItem('kv_access_token');
  const refreshToken = localStorage.getItem('kv_refresh_token');

  if (!accessToken && !refreshToken) {
    showScreen('screen-login');
    return;
  }

  // Access token is cleared every popup close (sessionStorage) — silently refresh it
  if (!accessToken && refreshToken) {
    try {
      const res = await fetch(`${URL}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      if (res.ok) {
        const data = await res.json();
        sessionStorage.setItem('kv_access_token', data.access_token);
        localStorage.setItem('kv_refresh_token', data.refresh_token);
        localStorage.setItem('kv_vault_salt', data.vault_salt);
      } else {
        // Refresh token expired — force re-login
        localStorage.removeItem('kv_refresh_token');
        localStorage.removeItem('kv_vault_salt');
        localStorage.removeItem('kv_master_hint');
        showScreen('screen-login');
        return;
      }
    } catch {
      // Network error — show lock screen anyway if we have salt
      const hint = localStorage.getItem('kv_master_hint');
      if (hint) document.getElementById('hint-text').textContent = `Hint: ${hint}`;
      showScreen('screen-lock');
      return;
    }
  }

  // Check if crypto key is still in memory via background service worker
  const storedKey = await getKeyFromBackground();
  if (storedKey) {
    cryptoKey = storedKey;
    await loadVault();
    showScreen('screen-vault');
    return;
  }

  // Token valid but key not in memory — show lock screen (enter master password)
  const hint = localStorage.getItem('kv_master_hint');
  if (hint) document.getElementById('hint-text').textContent = `Hint: ${hint}`;
  showScreen('screen-lock');
}

// Screen management

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// Unlock

async function unlockVault() {
  const password = document.getElementById('master-input').value;
  const salt = localStorage.getItem('kv_vault_salt') || '';
  const errEl = document.getElementById('unlock-error');
  const btn = document.getElementById('unlock-btn');

  if (!password) return;
  btn.textContent = 'Unlocking...';
  btn.disabled = true;
  errEl.style.display = 'none';

  try {
    const key = await deriveKey(password, salt);
    cryptoKey = key;
    await sendKeyToBackground(key);
    await loadVault();
    document.getElementById('master-input').value = '';
    showScreen('screen-vault');
  } catch (err) {
    console.error('Unlock failed:', err);
    errEl.textContent = 'Wrong master password';
    errEl.style.display = 'block';
  } finally {
    btn.textContent = 'Unlock';
    btn.disabled = false;
  }
}

async function loginUser() {
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');
  const btn = document.getElementById('btn-login');

  if (!email || !password) {
    errEl.textContent = 'Email and password are required';
    errEl.style.display = 'block';
    return;
  }

  btn.textContent = 'Signing in...';
  btn.disabled = true;
  errEl.style.display = 'none';

  try {
    let res;
    try {
      // pre-check: verify the API is reachable and is Cipheria
      const health = await fetch(`${URL}/api/health`).catch(() => null);
      if (!health) throw new Error(`Cannot reach server at ${URL} — is the API running?`);
      if (!health.ok) throw new Error(`Wrong server on port ${URL.split(':').pop()} (got ${health.status})`);

      res = await fetch(`${URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
    } catch {
      throw new Error(`Cannot reach server at ${URL} — is the API running?`);
    }

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.detail || `Server error (${res.status})`);
    }

    const data = await res.json();
    sessionStorage.setItem('kv_access_token', data.access_token);
    localStorage.setItem('kv_refresh_token', data.refresh_token);
    localStorage.setItem('kv_vault_salt', data.vault_salt);
    if (data.master_hint) localStorage.setItem('kv_master_hint', data.master_hint);

    document.getElementById('login-email').value = '';
    document.getElementById('login-password').value = '';

    const hint = data.master_hint || localStorage.getItem('kv_master_hint');
    if (hint) document.getElementById('hint-text').textContent = `Hint: ${hint}`;
    showScreen('screen-lock');
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = 'block';
  } finally {
    btn.textContent = 'Sign In';
    btn.disabled = false;
  }
}

async function registerUser() {
  const email = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;
  const full_name = document.getElementById('reg-name').value.trim() || undefined;
  const master_hint = document.getElementById('reg-hint').value.trim() || undefined;
  const errEl = document.getElementById('reg-error');
  const btn = document.getElementById('btn-register');

  if (!email || !password) {
    errEl.textContent = 'Email and password are required';
    errEl.style.display = 'block';
    return;
  }
  if (password.length < 8) {
    errEl.textContent = 'Password must be at least 8 characters';
    errEl.style.display = 'block';
    return;
  }

  btn.textContent = 'Creating account...';
  btn.disabled = true;
  errEl.style.display = 'none';

  try {
    let res;
    try {
      res = await fetch(`${URL}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, full_name, master_hint }),
      });
    } catch {
      throw new Error(`Cannot reach server at ${URL} — is the API running?`);
    }

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.detail || `Server error (${res.status})`);
    }

    const data = await res.json();
    sessionStorage.setItem('kv_access_token', data.access_token);
    localStorage.setItem('kv_refresh_token', data.refresh_token);
    localStorage.setItem('kv_vault_salt', data.vault_salt);
    if (master_hint) localStorage.setItem('kv_master_hint', master_hint);

    document.getElementById('reg-email').value = '';
    document.getElementById('reg-password').value = '';
    document.getElementById('reg-name').value = '';
    document.getElementById('reg-hint').value = '';

    if (master_hint) document.getElementById('hint-text').textContent = `Hint: ${master_hint}`;
    showToast('Account created! Now enter your master password.');
    showScreen('screen-lock');
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = 'block';
  } finally {
    btn.textContent = 'Create Account';
    btn.disabled = false;
  }
}

function switchTab(tab) {
  const isSignin = tab === 'signin';
  document.getElementById('pane-signin').style.display = isSignin ? 'flex' : 'none';
  document.getElementById('pane-register').style.display = isSignin ? 'none' : 'flex';
  document.getElementById('tab-signin').style.color = isSignin ? 'var(--accent)' : 'var(--text-secondary)';
  document.getElementById('tab-signin').style.borderBottomColor = isSignin ? 'var(--accent)' : 'transparent';
  document.getElementById('tab-signin').style.fontWeight = isSignin ? '600' : '400';
  document.getElementById('tab-register').style.color = isSignin ? 'var(--text-secondary)' : 'var(--accent)';
  document.getElementById('tab-register').style.borderBottomColor = isSignin ? 'transparent' : 'var(--accent)';
  document.getElementById('tab-register').style.fontWeight = isSignin ? '400' : '600';
}

function lockVault() {
  cryptoKey = null;
  vaultItems = [];
  removeKeyFromBackground();
  showScreen('screen-lock');
}

// Vault Loading

async function loadVault() {
  try {
    const token = await getValidToken();
    const res = await fetch(`${URL}/api/vault`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();

    vaultItems = await Promise.all(
      (data.items || []).map(async (item) => {
        try {
          const dec = await decryptData(item.encrypted_data, cryptoKey);
          return { ...item, decrypted: dec };
        } catch { return item; }
      })
    );

    renderList();
    checkAutofill();
  } catch (err) {
    console.error('Failed to load vault:', err);
  }
}

function renderList() {
  const search = document.getElementById('search-input')?.value?.toLowerCase() || '';
  const list = document.getElementById('item-list');

  const filtered = vaultItems.filter(item =>
    item.name.toLowerCase().includes(search) ||
    (item.decrypted?.username || '').toLowerCase().includes(search) ||
    (item.decrypted?.url || '').toLowerCase().includes(search)
  );

  if (filtered.length === 0) {
    list.innerHTML = `<div class="empty"><svg width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" opacity="0.4"><rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg><p style="font-size:12px;">No items found</p></div>`;
    return;
  }

  list.innerHTML = filtered.map(item => `
    <div class="item" data-id="${item.id}">
      <div class="item-icon">
        ${item.favicon_url
      ? `<img src="${item.favicon_url}" width="18" height="18" data-fallback="1" />`
      : getCategoryLabel(item.category)}
      </div>
      <div class="item-info">
        <div class="item-name">${escHtml(item.name)}</div>
        <div class="item-sub">${escHtml(item.decrypted?.username || item.decrypted?.url || item.category)}</div>
      </div>
      ${item.is_favourite ? '<svg width="11" height="11" fill="var(--accent)" viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>' : ''}
    </div>
  `).join('');
}

function showDetail(id) {
  currentItem = vaultItems.find(i => i.id === id);
  if (!currentItem) return;

  document.getElementById('detail-title').textContent = currentItem.name;
  const dec = currentItem.decrypted || {};

  let html = '';
  if (dec.url) html += fieldHtml('URL', dec.url, 'url');
  if (dec.username) html += fieldHtml('Username / Email', dec.username, 'text');
  if (dec.password) html += fieldHtml('Password', dec.password, 'password');
  if (dec.notes) html += `<div class="field"><div class="field-label">Notes</div><div class="field-value" style="white-space:pre-wrap;font-size:12px;">${escHtml(dec.notes)}</div></div>`;

  if (dec.url && dec.username && dec.password) {
    html += `<button class="btn btn-primary w-full" id="btn-autofill" style="margin-top:8px;">Autofill on Page</button>`;
  }

  document.getElementById('detail-content').innerHTML = html;
  // Wire autofill button if it was rendered (no inline onclick allowed by CSP)
  const autofillBtn = document.getElementById('btn-autofill');
  if (autofillBtn) autofillBtn.addEventListener('click', autofillItem);
  showScreen('screen-detail');
}

function fieldHtml(label, value, type) {
  const isPassword = type === 'password';
  const displayVal = isPassword ? '••••••••••••' : escHtml(value);
  const id = `field-${label.replaceAll(' ', '-')}`;
  return `
    <div class="field">
      <div class="field-label">${label}</div>
      <div class="field-value" id="${id}" data-val="${escHtml(value)}" data-shown="false">${displayVal}</div>
      <div class="field-actions">
        ${isPassword ? `<button class="btn btn-ghost" data-action="toggle" data-field-id="${id}" style="font-size:11px;padding:4px 8px;">Show</button>` : ''}
        <button class="btn btn-ghost" data-action="copy" data-value="${escHtml(value)}" data-label="${label}" style="font-size:11px;padding:4px 8px;">Copy</button>
      </div>
    </div>`;
}

function toggleShow(id) {
  const el = document.getElementById(id);
  const shown = el.dataset.shown === 'true';
  el.textContent = shown ? '••••••••••••' : el.dataset.val;
  el.dataset.shown = (!shown).toString();
  el.nextElementSibling.querySelector('button').textContent = shown ? 'Show' : 'Hide';
}

function copyField(value, label) {
  navigator.clipboard.writeText(value);
  showToast(`${label} copied!`);
  setTimeout(() => navigator.clipboard.writeText(''), 30000);
}

async function autofillItem() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  chrome.tabs.sendMessage(tab.id, {
    type: 'AUTOFILL',
    username: currentItem.decrypted.username,
    password: currentItem.decrypted.password,
  });
  window.close();
}

async function deleteCurrentItem() {
  if (!currentItem || !confirm(`Delete "${currentItem.name}"?`)) return;
  try {
    const token = await getValidToken();
    await fetch(`${URL}/api/vault/${currentItem.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    vaultItems = vaultItems.filter(i => i.id !== currentItem.id);
    currentItem = null;
    showScreen('screen-vault');
    renderList();
  } catch { showToast('Delete failed', true); }
}

async function saveItem() {
  const name = document.getElementById('add-name').value.trim();
  if (!name) { showToast('Name is required', true); return; }

  const payload = {
    username: document.getElementById('add-username').value,
    password: document.getElementById('add-password').value,
    url: document.getElementById('add-url').value,
    notes: document.getElementById('add-notes').value,
  };

  try {
    const encrypted_data = await encryptData(payload, cryptoKey);
    const url = payload.url;
    const favicon_url = url ? `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=64` : null;
    const token = await getValidToken();

    const res = await fetch(`${URL}/api/vault`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name, category: 'login', encrypted_data, favicon_url }),
    });
    const data = await res.json();
    vaultItems.unshift({ ...data, decrypted: payload });
    renderList();
    showScreen('screen-vault');
    showToast('Saved!');
  } catch (err) {
    console.error('Failed to save item:', err);
    showToast('Failed to save', true);
  }
}

function fillGenerated() {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
  const arr = new Uint32Array(20);
  crypto.getRandomValues(arr);
  document.getElementById('add-password').value = Array.from(arr, x => chars[x % chars.length]).join('');
  // nosemgrep: javascript:S2068 - password is randomly generated, not hard-coded
  document.getElementById('add-password').type = 'text';
}

function checkAutofill() {
  if (!currentTabUrl) return;
  const matching = vaultItems.filter(item => {
    const url = item.decrypted?.url || '';
    if (!url) return false;
    try {
      return new URL(url).hostname === new URL(currentTabUrl).hostname;
    } catch { return false; }
  });
  if (matching.length > 0) {
    document.getElementById('autofill-banner').style.display = 'block';
  }
}

// Crypto

async function deriveKey(password, saltHex) {
  const enc = new TextEncoder();
  const salt = hexToBytes(saltHex);
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function encryptData(data, key) {
  const enc = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(data)));
  return `${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(cipher))}`;
}

async function decryptData(encrypted, key) {
  const [ivB64, cipherB64] = encrypted.split('.');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(ivB64) }, key, base64ToBytes(cipherB64));
  return JSON.parse(new TextDecoder().decode(plain));
}

function hexToBytes(hex) {
  const b = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) b[i / 2] = Number.parseInt(hex.slice(i, i + 2), 16);
  return b;
}
function bytesToBase64(b) { return btoa(String.fromCodePoint(...b)); }
function base64ToBytes(s) { return Uint8Array.from(atob(s), c => c.codePointAt(0)); }

// Token Management 

async function getValidToken() {
  let token = sessionStorage.getItem('kv_access_token');
  if (token) return token;

  const refresh = localStorage.getItem('kv_refresh_token');
  if (!refresh) throw new Error('Not authenticated');

  const res = await fetch(`${URL}/api/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refresh }),
  });
  const data = await res.json();
  sessionStorage.setItem('kv_access_token', data.access_token);
  localStorage.setItem('kv_refresh_token', data.refresh_token);
  localStorage.setItem('kv_vault_salt', data.vault_salt);
  return data.access_token;
}

// Key persistence via background

async function sendKeyToBackground(key) {
  const raw = await crypto.subtle.exportKey('raw', key).catch(() => null);
  if (raw) chrome.runtime.sendMessage({ type: 'STORE_KEY', key: Array.from(new Uint8Array(raw)) });
}

async function getKeyFromBackground() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'GET_KEY' }, async (response) => {
      if (response?.key) {
        const key = await crypto.subtle.importKey('raw', new Uint8Array(response.key), { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
        resolve(key);
      } else resolve(null);
    });
  });
}

function removeKeyFromBackground() {
  chrome.runtime.sendMessage({ type: 'CLEAR_KEY' });
}

// Utils

function openWebApp() {
  chrome.tabs.create({ url: URL });
}

function getCategoryLabel(cat) {
  return { login: 'Web', card: 'Card', note: 'Note', identity: 'ID' }[cat] || 'Key';
}

function escHtml(str) {
  return String(str || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function showToast(msg, isError = false) {
  const el = document.createElement('div');
  el.textContent = msg;
  Object.assign(el.style, {
    position: 'fixed', bottom: '12px', left: '50%', transform: 'translateX(-50%)',
    background: isError ? 'var(--danger)' : 'var(--success)', color: '#fff',
    padding: '8px 16px', borderRadius: '8px', fontSize: '12px', fontWeight: 500,
    zIndex: 1000, pointerEvents: 'none',
  });
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2500);
}

// Keyboard shortcut
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && document.getElementById('screen-lock').classList.contains('active')) {
    unlockVault();
  }
  if (e.key === 'Enter' && document.getElementById('screen-login').classList.contains('active')) {
    const isRegister = document.getElementById('pane-register').style.display !== 'none';
    if (isRegister) registerUser(); else loginUser();
  }
});

// Static button event listeners (replaces all inline onclick in HTML for MV3 CSP compliance)
document.getElementById('unlock-btn').addEventListener('click', unlockVault);
document.getElementById('btn-login').addEventListener('click', loginUser);
document.getElementById('btn-register').addEventListener('click', registerUser);
document.getElementById('tab-signin').addEventListener('click', () => switchTab('signin'));
document.getElementById('tab-register').addEventListener('click', () => switchTab('register'));
document.getElementById('btn-webapp-lock').addEventListener('click', openWebApp);
document.getElementById('btn-add-item').addEventListener('click', () => showScreen('screen-add'));
document.getElementById('btn-lock').addEventListener('click', lockVault);
document.getElementById('btn-detail-back').addEventListener('click', () => showScreen('screen-vault'));
document.getElementById('btn-delete').addEventListener('click', deleteCurrentItem);
document.getElementById('btn-add-back').addEventListener('click', () => showScreen('screen-vault'));
document.getElementById('btn-gen-password').addEventListener('click', fillGenerated);
document.getElementById('btn-add-cancel').addEventListener('click', () => showScreen('screen-vault'));
document.getElementById('btn-save').addEventListener('click', saveItem);
document.getElementById('search-input').addEventListener('input', renderList);

// Event delegation for dynamically generated vault list items
document.getElementById('item-list').addEventListener('click', (e) => {
  const item = e.target.closest('[data-id]');
  if (item) showDetail(item.dataset.id);
});

// Hide broken favicon images via event delegation (onerror inline is blocked by CSP)
document.getElementById('item-list').addEventListener('error', (e) => {
  if (e.target.tagName === 'IMG' && e.target.dataset.fallback) e.target.style.display = 'none';
}, true);

// Event delegation for field action buttons inside detail view
document.getElementById('detail-content').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  if (btn.dataset.action === 'toggle') toggleShow(btn.dataset.fieldId);
  if (btn.dataset.action === 'copy') copyField(btn.dataset.value, btn.dataset.label);
});

// Start
await init();
