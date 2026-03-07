'use client';
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { toastService } from '@/lib/toast';
import { getItemLoadError } from '@/lib/errors';
import { useAuthStore, VaultItem } from '@/lib/store';
import { vaultApi, authApi } from '@/lib/api';
import { deriveKey, encryptData, decryptData } from '@/lib/crypto';
import { Category, IDLE_MS, genOptions, emptyForm } from '../../../components/dashboard/types';
import { tryGetFaviconUrl, fetchAndDecryptItem, buildPayload } from '../../../components/dashboard/utils';
import { LockedVaultScreen } from '../../../components/dashboard/LockedVaultScreen';
import { MainDashboard } from '../../../components/dashboard/MainDashboard';

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

// # vault unlock hook
function useVaultUnlock(
  user: any,
  setVaultKey: (k: CryptoKey) => void,
  setVaultItems: (items: VaultItem[]) => void,
  setTotalPages: (n: number) => void,
) {
  const [masterPassword, setMasterPassword] = useState('');
  const [unlocking, setUnlocking] = useState(false);
  const [signout, setSignout] = useState(false);
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
          update('Verifying master password...');
          const { data: listResult } = await vaultApi.list({ page_size: 50 });
          const items: VaultItem[] = listResult.items;
          if (items.length > 0) {
            try {
              // items[0].encrypted_data is always present — list endpoint includes it
              await decryptData(items[0].encrypted_data!, key);
            } catch (verifyErr) {
              console.error('[unlock] Key verification failed:', verifyErr);
              throw new Error('WRONG_PASSWORD');
            }
          }
          setVaultKey(key);
          update('Decrypting items...');
          const decryptedItems = await Promise.all(
            items.map(async (item) => {
              if (!item.encrypted_data) return item;
              try {
                const dec = await decryptData(item.encrypted_data, key);
                return { ...item, decrypted: dec };
              } catch {
                return item;
              }
            }),
          );
          setVaultItems(decryptedItems);
          setTotalPages(listResult.total_pages ?? 1);
          setMasterPassword('');
        },
        'Vault unlocked',
        {
          getError: (err: any) => {
            if (err?.message === 'WRONG_PASSWORD') return 'Wrong master password';
            if (err?.message === 'NO_SALT') return 'Session error — please sign out and sign in again';
            console.error('[unlock] Error:', err);
            return 'Failed to unlock vault';
          },
        },
      );
    } finally {
      setUnlocking(false);
    }
  };
  return { masterPassword, setMasterPassword, unlocking, signout, setSignout, unlockVault };
}

