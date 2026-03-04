'use client';
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  Key, Search, Plus, LogOut, Lock, Star, Globe, CreditCard, StickyNote, User,
  Copy, Eye, EyeOff, Trash2, Download, Shield, X, RefreshCw, Edit2,
  ChevronRight
} from 'lucide-react';
import { toastService } from '@/lib/toast';
import { getItemLoadError } from '@/lib/errors';
import { useAuthStore, VaultItem } from '@/lib/store';
import { vaultApi, authApi } from '@/lib/api';
import { deriveKey, encryptData, decryptData, generatePassword, passwordStrength, checkHIBP } from '@/lib/crypto';

type Category = 'all' | 'login' | 'card' | 'note' | 'identity';

const CATEGORY_ICONS: Record<string, any> = {
  login: Globe,
  card: CreditCard,
  note: StickyNote,
  identity: User,
};

const IDLE_MS = 5 * 60 * 1000;
const genOptions = { length: 20, uppercase: true, lowercase: true, numbers: true, symbols: true };
const emptyForm = {
  name: '', category: 'login',
  username: '', password: '', url: '', notes: '',
  cardNumber: '', cardHolder: '', expiry: '', cvv: '',
  firstName: '', lastName: '', phone: '', address: '',
};

const tryGetFaviconUrl = (url: string): string | undefined => {
  try {
    const { hostname } = new URL(url.includes('://') ? url : `https://${url}`);
    return `https://www.google.com/s2/favicons?domain=${hostname}&sz=64`;
  } catch {
    return undefined;
  }
};

const fetchAndDecryptItem = async (item: VaultItem): Promise<VaultItem> => {
  const { data } = await vaultApi.get(item.id);
  if (!data.encrypted_data?.includes('.')) throw new Error('BAD_FORMAT');
  const { cryptoKey: key } = useAuthStore.getState();
  if (!key) throw new Error('NO_KEY');
  let dec: any;
  try {
    dec = await decryptData(data.encrypted_data, key);
  } catch (cryptoErr) {
    console.error('[decrypt] WebCrypto error for item', item.id, cryptoErr);
    throw new Error('CRYPTO_FAIL');
  }
  const enriched: VaultItem = { ...item, encrypted_data: data.encrypted_data, decrypted: dec };
  useAuthStore.getState().updateVaultItem(item.id, enriched);
  return enriched;
};

