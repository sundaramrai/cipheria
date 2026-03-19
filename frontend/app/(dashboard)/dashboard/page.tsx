'use client';
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { toastService } from '@/lib/toast';
import { getItemLoadError, parseApiError } from '@/lib/errors';
import { useAuthStore } from '@/lib/store';
import type { SidebarCounts, VaultItem } from '@/lib/types';
import { vaultApi, authApi } from '@/lib/api';
import { emitAuthEvent, subscribeToAuthEvents } from '@/lib/authSync';
import type { AuthSyncEvent } from '@/lib/authSync';
import { deriveKey, deriveMasterPasswordVerifier, encryptData, decryptData, generateSaltHex } from '@/lib/crypto';
import { Category, genOptions, emptyForm } from '../../../components/dashboard/types';
import type { ItemForm } from '../../../components/dashboard/types';
import { tryGetFaviconUrl, fetchAndDecryptItem, buildPayload } from '../../../components/dashboard/utils';
import { useIdleTimer } from '@/components/dashboard/hooks/useIdleTimer';
import { LockedVaultScreen } from '../../../components/dashboard/LockedVaultScreen';
import { MainDashboard } from '../../../components/dashboard/MainDashboard';
import { SettingsModal } from '@/components/dashboard/SettingsModal';

async function decryptSearchItem(item: VaultItem, key: CryptoKey, storeItems: VaultItem[]): Promise<VaultItem> {
  const cached = storeItems.find((v) => v.id === item.id);
  if (cached?.decrypted) return cached;
  if (!item.encrypted_data) return item;
  try {
    return { ...item, decrypted: await decryptData(item.encrypted_data, key) };
  } catch {
    return item;
  }
}

function toItemFormCategory(category: string): ItemForm['category'] {
  return category === 'card' || category === 'note' || category === 'identity'
    ? category
    : 'login';
}

function applyFavUpdate(
  prev: VaultItem[] | null,
  itemId: string,
  updated: VaultItem,
): VaultItem[] | null {
  return prev?.map((result) => (result.id === itemId ? updated : result)) ?? null;
}

const EMPTY_SIDEBAR_COUNTS: SidebarCounts = {
  all: 0,
  login: 0,
  card: 0,
  note: 0,
  identity: 0,
  favourites: 0,
  trash: 0,
};

function FullScreenMessage({ message }: Readonly<{ message: string }>) {
  return (
    <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
      <div style={{ color: 'var(--text-secondary)', fontSize: 14 }}>{message}</div>
    </div>
  );
}

type CachedViewKey = 'all' | 'favourites' | 'trash';

type CachedViewState = {
  items: VaultItem[];
  page: number;
  totalPages: number;
  totalItems: number;
};

function sidebarCountDelta(item: Pick<VaultItem, 'category' | 'is_favourite' | 'is_deleted'> | null): SidebarCounts {
  const delta = { ...EMPTY_SIDEBAR_COUNTS };
  if (!item) return delta;

  if (item.is_deleted) {
    delta.trash = 1;
    return delta;
  }

  delta.all = 1;
  if (item.category === 'login' || item.category === 'card' || item.category === 'note' || item.category === 'identity') {
    delta[item.category] = 1;
  }
  if (item.is_favourite) {
    delta.favourites = 1;
  }
  return delta;
}

