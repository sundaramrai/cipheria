'use client';

const AUTH_HANDOFF_STORAGE_KEY = 'cipheria:auth-handoff';
const AUTH_HANDOFF_TTL_MS = 2 * 60 * 1000;

type AuthHandoffPayload = {
  version: 1;
  createdAt: number;
  userId: string;
  keyMaterial: string;
  masterPasswordVerifier: string;
};

function getSessionStorage(): Storage | null {
  if (globalThis.window === undefined) return null;
  try {
    return globalThis.window.sessionStorage;
  } catch {
    return null;
  }
}

function isAuthHandoffPayload(value: unknown): value is AuthHandoffPayload {
  const handoff = value as Partial<AuthHandoffPayload> | null;
  return Boolean(
    handoff?.version === 1
    && typeof handoff.createdAt === 'number'
    && typeof handoff.userId === 'string'
    && typeof handoff.keyMaterial === 'string'
    && typeof handoff.masterPasswordVerifier === 'string',
  );
}

export function saveAuthHandoff(payload: Omit<AuthHandoffPayload, 'version' | 'createdAt'>): void {
  const sessionStorage = getSessionStorage();
  if (!sessionStorage) return;

  try {
    sessionStorage.setItem(
      AUTH_HANDOFF_STORAGE_KEY,
      JSON.stringify({
        ...payload,
        version: 1,
        createdAt: Date.now(),
      } satisfies AuthHandoffPayload),
    );
  } catch {
    // Best effort only. Normal client-side navigation still works without this fallback.
  }
}

export function clearAuthHandoff(): void {
  const sessionStorage = getSessionStorage();
  if (!sessionStorage) return;

  try {
    sessionStorage.removeItem(AUTH_HANDOFF_STORAGE_KEY);
  } catch {
    // Ignore cleanup failures.
  }
}

export function consumeAuthHandoff(expectedUserId?: string | null): AuthHandoffPayload | null {
  const sessionStorage = getSessionStorage();
  if (!sessionStorage) return null;

  try {
    const raw = sessionStorage.getItem(AUTH_HANDOFF_STORAGE_KEY);
    if (!raw) return null;

    clearAuthHandoff();
    const parsed = JSON.parse(raw) as unknown;
    if (!isAuthHandoffPayload(parsed)) return null;
    if (Date.now() - parsed.createdAt > AUTH_HANDOFF_TTL_MS) return null;
    if (expectedUserId && parsed.userId !== expectedUserId) return null;
    return parsed;
  } catch {
    clearAuthHandoff();
    return null;
  }
}
