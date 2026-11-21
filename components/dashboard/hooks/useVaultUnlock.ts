'use client';

import { useState } from 'react';
import type React from 'react';
import { authApi } from '@/lib/api';
import { decryptData, deriveKey, deriveMasterPasswordVerifier } from '@/lib/crypto';
import { getSessionAwareError, parseApiError } from '@/lib/errors';
import { toastService } from '@/lib/toast';
import { useAuthStore } from '@/lib/store';
import { unlockKey, type KeyEnvelope } from '@/lib/vaultKeys';
import type { SidebarCounts, VaultItem } from '@/lib/types';

export function useVaultUnlock(
  user: { id: string; vault_salt?: string; key_envelope?: KeyEnvelope | null } | null,
  setVaultKey: (key: CryptoKey) => void,
  setVaultItems: (items: VaultItem[]) => void,
  setTotalPages: (totalPages: number) => void,
  setTotalItems: (totalItems: number) => void,
  setSidebarCounts: (counts: SidebarCounts) => void,
  cacheAllView: (items: VaultItem[], totalPages: number, totalItems: number) => void,
) {
  const [masterPassword, setMasterPassword] = useState('');
  const [unlocking, setUnlocking] = useState(false);
  const unlockVault = async (event: React.SyntheticEvent) => {
    event.preventDefault();
    if (unlocking) return;
    const lockVersion = useAuthStore.getState().lockVersion;
    setUnlocking(true);
    try {
      await toastService.withProgress(
        'Unlocking vault...',
        async (update) => {
          const salt = user?.vault_salt;
          if (!salt) throw new Error('NO_SALT');
          const verifier = await deriveMasterPasswordVerifier(masterPassword, salt, user?.key_envelope ? 2 : 1);
          update('Unlocking vault...');
          const { data: listResult } = await authApi.unlock(verifier);
          const key = user?.key_envelope ? await unlockKey(masterPassword, user.key_envelope) : await deriveKey(masterPassword, salt);
          const items: VaultItem[] = listResult.items;
          update('Decrypting items...');
          const decryptedItems = await Promise.all(
            items.map(async (item) => {
              if (!item.encrypted_data) return item;
              try {
                return { ...item, decrypted: await decryptData(item.encrypted_data, key, item.id) };
              } catch {
                return item;
              }
            }),
          );
          const currentState = useAuthStore.getState();
          const currentUser = currentState.user;
          if (currentState.lockVersion !== lockVersion) {
            setMasterPassword('');
            throw new Error('Vault locked while unlocking. Enter your master password again.');
          }
          if (currentUser?.id !== user?.id || currentUser?.vault_salt !== salt
            || currentUser?.key_envelope?.key_id !== user?.key_envelope?.key_id) {
            throw new Error('Vault changed while unlocking. Use the current master password.');
          }
          setVaultItems(decryptedItems);
          setTotalPages(listResult.total_pages ?? 1);
          setTotalItems(listResult.total ?? 0);
          if (listResult.sidebar_counts) {
            setSidebarCounts(listResult.sidebar_counts);
          }
          cacheAllView(
            decryptedItems,
            listResult.total_pages ?? 1,
            listResult.total ?? 0,
          );
          // Populate the first page before showing the unlocked dashboard.
          setVaultKey(key);
          setMasterPassword('');
        },
        'Vault unlocked',
        {
          getError: (err: unknown) => {
            const error = err as Error;
            const apiMessage = parseApiError(err, '');
            if (error?.message === 'WRONG_PASSWORD' || apiMessage === 'Invalid master password') {
              return 'Wrong master password';
            }
            if (error?.message === 'NO_SALT') return 'Session error - please sign out and sign in again';
            if ((err as { response?: { status?: number } })?.response?.status === 401) {
              return getSessionAwareError(err, 'Session expired - please sign in again');
            }
            console.error('[unlock] Error:', err);
            return parseApiError(err, 'Failed to unlock vault');
          },
        },
      );
    } finally {
      setUnlocking(false);
    }
  };
  return { masterPassword, setMasterPassword, unlocking, unlockVault };
}