const buildPayload = (form: typeof emptyForm) => {
  switch (form.category) {
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

// Custom hook for vault unlock logic
function useVaultUnlock(user: any, setVaultKey: any, setVaultItems: any) {
  const [masterPassword, setMasterPassword] = useState('');
  const [unlocking, setUnlocking] = useState(false);
  const [signout, setSignout] = useState(false);

  const unlockVault = async (e: React.FormEvent) => {
    e.preventDefault();
    setUnlocking(true);
    try {
      await toastService.withProgress(
        'Unlocking vault...',
        async (update) => {
          const salt = user?.vault_salt;
          if (!salt) throw new Error('NO_SALT');

          const key = await deriveKey(masterPassword, salt);

          // Verify the master password is correct before accepting it.
          // Fetch one item and try to decrypt it — if it fails the password is wrong.
          update('Verifying master password...');
          const { data: items } = await vaultApi.list();

          if (items.length > 0) {
            try {
              const { data: firstItem } = await vaultApi.get(items[0].id);
              await decryptData(firstItem.encrypted_data, key);
            } catch (verifyErr) {
              console.error('[unlock] Key verification failed:', verifyErr);
              throw new Error('WRONG_PASSWORD');
            }
          }

          // Key verified — commit to store and load all items
          setVaultKey(key);
          update('Loading items...');
          setVaultItems(items);
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
  const { user, cryptoKey, isAuthenticated, vaultItems, isVaultLocked,
    setVaultKey, setVaultItems, addVaultItem, updateVaultItem, removeVaultItem, logout, lockVault, restoreSession } = useAuthStore();

  const [category, setCategory] = useState<Category>('all');
  const [search, setSearch] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedItem, setSelectedItem] = useState<VaultItem | null>(null);
  const [newItem, setNewItem] = useState(emptyForm);
  const [sessionLoading, setSessionLoading] = useState(true);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editForm, setEditForm] = useState<typeof newItem | null>(null);
  const [savingItem, setSavingItem] = useState(false);
  const [updatingItem, setUpdatingItem] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [selectedItemLoading, setSelectedItemLoading] = useState(false);
  const [searchResults, setSearchResults] = useState<VaultItem[] | null>(null);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);
  const decryptingItemIds = useRef(new Set<string>());  // in-flight + completed fetches
  const currentSelectionRef = useRef<string | null>(null); // prevent overwrite on nav away
  const [hibp, setHibp] = useState<{ checking: boolean; count: number | null }>({ checking: false, count: null });

  const { masterPassword, setMasterPassword, unlocking, signout, setSignout, unlockVault } = useVaultUnlock(user, setVaultKey, setVaultItems);

  // Fetch full item (with encrypted_data) on demand and decrypt client-side.
  // Reads cryptoKey from the store directly (not from closure) to always have the latest key.
  const handleSelectItem = useCallback(async (item: VaultItem) => {
    setSelectedItem(item);
    setHibp({ checking: false, count: null });
    currentSelectionRef.current = item.id;

    // Always read live state \u2014 avoids stale-closure key and stale cache
    const { vaultItems: storeItems, cryptoKey: liveKey } = useAuthStore.getState();
    const cached = storeItems.find((v) => v.id === item.id);
    if (cached?.decrypted) {
      setSelectedItem(cached);
      return;
    }

    if (!liveKey) return;

    // Guard: only one fetch per item. Removed from set only on error so future
    // cache checks hit the store, not this guard.
    if (decryptingItemIds.current.has(item.id)) return;
    decryptingItemIds.current.add(item.id);

    setSelectedItemLoading(true);
    try {
      const enriched = await fetchAndDecryptItem(item);
      // Only update the panel if the user hasn't clicked a different item
      if (currentSelectionRef.current === item.id) {
        setSelectedItem(enriched);
      }
    } catch (err: any) {
      console.error('[handleSelectItem] Failed for item', item.id, err);
      toastService.error(getItemLoadError(err));
      // Allow retry on failure
      decryptingItemIds.current.delete(item.id);
    } finally {
      if (currentSelectionRef.current === item.id) {
        setSelectedItemLoading(false);
      }
    }
  }, []);  // no deps \u2014 reads everything live from the store

  // Debounced server-side search with AbortController to cancel stale requests
  const handleSearchChange = useCallback((val: string) => {
    setSearch(val);

    // Cancel any pending debounce timer
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    // Abort any in-flight search request immediately
    searchAbortRef.current?.abort();

    if (!val) { setSearchResults(null); return; }

    searchDebounceRef.current = setTimeout(async () => {
      const controller = new AbortController();
      searchAbortRef.current = controller;
      try {
        const { data } = await vaultApi.list({ search: val }, controller.signal);
        // Reject stale responses: if the search input changed before response arrived
        if (!controller.signal.aborted) {
          setSearchResults(data);
        }
      } catch (err: any) {
        // Ignore abort errors — they are expected when the user types ahead
        if (err?.code !== 'ERR_CANCELED' && err?.name !== 'AbortError') {
          console.error('Search error:', err);
        }
      }
    }, 300);
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      setSessionLoading(false);
      return;
    }
    restoreSession().then((ok) => {
      if (ok) {
        setSessionLoading(false);
        return;
      }
      router.push('/auth');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isVaultLocked) return;
    const reset = () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      idleTimerRef.current = setTimeout(() => {
        lockVault();
        toastService.notify('Vault auto-locked after 5 min of inactivity', { icon: '\uD83D\uDD12' });
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

  // Clear search state and decrypt tracking whenever the vault is locked
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

  const buildEncryptedPayload = async (form: typeof emptyForm) => {
    const payload = buildPayload(form);
    const encrypted_data = await encryptData(payload, cryptoKey!);
    return { payload, encrypted_data };
  };

  const handleAddItem = async (e: React.FormEvent) => {
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

  const handleEditItem = async (e: React.FormEvent) => {
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
          const favicon_url = editForm.url ? tryGetFaviconUrl(editForm.url) ?? selectedItem.favicon_url : selectedItem.favicon_url;
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

  const filteredItems = useMemo(
    () => (searchResults ?? vaultItems).filter((item) => category === 'all' || item.category === category),
    [searchResults, vaultItems, category],
  );

  if (isVaultLocked) {
    return <LockedVaultScreen user={user} masterPassword={masterPassword} setMasterPassword={setMasterPassword} unlocking={unlocking} signout={signout} setSignout={setSignout} unlockVault={unlockVault} handleLogout={handleLogout} />;
  }

  if (sessionLoading) {
    return (
      <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
        <div style={{ color: 'var(--text-secondary)', fontSize: 14 }}>Loading...</div>
      </div>
    );
  }

  return <MainDashboard user={user} category={category} setCategory={setCategory} searchValue={search} onSearchChange={handleSearchChange} handleExport={handleExport} lockVault={lockVault} handleLogout={handleLogout} vaultItems={vaultItems} selectedItem={selectedItem} handleSelectItem={handleSelectItem} selectedItemLoading={selectedItemLoading} handleToggleFav={handleToggleFav} handleOpenEdit={handleOpenEdit} handleDelete={handleDelete} deletingId={deletingId} copyToClipboard={copyToClipboard} hibp={hibp} setHibp={setHibp} showAddModal={showAddModal} setShowAddModal={setShowAddModal} newItem={newItem} setNewItem={setNewItem} savingItem={savingItem} genOptions={genOptions} handleAddItem={handleAddItem} showEditModal={showEditModal} setShowEditModal={setShowEditModal} editForm={editForm} setEditForm={setEditForm} updatingItem={updatingItem} handleEditItem={handleEditItem} filteredItems={filteredItems} />;
}

function LockedVaultScreen({ user, masterPassword, setMasterPassword, unlocking, signout, setSignout, unlockVault, handleLogout }: Readonly<any>) {
  const handleSignout = async () => {
    setSignout(true);
    try {
      await handleLogout();
    } finally {
      setSignout(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100dvh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg)',
        padding: 'clamp(16px, 5vw, 24px)',
        overflowY: 'auto',
      }}
    >
      <div style={{
        position: 'fixed', top: '30%', left: '50%', transform: 'translateX(-50%)',
        width: 'min(500px, 100vw)', height: 'min(500px, 100vw)', borderRadius: '50%',
        background: 'radial-gradient(ellipse, rgba(245,158,11,0.08) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />
      <div
        className="glass animate-fade-up"
        style={{
          borderRadius: 24,
          padding: 'clamp(24px, 6vw, 48px)',
          width: '100%',
          maxWidth: 420,
          position: 'relative',
          zIndex: 1,
          margin: '0 auto',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: 'clamp(24px, 6vw, 36px)' }}>
          <div style={{
            width: 72, height: 72, borderRadius: 18,
            background: 'var(--accent-dim)', border: '1px solid rgba(245,158,11,0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px',
          }}>
            <Lock size={32} color="var(--accent)" />
          </div>
          <h2 className="font-display" style={{ fontSize: 'clamp(1.5rem, 5vw, 2rem)', color: 'var(--text-primary)', marginBottom: 8 }}>
            Vault Locked
          </h2>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
            Enter your master password to unlock
          </p>
          {user?.master_hint && (
            <p style={{ marginTop: 12, fontSize: '0.8rem', color: 'rgba(245,158,11,0.7)', fontStyle: 'italic' }}>
              Hint: {user.master_hint}
            </p>
          )}
        </div>
        <form onSubmit={unlockVault} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <input
            className="input-field"
            type="password"
            placeholder="Master password"
            required
            autoFocus
            value={masterPassword}
            onChange={(e) => setMasterPassword(e.target.value)}
            /* Prevent iOS zoom on focus */
            style={{ fontSize: 'max(16px, 0.9rem)' }}
          />
          <button
            className="btn-primary"
            type="submit"
            disabled={unlocking}
            style={{ opacity: unlocking ? 0.7 : 1, minHeight: 48 }}
          >
            {unlocking ? 'Unlocking...' : 'Unlock Vault'}
          </button>
        </form>
        <button
          onClick={handleSignout}
          className="btn-ghost"
          disabled={signout}
          style={{ width: '100%', marginTop: 12, minHeight: 44, opacity: signout ? 0.7 : 1, color: 'var(--danger)' }}
        >
          {signout ? 'Signing out...' : 'Sign out'}
        </button>
      </div>
    </div>
  );
}

function MainDashboard(props: Readonly<any>) {
  const { user, category, searchValue, onSearchChange, handleExport, lockVault, handleLogout, vaultItems, setShowAddModal, selectedItem, handleSelectItem, selectedItemLoading, handleToggleFav, handleOpenEdit, handleDelete, deletingId, copyToClipboard, hibp, setHibp, showAddModal, newItem, setNewItem, savingItem, genOptions, handleAddItem, showEditModal, setShowEditModal, editForm, setEditForm, updatingItem, handleEditItem, filteredItems } = props;

  // Mobile panel state: 'list' shows the item list, 'detail' shows the selected item
  const [mobilePanel, setMobilePanel] = useState<'list' | 'detail'>('list');

  const handleSelectItemMobile = (item: any) => {
    handleSelectItem(item);
    setMobilePanel('detail');
  };

  return (
    <div style={{ display: 'flex', height: '100dvh', background: 'var(--bg)', overflow: 'hidden' }}>
      {/* Mobile top bar */}
      <div style={{
        display: 'none',
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 50,
        background: 'rgba(10,9,8,0.95)', backdropFilter: 'blur(12px)',
        borderBottom: '1px solid var(--border)',
        padding: '12px 16px',
        alignItems: 'center', justifyContent: 'space-between',
      }} className="mobile-topbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {mobilePanel === 'detail' && selectedItem ? (
            <button
              onClick={() => setMobilePanel('list')}
              style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: '0.875rem', padding: '4px 0', display: 'flex', alignItems: 'center', gap: 4 }}
            >
              ← Back
            </button>
          ) : (
            <>
              <div style={{ width: 28, height: 28, borderRadius: 7, background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Key size={14} color="#0a0908" strokeWidth={2.5} />
              </div>
              <span className="font-display" style={{ fontSize: '1.25rem', color: 'var(--text-primary)' }}>Cipheria</span>
            </>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={lockVault} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: 6 }}>
            <Lock size={18} />
          </button>
          <button onClick={handleLogout} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', padding: 6 }}>
            <LogOut size={18} />
          </button>
        </div>
      </div>

      <style>{`
        /* Mobile: hide desktop columns, show mobile panels */
        @media (max-width: 768px) {
          .desktop-sidebar, .desktop-list-col, .desktop-detail-col { display: none !important; }
          .mobile-topbar { display: flex !important; }
        }
        /* Desktop: hide all mobile UI, restore desktop columns to their natural display */
        @media (min-width: 769px) {
          .mobile-topbar, .mobile-list-panel, .mobile-detail-panel { display: none !important; }
          .desktop-sidebar { display: flex !important; }
          .desktop-list-col { display: flex !important; }
          /* desktop-detail-col keeps its natural display (block) — no override needed */
          .desktop-detail-col { display: block !important; }
        }
      `}</style>

      {/* Mobile: List panel */}
      <div
        className="mobile-list-panel"
        style={{
          display: mobilePanel === 'list' ? 'flex' : 'none',
          position: 'fixed', inset: 0, zIndex: 10,
          flexDirection: 'column',
          background: 'var(--bg)',
          paddingTop: 57,
        }}
      >
        {/* Category scroll */}
        <div style={{ overflowX: 'auto', display: 'flex', gap: 8, padding: '12px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          {[
            { id: 'all', label: 'All', icon: Shield },
            { id: 'login', label: 'Logins', icon: Globe },
            { id: 'card', label: 'Cards', icon: CreditCard },
            { id: 'note', label: 'Notes', icon: StickyNote },
            { id: 'identity', label: 'Identities', icon: User },
          ].map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => props.setCategory(id as Category)} style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px',
              borderRadius: 20, border: '1px solid',
              borderColor: category === id ? 'var(--accent)' : 'var(--border)',
              background: category === id ? 'var(--accent-dim)' : 'transparent',
              color: category === id ? 'var(--accent)' : 'var(--text-secondary)',
              fontSize: '0.8rem', fontFamily: 'Outfit, sans-serif',
              cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
            }}>
              <Icon size={13} /> {label}
            </button>
          ))}
        </div>
        {/* Search + Add */}
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, flexShrink: 0 }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
            <input className="input-field" placeholder="Search vault..." value={searchValue}
              onChange={(e) => onSearchChange(e.target.value)} style={{ paddingLeft: 36, fontSize: 'max(16px, 0.9rem)' }} />
          </div>
          <button className="btn-primary" onClick={() => setShowAddModal(true)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 16px', flexShrink: 0 }}>
            <Plus size={16} />
          </button>
        </div>
        {/* Items list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
          {filteredItems.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-secondary)' }}>
              <Shield size={32} style={{ opacity: 0.3, margin: '0 auto 12px' }} />
              <p style={{ fontSize: '0.875rem' }}>No items found</p>
            </div>
          ) : filteredItems.map((item: any) => {
            const Icon = CATEGORY_ICONS[item.category] || Globe;
            return (
              <button key={item.id} onClick={() => handleSelectItemMobile(item)} style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 12,
                padding: '14px 12px', borderRadius: 10, border: 'none', cursor: 'pointer',
                background: 'transparent',
                borderLeft: '2px solid transparent',
                transition: 'all 0.15s', marginBottom: 2,
              }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, flexShrink: 0, background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                  {item.favicon_url
                    ? <img src={item.favicon_url} alt="" width={22} height={22} onError={(e: any) => e.target.style.display = 'none'} />
                    : <Icon size={18} color="var(--text-secondary)" />}
                </div>
                <div style={{ flex: 1, textAlign: 'left', minWidth: 0 }}>
                  <p style={{ fontSize: '0.9rem', color: 'var(--text-primary)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</p>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.decrypted?.username || item.decrypted?.url || item.category}
                  </p>
                </div>
                {item.is_favourite && <Star size={14} color="var(--accent)" fill="var(--accent)" />}
                <ChevronRight size={16} color="var(--text-secondary)" style={{ opacity: 0.4 }} />
              </button>
            );
          })}
        </div>
        {/* Mobile bottom actions */}
        <div style={{ borderTop: '1px solid var(--border)', padding: '12px 16px', display: 'flex', gap: 8, paddingBottom: 'calc(12px + env(safe-area-inset-bottom, 0px))' }}>
          <button onClick={handleExport} className="btn-ghost" style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center', fontSize: '0.8rem' }}>
            <Download size={14} /> Export
          </button>
          <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', padding: '0 8px', opacity: 0.6, flex: 1, justifyContent: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {user?.email}
          </p>
        </div>
      </div>

      {/* Mobile: Detail panel */}
      <div
        className="mobile-detail-panel"
        style={{
          display: mobilePanel === 'detail' ? 'flex' : 'none',
          position: 'fixed', inset: 0, zIndex: 10,
          flexDirection: 'column',
          background: 'var(--bg)',
          paddingTop: 57,
          overflowY: 'auto',
        }}
      >
        <div style={{ padding: '24px 16px', flex: 1 }}>
          {selectedItem == null && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column', gap: 12, opacity: 0.4 }}>
              <Shield size={48} color="var(--text-secondary)" />
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Select an item to view details</p>
            </div>
          )}
          {selectedItem != null && selectedItemLoading && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, flexDirection: 'column', gap: 12, opacity: 0.5 }}>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Decrypting…</p>
            </div>
          )}
          {selectedItem != null && !selectedItemLoading && (
            <div className="animate-fade-up">
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 48, height: 48, borderRadius: 10, background: 'var(--bg-elevated)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {selectedItem.favicon_url
                      ? <img src={selectedItem.favicon_url} alt="" width={26} height={26} />
                      : React.createElement(CATEGORY_ICONS[selectedItem.category] || Globe, { size: 22, color: 'var(--accent)' })}
                  </div>
                  <div>
                    <h2 className="font-display" style={{ fontSize: 'clamp(1.25rem, 5vw, 1.75rem)', color: 'var(--text-primary)' }}>{selectedItem.name}</h2>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', textTransform: 'capitalize' }}>{selectedItem.category}</span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button onClick={() => handleToggleFav(selectedItem)} className="btn-ghost" style={{ padding: '8px 10px' }}>
                    <Star size={15} color={selectedItem.is_favourite ? 'var(--accent)' : 'var(--text-secondary)'} fill={selectedItem.is_favourite ? 'var(--accent)' : 'none'} />
                  </button>
                  <button onClick={() => handleOpenEdit(selectedItem)} className="btn-ghost" style={{ padding: '8px 10px' }}>
                    <Edit2 size={15} />
                  </button>
                  <button onClick={() => handleDelete(selectedItem.id, () => setMobilePanel('list'))} className="btn-ghost"
                    disabled={deletingId === selectedItem.id}
                    style={{ padding: '8px 10px', color: 'var(--danger)', borderColor: 'rgba(239,68,68,0.2)', opacity: deletingId === selectedItem.id ? 0.5 : 1 }}>
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {selectedItem.decrypted?.url && <Field label="URL" value={selectedItem.decrypted.url} onCopy={() => copyToClipboard(selectedItem.decrypted.url, 'URL')} />}
                {selectedItem.decrypted?.username && <Field label="Username / Email" value={selectedItem.decrypted.username} onCopy={() => copyToClipboard(selectedItem.decrypted.username, 'Username')} />}
                {selectedItem.decrypted?.password && (
                  <>
                    <Field label="Password" value={selectedItem.decrypted.password} secret onCopy={() => copyToClipboard(selectedItem.decrypted.password, 'Password')} />
                    <HibpCheck hibp={hibp} onCheck={async () => {
                      setHibp({ checking: true, count: null });
                      try { const c = await checkHIBP(selectedItem.decrypted.password); setHibp({ checking: false, count: c }); }
                      catch { setHibp({ checking: false, count: -1 }); }
                    }} />
                  </>
                )}
                {selectedItem.decrypted?.cardNumber && <Field label="Card Number" value={selectedItem.decrypted.cardNumber} secret onCopy={() => copyToClipboard(selectedItem.decrypted.cardNumber, 'Card number')} />}
                {selectedItem.decrypted?.cardHolder && <Field label="Cardholder Name" value={selectedItem.decrypted.cardHolder} onCopy={() => copyToClipboard(selectedItem.decrypted.cardHolder, 'Cardholder')} />}
                {selectedItem.decrypted?.expiry && <Field label="Expiry" value={selectedItem.decrypted.expiry} onCopy={() => copyToClipboard(selectedItem.decrypted.expiry, 'Expiry')} />}
                {selectedItem.decrypted?.cvv && <Field label="CVV" value={selectedItem.decrypted.cvv} secret onCopy={() => copyToClipboard(selectedItem.decrypted.cvv, 'CVV')} />}
                {selectedItem.decrypted?.firstName && <Field label="First Name" value={selectedItem.decrypted.firstName} onCopy={() => copyToClipboard(selectedItem.decrypted.firstName, 'First name')} />}
                {selectedItem.decrypted?.lastName && <Field label="Last Name" value={selectedItem.decrypted.lastName} onCopy={() => copyToClipboard(selectedItem.decrypted.lastName, 'Last name')} />}
                {selectedItem.decrypted?.phone && <Field label="Phone" value={selectedItem.decrypted.phone} onCopy={() => copyToClipboard(selectedItem.decrypted.phone, 'Phone')} />}
                {selectedItem.decrypted?.address && <Field label="Address" value={selectedItem.decrypted.address} multiline />}
                {selectedItem.decrypted?.notes && <Field label="Notes" value={selectedItem.decrypted.notes} multiline />}
              </div>
              <p style={{ marginTop: 20, fontSize: '0.72rem', color: 'var(--text-secondary)', opacity: 0.6 }}>
                Last updated {new Date(selectedItem.updated_at).toLocaleDateString()}
              </p>
            </div>
          )}
        </div>
      </div>

      {/*  Desktop layout */}
      <aside className="desktop-sidebar" style={{
        width: 240, borderRight: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column', padding: '24px 16px', flexShrink: 0,
      }}>
        <div className="flex items-center gap-2 px-3 mb-8">
          <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Key size={16} color="#0a0908" strokeWidth={2.5} />
          </div>
          <span className="font-display text-xl" style={{ color: 'var(--text-primary)' }}>Cipheria</span>
        </div>

        <nav style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {[
            { id: 'all', label: 'All Items', icon: Shield },
            { id: 'login', label: 'Logins', icon: Globe },
            { id: 'card', label: 'Cards', icon: CreditCard },
            { id: 'note', label: 'Notes', icon: StickyNote },
            { id: 'identity', label: 'Identities', icon: User },
          ].map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => props.setCategory(id as Category)} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
              borderRadius: 10, border: 'none', cursor: 'pointer', textAlign: 'left', width: '100%',
              background: category === id ? 'var(--accent-dim)' : 'transparent',
              color: category === id ? 'var(--accent)' : 'var(--text-secondary)',
              fontSize: '0.875rem', fontFamily: 'Outfit, sans-serif', transition: 'all 0.15s',
            }}>
              <Icon size={16} />
              {label}
              <span style={{ marginLeft: 'auto', fontSize: '0.75rem', opacity: 0.6 }}>
                {id === 'all' ? vaultItems.length : vaultItems.filter((i: VaultItem) => i.category === id).length}
              </span>
            </button>
          ))}
        </nav>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
          <button onClick={handleExport} className="btn-ghost" style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center', fontSize: '0.8rem' }}>
            <Download size={14} /> Export Vault
          </button>
          <button onClick={lockVault} className="btn-ghost" style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center', fontSize: '0.8rem' }}>
            <Lock size={14} /> Lock Vault
          </button>
          <button onClick={handleLogout} className="btn-ghost" style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center', fontSize: '0.8rem', color: 'var(--danger)' }}>
            <LogOut size={14} /> Sign Out
          </button>
          <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', textAlign: 'center', paddingTop: 8, opacity: 0.6 }}>
            {user?.email}
          </p>
        </div>
      </aside>

      <div className="desktop-list-col" style={{ width: 320, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
        <div style={{ padding: '20px 16px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ position: 'relative', marginBottom: 12 }}>
            <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
            <input
              className="input-field"
              placeholder="Search vault..."
              value={searchValue}
              onChange={(e) => onSearchChange(e.target.value)}
              style={{ paddingLeft: 36 }}
            />
          </div>
          <button className="btn-primary" onClick={() => setShowAddModal(true)}
            style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <Plus size={16} /> Add Item
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
          {filteredItems.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-secondary)' }}>
              <Shield size={32} style={{ opacity: 0.3, margin: '0 auto 12px' }} />
              <p style={{ fontSize: '0.875rem' }}>No items found</p>
            </div>
          ) : filteredItems.map((item: any) => {
            const Icon = CATEGORY_ICONS[item.category] || Globe;
            return (
              <button key={item.id} onClick={() => handleSelectItem(item)} style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 12,
                padding: '12px', borderRadius: 10, border: 'none', cursor: 'pointer',
                background: selectedItem?.id === item.id ? 'var(--accent-dim)' : 'transparent',
                borderLeft: selectedItem?.id === item.id ? '2px solid var(--accent)' : '2px solid transparent',
                transition: 'all 0.15s', marginBottom: 2,
              }}>
                <div style={{
                  width: 36, height: 36, borderRadius: 8, flexShrink: 0,
                  background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  overflow: 'hidden',
                }}>
                  {item.favicon_url ? (
                    <img src={item.favicon_url} alt="" width={20} height={20} onError={(e: any) => e.target.style.display = 'none'} />
                  ) : <Icon size={16} color="var(--text-secondary)" />}
                </div>
                <div style={{ flex: 1, textAlign: 'left', minWidth: 0 }}>
                  <p style={{ fontSize: '0.875rem', color: 'var(--text-primary)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.name}
                  </p>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.decrypted?.username || item.decrypted?.url || item.category}
                  </p>
                </div>
                {item.is_favourite && <Star size={12} color="var(--accent)" fill="var(--accent)" />}
              </button>
            );
          })}
        </div>
      </div>

      <div className="desktop-detail-col" style={{ flex: 1, overflowY: 'auto', padding: '32px' }}>
        {selectedItem == null && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column', gap: 12, opacity: 0.4 }}>
            <Shield size={48} color="var(--text-secondary)" />
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Select an item to view details</p>
          </div>
        )}
        {selectedItem != null && selectedItemLoading && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column', gap: 12, opacity: 0.5 }}>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Decrypting…</p>
          </div>
        )}
        {selectedItem != null && !selectedItemLoading && (
          <div className="animate-fade-up" style={{ maxWidth: 560 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 32 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <div style={{
                  width: 52, height: 52, borderRadius: 12, background: 'var(--bg-elevated)',
                  border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {selectedItem.favicon_url
                    ? <img src={selectedItem.favicon_url} alt="" width={28} height={28} />
                    : React.createElement(CATEGORY_ICONS[selectedItem.category] || Globe, { size: 24, color: 'var(--accent)' })}
                </div>
                <div>
                  <h2 className="font-display" style={{ fontSize: '1.75rem', color: 'var(--text-primary)' }}>{selectedItem.name}</h2>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', textTransform: 'capitalize' }}>{selectedItem.category}</span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => handleToggleFav(selectedItem)} className="btn-ghost" style={{ padding: '8px 12px' }}>
                  <Star size={16} color={selectedItem.is_favourite ? 'var(--accent)' : 'var(--text-secondary)'} fill={selectedItem.is_favourite ? 'var(--accent)' : 'none'} />
                </button>
                <button onClick={() => handleOpenEdit(selectedItem)} className="btn-ghost" style={{ padding: '8px 12px' }} title="Edit item">
                  <Edit2 size={16} />
                </button>
                <button onClick={() => handleDelete(selectedItem.id)} className="btn-ghost"
                  disabled={deletingId === selectedItem.id}
                  style={{ padding: '8px 12px', color: 'var(--danger)', borderColor: 'rgba(239,68,68,0.2)', opacity: deletingId === selectedItem.id ? 0.5 : 1 }}>
                  <Trash2 size={16} />
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {selectedItem.decrypted?.url && (
                <Field label="URL" value={selectedItem.decrypted.url} onCopy={() => copyToClipboard(selectedItem.decrypted.url, 'URL')} />
              )}
              {selectedItem.decrypted?.username && (
                <Field label="Username / Email" value={selectedItem.decrypted.username} onCopy={() => copyToClipboard(selectedItem.decrypted.username, 'Username')} />
              )}
              {selectedItem.decrypted?.password && (
                <>
                  <Field label="Password" value={selectedItem.decrypted.password} secret onCopy={() => copyToClipboard(selectedItem.decrypted.password, 'Password')} />
                  <HibpCheck
                    hibp={hibp}
                    onCheck={async () => {
                      setHibp({ checking: true, count: null });
                      try {
                        const c = await checkHIBP(selectedItem.decrypted.password);
                        setHibp({ checking: false, count: c });
                      } catch { setHibp({ checking: false, count: -1 }); }
                    }}
                  />
                </>
              )}
              {selectedItem.decrypted?.cardNumber && (
                <Field label="Card Number" value={selectedItem.decrypted.cardNumber} secret onCopy={() => copyToClipboard(selectedItem.decrypted.cardNumber, 'Card number')} />
              )}
              {selectedItem.decrypted?.cardHolder && (
                <Field label="Cardholder Name" value={selectedItem.decrypted.cardHolder} onCopy={() => copyToClipboard(selectedItem.decrypted.cardHolder, 'Cardholder')} />
              )}
              {selectedItem.decrypted?.expiry && (
                <Field label="Expiry" value={selectedItem.decrypted.expiry} onCopy={() => copyToClipboard(selectedItem.decrypted.expiry, 'Expiry')} />
              )}
              {selectedItem.decrypted?.cvv && (
                <Field label="CVV" value={selectedItem.decrypted.cvv} secret onCopy={() => copyToClipboard(selectedItem.decrypted.cvv, 'CVV')} />
              )}
              {selectedItem.decrypted?.firstName && (
                <Field label="First Name" value={selectedItem.decrypted.firstName} onCopy={() => copyToClipboard(selectedItem.decrypted.firstName, 'First name')} />
              )}
              {selectedItem.decrypted?.lastName && (
                <Field label="Last Name" value={selectedItem.decrypted.lastName} onCopy={() => copyToClipboard(selectedItem.decrypted.lastName, 'Last name')} />
              )}
              {selectedItem.decrypted?.phone && (
                <Field label="Phone" value={selectedItem.decrypted.phone} onCopy={() => copyToClipboard(selectedItem.decrypted.phone, 'Phone')} />
              )}
              {selectedItem.decrypted?.address && (
                <Field label="Address" value={selectedItem.decrypted.address} multiline />
              )}
              {selectedItem.decrypted?.notes && (
                <Field label="Notes" value={selectedItem.decrypted.notes} multiline />
              )}
            </div>

            <p style={{ marginTop: 24, fontSize: '0.72rem', color: 'var(--text-secondary)', opacity: 0.6 }}>
              Last updated {new Date(selectedItem.updated_at).toLocaleDateString()}
            </p>
          </div>
        )}
      </div>

      {showAddModal && (
        <AddItemModal newItem={newItem} setNewItem={setNewItem} savingItem={savingItem} genOptions={genOptions} onSubmit={handleAddItem} onClose={() => setShowAddModal(false)} />
      )}

      {showEditModal && editForm && (
        <EditItemModal editForm={editForm} setEditForm={setEditForm} updatingItem={updatingItem} genOptions={genOptions} onSubmit={handleEditItem} onClose={() => { setShowEditModal(false); setEditForm(null); }} />
      )}
    </div>
  );
}

// Sub-components

function HibpCheck({ hibp, onCheck }: Readonly<{
  hibp: { checking: boolean; count: number | null };
  onCheck: () => void;
}>) {
  const { checking, count } = hibp;
  let statusColor = 'var(--text-secondary)';
  if (count === 0) statusColor = '#22c55e';
  else if (count !== null && count > 0) statusColor = '#ef4444';
  let statusText = '';
  if (count === -1) statusText = 'Check failed';
  else if (count === 0) statusText = '\u2713 Not found in known breaches';
  else if (count !== null) statusText = `\u26A0 Found in ${count.toLocaleString()} breaches`;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: -8 }}>
      <button
        type="button"
        onClick={onCheck}
        disabled={checking}
        style={{
          fontSize: '0.72rem', padding: '4px 10px', borderRadius: 6,
          border: '1px solid var(--border)', background: 'transparent',
          color: 'var(--text-secondary)', cursor: checking ? 'default' : 'pointer',
          opacity: checking ? 0.6 : 1,
        }}
      >
        {checking ? 'Checking\u2026' : 'Check breaches (HIBP)'}
      </button>
      {count !== null && (
        <span style={{ fontSize: '0.72rem', fontWeight: 600, color: statusColor }}>
          {statusText}
        </span>
      )}
    </div>
  );
}

