'use client';

/**
 * crypto.ts — Client-side AES-256-GCM encryption using the Web Crypto API.
 *
 * Security model:
 * - User's master password → PBKDF2 (600k iterations, SHA-256) → 256-bit key
 * - The vault salt comes from the server (unique per user, never changes)
 * - Each vault item is encrypted independently: AES-256-GCM with a fresh 12-byte IV
 * - The server stores only ciphertext — it cannot decrypt any vault data
 * - The derived key lives only in memory; it's never persisted
 */

const PBKDF2_ITERATIONS = 600_000;
const KEY_LENGTH = 256;

async function deriveKeyBits(masterPassword: string, saltHex: string): Promise<ArrayBuffer> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(masterPassword),
    'PBKDF2',
    false,
    ['deriveBits'],
  );

  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: hexToBytes(saltHex), iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    KEY_LENGTH,
  );
}

async function hashBytesHex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return bytesToHex(new Uint8Array(digest));
}

export function generateSaltHex(bytes = 32): string {
  const array = new Uint8Array(bytes);
  crypto.getRandomValues(array);
  return bytesToHex(array);
}

export async function deriveMasterPasswordVerifier(
  masterPassword: string,
  saltHex: string,
): Promise<string> {
  const keyBits = await deriveKeyBits(masterPassword, saltHex);
  return hashBytesHex(keyBits);
}

// Key Derivation
export async function deriveKey(masterPassword: string, saltHex: string): Promise<CryptoKey> {
  const keyBits = await deriveKeyBits(masterPassword, saltHex);
  return crypto.subtle.importKey(
    'raw',
    keyBits,
    { name: 'AES-GCM', length: KEY_LENGTH },
    false,
    ['encrypt', 'decrypt'],
  );
}

// Encrypt
export async function encryptData(data: object, key: CryptoKey): Promise<string> {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const plaintext = new TextEncoder().encode(JSON.stringify(data));

  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);

  return `${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(ciphertext))}`;
}

// Decrypt
export async function decryptData<T = Record<string, unknown>>(
  encrypted: string,
  key: CryptoKey,
): Promise<T> {
  const [ivB64, ciphertextB64] = encrypted.split('.');
  const iv = base64ToBytes(ivB64);
  const ciphertext = base64ToBytes(ciphertextB64);

  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);

  return JSON.parse(new TextDecoder().decode(plaintext)) as T;
}

// Helpers
function bytesToBase64(bytes: Uint8Array<ArrayBuffer>): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCodePoint(byte);
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.codePointAt(i) ?? 0;
  return bytes;
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(hex.length / 2));
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = Number.parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array<ArrayBuffer>): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// Password Generator
export function generatePassword(options: {
  length: number;
  uppercase: boolean;
  lowercase: boolean;
  numbers: boolean;
  symbols: boolean;
}): string {
  const { length, uppercase, lowercase, numbers, symbols } = options;
  let charset = '';
  if (uppercase) charset += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  if (lowercase) charset += 'abcdefghijklmnopqrstuvwxyz';
  if (numbers) charset += '0123456789';
  if (symbols) charset += '!@#$%^&*()_+-=[]{}|;:,.<>?';

  if (!charset) charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

  const array = new Uint32Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, (x) => charset[x % charset.length]).join('');
}

// HIBP Pwned Passwords — k-anonymity model (SHA-1 prefix, never sends full hash)
/**
 * Client-side session cache only.
 * This Map is module-level — safe in the browser (one instance per tab).
 * Do NOT use this module in SSR/edge context without clearing the cache
 * between requests, as it would be shared across users in the same instance.
 */
const _hibpCache = new Map<string, number>();

export async function checkHIBP(password: string): Promise<number> {
  const cached = _hibpCache.get(password);
  if (typeof cached === 'number') return cached;
  const encoded = new TextEncoder().encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-1', encoded);
  const hashHex = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
  const prefix = hashHex.slice(0, 5);
  const suffix = hashHex.slice(5);

  const response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
    headers: { 'Add-Padding': 'true' }, // prevents traffic-analysis of result count
  });
  if (!response.ok) throw new Error('HIBP API unavailable');

  const text = await response.text();
  const line = text.split('\n').find((l) => l.trimStart().startsWith(suffix));
  const count = line ? Number.parseInt(line.split(':')[1], 10) : 0;
  _hibpCache.set(password, count);
  return count;
}

// Password Strength
export function passwordStrength(password: string): {
  score: number;
  label: string;
  color: string;
} {
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 16) score++;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;

  const levels = [
    { label: 'Very Weak', color: 'var(--danger)' },
    { label: 'Weak', color: 'var(--strength-weak)' },
    { label: 'Fair', color: 'var(--strength-fair)' },
    { label: 'Strong', color: 'var(--strength-strong)' },
    { label: 'Very Strong', color: 'var(--success)' },
  ];

  return { score, ...levels[Math.min(score, 4)] };
}
