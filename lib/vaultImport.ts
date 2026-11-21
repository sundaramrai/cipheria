import { decryptData, deriveKey, encryptData } from './crypto.ts';
import type { DecryptedPayload } from './types';
import { unlockKey, validateEnvelope, type KeyEnvelope } from './vaultKeys.ts';

export const MAX_EXPORT_BYTES = 2 * 1024 * 1024;
const MAX_IMPORT_BYTES = 3 * 1024 * 1024;
const fields = new Set([
  'username', 'password', 'url', 'cardNumber', 'cardHolder', 'expiry', 'cvv',
  'firstName', 'lastName', 'phone', 'address', 'notes',
]);

interface ImportItem {
  id?: string;
  name: string;
  category: string;
  encrypted_data: string;
  is_favourite: boolean;
  created_at: string;
}

export interface ImportRequest {
  operation_id: string;
  destination_salt: string;
  items: ImportItem[];
}

export interface ImportPreview {
  items: Array<ImportItem & { duplicate: boolean; duplicateOf?: number; sourceRow?: number }>;
  duplicateCount: number;
}

export type PlainImportItem = Omit<ImportItem, 'encrypted_data'> & {
  payload: DecryptedPayload;
  sourceRow?: number;
};

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseExport(value: unknown): { vault_salt: string; items: ImportItem[]; key_envelope?: KeyEnvelope } {
  if (!record(value) || !['1.0', '2.0'].includes(String(value.export_version)) ||
      typeof value.vault_salt !== 'string' || !/^[a-f\d]{64}$/i.test(value.vault_salt) ||
      !Array.isArray(value.items) || !value.items.length || value.items.length > 1000) {
    throw new Error('Choose a Cipheria JSON export containing 1 to 1000 items.');
  }
  const items = value.items.map((item: unknown) => {
    if (!record(item) || typeof item.name !== 'string' || !item.name.length || item.name.length > 255 ||
        typeof item.category !== 'string' || !['login', 'card', 'note', 'identity'].includes(item.category) ||
        typeof item.encrypted_data !== 'string' || item.encrypted_data.length > 100_000 ||
        !(value.export_version === '2.0' ? /^v2\.[A-Za-z0-9+/]{16}\.[A-Za-z0-9+/]+={0,2}$/ : /^[A-Za-z0-9+/]{16}\.[A-Za-z0-9+/]+={0,2}$/).test(item.encrypted_data) ||
        (value.export_version === '2.0' && (typeof item.id !== 'string' || !/^[a-f0-9-]{36}$/.test(item.id))) ||
        typeof item.is_favourite !== 'boolean' || typeof item.created_at !== 'string' ||
        !Number.isFinite(Date.parse(item.created_at))) {
      throw new Error('The export contains an invalid or unsupported item. Nothing was imported.');
    }
    return {
      name: item.name, category: item.category, encrypted_data: item.encrypted_data,
      ...(typeof item.id === 'string' ? { id: item.id } : {}),
      is_favourite: item.is_favourite, created_at: item.created_at,
    };
  });
  const key_envelope = value.export_version === '2.0' ? validateEnvelope(value.key_envelope) : undefined;
  if (key_envelope && key_envelope.salt !== value.vault_salt) throw new Error('Export key parameters differ');
  return { vault_salt: value.vault_salt, items, key_envelope };
}

function validatePayload(value: unknown): DecryptedPayload {
  if (!record(value) || Object.entries(value).some(([key, entry]) => {
    if (key !== 'password_history') return !fields.has(key) || typeof entry !== 'string';
    return !Array.isArray(entry) || entry.length > 5 || entry.some((old: unknown) =>
      !record(old) || Object.keys(old).some(field => field !== 'password' && field !== 'replaced_at') ||
      typeof old.password !== 'string' || typeof old.replaced_at !== 'string' ||
      !Number.isFinite(Date.parse(old.replaced_at)));
  })) {
    throw new Error('The export contains unsupported item contents. Nothing was imported.');
  }
  return value as DecryptedPayload;
}

// Local canonical comparison only: no plaintext or comparison tokens reach the API.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (record(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function fingerprint(name: string, category: string, payload: object): string {
  // Older entries and browser CSVs differ in how they represent empty optional fields.
  const normalized = Object.fromEntries(Object.entries(payload).filter(([field, value]) =>
    value !== '' && !(field === 'password_history' && Array.isArray(value) && value.length === 0)));
  return canonical({ name, category, payload: normalized });
}

