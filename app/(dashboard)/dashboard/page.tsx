'use client';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { isAxiosError } from 'axios';
import { toastService } from '@/lib/toast';
import { getItemLoadError, getSessionAwareError } from '@/lib/errors';
import { useAuthStore } from '@/lib/store';
import type { DecryptedPayload, VaultItem } from '@/lib/types';
import { vaultApi, authApi } from '@/lib/api';
import { emitAuthEvent } from '@/lib/authSync';
import { deriveMasterPasswordVerifier, encryptData, decryptData, withPasswordHistory } from '@/lib/crypto';
import { createVaultKey, rewrapVaultKey } from '@/lib/vaultKeys';
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
import type { MasterPasswordForm } from '@/components/dashboard/SettingsModal';
import { ImportVaultModal } from '@/components/dashboard/ImportVaultModal';

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
  const [showImportModal, setShowImportModal] = useState(false);
  const [selectedItem, setSelectedItem] = useState<VaultItem | null>(null);
  const [newItem, setNewItem] = useState<ItemForm>({ ...emptyForm });
  const [showEditModal, setShowEditModal] = useState(false);
  const [editForm, setEditForm] = useState<ItemForm | null>(null);
  const [editBase, setEditBase] = useState<VaultItem | null>(null);
  const [editConflict, setEditConflict] = useState(false);
  const [savingItem, setSavingItem] = useState(false);
  const [updatingItem, setUpdatingItem] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [selectedItemLoading, setSelectedItemLoading] = useState(false);
  const [hibp, setHibp] = useState<{ checking: boolean; count: number | null }>({ checking: false, count: null });
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
      setShowImportModal(false);
      setShowAddModal(false);
      setShowEditModal(false);
      setNewItem({ ...emptyForm });
      setEditForm(null);
      setEditBase(null);
      setEditConflict(false);
      setShowSettingsModal(false);
      decryptingItemIds.current.clear();
      clearSelection();
    }
  }, [clearSelection, isVaultLocked]);

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

  const liveVault = useCallback(() => {
    const live = useAuthStore.getState();
    return live.cryptoKey === cryptoKey && live.user?.id === user?.id
      && live.user?.vault_salt === user?.vault_salt && !live.isVaultLocked;
  }, [cryptoKey, user]);

  const writeError = useCallback((error: unknown) => {
    if (isAxiosError(error) && error.response?.status === 409
      && String(error.response.data?.detail).startsWith('Vault password changed.')) {
      lockVault();
      void authApi.me().then(({ data }) => {
        if (useAuthStore.getState().user?.id === data.id) {
          setUser(data);
          emitAuthEvent('user-updated', data);
        }
      }).catch(() => { /* The session interceptor handles revoked sessions. */ });
      return 'Vault password changed. Unlock with the current password before saving.';
    }
    if (isAxiosError(error) && error.response?.status === 412) {
      invalidateCachedViews();
      clearSelection();
      void refreshCurrentView().catch(() => { /* The original conflict remains visible. */ });
    }
    return getSessionAwareError(error, 'Unable to save this change');
  }, [clearSelection, invalidateCachedViews, lockVault, refreshCurrentView, setUser]);

  const applyOptimisticMutation = useCallback((
    before: VaultItem | null,
    after: VaultItem | null,
    view = getCurrentView(),
  ) => {
    if (useAuthStore.getState().isVaultLocked) return;
    const activeSearch = search.trim().toLowerCase();
    setSidebarCounts((current) => applySidebarDelta(current, before, after));
    const active = activeViewRef.current;
    const refreshView = (target: typeof active) => {
      const refresh = target.search
        ? runSearch(target.search, target.page, target.view, true)
        : loadVaultPage(target.page, target.view, true);
      void refresh.catch((err) => {
        toastService.error(getSessionAwareError(err, 'Unable to refresh vault items'));
      });
    };
    if (getViewCacheKey(view) !== getViewCacheKey(active.view) ||
        activeSearch !== active.search || page !== active.page) {
      invalidateCachedViews();
      refreshView(active);
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
      refreshView({ ...active, page: nextPage });
    }
  }, [getCurrentView, invalidateCachedViews, loadVaultPage, page, runSearch, search, setCachedView, setPage, setSidebarCounts, setTotalItems, setTotalPages, setVaultItems, totalItems, vaultItems]);

  const buildEncryptedPayload = useCallback(async (form: ItemForm, previous?: DecryptedPayload, id = crypto.randomUUID()) => {
    if (!cryptoKey) throw new Error('Crypto key not available');
    const payload = withPasswordHistory(buildPayload(form), previous);
    const encrypted_data = await encryptData(payload, cryptoKey, id);
    if (useAuthStore.getState().cryptoKey !== cryptoKey) throw new Error('Vault locked before saving');
    return { id, payload, encrypted_data };
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
    if (!cryptoKey || !user) return;
    if (newItem.category === 'login' && newItem.url && !/^https?:\/\//i.exec(newItem.url)) {
      toastService.error('URL must start with http:// or https://');
      return;
    }
    setSavingItem(true);
    try {
      await toastService.withProgress(
        'Saving to vault...',
        async () => {
          const { id, encrypted_data, payload } = await buildEncryptedPayload(newItem);
          const { data } = await vaultApi.create({ id, name: newItem.name, category: newItem.category, encrypted_data }, user.vault_salt);
          if (!liveVault()) return;
          applyOptimisticMutation(null, { ...data, decrypted: payload });
          setShowAddModal(false);
          setNewItem({ ...emptyForm });
        },
        'Item added to vault',
        { getError: writeError },
      );
    } finally { setSavingItem(false); }
  }, [applyOptimisticMutation, cryptoKey, newItem, buildEncryptedPayload, liveVault, user, writeError]);

  const handleOpenEdit = useCallback((item: VaultItem) => {
    setEditBase(item);
    setEditConflict(false);
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
    if (!cryptoKey || !editForm || !editBase || !user || editConflict) return;
    if (editForm.category === 'login' && editForm.url && !/^https?:\/\//i.exec(editForm.url)) {
      toastService.error('URL must start with http:// or https://');
      return;
    }
    setUpdatingItem(true);
    try {
      await toastService.withProgress(
        'Updating item...',
        async () => {
          const previousItem = editBase;
          const { payload, encrypted_data } = await buildEncryptedPayload(editForm, previousItem.decrypted, previousItem.id);
          const { data } = await vaultApi.update(previousItem, { name: editForm.name, category: editForm.category, encrypted_data }, user.vault_salt);
          if (!liveVault()) return;
          const updated = { ...data, decrypted: payload };
          updateVaultItem(previousItem.id, updated);
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
        { getError: (error) => {
          if (isAxiosError(error) && [412, 404].includes(error.response?.status ?? 0) && liveVault()) {
            setEditConflict(true);
            return 'This item changed elsewhere. Your edits have been kept.';
          }
          return writeError(error);
        } },
      );
    } finally { setUpdatingItem(false); }
  }, [applyOptimisticMutation, buildEncryptedPayload, clearSelection, cryptoKey, editForm, editBase, editConflict, liveVault, user, updateVaultItem, writeError]);

  const reloadConflictedItem = useCallback(async () => {
    if (!editBase || !cryptoKey) return;
    setUpdatingItem(true);
    try {
      const { data } = await vaultApi.get(editBase.id, true);
      const decrypted = await decryptData<DecryptedPayload>(data.encrypted_data!, cryptoKey, data.id);
      if (!liveVault()) return;
      const latest = { ...data, decrypted };
      updateVaultItem(latest.id, latest);
      setSelectedItem(latest);
      if (latest.is_deleted) {
        setShowEditModal(false);
        setEditForm(null);
        clearSelection();
        toastService.info('This item is in Trash. Restore it before editing.');
      } else handleOpenEdit(latest);
      invalidateCachedViews();
      void refreshCurrentView().catch(() => {});
    } catch (error) {
      // A missing item must leave the draft available for saving as a copy.
      toastService.error(getSessionAwareError(error, 'Unable to reload this item; your edits are still here'));
    } finally { setUpdatingItem(false); }
  }, [clearSelection, cryptoKey, editBase, handleOpenEdit, invalidateCachedViews, liveVault, refreshCurrentView, updateVaultItem]);

  const saveConflictedCopy = useCallback(async () => {
    if (!editForm || !editBase || !cryptoKey || !user) return;
    if (!editForm.name.trim()) {
      toastService.error('Enter a name before saving a separate item');
      return;
    }
    if (editForm.category === 'login' && editForm.url && !/^https?:\/\//i.exec(editForm.url)) {
      toastService.error('URL must start with http:// or https://');
      return;
    }
    setUpdatingItem(true);
    try {
      await toastService.withProgress('Saving a separate item...', async () => {
        const { id, encrypted_data, payload } = await buildEncryptedPayload(editForm, editBase.decrypted);
        const { data } = await vaultApi.create({ id, name: `${editForm.name.slice(0, 248)} (copy)`, category: editForm.category, encrypted_data }, user.vault_salt);
        if (!liveVault()) return;
        applyOptimisticMutation(null, { ...data, decrypted: payload });
        setShowEditModal(false);
        setEditForm(null);
        setEditBase(null);
        setEditConflict(false);
        invalidateCachedViews();
        void refreshCurrentView().catch(() => {});
      }, 'Saved as a separate item', { getError: writeError });
    } finally { setUpdatingItem(false); }
  }, [applyOptimisticMutation, buildEncryptedPayload, cryptoKey, editBase, editForm, invalidateCachedViews, liveVault, refreshCurrentView, user, writeError]);

  const handleDelete = useCallback(async (id: string, onAfterDelete?: () => void) => {
    if (deletingId) return;
    setDeletingId(id);
    try {
      await toastService.withProgress(
        'Moving item to trash...',
        async () => {
          const previousItem = getKnownItemById(id);
          if (!previousItem || !user) throw new Error('Reload this item before deleting');
          await vaultApi.delete(previousItem, user.vault_salt);
          if (!liveVault()) return;
          applyOptimisticMutation(previousItem, {
            ...previousItem,
            revision: previousItem.revision + 1,
            is_deleted: true,
            deleted_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });
          if (currentSelectionRef.current === id) {
            clearSelection();
            onAfterDelete?.();
          }
        },
        'Moved item to trash',
        { getError: writeError },
      );
    } finally { setDeletingId(null); }
  }, [applyOptimisticMutation, clearSelection, deletingId, getKnownItemById, liveVault, user, writeError]);

  const handleToggleFav = useCallback(async (item: VaultItem) => {
    const adding = !item.is_favourite;
    await toastService.withProgress(
      adding ? 'Adding to favourites...' : 'Removing from favourites...',
      async () => {
        const previousItem = selectedItem?.id === item.id ? selectedItem : item;
        if (!user) return;
        const { data } = await vaultApi.update(previousItem, { is_favourite: adding }, user.vault_salt);
        if (!liveVault()) return;
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
      { getError: writeError },
    );
  }, [applyOptimisticMutation, clearSelection, liveVault, selectedItem, updateVaultItem, user, writeError]);

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

  const handleSaveProfile = useCallback(async (changes: { full_name?: string | null; master_hint?: string | null }) => {
    setProfileSaving(true);
    try {
      const { data } = await authApi.updateProfile({
        full_name: user?.full_name ?? null,
        master_hint: user?.master_hint ?? null,
        ...changes,
      });
      setUser(data);
      emitAuthEvent('user-updated', data);
      return null;
    } catch (err) {
      return getSessionAwareError(err, 'Failed to update profile');
    } finally {
      setProfileSaving(false);
    }
  }, [setUser, user]);

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

  const recoverProtectionChange = useCallback(async (previous: { id: string; vault_salt: string }) => {
    try {
      const { data } = await authApi.me();
      if (data.id !== previous.id || useAuthStore.getState().user?.id !== previous.id || data.vault_salt === previous.vault_salt) return false;
      setUser(data);
      emitAuthEvent('user-updated', data);
      lockVault();
      setShowSettingsModal(false);
      toastService.info('Vault protection changed. Unlock with its current master password.');
      return true;
    } catch { /* The session interceptor handles confirmed revocation. */ }
    return false;
  }, [lockVault, setUser]);

  const handleChangeMasterPassword = useCallback(async (masterPasswordForm: MasterPasswordForm, rotate = false) => {
    if (masterPasswordSaving) return 'A vault protection update is already in progress';
    if (!cryptoKey || !user) {
      return 'Unlock the vault before changing the master password';
    }
    if (!masterPasswordForm.current_password) {
      return 'Enter your current master password';
    }
    if (!rotate && (!masterPasswordForm.password || masterPasswordForm.password !== masterPasswordForm.confirm)) {
      return 'Master password confirmation does not match';
    }

    setMasterPasswordSaving(true);
    try {
      const currentVerifier = await deriveMasterPasswordVerifier(masterPasswordForm.current_password, user.vault_salt, user.key_envelope ? 2 : 1);
      // Verify the current password before preparing a potentially expensive migration.
      await authApi.unlock(currentVerifier);
      const password = rotate ? masterPasswordForm.current_password : masterPasswordForm.password;
      const prepareKeyChange = async () => {
        if (user.key_envelope && !rotate) {
          return { keyEnvelope: await rewrapVaultKey(masterPasswordForm.current_password, password, user.key_envelope), items: [] };
        }
        const created = await createVaultKey(password, user.key_envelope?.vault_id);
        const { data } = await vaultApi.export(true);
        if (data.vault_salt !== user.vault_salt) throw new Error('Vault password changed. Unlock again before changing it.');
        const items = await Promise.all((data.items as Array<{ id: string; revision: number; encrypted_data: string }>).map(async item => {
          const payload = await decryptData(item.encrypted_data, cryptoKey, item.id);
          return { id: item.id, revision: item.revision, encrypted_data: await encryptData(payload, created.key, item.id) };
        }));
        return { keyEnvelope: created.envelope, items };
      };
      const { keyEnvelope, items } = await prepareKeyChange();
      if (!liveVault()) throw new Error('Vault locked during key preparation');
      const newSalt = keyEnvelope.salt;
      const nextVerifier = await deriveMasterPasswordVerifier(password, newSalt, 2);
      if (!liveVault()) throw new Error('Vault locked during key preparation');
      const { data: updatedUser } = await authApi.changeMasterPassword({
        current_master_password_verifier: currentVerifier,
        new_vault_salt: newSalt,
        new_master_password_verifier: nextVerifier,
        master_hint: user.master_hint || null,
        items,
        key_envelope: keyEnvelope,
      });
      if (useAuthStore.getState().user?.id !== user.id) return null;
      setUser(updatedUser);
      emitAuthEvent('user-updated', updatedUser);
      lockVault();
      emitAuthEvent('lock');
      setShowSettingsModal(false);
      toastService.success(rotate ? 'Vault encryption updated. Unlock with your master password.' : 'Master password changed. Unlock with the new password.');
      return null;
    } catch (err) {
      // Recover committed changes whose successful response was lost.
      if (await recoverProtectionChange(user)) return null;
      return getSessionAwareError(err, 'Failed to change master password');
    } finally {
      setMasterPasswordSaving(false);
    }
  }, [cryptoKey, liveVault, lockVault, masterPasswordSaving, recoverProtectionChange, setUser, user]);

  const handleDeleteAccount = useCallback(async (deletePassword: string) => {
    if (!deletePassword) {
      return 'Enter your master password to delete the account';
    }
    if (!user?.vault_salt) {
      return 'Session error - please sign out and sign in again';
    }
    setDeletingAccount(true);
    try {
      const verifier = await deriveMasterPasswordVerifier(deletePassword, user.vault_salt, user.key_envelope ? 2 : 1);
      await authApi.deleteAccount(verifier);
      emitAuthEvent('logout');
      logout();
      router.replace('/auth');
      return null;
    } catch (err) {
      return getSessionAwareError(err, 'Failed to delete account');
    } finally {
      setDeletingAccount(false);
    }
  }, [logout, router, user]);

  const handleRestoreItem = useCallback(async (id: string) => {
    await toastService.withProgress(
      'Restoring item...',
      async () => {
        const previousItem = getKnownItemById(id);
        if (!previousItem || !user) throw new Error('Reload this item before restoring');
        const { data } = await vaultApi.restore(previousItem, user.vault_salt);
        if (!liveVault()) return;
        if (currentSelectionRef.current === id) {
          clearSelection();
        }
        applyOptimisticMutation(previousItem, data);
      },
      'Restored item',
      { getError: writeError },
    );
  }, [applyOptimisticMutation, clearSelection, getKnownItemById, liveVault, user, writeError]);

  const handleDeletePermanent = useCallback(async (id: string) => {
    if (deletingId) return false;
    setDeletingId(id);
    try {
      const deleted = await toastService.withProgress(
        'Item deleting permanently...',
        async () => {
          const previousItem = getKnownItemById(id);
          if (!previousItem || !user) throw new Error('Reload this item before deleting');
          await vaultApi.deletePermanent(previousItem, user.vault_salt);
          if (!liveVault()) return false;
          if (currentSelectionRef.current === id) clearSelection();
          applyOptimisticMutation(previousItem, null);
          return true;
        },
        'Item permanently deleted',
        { getError: writeError },
      );
      return deleted === true;
    } finally {
      setDeletingId(null);
    }
  }, [applyOptimisticMutation, clearSelection, deletingId, getKnownItemById, liveVault, user, writeError]);

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
  const handleOpenImport = useCallback(() => setShowImportModal(true), []);
  const handleImported = () => {
    invalidateCachedViews();
    clearSelection();
    void refreshCurrentView(1).catch(() => {
      toastService.error('Items were imported. Reload the vault to refresh the list.');
    });
  };

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
        category={category}
        setCategory={handleCategoryChange}
        searchValue={search}
        searchError={searchError}
        onSearchChange={handleSearchChange}
        handleExport={handleExport}
        onImport={handleOpenImport}
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
        editRevision={editBase?.revision}
        editConflict={editConflict ? { onReload: reloadConflictedItem, onSaveCopy: saveConflictedCopy } : undefined}
        filteredItems={vaultItems}
        page={page}
        totalPages={totalPages}
        onPageChange={handlePageChange}
        searchLoading={listLoading}
      />
      {showSettingsModal && (
        <SettingsModal
          user={user}
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
      {showImportModal && (
        <ImportVaultModal key={`${user?.id}:${user?.vault_salt}`}
          onClose={() => setShowImportModal(false)} onImported={handleImported} />
      )}
    </>
  );
}