function Field({ label, value, secret, onCopy }: Readonly<{
  label: string; value: string; secret?: boolean; multiline?: boolean; onCopy?: () => void;
}>) {
  const [show, setShow] = useState(!secret);
  return (
    <div className="glass" style={{ borderRadius: 12, padding: '16px 18px' }}>
      <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginBottom: 8, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{label}</p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <p style={{
          flex: 1, fontSize: '0.95rem', color: 'var(--text-primary)', fontFamily: secret ? 'DM Mono, monospace' : 'inherit',
          wordBreak: 'break-all', lineHeight: 1.6
        }}>
          {secret && !show ? '••••••••••••••••' : value}
        </p>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          {secret && (
            <button onClick={() => setShow(!show)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: 4 }}>
              {show ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          )}
          {onCopy && (
            <button onClick={onCopy} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: 4 }}>
              <Copy size={15} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Shared label helper
function FieldLabel({ htmlFor, children }: Readonly<{ htmlFor: string; children: React.ReactNode }>) {
  return (
    <label htmlFor={htmlFor} style={{
      display: 'flex', alignItems: 'center', gap: 6,
      fontSize: '0.72rem', fontWeight: 600, letterSpacing: '0.06em',
      textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: 8,
    }}>
      {children}
    </label>
  );
}

// Category pill selector
const CATEGORY_CONFIG = [
  { value: 'login', label: 'Login', icon: Globe },
  { value: 'card', label: 'Card', icon: CreditCard },
  { value: 'note', label: 'Note', icon: StickyNote },
  { value: 'identity', label: 'Identity', icon: User },
] as const;

function CategoryPicker({ value, onChange }: Readonly<{ value: string; onChange: (v: string) => void }>) {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {CATEGORY_CONFIG.map(({ value: v, label, icon: Icon }) => {
        const active = value === v;
        return (
          <button
            key={v}
            type="button"
            onClick={() => onChange(v)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '7px 14px', borderRadius: 20, border: '1px solid',
              borderColor: active ? 'var(--accent)' : 'var(--border)',
              background: active ? 'var(--accent-dim)' : 'transparent',
              color: active ? 'var(--accent)' : 'var(--text-secondary)',
              fontSize: '0.8rem', fontFamily: 'Outfit, sans-serif',
              cursor: 'pointer', transition: 'all 0.15s',
              minHeight: 36,
            }}
          >
            <Icon size={13} />
            {label}
          </button>
        );
      })}
    </div>
  );
}

