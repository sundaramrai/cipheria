/**
 * content.js — Cipheria content script.
 * Listens for AUTOFILL messages from the extension popup
 * and fills username/password fields on the active page.
 */

function fillField(el, value) {
  if (!el) return;
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(globalThis.HTMLInputElement.prototype, 'value').set;
  nativeInputValueSetter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== 'AUTOFILL') return;

  const { username, password } = msg;

  // Find username/email fields
  const usernameSelectors = [
    'input[type="email"]',
    'input[type="text"][name*="email"]',
    'input[type="text"][name*="user"]',
    'input[type="text"][name*="login"]',
    'input[name*="email"]',
    'input[name*="username"]',
    'input[id*="email"]',
    'input[id*="user"]',
    'input[autocomplete="email"]',
    'input[autocomplete="username"]',
  ];

  const passwordSelectors = [
    'input[type="password"]',
    'input[autocomplete="current-password"]',
  ];

  let usernameField = null;
  for (const sel of usernameSelectors) {
    usernameField = document.querySelector(sel);
    if (usernameField) break;
  }

  let passwordField = null;
  for (const sel of passwordSelectors) {
    passwordField = document.querySelector(sel);
    if (passwordField) break;
  }

  if (usernameField && username) fillField(usernameField, username);
  if (passwordField && password) fillField(passwordField, password);

  // Visual feedback
  if (usernameField || passwordField) {
    const toast = document.createElement('div');
    toast.innerHTML = 'Cipheria — Credentials filled!';
    Object.assign(toast.style, {
      position: 'fixed', top: '16px', right: '16px', zIndex: '2147483647',
      background: '#0a0908', color: '#f5f0e8', border: '1px solid rgba(245,158,11,0.3)',
      padding: '10px 16px', borderRadius: '10px', fontSize: '13px', fontFamily: 'sans-serif',
      boxShadow: '0 4px 24px rgba(0,0,0,0.4)', backdropFilter: 'blur(8px)',
      animation: 'slideIn 0.3s ease',
    });
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2500);
  }
});
