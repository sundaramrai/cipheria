/**
 * background.js — Service worker for KeyVault extension.
 * Stores the derived crypto key in memory (cleared when browser closes).
 * This avoids the user having to re-enter master password for every popup open.
 */

let inMemoryKey = null;

chrome.runtime.onMessage.addListener((msg, sendResponse) => {
  switch (msg.type) {
    case 'STORE_KEY':
      inMemoryKey = msg.key; // Raw key bytes as array
      sendResponse({ ok: true });
      break;

    case 'GET_KEY':
      sendResponse(inMemoryKey ? { key: inMemoryKey } : { key: null });
      break;

    case 'CLEAR_KEY':
      inMemoryKey = null;
      sendResponse({ ok: true });
      break;

    default:
      sendResponse({ ok: false });
  }
  return true; // Keep channel open for async
});

// Clear key when all extension views close
chrome.runtime.onConnect.addListener((port) => {
  port.onDisconnect.addListener(() => {
    // Optionally auto-lock after popup closes — comment out to keep unlocked
    // inMemoryKey = null;
  });
});