// Modal shell
function Modal({ children, onClose, title, icon }: Readonly<{
  children: React.ReactNode; onClose: () => void; title: string; icon?: React.ReactNode;
}>) {
  const dialogRef = React.useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (dialogRef.current && !dialogRef.current.open) dialogRef.current.showModal();
    const dialog = dialogRef.current;
    const handleCancel = (e: Event) => { e.preventDefault(); onClose(); };
    dialog?.addEventListener('cancel', handleCancel);
    return () => dialog?.removeEventListener('cancel', handleCancel);
  }, [onClose]);

  return (
    <dialog
      ref={dialogRef}
      style={{
        position: 'fixed', inset: 0, margin: 0,
        width: '100%', height: '100%', maxWidth: '100%', maxHeight: '100%',
        background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        zIndex: 100, padding: 0, border: 'none',
      }}
    >
      <style>{`
        /* Desktop: centered floating card */
        @media (min-width: 600px) {
          .modal-sheet { border-radius: 20px !important; margin-bottom: 0 !important; }
          .modal-backdrop { align-items: center !important; padding: 24px !important; }
        }
        /* Drag handle only on mobile */
        @media (min-width: 600px) { .modal-handle { display: none !important; } }
        /* Smooth sheet entrance */
        @keyframes slideUp {
          from { transform: translateY(24px); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }
        .modal-sheet { animation: slideUp 0.28s cubic-bezier(0.32,0.72,0,1) forwards; }
      `}</style>

      <button
        className="modal-backdrop"
        style={{
          display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
          width: '100%', height: '100%',
          background: 'none', border: 'none', padding: 0,
        }}
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        onKeyDown={(e) => { if ((e.key === 'Escape' || e.key === 'Enter') && e.currentTarget === e.target) onClose(); }}
      >
        <div
          className="modal-sheet"
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: '24px 24px 0 0',
            width: '100%', maxWidth: 520,
            maxHeight: '92dvh',
            display: 'flex', flexDirection: 'column',
            overflow: 'hidden',
            boxShadow: '0 -8px 40px rgba(0,0,0,0.5)',
          }}
        >
          {/* Drag handle (mobile only) */}
          <div className="modal-handle" style={{ display: 'flex', justifyContent: 'center', paddingTop: 12, paddingBottom: 4, flexShrink: 0 }}>
            <div style={{ width: 36, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.15)' }} />
          </div>

          {/* Header */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '20px 24px 0',
            flexShrink: 0,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {icon && (
                <div style={{
                  width: 36, height: 36, borderRadius: 10,
                  background: 'var(--accent-dim)', border: '1px solid rgba(245,158,11,0.25)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>
                  {icon}
                </div>
              )}
              <h3 className="font-display" style={{ fontSize: '1.4rem', color: 'var(--text-primary)', lineHeight: 1 }}>
                {title}
              </h3>
            </div>
            <button
              onClick={onClose}
              style={{
                background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border)',
                borderRadius: 8, cursor: 'pointer', color: 'var(--text-secondary)',
                width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'all 0.15s', flexShrink: 0,
              }}
            >
              <X size={16} />
            </button>
          </div>

          {/* Divider */}
          <div style={{ height: 1, background: 'var(--border)', margin: '16px 0 0', flexShrink: 0 }} />

          {/* Scrollable body */}
          <div style={{
            overflowY: 'auto', flex: 1,
            padding: '20px 24px',
            paddingBottom: 'calc(20px + env(safe-area-inset-bottom, 0px))',
          }}>
            {children}
          </div>
        </div>
      </button>
    </dialog>
  );
}

// Shared form body (used by both Add and Edit) 
function ItemFormBody({
  form, setForm, genOptions, submitLabel, submitting, onClose,
}: Readonly<{
  form: any; setForm: (f: any) => void; genOptions: any;
  submitLabel: string; submitting: boolean; onClose: () => void;
}>) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Name */}
      <div>
        <FieldLabel htmlFor="form-name">Name *</FieldLabel>
        <input
          id="form-name" className="input-field" required
          placeholder="e.g. GitHub, Netflix…"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          style={{ fontSize: 'max(16px, 0.9rem)' }}
        />
      </div>

      {/* Category pills */}
      <div>
        <FieldLabel htmlFor="form-category">Category</FieldLabel>
        <CategoryPicker value={form.category} onChange={(v) => setForm({ ...form, category: v })} />
      </div>

      {/* Divider */}
      <div style={{ height: 1, background: 'var(--border)' }} />

      {/* Category-specific fields */}
      {form.category === 'login' && <LoginFormFields form={form} setForm={setForm} genOptions={genOptions} />}
      {form.category === 'card' && <CardFormFields form={form} setForm={setForm} prefix="form" />}
      {form.category === 'identity' && <IdentityFormFields form={form} setForm={setForm} prefix="form" />}

      {/* Notes — always shown */}
      <div>
        <FieldLabel htmlFor="form-notes">Notes</FieldLabel>
        <textarea
          id="form-notes" className="input-field" rows={3}
          placeholder="Any additional notes…"
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
          style={{ resize: 'vertical', fontSize: 'max(16px, 0.9rem)' }}
        />
      </div>

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 10, paddingTop: 4 }}>
        <button
          type="button" className="btn-ghost" onClick={onClose}
          style={{ flex: 1, minHeight: 46 }}
        >
          Cancel
        </button>
        <button
          type="submit" className="btn-primary"
          disabled={submitting}
          style={{ flex: 2, minHeight: 46, opacity: submitting ? 0.6 : 1, cursor: submitting ? 'not-allowed' : 'pointer' }}
        >
          {submitting ? 'Saving…' : submitLabel}
        </button>
      </div>
    </div>
  );
}

