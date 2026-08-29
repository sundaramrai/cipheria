import type { UserProfile } from '@/lib/types';

export type AuthSyncEvent = {
  type: 'logout' | 'lock' | 'user-updated';
  id: string;
  tabId: string;
  user?: UserProfile;
};

const AUTH_SYNC_CHANNEL = 'cipheria-auth';
const AUTH_SYNC_STORAGE_KEY = 'cipheria:auth-event';

let tabId: string | null = null;

function createSecureEventId(): string {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  // randomUUID is unavailable in older browsers and non-secure local contexts.
  // getRandomValues is widely supported there and remains cryptographically strong.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function getTabId() {
  if (globalThis.window === undefined) return 'server';
  if (tabId) return tabId;

  tabId = createSecureEventId();

  return tabId;
}

function createEvent(type: AuthSyncEvent['type'], user?: UserProfile): AuthSyncEvent {
  return {
    type,
    id: createSecureEventId(),
    tabId: getTabId(),
    ...(user ? { user } : {}),
  };
}

export function emitAuthEvent(type: AuthSyncEvent['type'], user?: UserProfile) {
  if (globalThis.window === undefined) return;

  const event = createEvent(type, user);
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
