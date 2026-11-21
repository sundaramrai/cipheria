import { generateSaltHex } from './crypto.ts';

export interface KeyEnvelope {
  version: 2;
  vault_id: string;
  key_id: string;
  kdf: 'PBKDF2-SHA256';
  iterations: 600000;
  salt: string;
  wrapped_key: string;
}

const encoder = new TextEncoder();
const contexts = new WeakMap<CryptoKey, KeyEnvelope>();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function validateEnvelope(value: unknown): KeyEnvelope {
  const e = value as KeyEnvelope | null;
  if (!e || e.version !== 2 || typeof e.vault_id !== 'string' || !uuid.test(e.vault_id)
    || typeof e.key_id !== 'string' || !uuid.test(e.key_id)
    || e.kdf !== 'PBKDF2-SHA256' || e.iterations !== 600000 || typeof e.salt !== 'string' || !/^[a-f0-9]{64}$/.test(e.salt)
    || Object.keys(e).some(field => !['version', 'vault_id', 'key_id', 'kdf', 'iterations', 'salt', 'wrapped_key'].includes(field))
    || typeof e.wrapped_key !== 'string' || !/^[A-Za-z0-9+/]{16}\.[A-Za-z0-9+/]{64}$/.test(e.wrapped_key)) {
    throw new Error('Unsupported vault key envelope');
  }
  return e;
}

function bytes(value: string) { return Uint8Array.from(atob(value), c => c.charCodeAt(0)); }
function base64(value: ArrayBuffer | Uint8Array) { return btoa(String.fromCharCode(...new Uint8Array(value))); }
function wrappingContext(e: KeyEnvelope) {
  return encoder.encode(JSON.stringify(['cipheria-key', 2, e.vault_id, e.key_id, e.kdf, e.iterations, e.salt]));
}

async function passwordKey(password: string, salt: string, purpose: 'wrap' | 'authenticate') {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', iterations: 600000,
    salt: encoder.encode(`cipheria:v2:${purpose}:${salt}`) }, material, 256);
}

async function kek(password: string, e: KeyEnvelope) {
  validateEnvelope(e);
  return crypto.subtle.importKey('raw', await passwordKey(password, e.salt, 'wrap'), 'AES-GCM', false, ['wrapKey', 'unwrapKey']);
}

export async function verifierV2(password: string, salt: string) {
  if (!/^[a-f0-9]{64}$/.test(salt)) throw new Error('Invalid vault salt');
  return Array.from(new Uint8Array(await passwordKey(password, salt, 'authenticate')), b => b.toString(16).padStart(2, '0')).join('');
}

async function wrap(key: CryptoKey, password: string, envelope: KeyEnvelope) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.wrapKey('raw', key, await kek(password, envelope),
    { name: 'AES-GCM', iv, additionalData: wrappingContext(envelope) });
  return { ...envelope, wrapped_key: `${base64(iv)}.${base64(encrypted)}` };
}

export async function unlockKey(password: string, envelope: KeyEnvelope, extractable = false): Promise<CryptoKey> {
  const e = validateEnvelope(envelope);
  const [iv, ciphertext] = e.wrapped_key.split('.');
  const key = await crypto.subtle.unwrapKey('raw', bytes(ciphertext), await kek(password, e),
    { name: 'AES-GCM', iv: bytes(iv), additionalData: wrappingContext(e) }, 'AES-GCM', extractable, ['encrypt', 'decrypt']);
  contexts.set(key, { ...e });
  return key;
}

export async function createVaultKey(password: string, vaultId = crypto.randomUUID()) {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const envelope = await wrap(key, password, { version: 2, vault_id: vaultId, key_id: crypto.randomUUID(),
    kdf: 'PBKDF2-SHA256', iterations: 600000, salt: generateSaltHex(), wrapped_key: `${'A'.repeat(16)}.${'A'.repeat(64)}` });
  return { envelope, key: await unlockKey(password, envelope) };
}

export async function rewrapVaultKey(currentPassword: string, nextPassword: string, envelope: KeyEnvelope) {
  // The ordinary active key stays non-extractable. This temporary unwrap is
  // scoped to the password operation and is never retained in application state.
  const temporary = await unlockKey(currentPassword, envelope, true);
  return wrap(temporary, nextPassword, { ...envelope, salt: generateSaltHex() });
}

export function itemContext(key: CryptoKey, itemId?: string): Uint8Array<ArrayBuffer> | undefined {
  const e = contexts.get(key);
  if (!e) return undefined;
  if (!itemId || !uuid.test(itemId)) throw new Error('An item ID is required for version 2 encryption');
  return encoder.encode(JSON.stringify(['cipheria-item', 2, e.vault_id, itemId, e.key_id]));
}