function AddItemModal({ newItem, setNewItem, savingItem, genOptions, onSubmit, onClose }: Readonly<{
  newItem: any; setNewItem: (f: any) => void; savingItem: boolean; genOptions: any; onSubmit: (e: React.FormEvent) => void; onClose: () => void;
}>) {
  return (
    <Modal onClose={onClose} title="Add Item" icon={<Plus size={16} color="var(--accent)" />}>
      <form onSubmit={onSubmit}>
        <ItemFormBody
          form={newItem} setForm={setNewItem} genOptions={genOptions}
          submitLabel="Save to Vault" submitting={savingItem} onClose={onClose}
        />
      </form>
    </Modal>
  );
}

function EditItemModal({ editForm, setEditForm, updatingItem, genOptions, onSubmit, onClose }: Readonly<{
  editForm: any; setEditForm: (f: any) => void; updatingItem: boolean; genOptions: any; onSubmit: (e: React.FormEvent) => void; onClose: () => void;
}>) {
  return (
    <Modal onClose={onClose} title="Edit Item" icon={<Edit2 size={16} color="var(--accent)" />}>
      <form onSubmit={onSubmit}>
        <ItemFormBody
          form={editForm} setForm={setEditForm} genOptions={genOptions}
          submitLabel="Save Changes" submitting={updatingItem} onClose={onClose}
        />
      </form>
    </Modal>
  );
}

