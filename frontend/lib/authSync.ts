export type AuthSyncEvent = {
  type: 'logout' | 'lock';
  id: string;
  tabId: string;
};

const AUTH_SYNC_CHANNEL = 'cipheria-auth';
const AUTH_SYNC_STORAGE_KEY = 'cipheria:auth-event';

let tabId: string | null = null;

function getTabId() {
  if (globalThis.window === undefined) return 'server';
  if (tabId) return tabId;

  tabId =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  return tabId;
}

function createEvent(type: AuthSyncEvent['type']): AuthSyncEvent {
  return {
    type,
    id:
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    tabId: getTabId(),
  };
}

export function emitAuthEvent(type: AuthSyncEvent['type']) {
  if (globalThis.window === undefined) return;

  const event = createEvent(type);
  const payload = JSON.stringify(event);

  try {
    globalThis.window.localStorage.setItem(AUTH_SYNC_STORAGE_KEY, payload);
  } catch {
    // Ignore storage failures and still attempt BroadcastChannel delivery.
  }

  if (typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel(AUTH_SYNC_CHANNEL);
    channel.postMessage(event);
    channel.close();
  }
}

export function subscribeToAuthEvents(onEvent: (event: AuthSyncEvent) => void) {
  if (globalThis.window === undefined) return () => undefined;

  let lastHandledId: string | null = null;
  let channel: BroadcastChannel | null = null;

  const handleEvent = (event: AuthSyncEvent) => {
    if (event.id === lastHandledId || event.tabId === getTabId()) return;
    lastHandledId = event.id;
    onEvent(event);
  };

  const handleStorage = (event: StorageEvent) => {
    if (event.key !== AUTH_SYNC_STORAGE_KEY || !event.newValue) return;
    try {
      handleEvent(JSON.parse(event.newValue) as AuthSyncEvent);
    } catch {
      // Ignore malformed storage payloads.
    }
  };

  globalThis.window.addEventListener('storage', handleStorage);

  if (typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel(AUTH_SYNC_CHANNEL);
    channel.onmessage = (event: MessageEvent<AuthSyncEvent>) => {
      handleEvent(event.data);
    };
  }

  return () => {
    globalThis.window.removeEventListener('storage', handleStorage);
    channel?.close();
  };
}