export async function prepareImport(
  source: string,
  password: string,
  destinationKey: CryptoKey,
  existing: ImportItem[],
  signal: AbortSignal,
): Promise<ImportPreview> {
  signal.throwIfAborted();
  if (new TextEncoder().encode(source).byteLength > MAX_EXPORT_BYTES) {
    throw new Error('Choose an export smaller than 2 MiB.');
  }
  let parsed: unknown;
  try { parsed = JSON.parse(source); } catch { throw new Error('The selected file is not valid JSON.'); }
  const exported = parseExport(parsed);
  let sourceKey: CryptoKey;
  try { sourceKey = exported.key_envelope ? await unlockKey(password, exported.key_envelope) : await deriveKey(password, exported.vault_salt); }
  catch { throw new Error('The export password is incorrect or its key is damaged. Nothing was imported.'); }
  signal.throwIfAborted();
  async function* entries(): AsyncGenerator<PlainImportItem> {
    for (const item of exported.items) {
      signal.throwIfAborted();
      let decrypted: unknown;
      try { decrypted = await decryptData(item.encrypted_data, sourceKey, item.id); } catch {
        throw new Error('The export password is incorrect or an item is damaged. Nothing was imported.');
      }
      yield { ...item, payload: validatePayload(decrypted) };
    }
  }
  return prepareImportItems(entries(), destinationKey, existing, signal);
}

export async function prepareImportItems(
  source: Iterable<PlainImportItem> | AsyncIterable<PlainImportItem>,
  destinationKey: CryptoKey,
  existing: ImportItem[],
  signal: AbortSignal,
): Promise<ImportPreview> {
  signal.throwIfAborted();
  const known = new Set<string>();
  for (const item of existing) {
    signal.throwIfAborted();
    const payload = await decryptData(item.encrypted_data, destinationKey, item.id);
    known.add(fingerprint(item.name, item.category, payload));
  }
  const items: ImportPreview['items'] = [];
  const firstOccurrences = new Map<string, number>();
  for await (const { payload, ...item } of source) {
    signal.throwIfAborted();
    if (items.length >= 1000) throw new Error('Choose at most 1000 items.');
    const itemFingerprint = fingerprint(item.name, item.category, payload);
    const duplicateOf = firstOccurrences.get(itemFingerprint);
    const duplicate = known.has(itemFingerprint) || duplicateOf !== undefined;
    if (duplicateOf === undefined) firstOccurrences.set(itemFingerprint, items.length);
    const id = crypto.randomUUID();
    const encrypted_data = await encryptData(payload, destinationKey, id);
    if (encrypted_data.length > 100_000) throw new Error('An item exceeds the import size limit.');
    signal.throwIfAborted();
    items.push({ ...item, id, encrypted_data, duplicate, ...(duplicateOf === undefined ? {} : { duplicateOf }) });
  }
  return { items, duplicateCount: items.filter(item => item.duplicate).length };
}

export function selectImportItems(preview: ImportPreview, skipDuplicates: boolean, selected?: ReadonlySet<number>) {
  const includedGroups = new Set<number>();
  return preview.items.filter((item, index) => {
    if (selected && !selected.has(index)) return false;
    const group = item.duplicateOf ?? index;
    if (skipDuplicates && (preview.items[group].duplicate || includedGroups.has(group))) return false;
    includedGroups.add(group);
    return true;
  });
}

export function buildImportRequest(
  preview: ImportPreview, destinationSalt: string, skipDuplicates: boolean, selected?: ReadonlySet<number>,
): ImportRequest {
  const items = selectImportItems(preview, skipDuplicates, selected)
    .map(({ id, name, category, encrypted_data, is_favourite, created_at }) =>
      ({ id, name, category, encrypted_data, is_favourite, created_at }));
  if (!items.length) throw new Error('There are no new items to import.');
  const request = { operation_id: crypto.randomUUID(), destination_salt: destinationSalt, items };
  if (new TextEncoder().encode(JSON.stringify(request)).byteLength > MAX_IMPORT_BYTES) {
    throw new Error('The prepared import exceeds the 3 MiB request limit.');
  }
  return request;
}