// Form field components

function LoginFormFields({ form, setForm, genOptions }: Readonly<{ form: any; setForm: (f: any) => void; genOptions: any }>) {
  const [showPw, setShowPw] = useState(false);
  const s = form.password ? passwordStrength(form.password) : null;
  return (
    <>
      <div>
        <FieldLabel htmlFor="login-url">URL</FieldLabel>
        <input
          id="login-url" className="input-field" placeholder="https://github.com"
          value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })}
          style={{ fontSize: 'max(16px, 0.9rem)' }}
        />
      </div>
      <div>
        <FieldLabel htmlFor="login-username">Username / Email</FieldLabel>
        <input
          id="login-username" className="input-field" placeholder="you@example.com"
          value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })}
          style={{ fontSize: 'max(16px, 0.9rem)' }}
        />
      </div>
      <div>
        <FieldLabel htmlFor="login-password">Password</FieldLabel>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <input
              id="login-password" className="input-field"
              type={showPw ? 'text' : 'password'} placeholder="••••••••"
              value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })}
              style={{ paddingRight: 44, fontSize: 'max(16px, 0.9rem)' }}
            />
            <button
              type="button" onClick={() => setShowPw(!showPw)}
              style={{
                position: 'absolute', right: 0, top: 0, bottom: 0, width: 44,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)',
              }}
            >
              {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
          <button
            type="button" className="btn-ghost"
            style={{ padding: '0 14px', flexShrink: 0, minHeight: 44, display: 'flex', alignItems: 'center', gap: 6 }}
            onClick={() => setForm({ ...form, password: generatePassword(genOptions) })}
            title="Generate password"
          >
            <RefreshCw size={14} />
          </button>
        </div>
        {/* Strength bar */}
        {s && (
          <div style={{ marginTop: 8 }}>
            <div style={{ display: 'flex', gap: 3, marginBottom: 5 }}>
              {[0, 1, 2, 3, 4].map(i => (
                <div key={i} style={{
                  height: 3, flex: 1, borderRadius: 2,
                  background: i <= s.score ? s.color : 'rgba(255,255,255,0.08)',
                  transition: 'background 0.3s',
                }} />
              ))}
            </div>
            <span style={{ fontSize: '0.72rem', color: s.color }}>{s.label}</span>
          </div>
        )}
      </div>
    </>
  );
}