export default function Dashboard() {
  const router = useRouter();
  const {
    user, cryptoKey, isAuthenticated, vaultItems, isVaultLocked,
    setVaultKey, setVaultItems, addVaultItem, updateVaultItem, removeVaultItem,
    logout, lockVault, restoreSession,
  } = useAuthStore();
  const [category, setCategory] = useState<Category>('all');
  const [search, setSearch] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedItem, setSelectedItem] = useState<VaultItem | null>(null);
  const [newItem, setNewItem] = useState(emptyForm);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editForm, setEditForm] = useState<typeof emptyForm | null>(null);
  const [savingItem, setSavingItem] = useState(false);
  const [updatingItem, setUpdatingItem] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [selectedItemLoading, setSelectedItemLoading] = useState(false);
  const [searchResults, setSearchResults] = useState<VaultItem[] | null>(null);
  const [hibp, setHibp] = useState<{ checking: boolean; count: number | null }>({ checking: false, count: null });
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);
  const decryptingItemIds = useRef(new Set<string>());
  const currentSelectionRef = useRef<string | null>(null);
  const { masterPassword, setMasterPassword, unlocking, signout, setSignout, unlockVault } =
    useVaultUnlock(user, setVaultKey, setVaultItems, setTotalPages);

  // # session restore
  useEffect(() => {
    if (isAuthenticated) { setSessionLoading(false); return; }
    restoreSession().then((ok) => {
      if (ok) { setSessionLoading(false); return; }
      router.push('/auth');
    });
  }, []);

  // # idle auto-lock
  useEffect(() => {
    if (isVaultLocked) return;
    const reset = () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      idleTimerRef.current = setTimeout(() => {
        lockVault();
        toastService.notify('Vault auto-locked after 5 min of inactivity', { icon: '🔒' });
      }, IDLE_MS);
    };
    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'] as const;
    events.forEach((e) => globalThis.addEventListener(e, reset, { passive: true }));
    reset();
    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      events.forEach((e) => globalThis.removeEventListener(e, reset));
    };
  }, [isVaultLocked]);

  // # clear state on vault lock
  useEffect(() => {
    if (isVaultLocked) {
      setSearch('');
      setSearchResults(null);
      decryptingItemIds.current.clear();
      currentSelectionRef.current = null;
    }
  }, [isVaultLocked]);

  const handleLogout = async () => {
    try { await authApi.logout(); } catch { }
    logout();
    router.push('/auth');
  };

  // # item selection and decryption
  const handleSelectItem = useCallback(async (item: VaultItem) => {
    setSelectedItem(item);
    setHibp({ checking: false, count: null });
    currentSelectionRef.current = item.id;
    const { vaultItems: storeItems, cryptoKey: liveKey } = useAuthStore.getState();
    const cached = storeItems.find((v) => v.id === item.id);
    if (cached?.decrypted) { setSelectedItem(cached); return; }
    if (item.decrypted) return;  // already decrypted (e.g. from search results)
    if (!liveKey) return;
    if (decryptingItemIds.current.has(item.id)) return;
    decryptingItemIds.current.add(item.id);
    setSelectedItemLoading(true);
    try {
      const enriched = await fetchAndDecryptItem(item);
      if (currentSelectionRef.current === item.id) setSelectedItem(enriched);
    } catch (err: any) {
      console.error('[handleSelectItem] Failed for item', item.id, err);
      toastService.error(getItemLoadError(err));
      decryptingItemIds.current.delete(item.id);
    } finally {
      if (currentSelectionRef.current === item.id) setSelectedItemLoading(false);
    }
  }, []);

  // # debounced search
  const handleSearchChange = useCallback((val: string) => {
    setSearch(val);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchAbortRef.current?.abort();
    if (!val) { setSearchResults(null); setPage(1); return; }
    searchDebounceRef.current = setTimeout(async () => {
      const controller = new AbortController();
      searchAbortRef.current = controller;
      try {
        const { data } = await vaultApi.list({ search: val }, controller.signal);
        if (controller.signal.aborted) return;
        const key = useAuthStore.getState().cryptoKey;
        const storeItems = useAuthStore.getState().vaultItems;
        const decryptedResults = key
          ? await Promise.all(data.items.map((item: VaultItem) => decryptSearchItem(item, key, storeItems)))
          : data.items;
        if (!controller.signal.aborted) setSearchResults(decryptedResults);
      } catch (err: any) {
        if (err?.code !== 'ERR_CANCELED' && err?.name !== 'AbortError') {
          console.error('Search error:', err);
        }
      }
    }, 300);
  }, []);

  const buildEncryptedPayload = async (form: typeof emptyForm) => {
    if (!cryptoKey) throw new Error('Crypto key not available');
    const payload = buildPayload(form);
    const encrypted_data = await encryptData(payload, cryptoKey);
    return { payload, encrypted_data };
  };

  const handleAddItem = async (e: React.SyntheticEvent) => {
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
          addVaultItem({ ...data, decrypted: payload });
          setShowAddModal(false);
          setNewItem(emptyForm);
        },
        'Item added to vault',
        { fallbackError: 'Failed to save item' },
      );
    } finally { setSavingItem(false); }
  };

  const handleOpenEdit = useCallback((item: VaultItem) => {
    const d = item.decrypted ?? {};
    setEditForm({
      name: item.name, category: item.category,
      username: d.username ?? '', password: d.password ?? '', url: d.url ?? '', notes: d.notes ?? '',
      cardNumber: d.cardNumber ?? '', cardHolder: d.cardHolder ?? '', expiry: d.expiry ?? '', cvv: d.cvv ?? '',
      firstName: d.firstName ?? '', lastName: d.lastName ?? '', phone: d.phone ?? '', address: d.address ?? '',
    });
    setHibp({ checking: false, count: null });
    setShowEditModal(true);
  }, []);

  const handleEditItem = async (e: React.SyntheticEvent) => {
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
            ? tryGetFaviconUrl(editForm.url) ?? selectedItem.favicon_url
            : selectedItem.favicon_url;
          const { data } = await vaultApi.update(selectedItem.id, { name: editForm.name, category: editForm.category, encrypted_data, favicon_url });
          const updated = { ...data, decrypted: payload };
          updateVaultItem(selectedItem.id, updated);
          setSelectedItem(updated);
          setShowEditModal(false);
          setEditForm(null);
        },
        'Item updated',
        { fallbackError: 'Failed to update item' },
      );
    } finally { setUpdatingItem(false); }
  };

  const handleDelete = async (id: string, onAfterDelete?: () => void) => {
    if (deletingId) return;
    setDeletingId(id);
    try {
      await toastService.withProgress(
        'Deleting item...',
        async () => {
          await vaultApi.delete(id);
          removeVaultItem(id);
          if (selectedItem?.id === id) {
            setSelectedItem(null);
            onAfterDelete?.();
          }
        },
        'Item deleted',
        { fallbackError: 'Failed to delete' },
      );
    } finally { setDeletingId(null); }
  };

  const handleToggleFav = async (item: VaultItem) => {
    try {
      await vaultApi.update(item.id, { is_favourite: !item.is_favourite });
      const updated = { ...item, is_favourite: !item.is_favourite };
      updateVaultItem(item.id, updated);
      if (selectedItem?.id === item.id) setSelectedItem(updated);
    } catch { }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toastService.success(`${label} copied!`);
    setTimeout(() => navigator.clipboard.writeText(''), 30000);
  };

  const handleExport = async () => {
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
  };

  const handlePageChange = useCallback(async (newPage: number) => {
    try {
      const { data } = await vaultApi.list({ page: newPage, page_size: 50 });
      const key = useAuthStore.getState().cryptoKey;
      const decryptedItems = key
        ? await Promise.all(
          data.items.map(async (item: any) => {
            try {
              const dec = await decryptData(item.encrypted_data, key);
              return { ...item, decrypted: dec };
            } catch {
              return item;
            }
          }),
        )
        : data.items;
      setVaultItems(decryptedItems);
      setPage(newPage);
      setTotalPages(data.total_pages ?? 1);
      decryptingItemIds.current.clear();
      setSelectedItem(null);
    } catch (err) {
      console.error('[pagination] Failed to load page', newPage, err);
    }
  }, [setVaultItems]);

  const filteredItems = useMemo(
    () => (searchResults ?? vaultItems).filter((item) => category === 'all' || item.category === category),
    [searchResults, vaultItems, category],
  );

  if (sessionLoading) {
    return (
      <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
        <div style={{ color: 'var(--text-secondary)', fontSize: 14 }}>Loading...</div>
      </div>
    );
  }

  if (isVaultLocked) {
    return (
      <LockedVaultScreen
        user={user}
        masterPassword={masterPassword}
        setMasterPassword={setMasterPassword}
        unlocking={unlocking}
        signout={signout}
        setSignout={setSignout}
        unlockVault={unlockVault}
        handleLogout={handleLogout}
      />
    );
  }

  return (
    <MainDashboard
      user={user}
      category={category}
      setCategory={setCategory}
      searchValue={search}
      onSearchChange={handleSearchChange}
      handleExport={handleExport}
      lockVault={lockVault}
      handleLogout={handleLogout}
      vaultItems={vaultItems}
      selectedItem={selectedItem}
      handleSelectItem={handleSelectItem}
      selectedItemLoading={selectedItemLoading}
      handleToggleFav={handleToggleFav}
      handleOpenEdit={handleOpenEdit}
      handleDelete={handleDelete}
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
    />
  );
}