'use client';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { toastService } from '@/lib/toast';
import { getItemLoadError, getSessionAwareError } from '@/lib/errors';
import { useAuthStore } from '@/lib/store';
import type { DecryptedPayload, VaultItem } from '@/lib/types';
import { vaultApi, authApi } from '@/lib/api';
import { emitAuthEvent } from '@/lib/authSync';
import { deriveKey, deriveMasterPasswordVerifier, encryptData, decryptData, generateSaltHex, withPasswordHistory } from '@/lib/crypto';
import { Category, emptyForm } from '../../../components/dashboard/types';
import type { ItemForm } from '../../../components/dashboard/types';
import { fetchAndDecryptItem, buildPayload } from '../../../components/dashboard/utils';
import { useDashboardSession } from '@/components/dashboard/hooks/useDashboardSession';
import { useVaultUnlock } from '@/components/dashboard/hooks/useVaultUnlock';
import { useVaultViews } from '@/components/dashboard/hooks/useVaultViews';
import {
  applySidebarDelta, buildViewRequest, clampPage, computeTotalPages, getMatchDelta,
  getViewCacheKey, itemMatchesView, reconcileVisibleItems,
} from '@/components/dashboard/vaultView';
import { itemMatchesSearch } from '@/lib/vaultSearch';
import { LockedVaultScreen } from '../../../components/dashboard/LockedVaultScreen';
import { MainDashboard } from '../../../components/dashboard/MainDashboard';
import { SettingsModal } from '@/components/dashboard/SettingsModal';

function toItemFormCategory(category: string): ItemForm['category'] {
  return category === 'card' || category === 'note' || category === 'identity'
    ? category
    : 'login';
}

function FullScreenMessage({ message }: Readonly<{ message: string }>) {
  return (
    <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
      <div style={{ color: 'var(--text-secondary)', fontSize: 14 }}>{message}</div>
    </div>
  );
}