function CardFormFields({ form, setForm, prefix }: Readonly<{ form: any; setForm: (f: any) => void; prefix: string }>) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <FieldLabel htmlFor={`${prefix}-card-number`}>Card Number</FieldLabel>
        <input id={`${prefix}-card-number`} className="input-field" placeholder="4111 1111 1111 1111"
          value={form.cardNumber} onChange={(e) => setForm({ ...form, cardNumber: e.target.value })}
          style={{ fontSize: 'max(16px, 0.9rem)', fontFamily: 'DM Mono, monospace', letterSpacing: '0.05em' }} />
      </div>
      <div>
        <FieldLabel htmlFor={`${prefix}-card-holder`}>Cardholder Name</FieldLabel>
        <input id={`${prefix}-card-holder`} className="input-field" placeholder="Jane Smith"
          value={form.cardHolder} onChange={(e) => setForm({ ...form, cardHolder: e.target.value })}
          style={{ fontSize: 'max(16px, 0.9rem)' }} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <FieldLabel htmlFor={`${prefix}-expiry`}>Expiry</FieldLabel>
          <input id={`${prefix}-expiry`} className="input-field" placeholder="MM/YY"
            value={form.expiry} onChange={(e) => setForm({ ...form, expiry: e.target.value })}
            style={{ fontSize: 'max(16px, 0.9rem)' }} />
        </div>
        <div>
          <FieldLabel htmlFor={`${prefix}-cvv`}>CVV</FieldLabel>
          <input id={`${prefix}-cvv`} className="input-field" placeholder="•••" type="password"
            value={form.cvv} onChange={(e) => setForm({ ...form, cvv: e.target.value })}
            style={{ fontSize: 'max(16px, 0.9rem)' }} />
        </div>
      </div>
    </div>
  );
}

