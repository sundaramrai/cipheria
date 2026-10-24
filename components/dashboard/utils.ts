import { vaultApi } from '@/lib/api';
import { decryptData } from '@/lib/crypto';
import type { VaultItem } from '@/lib/types';

import type { Category, ItemForm } from './types';

/**
 * Fetches missing ciphertext and decrypts it with the supplied vault key.
 * The caller's onUpdate callback decides whether the result still belongs
 * in the current vault state after navigation or locking.
 */
export const fetchAndDecryptItem = async (item: VaultItem,
    key: CryptoKey,
    onUpdate: (id: string, enriched: VaultItem) => void,
): Promise<VaultItem> => {
    let encryptedData = item.encrypted_data;
    if (!encryptedData) {
        const { data } = await vaultApi.get(item.id);
        encryptedData = data.encrypted_data as string;
    }
    if (!encryptedData?.includes('.')) throw new Error('BAD_FORMAT');
    let dec: unknown;
    try {
        dec = await decryptData(encryptedData, key);
    } catch (cryptoErr) {
        console.error('[decrypt] WebCrypto error for item', item.id, cryptoErr);
        throw new Error('CRYPTO_FAIL', { cause: cryptoErr });
    }
    const enriched: VaultItem = { ...item, encrypted_data: encryptedData, decrypted: dec as VaultItem['decrypted'] };
    onUpdate(item.id, enriched);
    return enriched;
};

/** Selects the category's fields for encryption, excluding listing metadata. */
export const buildPayload = (form: ItemForm) => {
    switch (form.category as Category) {
        case 'card':
            return { cardNumber: form.cardNumber, cardHolder: form.cardHolder, expiry: form.expiry, cvv: form.cvv, notes: form.notes };
        case 'identity':
            return { firstName: form.firstName, lastName: form.lastName, phone: form.phone, address: form.address, notes: form.notes };
        case 'note':
            return { notes: form.notes };
        default:
            return { username: form.username, password: form.password, url: form.url, notes: form.notes };
    }
};
