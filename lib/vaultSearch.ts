import type { DecryptedPayload, PaginatedVaultItems, VaultItem } from './types';

export function itemMatchesSearch(item: VaultItem, term: string): boolean {
  const needle = term.trim().toLowerCase();
  const fields = item.decrypted ?? item.search_fields;
  return [item.name, fields?.username, fields?.url]
    .some(value => typeof value === 'string' && value.toLowerCase().includes(needle));
}

/** Fetch every page; retain searchable fields without retaining decrypted passwords. */
export async function loadSearchItems(
  fetchPage: (page: number) => Promise<PaginatedVaultItems<VaultItem>>,
  decrypt: (encrypted: string) => Promise<DecryptedPayload>,
  signal: AbortSignal,
): Promise<VaultItem[]> {
  const items: VaultItem[] = [];
  let totalPages = 1;
  for (let page = 1; page <= totalPages; page++) {
    signal.throwIfAborted();
    const data = await fetchPage(page); // NOSONAR -- Sequential pages provide the page count and allow cancellation between requests.
    signal.throwIfAborted();
    totalPages = data.total_pages;
    const batch = await Promise.all(data.items.map(async item => { // NOSONAR -- Bound concurrent decryption to one page before fetching more ciphertext.
      if (item.category !== 'login') return item;
      if (!item.encrypted_data) throw new Error('Missing encrypted login data');
      const payload = await decrypt(item.encrypted_data);
      return { ...item, search_fields: {
        username: typeof payload.username === 'string' ? payload.username : '',
        url: typeof payload.url === 'string' ? payload.url : '',
      } };
    }));
    signal.throwIfAborted();
    items.push(...batch);
  }
  return items;
}