// Vault unlock sub-hook
function useVaultUnlock(
  user: { vault_salt?: string } | null,
  setVaultKey: (k: CryptoKey) => void,
  setVaultItems: (items: VaultItem[]) => void,
  setTotalPages: (n: number) => void,
  setTotalItems: (n: number) => void,
  setSidebarCounts: (counts: SidebarCounts) => void,
  cacheAllView: (items: VaultItem[], totalPages: number, totalItems: number) => void,
) {
  const [masterPassword, setMasterPassword] = useState('');
  const [unlocking, setUnlocking] = useState(false);
  const unlockVault = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    setUnlocking(true);
    try {
      await toastService.withProgress(
        'Unlocking vault...',
        async (update) => {
          const salt = user?.vault_salt;
          if (!salt) throw new Error('NO_SALT');
          const key = await deriveKey(masterPassword, salt);
          const verifier = await deriveMasterPasswordVerifier(masterPassword, salt);
          update('Unlocking vault...');
          const { data: listResult } = await authApi.unlock(verifier);
          const items: VaultItem[] = listResult.items;
          setVaultKey(key);
          update('Decrypting items...');
          const decryptedItems = await Promise.all(
            items.map(async (item) => {
              if (!item.encrypted_data) return item;
              try {
                return { ...item, decrypted: await decryptData(item.encrypted_data, key) };
              } catch {
                return item;
              }
            }),
          );
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
          setMasterPassword('');
        },
        'Vault unlocked',
        {
          getError: (err: unknown) => {
            const e = err as Error;
            if (e?.message === 'WRONG_PASSWORD') return 'Wrong master password';
            if (e?.message === 'NO_SALT') return 'Session error — please sign out and sign in again';
            if ((err as { response?: { status?: number } })?.response?.status === 401) {
              return 'Wrong master password';
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

export default function Page() {
  const router = useRouter();
  const {
    user, cryptoKey, isAuthenticated, vaultItems, isVaultLocked,
    setUser, setVaultKey, setVaultItems, addVaultItem, updateVaultItem, removeVaultItem,
    logout, lockVault, restoreSession,
  } = useAuthStore();
  const [category, setCategory] = useState<Category>('all');
  const [search, setSearch] = useState('');
  const [isFavouritesView, setIsFavouritesView] = useState(false);
  const [isTrashView, setIsTrashView] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [selectedItem, setSelectedItem] = useState<VaultItem | null>(null);
  const [newItem, setNewItem] = useState({ ...emptyForm });
  const [sessionLoading, setSessionLoading] = useState(true);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editForm, setEditForm] = useState<ItemForm | null>(null);
  const [savingItem, setSavingItem] = useState(false);
  const [updatingItem, setUpdatingItem] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [selectedItemLoading, setSelectedItemLoading] = useState(false);
  const [searchResults, setSearchResults] = useState<VaultItem[] | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [listLoading, setListLoading] = useState(false);
  const [hibp, setHibp] = useState<{ checking: boolean; count: number | null }>({ checking: false, count: null });
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState<number | null>(null);
  const [sidebarCounts, setSidebarCounts] = useState<SidebarCounts>(EMPTY_SIDEBAR_COUNTS);
  const [profileForm, setProfileForm] = useState({ full_name: '', master_hint: '' });
  const [masterPasswordForm, setMasterPasswordForm] = useState({ password: '', confirm: '', master_hint: '' });
  const [deletePassword, setDeletePassword] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [verificationSending, setVerificationSending] = useState(false);
  const [masterPasswordSaving, setMasterPasswordSaving] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);
  const decryptingItemIds = useRef(new Set<string>());
  const currentSelectionRef = useRef<string | null>(null);
  const viewCacheRef = useRef<Partial<Record<CachedViewKey, CachedViewState>>>({});
  const setCachedView = useCallback((key: CachedViewKey, items: VaultItem[], currentPage: number, nextTotalPages: number, nextTotalItems: number) => {
    viewCacheRef.current[key] = {
      items,
      page: currentPage,
      totalPages: nextTotalPages,
      totalItems: nextTotalItems,
    };
  }, []);
  const invalidateCachedViews = useCallback((exceptKey?: CachedViewKey) => {
    if (!exceptKey) {
      viewCacheRef.current = {};
      return;
    }
    const preserved = viewCacheRef.current[exceptKey];
    viewCacheRef.current = preserved ? { [exceptKey]: preserved } : {};
  }, []);
  const restoreCachedView = useCallback((key: CachedViewKey) => {
    const cached = viewCacheRef.current[key];
    if (!cached) return false;
    setVaultItems(cached.items);
    setPage(cached.page);
    setTotalPages(cached.totalPages);
    setTotalItems(cached.totalItems);
    decryptingItemIds.current.clear();
    setSelectedItem(null);
    return true;
  }, [setVaultItems]);
  const applySidebarCountsChange = useCallback((previousItem: VaultItem | null, nextItem: VaultItem | null) => {
    const previousDelta = sidebarCountDelta(previousItem);
    const nextDelta = sidebarCountDelta(nextItem);
    setSidebarCounts((prev) => ({
      all: Math.max(0, prev.all - previousDelta.all + nextDelta.all),
      login: Math.max(0, prev.login - previousDelta.login + nextDelta.login),
      card: Math.max(0, prev.card - previousDelta.card + nextDelta.card),
      note: Math.max(0, prev.note - previousDelta.note + nextDelta.note),
      identity: Math.max(0, prev.identity - previousDelta.identity + nextDelta.identity),
      favourites: Math.max(0, prev.favourites - previousDelta.favourites + nextDelta.favourites),
      trash: Math.max(0, prev.trash - previousDelta.trash + nextDelta.trash),
    }));
  }, []);
  const { masterPassword, setMasterPassword, unlocking, unlockVault } =
    useVaultUnlock(
      user,
      setVaultKey,
      setVaultItems,
      setTotalPages,
      setTotalItems,
      setSidebarCounts,
      (items, nextTotalPages, nextTotalItems) => setCachedView('all', items, 1, nextTotalPages, nextTotalItems),
    );

  // Idle auto-lock (extracted hook)
  const handleLockVault = useCallback(() => {
    lockVault();
    emitAuthEvent('lock');
  }, [lockVault]);

  useIdleTimer(isVaultLocked, handleLockVault);
  // Session restore
  useEffect(() => {
    let active = true;

    if (isAuthenticated) {
      setSessionLoading(false);
      return () => {
        active = false;
      };
    }

    void restoreSession().then((ok) => {
      if (!active) return;
      setSessionLoading(false);
      if (ok) return;
      router.replace('/auth');
    });

    return () => {
      active = false;
    };
  }, [isAuthenticated, restoreSession, router]);

  useEffect(() => {
    return subscribeToAuthEvents((event: AuthSyncEvent) => {
      if (event.type === 'logout') {
        logout();
        router.replace('/auth');
        return;
      }

      if (event.type === 'lock') {
        lockVault();
        return;
      }

      if (event.type === 'user-updated') {
        void authApi.me()
          .then(({ data }) => setUser(data))
          .catch(() => {
            // Ignore transient sync failures; the next restore/me path will recover.
          });
      }
    });
  }, [lockVault, logout, router, setUser]);

  useEffect(() => {
    if (isVaultLocked) {
      setSearch('');
      setSearchResults(null);
      setSidebarCounts(EMPTY_SIDEBAR_COUNTS);
      viewCacheRef.current = {};
      decryptingItemIds.current.clear();
      currentSelectionRef.current = null;
    }
  }, [isVaultLocked]);

  useEffect(() => {
    setProfileForm({
      full_name: user?.full_name ?? '',
      master_hint: user?.master_hint ?? '',
    });
    setMasterPasswordForm((prev) => ({ ...prev, master_hint: user?.master_hint ?? '' }));
  }, [user]);

  const loadVaultPage = useCallback(async (
    newPage: number,
    {
      deletedOnly = isTrashView,
      favouritesOnly = isFavouritesView,
    }: { deletedOnly?: boolean; favouritesOnly?: boolean } = {},
  ) => {
    setListLoading(true);
    try {
      const { data } = await vaultApi.list({
        page: newPage,
        page_size: 50,
        deleted_only: deletedOnly,
        favourites_only: deletedOnly ? false : favouritesOnly,
      });
      const { cryptoKey: key } = useAuthStore.getState();
      const decryptedItems = key
        ? await Promise.all(
          data.items.map(async (item: VaultItem) => {
            try {
              if (!item.encrypted_data) return item;
              return { ...item, decrypted: await decryptData(item.encrypted_data, key) };
            } catch {
              return item;
            }
          }),
        )
        : data.items;
      setVaultItems(decryptedItems);
      setPage(newPage);
      setTotalPages(data.total_pages ?? 1);
      setTotalItems(data.total ?? 0);
      if (data.sidebar_counts) {
        setSidebarCounts(data.sidebar_counts);
      }
      let cacheKey: CachedViewKey;
      if (deletedOnly) {
        cacheKey = 'trash';
      } else if (favouritesOnly) {
        cacheKey = 'favourites';
      } else {
        cacheKey = 'all';
      }
      setCachedView(
        cacheKey,
        decryptedItems,
        newPage,
        data.total_pages ?? 1,
        data.total ?? 0,
      );
      decryptingItemIds.current.clear();
      setSelectedItem(null);
    } finally {
      setListLoading(false);
    }
  }, [isFavouritesView, isTrashView, setCachedView, setVaultItems]);

  const buildEncryptedPayload = useCallback(async (form: ItemForm) => {
    if (!cryptoKey) throw new Error('Crypto key not available');
    const payload = buildPayload(form);
    const encrypted_data = await encryptData(payload, cryptoKey);
    return { payload, encrypted_data };
  }, [cryptoKey]);

  const handleLogout = useCallback(async () => {
    try { await authApi.logout(); } catch { /* ignore network errors on logout */ }
    logout();
    emitAuthEvent('logout');
    router.replace('/auth');
  }, [logout, router]);

  const handleMasterPasswordChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => setMasterPassword(e.target.value),
    [setMasterPassword],
  );

  // Item selection + decryption
  const handleSelectItem = useCallback(async (item: VaultItem) => {
    setSelectedItem(item);
    setHibp({ checking: false, count: null });
    currentSelectionRef.current = item.id;
    const { vaultItems: storeItems, cryptoKey: liveKey } = useAuthStore.getState();
    const cached = storeItems.find((v) => v.id === item.id);
    if (cached?.decrypted) { setSelectedItem(cached); return; }
    if (item.decrypted || !liveKey) return;
    if (decryptingItemIds.current.has(item.id)) return;
    decryptingItemIds.current.add(item.id);
    setSelectedItemLoading(true);
    try {
      const enriched = await fetchAndDecryptItem(item, liveKey, updateVaultItem);
      if (currentSelectionRef.current === item.id) setSelectedItem(enriched);
    } catch (err: unknown) {
      console.error('[handleSelectItem] Failed for item', item.id, err);
      toastService.error(getItemLoadError(err));
      decryptingItemIds.current.delete(item.id);
    } finally {
      if (currentSelectionRef.current === item.id) setSelectedItemLoading(false);
    }
  }, [updateVaultItem]);

  // Debounced search
  const handleSearchChange = useCallback((val: string) => {
    setSearch(val);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchAbortRef.current?.abort();
    if (!val) { setSearchResults(null); setSearchLoading(false); setPage(1); return; }
    if (totalItems === 0) { setSearchResults([]); return; }
    searchDebounceRef.current = setTimeout(async () => {
      setSearchLoading(true);
      const controller = new AbortController();
      searchAbortRef.current = controller;
      try {
        const { data } = await vaultApi.list({
          search: val,
          deleted_only: isTrashView,
          favourites_only: isTrashView ? false : isFavouritesView,
        }, controller.signal);
        if (controller.signal.aborted) return;
        const { cryptoKey: key, vaultItems: storeItems } = useAuthStore.getState();
        const decryptedResults = key
          ? await Promise.all(data.items.map((item: VaultItem) => decryptSearchItem(item, key, storeItems)))
          : data.items;
        if (!controller.signal.aborted) setSearchResults(decryptedResults);
      } catch (err: unknown) {
        const e = err as { code?: string; name?: string };
        if (e?.code !== 'ERR_CANCELED' && e?.name !== 'AbortError') {
          console.error('Search error:', err);
        }
      } finally {
        setSearchLoading(false);
      }
    }, 300);
  }, [isFavouritesView, isTrashView, totalItems]);

  const handleAddItem = useCallback(async (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (!cryptoKey) return;
    if (newItem.category === 'login' && newItem.url && !/^https?:\/\//i.exec(newItem.url)) {
      toastService.error('URL must start with http:// or https://');
      return;
    }
    setSavingItem(true);
    try {
      await toastService.withProgress(
        'Saving to vault...',
        async () => {
          const { payload, encrypted_data } = await buildEncryptedPayload(newItem);
          const favicon_url = newItem.url ? tryGetFaviconUrl(newItem.url) : undefined;
          const { data } = await vaultApi.create({ name: newItem.name, category: newItem.category, encrypted_data, favicon_url });
          const createdItem = { ...data, decrypted: payload };
          addVaultItem(createdItem);
          applySidebarCountsChange(null, createdItem);
          invalidateCachedViews();
          setShowAddModal(false);
          setNewItem({ ...emptyForm });
        },
        'Item added to vault',
        { fallbackError: 'Failed to save item' },
      );
    } finally { setSavingItem(false); }
  }, [cryptoKey, newItem, addVaultItem, applySidebarCountsChange, buildEncryptedPayload, invalidateCachedViews]);

  const handleOpenEdit = useCallback((item: VaultItem) => {
    const d = item.decrypted ?? {};
    setEditForm({
      name: item.name, category: toItemFormCategory(item.category),
      username: d.username ?? '', password: d.password ?? '', url: d.url ?? '', notes: d.notes ?? '',
      cardNumber: d.cardNumber ?? '', cardHolder: d.cardHolder ?? '', expiry: d.expiry ?? '', cvv: d.cvv ?? '',
      firstName: d.firstName ?? '', lastName: d.lastName ?? '', phone: d.phone ?? '', address: d.address ?? '',
    });
    setHibp({ checking: false, count: null });
    setShowEditModal(true);
  }, []);

  const handleEditItem = useCallback(async (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (!cryptoKey || !editForm || !selectedItem) return;
    if (editForm.category === 'login' && editForm.url && !/^https?:\/\//i.exec(editForm.url)) {
      toastService.error('URL must start with http:// or https://');
      return;
    }
    setUpdatingItem(true);
    try {
      await toastService.withProgress(
        'Updating item...',
        async () => {
          const { payload, encrypted_data } = await buildEncryptedPayload(editForm);
          const favicon_url = editForm.url
            ? (tryGetFaviconUrl(editForm.url) ?? selectedItem.favicon_url)
            : selectedItem.favicon_url;
          const { data } = await vaultApi.update(selectedItem.id, { name: editForm.name, category: editForm.category, encrypted_data, favicon_url });
          const updated = { ...data, decrypted: payload };
          updateVaultItem(selectedItem.id, updated);
          setSelectedItem(updated);
          applySidebarCountsChange(selectedItem, updated);
          invalidateCachedViews();
          setShowEditModal(false);
          setEditForm(null);
        },
        'Item updated',
        { fallbackError: 'Failed to update item' },
      );
    } finally { setUpdatingItem(false); }
  }, [cryptoKey, editForm, selectedItem, updateVaultItem, applySidebarCountsChange, buildEncryptedPayload, invalidateCachedViews]);

  const handleDelete = useCallback(async (id: string, onAfterDelete?: () => void) => {
    if (deletingId) return;
    setDeletingId(id);
    try {
      await toastService.withProgress(
        'Moving item to trash...',
        async () => {
          const itemToDelete = vaultItems.find((item) => item.id === id) ?? (selectedItem?.id === id ? selectedItem : null);
          await vaultApi.delete(id);
          removeVaultItem(id);
          if (itemToDelete) {
            applySidebarCountsChange(itemToDelete, { ...itemToDelete, is_deleted: true });
          }
          invalidateCachedViews();
          if (selectedItem?.id === id) {
            setSelectedItem(null);
            onAfterDelete?.();
          }
        },
        'Moved item to trash',
        { fallbackError: 'Failed to move item to trash' },
      );
    } finally { setDeletingId(null); }
  }, [deletingId, selectedItem, removeVaultItem, vaultItems, applySidebarCountsChange, invalidateCachedViews]);

  const handleToggleFav = useCallback(async (item: VaultItem) => {
    const adding = !item.is_favourite;
    await toastService.withProgress(
      adding ? 'Adding to favourites...' : 'Removing from favourites...',
      async () => {
        await vaultApi.update(item.id, { is_favourite: adding });
        const updated = { ...item, is_favourite: adding };
        updateVaultItem(item.id, updated);
        if (selectedItem?.id === item.id) setSelectedItem(updated);
        if (searchResults) {
          setSearchResults((prev) => applyFavUpdate(prev, item.id, updated));
        }
        if (isFavouritesView && !adding && selectedItem?.id === item.id) {
          setSelectedItem(null);
        }
        applySidebarCountsChange(item, updated);
        invalidateCachedViews();
      },
      adding ? 'Added to favourites' : 'Removed from favourites',
      { fallbackError: 'Failed to update favourite' },
    );
  }, [isFavouritesView, searchResults, selectedItem, updateVaultItem, applySidebarCountsChange, invalidateCachedViews]);

  const copyToClipboard = useCallback((text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toastService.success(`${label} copied!`);
    setTimeout(() => navigator.clipboard.writeText(''), 30_000);
  }, []);

  const handleExport = useCallback(async () => {
    await toastService.withProgress(
      'Exporting vault...',
      async () => {
        const { data } = await vaultApi.export();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'cipheria-export.json'; a.click();
      },
      'Vault exported',
      { fallbackError: 'Export failed' },
    );
  }, []);

  const handleSaveProfile = useCallback(async (e: React.SyntheticEvent) => {
    e.preventDefault();
    setProfileSaving(true);
    try {
      const { data } = await authApi.updateProfile({
        full_name: profileForm.full_name || null,
        master_hint: profileForm.master_hint || null,
      });
      setUser(data);
      toastService.success('Profile updated');
    } catch (err) {
      toastService.error(getItemLoadError(err));
    } finally {
      setProfileSaving(false);
    }
  }, [profileForm, setUser]);

  const handleResendVerification = useCallback(async () => {
    setVerificationSending(true);
    try {
      const { data } = await authApi.requestEmailVerification();
      toastService.success(data.message);
    } catch (err) {
      toastService.error(getItemLoadError(err));
    } finally {
      setVerificationSending(false);
    }
  }, []);

  const handleChangeMasterPassword = useCallback(async (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (!cryptoKey || !user) {
      toastService.error('Unlock the vault before changing the master password');
      return;
    }
    if (!masterPasswordForm.password || masterPasswordForm.password !== masterPasswordForm.confirm) {
      toastService.error('Master password confirmation does not match');
      return;
    }

    setMasterPasswordSaving(true);
    try {
      const newSalt = generateSaltHex();
      const nextKey = await deriveKey(masterPasswordForm.password, newSalt);
      const nextVerifier = await deriveMasterPasswordVerifier(masterPasswordForm.password, newSalt);
      const { data } = await vaultApi.export();
      const items = await Promise.all(
        (data.items as Array<{ id: string; encrypted_data: string }>).map(async (item) => {
          const payload = await decryptData(item.encrypted_data, cryptoKey);
          const encrypted_data = await encryptData(payload, nextKey);
          return { id: item.id, encrypted_data };
        }),
      );
      const { data: updatedUser } = await authApi.changeMasterPassword({
        new_vault_salt: newSalt,
        new_master_password_verifier: nextVerifier,
        master_hint: masterPasswordForm.master_hint || null,
        items,
      });
      setUser(updatedUser);
      setMasterPasswordForm({ password: '', confirm: '', master_hint: updatedUser.master_hint ?? '' });
      lockVault();
      emitAuthEvent('lock');
      setShowSettingsModal(false);
      toastService.success('Master password changed. Unlock with the new password.');
    } catch (err) {
      toastService.error(getItemLoadError(err));
    } finally {
      setMasterPasswordSaving(false);
    }
  }, [cryptoKey, lockVault, masterPasswordForm, setUser, user]);

  const handleDeleteAccount = useCallback(async (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (!deletePassword) {
      toastService.error('Enter your master password to delete the account');
      return;
    }
    if (!user?.vault_salt) {
      toastService.error('Session error - please sign out and sign in again');
      return;
    }
    setDeletingAccount(true);
    try {
      const verifier = await deriveMasterPasswordVerifier(deletePassword, user.vault_salt);
      await authApi.deleteAccount(verifier);
      emitAuthEvent('logout');
      logout();
      router.replace('/auth');
    } catch (err) {
      toastService.error(getItemLoadError(err));
    } finally {
      setDeletingAccount(false);
    }
  }, [deletePassword, logout, router, user]);

  const handleRestoreItem = useCallback(async (id: string) => {
    await toastService.withProgress(
      'Restoring item...',
      async () => {
        const existingItem = vaultItems.find((item) => item.id === id) ?? (selectedItem?.id === id ? selectedItem : null);
        const { data } = await vaultApi.restore(id);
        updateVaultItem(id, data);
        if (existingItem) {
          applySidebarCountsChange(existingItem, data);
        }
        if (selectedItem?.id === id) {
          setSelectedItem(null);
        }
        invalidateCachedViews();
        await loadVaultPage(page);
      },
      'Restored item',
      { fallbackError: 'Failed to restore item' },
    );
  }, [loadVaultPage, page, selectedItem, updateVaultItem, vaultItems, applySidebarCountsChange, invalidateCachedViews]);

  const handleDeletePermanent = useCallback(async (id: string) => {
    if (deletingId) return;
    setDeletingId(id);
    try {
      await toastService.withProgress(
        'Item deleting permanently...',
        async () => {
          const existingItem = vaultItems.find((item) => item.id === id) ?? (selectedItem?.id === id ? selectedItem : null);
          await vaultApi.deletePermanent(id);
          removeVaultItem(id);
          if (existingItem) {
            applySidebarCountsChange(existingItem, null);
          }
          if (selectedItem?.id === id) setSelectedItem(null);
          invalidateCachedViews();
          await loadVaultPage(page);
        },
        'Item permanently deleted',
        { fallbackError: 'Failed to permanently delete item' },
      );
    } finally {
      setDeletingId(null);
    }
  }, [deletingId, loadVaultPage, page, removeVaultItem, selectedItem, vaultItems, applySidebarCountsChange, invalidateCachedViews]);

  const handlePageChange = useCallback(async (newPage: number) => {
    try {
      await loadVaultPage(newPage);
    } catch (err) {
      console.error('[pagination] Failed to load page', newPage, err);
    }
  }, [loadVaultPage]);

  const handleCategoryChange = useCallback(async (nextCategory: Category) => {
    setCategory(nextCategory);
    if (!isTrashView && !isFavouritesView) return;
    setIsFavouritesView(false);
    setIsTrashView(false);
    setSearch('');
    setSearchResults(null);
    if (restoreCachedView('all')) return;
    try {
      await loadVaultPage(1, { deletedOnly: false, favouritesOnly: false });
    } catch (err) {
      console.error('[category] Failed to switch view', err);
    }
  }, [isFavouritesView, isTrashView, loadVaultPage, restoreCachedView]);

  const handleToggleFavourites = useCallback(async () => {
    const next = !isFavouritesView;
    setIsFavouritesView(next);
    setIsTrashView(false);
    setSearch('');
    setSearchResults(null);
    if (restoreCachedView(next ? 'favourites' : 'all')) return;
    try {
      await loadVaultPage(1, { deletedOnly: false, favouritesOnly: next });
    } catch (err) {
      console.error('[favourites] Failed to switch view', err);
    }
  }, [isFavouritesView, loadVaultPage, restoreCachedView]);

  const handleToggleTrash = useCallback(async () => {
    const next = !isTrashView;
    setIsTrashView(next);
    setIsFavouritesView(false);
    setSearch('');
    setSearchResults(null);
    if (restoreCachedView(next ? 'trash' : 'all')) return;
    try {
      await loadVaultPage(1, { deletedOnly: next, favouritesOnly: false });
    } catch (err) {
      console.error('[trash] Failed to switch view', err);
    }
  }, [isTrashView, loadVaultPage, restoreCachedView]);

  const handleOpenSettings = useCallback(() => setShowSettingsModal(true), []);
  const handleCloseSettings = useCallback(() => setShowSettingsModal(false), []);

  const filteredItems = useMemo(
    () => {
      const items = searchResults ?? vaultItems;
      if (isTrashView) {
        return items;
      } else if (isFavouritesView) {
        return items.filter((item) => item.is_favourite);
      } else {
        return items.filter((item) => category === 'all' || item.category === category);
      }
    },
    [searchResults, vaultItems, category, isFavouritesView, isTrashView],
  );

  if (sessionLoading) return <FullScreenMessage message="Loading..." />;

  if (!isAuthenticated) return <FullScreenMessage message="Redirecting to sign in..." />;

  if (isVaultLocked) return (
    <LockedVaultScreen
      user={user}
      masterPassword={masterPassword}
      onMasterPasswordChange={handleMasterPasswordChange}
      unlocking={unlocking}
      unlockVault={unlockVault}
      handleLogout={handleLogout}
    />
  );

  return (
    <>
      <MainDashboard
        user={user}
        category={category}
        setCategory={handleCategoryChange}
        searchValue={search}
        onSearchChange={handleSearchChange}
        handleExport={handleExport}
        onOpenSettings={handleOpenSettings}
        onToggleFavourites={handleToggleFavourites}
        onToggleTrash={handleToggleTrash}
        isFavouritesView={isFavouritesView}
        isTrashView={isTrashView}
        lockVault={handleLockVault}
        handleLogout={handleLogout}
        vaultItems={vaultItems}
        sidebarCounts={sidebarCounts}
        selectedItem={selectedItem}
        handleSelectItem={handleSelectItem}
        selectedItemLoading={selectedItemLoading}
        handleToggleFav={handleToggleFav}
        handleOpenEdit={handleOpenEdit}
        handleDelete={handleDelete}
        handleRestoreItem={handleRestoreItem}
        handleDeletePermanent={handleDeletePermanent}
        deletingId={deletingId}
        copyToClipboard={copyToClipboard}
        hibp={hibp}
        setHibp={setHibp}
        showAddModal={showAddModal}
        setShowAddModal={setShowAddModal}
        newItem={newItem}
        setNewItem={setNewItem}
        savingItem={savingItem}
        genOptions={genOptions}
        handleAddItem={handleAddItem}
        showEditModal={showEditModal}
        setShowEditModal={setShowEditModal}
        editForm={editForm}
        setEditForm={setEditForm}
        updatingItem={updatingItem}
        handleEditItem={handleEditItem}
        filteredItems={filteredItems}
        page={page}
        totalPages={totalPages}
        onPageChange={handlePageChange}
        isSearchActive={searchResults !== null}
        searchLoading={searchLoading || listLoading}
      />
      {showSettingsModal && (
        <SettingsModal
          user={user}
          profileForm={profileForm}
          setProfileForm={setProfileForm}
          masterPasswordForm={masterPasswordForm}
          setMasterPasswordForm={setMasterPasswordForm}
          deletePassword={deletePassword}
          setDeletePassword={setDeletePassword}
          profileSaving={profileSaving}
          verificationSending={verificationSending}
          masterPasswordSaving={masterPasswordSaving}
          deletingAccount={deletingAccount}
          onClose={handleCloseSettings}
          onSaveProfile={handleSaveProfile}
          onResendVerification={handleResendVerification}
          onChangeMasterPassword={handleChangeMasterPassword}
          onDeleteAccount={handleDeleteAccount}
        />
      )}
    </>
  );
}