function IdentityFormFields({ form, setForm, prefix }: Readonly<{ form: any; setForm: (f: any) => void; prefix: string }>) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <FieldLabel htmlFor={`${prefix}-first-name`}>First Name</FieldLabel>
          <input id={`${prefix}-first-name`} className="input-field" placeholder="Jane"
            value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })}
            style={{ fontSize: 'max(16px, 0.9rem)' }} />
        </div>
        <div>
          <FieldLabel htmlFor={`${prefix}-last-name`}>Last Name</FieldLabel>
          <input id={`${prefix}-last-name`} className="input-field" placeholder="Smith"
            value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })}
            style={{ fontSize: 'max(16px, 0.9rem)' }} />
        </div>
      </div>
      <div>
        <FieldLabel htmlFor={`${prefix}-phone`}>Phone</FieldLabel>
        <input id={`${prefix}-phone`} className="input-field" placeholder="+1 555 000 0000"
          value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
          style={{ fontSize: 'max(16px, 0.9rem)' }} />
      </div>
      <div>
        <FieldLabel htmlFor={`${prefix}-address`}>Address</FieldLabel>
        <input id={`${prefix}-address`} className="input-field" placeholder="123 Main St, City"
          value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })}
          style={{ fontSize: 'max(16px, 0.9rem)' }} />
      </div>
    </div>
  );
}