export default function Page() {
  const router = useRouter();
  const {
    user, cryptoKey, isAuthenticated, vaultItems, isVaultLocked,
    setUser, setVaultKey, setVaultItems, updateVaultItem,
    logout, lockVault,
  } = useAuthStore();
  const [showAddModal, setShowAddModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [selectedItem, setSelectedItem] = useState<VaultItem | null>(null);
  const [newItem, setNewItem] = useState<ItemForm>({ ...emptyForm });
  const [showEditModal, setShowEditModal] = useState(false);
  const [editForm, setEditForm] = useState<ItemForm | null>(null);
  const [savingItem, setSavingItem] = useState(false);
  const [updatingItem, setUpdatingItem] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [selectedItemLoading, setSelectedItemLoading] = useState(false);
  const [hibp, setHibp] = useState<{ checking: boolean; count: number | null }>({ checking: false, count: null });
  const [profileForm, setProfileForm] = useState({ full_name: '', master_hint: '' });
  const [masterPasswordForm, setMasterPasswordForm] = useState({ current_password: '', password: '', confirm: '', master_hint: '' });
  const [deletePassword, setDeletePassword] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [verificationSending, setVerificationSending] = useState(false);
  const [masterPasswordSaving, setMasterPasswordSaving] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const decryptingItemIds = useRef(new Set<string>());
  const currentSelectionRef = useRef<string | null>(null);
  const { sessionLoading, handleLockVault, handleLogout } = useDashboardSession();
  const clearSelection = useCallback(() => {
    currentSelectionRef.current = null;
    setSelectedItem(null);
    setSelectedItemLoading(false);
    setHibp({ checking: false, count: null });
  }, []);
  const {
    category, setCategory, viewMode, setViewMode, isFavouritesView, isTrashView,
    listLoading, page, setPage, totalPages, setTotalPages, totalItems, setTotalItems,
    sidebarCounts, setSidebarCounts, getCurrentView, setCachedView, cacheAllView,
    invalidateCachedViews, restoreCachedView, restoreOrHydrateView, loadVaultPage,
    search, searchError, resetSearch, runSearch, queueSearch,
  } = useVaultViews({ isAuthenticated, isVaultLocked, setVaultItems, clearSelection });
  const activeViewRef = useRef({ view: getCurrentView(), search: '', page: 1 });
  const viewSwitchRef = useRef(0);
  useEffect(() => {
    activeViewRef.current = { view: getCurrentView(), search: search.trim().toLowerCase(), page };
  }, [getCurrentView, page, search]);
  const { masterPassword, setMasterPassword, unlocking, unlockVault } =
    useVaultUnlock(
      user,
      setVaultKey,
      setVaultItems,
      setTotalPages,
      setTotalItems,
      setSidebarCounts,
      cacheAllView,
    );
  const getKnownItemById = useCallback((id: string) => {
    if (selectedItem?.id === id) return selectedItem;
    return vaultItems.find((item) => item.id === id) ?? null;
  }, [selectedItem, vaultItems]);

  useEffect(() => {
    if (isVaultLocked) {
      decryptingItemIds.current.clear();
      clearSelection();
    }
  }, [clearSelection, isVaultLocked]);

  useEffect(() => {
    setProfileForm({
      full_name: user?.full_name ?? '',
      master_hint: user?.master_hint ?? '',
    });
    setMasterPasswordForm((prev) => ({ ...prev, master_hint: user?.master_hint ?? '' }));
  }, [user]);

  const refreshCurrentView = useCallback(async (
    targetPage = page,
    view = getCurrentView(),
  ) => {
    if (search.trim()) {
      await runSearch(search, page, view);
      return;
    }
    await loadVaultPage(targetPage, view);
  }, [getCurrentView, loadVaultPage, page, runSearch, search]);

  const applyOptimisticMutation = useCallback((
    before: VaultItem | null,
    after: VaultItem | null,
    view = getCurrentView(),
  ) => {
    if (useAuthStore.getState().isVaultLocked) return;
    const activeSearch = search.trim().toLowerCase();
    setSidebarCounts((current) => applySidebarDelta(current, before, after));
    const active = activeViewRef.current;
    if (getViewCacheKey(view) !== getViewCacheKey(active.view) ||
        activeSearch !== active.search || page !== active.page) {
      invalidateCachedViews();
      return;
    }
    const totalDelta = getMatchDelta(before, after, (item) =>
      itemMatchesView(item, view) && (!activeSearch || itemMatchesSearch(item, activeSearch)));
    const nextTotalItems = Math.max(0, (totalItems ?? 0) + totalDelta);
    const nextTotalPages = computeTotalPages(nextTotalItems);

    setTotalItems(nextTotalItems);
    setTotalPages(nextTotalPages);
    setPage((current) => clampPage(current, nextTotalPages));

    const nextItems = reconcileVisibleItems(vaultItems, before, after, view, activeSearch, page);
    setVaultItems(nextItems);
    invalidateCachedViews(activeSearch ? undefined : getViewCacheKey(view));
    if (!activeSearch) {
      setCachedView(getViewCacheKey(view), {
        items: nextItems, page: clampPage(page, nextTotalPages), totalPages: nextTotalPages, totalItems: nextTotalItems,
      });
    }
    if (totalDelta < 0 || activeSearch) {
      const nextPage = clampPage(page, nextTotalPages);
      const refresh = activeSearch
        ? runSearch(search, nextPage, view, true)
        : loadVaultPage(nextPage, view, true);
      void refresh.catch((err) => {
        toastService.error(getSessionAwareError(err, 'Unable to refresh vault items'));
      });
    }
  }, [getCurrentView, invalidateCachedViews, loadVaultPage, page, runSearch, search, setCachedView, setPage, setSidebarCounts, setTotalItems, setTotalPages, setVaultItems, totalItems, vaultItems]);

  const buildEncryptedPayload = useCallback(async (form: ItemForm, previous?: DecryptedPayload) => {
    if (!cryptoKey) throw new Error('Crypto key not available');
    const payload = withPasswordHistory(buildPayload(form), previous);
    const encrypted_data = await encryptData(payload, cryptoKey);
    return { payload, encrypted_data };
  }, [cryptoKey]);

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
    if (cached?.decrypted) {
      setSelectedItem(cached);
      setSelectedItemLoading(false);
      return;
    }
    if (item.decrypted || !liveKey) {
      setSelectedItemLoading(false);
      return;
    }
    if (decryptingItemIds.current.has(item.id)) {
      setSelectedItemLoading(true);
      return;
    }
    decryptingItemIds.current.add(item.id);
    setSelectedItemLoading(true);
    try {
      const enriched = await fetchAndDecryptItem(item, liveKey, (id, updated) => {
        if (useAuthStore.getState().cryptoKey === liveKey) updateVaultItem(id, updated);
      });
      if (currentSelectionRef.current === item.id && useAuthStore.getState().cryptoKey === liveKey) setSelectedItem(enriched);
    } catch (err: unknown) {
      console.error('[handleSelectItem] Failed for item', item.id, err);
      if (currentSelectionRef.current === item.id && useAuthStore.getState().cryptoKey === liveKey) {
        clearSelection();
        toastService.error(getItemLoadError(err));
      }
    } finally {
      decryptingItemIds.current.delete(item.id);
      if (currentSelectionRef.current === item.id && useAuthStore.getState().cryptoKey === liveKey) setSelectedItemLoading(false);
    }
  }, [clearSelection, updateVaultItem]);

  // Debounced search
  const handleSearchChange = useCallback((val: string) => {
    clearSelection();
    if (!val.trim()) {
      resetSearch();
      const view = getCurrentView();
      if (!restoreOrHydrateView(view)) {
        void loadVaultPage(1, view).catch((err) => {
          toastService.error(getSessionAwareError(err, 'Vault is temporarily unavailable'));
        });
      }
      return;
    }
    queueSearch(val);
  }, [clearSelection, getCurrentView, loadVaultPage, queueSearch, resetSearch, restoreOrHydrateView]);

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
          const { encrypted_data, payload } = await buildEncryptedPayload(newItem);
          const { data } = await vaultApi.create({ name: newItem.name, category: newItem.category, encrypted_data });
          applyOptimisticMutation(null, { ...data, decrypted: payload });
          setShowAddModal(false);
          setNewItem({ ...emptyForm });
        },
        'Item added to vault',
        { fallbackError: 'Failed to save item' },
      );
    } finally { setSavingItem(false); }
  }, [applyOptimisticMutation, cryptoKey, newItem, buildEncryptedPayload]);

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
          const previousItem = selectedItem;
          const { payload, encrypted_data } = await buildEncryptedPayload(editForm, previousItem.decrypted);
          const { data } = await vaultApi.update(selectedItem.id, { name: editForm.name, category: editForm.category, encrypted_data });
          const updated = { ...data, decrypted: payload };
          updateVaultItem(selectedItem.id, updated);
          if (currentSelectionRef.current === updated.id) {
            const active = activeViewRef.current;
            if (itemMatchesView(updated, active.view) && itemMatchesSearch(updated, active.search)) {
              setSelectedItem(updated);
            } else {
              clearSelection();
            }
          }
          applyOptimisticMutation(previousItem, updated);
          setShowEditModal(false);
          setEditForm(null);
        },
        'Item updated',
        { fallbackError: 'Failed to update item' },
      );
    } finally { setUpdatingItem(false); }
  }, [applyOptimisticMutation, buildEncryptedPayload, clearSelection, cryptoKey, editForm, selectedItem, updateVaultItem]);

  const handleDelete = useCallback(async (id: string, onAfterDelete?: () => void) => {
    if (deletingId) return;
    setDeletingId(id);
    try {
      await toastService.withProgress(
        'Moving item to trash...',
        async () => {
          const previousItem = getKnownItemById(id);
          await vaultApi.delete(id);
          if (previousItem) {
            applyOptimisticMutation(previousItem, {
              ...previousItem,
              is_deleted: true,
              deleted_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            });
          } else {
            await refreshCurrentView(page);
          }
          if (currentSelectionRef.current === id) {
            clearSelection();
            onAfterDelete?.();
          }
        },
        'Moved item to trash',
        { fallbackError: 'Failed to move item to trash' },
      );
    } finally { setDeletingId(null); }
  }, [applyOptimisticMutation, clearSelection, deletingId, getKnownItemById, page, refreshCurrentView]);

  const handleToggleFav = useCallback(async (item: VaultItem) => {
    const adding = !item.is_favourite;
    await toastService.withProgress(
      adding ? 'Adding to favourites...' : 'Removing from favourites...',
      async () => {
        const previousItem = selectedItem?.id === item.id ? selectedItem : item;
        const { data } = await vaultApi.update(item.id, { is_favourite: adding });
        const updated = { ...previousItem, ...data };
        updateVaultItem(item.id, updated);
        if (currentSelectionRef.current === item.id) {
          const active = activeViewRef.current;
          if (itemMatchesView(updated, active.view) && itemMatchesSearch(updated, active.search)) setSelectedItem(updated);
          else clearSelection();
        }
        applyOptimisticMutation(previousItem, updated);
      },
      adding ? 'Added to favourites' : 'Removed from favourites',
      { fallbackError: 'Failed to update favourite' },
    );
  }, [applyOptimisticMutation, clearSelection, selectedItem, updateVaultItem]);

  const copyToClipboard = useCallback(async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toastService.success(`${label} copied!`);
      return true;
    } catch {
      toastService.error(`Failed to copy ${label.toLowerCase()}`);
      return false;
    }
  }, []);

  const handleExport = useCallback(async () => {
    await toastService.withProgress(
      'Exporting vault...',
      async () => {
        const { data } = await vaultApi.export();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'cipheria-export.json';
        a.click();
        URL.revokeObjectURL(url);
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
      emitAuthEvent('user-updated', data);
      toastService.success('Profile updated');
    } catch (err) {
      toastService.error(getSessionAwareError(err, 'Failed to update profile'));
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
      toastService.error(getSessionAwareError(err, 'Failed to send verification email'));
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
    if (!masterPasswordForm.current_password) {
      toastService.error('Enter your current master password');
      return;
    }
    if (!masterPasswordForm.password || masterPasswordForm.password !== masterPasswordForm.confirm) {
      toastService.error('Master password confirmation does not match');
      return;
    }

    setMasterPasswordSaving(true);
    try {
      const currentVerifier = await deriveMasterPasswordVerifier(masterPasswordForm.current_password, user.vault_salt);
      const newSalt = generateSaltHex();
      const nextKey = await deriveKey(masterPasswordForm.password, newSalt);
      const nextVerifier = await deriveMasterPasswordVerifier(masterPasswordForm.password, newSalt);
      const { data } = await vaultApi.export(true);
      const items = await Promise.all(
        (data.items as Array<{ id: string; encrypted_data: string }>).map(async (item) => {
          const payload = await decryptData(item.encrypted_data, cryptoKey);
          const encrypted_data = await encryptData(payload, nextKey);
          return { id: item.id, encrypted_data };
        }),
      );
      const { data: updatedUser } = await authApi.changeMasterPassword({
        current_master_password_verifier: currentVerifier,
        new_vault_salt: newSalt,
        new_master_password_verifier: nextVerifier,
        master_hint: masterPasswordForm.master_hint || null,
        items,
      });
      setUser(updatedUser);
      emitAuthEvent('user-updated', updatedUser);
      setMasterPasswordForm({ current_password: '', password: '', confirm: '', master_hint: updatedUser.master_hint ?? '' });
      lockVault();
      emitAuthEvent('lock');
      setShowSettingsModal(false);
      toastService.success('Master password changed. Unlock with the new password.');
    } catch (err) {
      toastService.error(getSessionAwareError(err, 'Failed to change master password'));
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
      toastService.error(getSessionAwareError(err, 'Failed to delete account'));
    } finally {
      setDeletingAccount(false);
    }
  }, [deletePassword, logout, router, user]);

  const handleRestoreItem = useCallback(async (id: string) => {
    await toastService.withProgress(
      'Restoring item...',
      async () => {
        const previousItem = getKnownItemById(id);
        const { data } = await vaultApi.restore(id);
        if (currentSelectionRef.current === id) {
          clearSelection();
        }
        if (previousItem) {
          applyOptimisticMutation(previousItem, data);
        } else {
          await refreshCurrentView(page);
        }
      },
      'Restored item',
      { fallbackError: 'Failed to restore item' },
    );
  }, [applyOptimisticMutation, clearSelection, getKnownItemById, page, refreshCurrentView]);

  const handleDeletePermanent = useCallback(async (id: string) => {
    if (deletingId) return false;
    setDeletingId(id);
    try {
      const deleted = await toastService.withProgress(
        'Item deleting permanently...',
        async () => {
          const previousItem = getKnownItemById(id);
          await vaultApi.deletePermanent(id);
          if (currentSelectionRef.current === id) clearSelection();
          if (previousItem) {
            applyOptimisticMutation(previousItem, null);
          } else {
            await refreshCurrentView(page);
          }
          return true;
        },
        'Item permanently deleted',
        { fallbackError: 'Failed to permanently delete item' },
      );
      return deleted === true;
    } finally {
      setDeletingId(null);
    }
  }, [applyOptimisticMutation, clearSelection, deletingId, getKnownItemById, page, refreshCurrentView]);

  const handlePageChange = useCallback(async (newPage: number) => {
    if (newPage === page) return;
    clearSelection();
    try {
      if (search.trim()) {
        await runSearch(search, newPage);
        return;
      }
      await loadVaultPage(newPage);
    } catch (err) {
      console.error('[pagination] Failed to load page', newPage, err);
    }
  }, [clearSelection, loadVaultPage, page, runSearch, search]);

  const switchView = useCallback(async (
    nextCategory: Category,
    source: 'category' | 'favourites' | 'trash',
    enabled = false,
  ) => {
    const nextFavouritesView = source === 'favourites' && enabled;
    const nextTrashView = source === 'trash' && enabled;
    const nextViewMode = enabled ? source : 'category';
    if (nextCategory === category && nextViewMode === viewMode) return;
    const switchId = ++viewSwitchRef.current;
    const previousCategory = category;
    const previousViewMode = viewMode;
    const nextView = buildViewRequest(nextCategory, nextFavouritesView, nextTrashView);
    setCategory(nextCategory);
    setViewMode(enabled ? source : 'category');
    resetSearch();
    if (!nextTrashView && restoreCachedView(getViewCacheKey(nextView))) return;
    try {
      await loadVaultPage(1, nextView);
    } catch (err) {
      if (switchId !== viewSwitchRef.current) return;
      setCategory(previousCategory);
      setViewMode(previousViewMode);
      toastService.error(getSessionAwareError(err, 'Vault is temporarily unavailable'));
      console.error(`[${source}] Failed to switch view`, err);
    }
  }, [category, loadVaultPage, resetSearch, restoreCachedView, setCategory, setViewMode, viewMode]);

  const handleCategoryChange = useCallback(
    (nextCategory: Category) => switchView(nextCategory, 'category'),
    [switchView],
  );

  const handleToggleFavourites = useCallback(() => {
    const next = !isFavouritesView;
    return switchView(category, 'favourites', next);
  }, [category, isFavouritesView, switchView]);

  const handleToggleTrash = useCallback(() => {
    const next = !isTrashView;
    return switchView(category, 'trash', next);
  }, [category, isTrashView, switchView]);

  const handleOpenSettings = useCallback(() => setShowSettingsModal(true), []);
  const handleCloseSettings = useCallback(() => setShowSettingsModal(false), []);

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
        searchError={searchError}
        onSearchChange={handleSearchChange}
        handleExport={handleExport}
        onOpenSettings={handleOpenSettings}
        onToggleFavourites={handleToggleFavourites}
        onToggleTrash={handleToggleTrash}
        isFavouritesView={isFavouritesView}
        isTrashView={isTrashView}
        lockVault={handleLockVault}
        handleLogout={handleLogout}
        sidebarCounts={sidebarCounts}
        selectedItem={selectedItem}
        clearSelection={clearSelection}
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
        handleAddItem={handleAddItem}
        showEditModal={showEditModal}
        setShowEditModal={setShowEditModal}
        editForm={editForm}
        setEditForm={setEditForm}
        updatingItem={updatingItem}
        handleEditItem={handleEditItem}
        filteredItems={vaultItems}
        page={page}
        totalPages={totalPages}
        onPageChange={handlePageChange}
        searchLoading={listLoading}
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
