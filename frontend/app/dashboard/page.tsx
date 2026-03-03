'use client';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Key, Search, Plus, LogOut, Lock, Star, Globe, CreditCard, StickyNote, User,
  Copy, Eye, EyeOff, Trash2, Download, Shield, X, RefreshCw, Edit2
} from 'lucide-react';
import toast from 'react-hot-toast';
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

// Custom hook for vault unlock logic
function useVaultUnlock(user: any, setVaultKey: any, setVaultItems: any) {
  const [masterPassword, setMasterPassword] = useState('');
  const [unlocking, setUnlocking] = useState(false);

  const unlockVault = async (e: React.FormEvent) => {
    e.preventDefault();
    setUnlocking(true);
    const tid = toast.loading('Unlocking vault...');
    try {
      const salt = user?.vault_salt || '';
      const key = await deriveKey(masterPassword, salt);
      setVaultKey(key);

      toast.loading('Loading items...', { id: tid });
      const { data } = await vaultApi.list();
      const decrypted = await Promise.all(
        data.map(async (item: any) => {
          try {
            const dec = await decryptData(item.encrypted_data, key);
            return { ...item, decrypted: dec };
          } catch { return item; }
        })
      );
      setVaultItems(decrypted);
      setMasterPassword('');
      toast.success('Vault unlocked', { id: tid });
    } catch (err) {
      toast.error('Wrong master password or corrupted data', { id: tid });
      console.error('Vault unlock error:', err);
    } finally {
      setUnlocking(false);
    }
  };

  return { masterPassword, setMasterPassword, unlocking, unlockVault };
}

export default function Dashboard() {
  const router = useRouter();
  const { user, cryptoKey, isAuthenticated, vaultItems, isVaultLocked,
    setVaultKey, setVaultItems, addVaultItem, updateVaultItem, removeVaultItem, logout, lockVault, restoreSession } = useAuthStore();

  const [category, setCategory] = useState<Category>('all');
  const [search, setSearch] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedItem, setSelectedItem] = useState<VaultItem | null>(null);
  const [newItem, setNewItem] = useState({
    name: '', category: 'login',
    username: '', password: '', url: '', notes: '',
    cardNumber: '', cardHolder: '', expiry: '', cvv: '',
    firstName: '', lastName: '', phone: '', address: '',
  });
  const emptyForm = { name: '', category: 'login', username: '', password: '', url: '', notes: '', cardNumber: '', cardHolder: '', expiry: '', cvv: '', firstName: '', lastName: '', phone: '', address: '' };
  const genOptions = { length: 20, uppercase: true, lowercase: true, numbers: true, symbols: true };
  const [sessionLoading, setSessionLoading] = useState(true);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const IDLE_MS = 5 * 60 * 1000;
  const [showEditModal, setShowEditModal] = useState(false);
  const [editForm, setEditForm] = useState<typeof newItem | null>(null);
  const [savingItem, setSavingItem] = useState(false);
  const [updatingItem, setUpdatingItem] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [hibp, setHibp] = useState<{ checking: boolean; count: number | null }>({ checking: false, count: null });

  const { masterPassword, setMasterPassword, unlocking, unlockVault } = useVaultUnlock(user, setVaultKey, setVaultItems);

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
        toast('Vault auto-locked after 5 min of inactivity', { icon: '\uD83D\uDD12' });
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

  const parseApiError = (err: any, fallback: string): string => {
    const detail = err?.response?.data?.detail;
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail) && detail.length > 0)
      return detail.map((d: any) => String(d.msg ?? d).replace(/^Value error,\s*/i, '')).join('; ');
    return fallback;
  };

  const tryGetFaviconUrl = (url: string): string | undefined => {
    try {
      const { hostname } = new URL(url.includes('://') ? url : `https://${url}`);
      return `https://www.google.com/s2/favicons?domain=${hostname}&sz=64`;
    } catch {
      return undefined;
    }
  };

  const handleLogout = async () => {
    try { await authApi.logout(); } catch { }
    logout();
    router.push('/auth');
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

  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cryptoKey) return;
    if (newItem.category === 'login' && newItem.url && !/^https?:\/\//i.exec(newItem.url)) {
      toast.error('URL must start with http:// or https://');
      return;
    }
    setSavingItem(true);
    const tid = toast.loading('Saving to vault...');
    try {
      const payload = buildPayload(newItem);
      const encrypted_data = await encryptData(payload, cryptoKey);
      const favicon_url = newItem.url ? tryGetFaviconUrl(newItem.url) : undefined;

      const { data } = await vaultApi.create({
        name: newItem.name,
        category: newItem.category,
        encrypted_data,
        favicon_url,
      });
      addVaultItem({ ...data, decrypted: payload });
      setShowAddModal(false);
      setNewItem(emptyForm);
      toast.success('Item added to vault', { id: tid });
    } catch (err) { toast.error(parseApiError(err, 'Failed to save item'), { id: tid }); }
    finally { setSavingItem(false); }
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
      toast.error('URL must start with http:// or https://');
      return;
    }
    setUpdatingItem(true);
    const tid = toast.loading('Updating item...');
    try {
      const payload = buildPayload(editForm);
      const encrypted_data = await encryptData(payload, cryptoKey);
      const favicon_url = editForm.url
        ? tryGetFaviconUrl(editForm.url) ?? selectedItem.favicon_url
        : selectedItem.favicon_url;
      const { data } = await vaultApi.update(selectedItem.id, {
        name: editForm.name, category: editForm.category, encrypted_data, favicon_url,
      });
      const updated = { ...data, decrypted: payload };
      updateVaultItem(selectedItem.id, updated);
      setSelectedItem(updated);
      setShowEditModal(false);
      setEditForm(null);
      toast.success('Item updated', { id: tid });
    } catch (err) { toast.error(parseApiError(err, 'Failed to update item'), { id: tid }); }
    finally { setUpdatingItem(false); }
  };

  const handleDelete = async (id: string) => {
    if (deletingId) return;
    setDeletingId(id);
    const tid = toast.loading('Deleting item...');
    try {
      await vaultApi.delete(id);
      removeVaultItem(id);
      if (selectedItem?.id === id) setSelectedItem(null);
      toast.success('Item deleted', { id: tid });
    } catch (err) { toast.error(parseApiError(err, 'Failed to delete'), { id: tid }); }
    finally { setDeletingId(null); }
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
    toast.success(`${label} copied!`);
    setTimeout(() => navigator.clipboard.writeText(''), 30000);
  };

  const handleExport = async () => {
    try {
      const { data } = await vaultApi.export();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'cipheria-export.json'; a.click();
      toast.success('Vault exported');
    } catch { toast.error('Export failed'); }
  };

  const filteredItems = vaultItems.filter((item) => {
    if (category !== 'all' && item.category !== category) return false;
    if (search && !item.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  if (isVaultLocked) {
    return <LockedVaultScreen user={user} masterPassword={masterPassword} setMasterPassword={setMasterPassword} unlocking={unlocking} unlockVault={unlockVault} handleLogout={handleLogout} />;
  }

  if (sessionLoading) {
    return (
      <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
        <div style={{ color: 'var(--text-secondary)', fontSize: 14 }}>Loading...</div>
      </div>
    );
  }

  return <MainDashboard user={user} category={category} setCategory={setCategory} search={setSearch} handleExport={handleExport} lockVault={lockVault} handleLogout={handleLogout} vaultItems={vaultItems} selectedItem={selectedItem} setSelectedItem={setSelectedItem} handleToggleFav={handleToggleFav} handleOpenEdit={handleOpenEdit} handleDelete={handleDelete} deletingId={deletingId} copyToClipboard={copyToClipboard} hibp={hibp} setHibp={setHibp} showAddModal={showAddModal} setShowAddModal={setShowAddModal} newItem={newItem} setNewItem={setNewItem} savingItem={savingItem} genOptions={genOptions} handleAddItem={handleAddItem} showEditModal={showEditModal} setShowEditModal={setShowEditModal} editForm={editForm} setEditForm={setEditForm} updatingItem={updatingItem} handleEditItem={handleEditItem} filteredItems={filteredItems} />;
}

function LockedVaultScreen({ user, masterPassword, setMasterPassword, unlocking, unlockVault, handleLogout }: Readonly<any>) {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg)' }}>
      <div style={{
        position: 'fixed', top: '30%', left: '50%', transform: 'translateX(-50%)',
        width: 500, height: 500, borderRadius: '50%',
        background: 'radial-gradient(ellipse, rgba(245,158,11,0.08) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />
      <div className="glass animate-fade-up" style={{ borderRadius: 24, padding: 48, width: '100%', maxWidth: 420, position: 'relative', zIndex: 1 }}>
        <div style={{ textAlign: 'center', marginBottom: 36 }}>
          <div style={{
            width: 72, height: 72, borderRadius: 18,
            background: 'var(--accent-dim)', border: '1px solid rgba(245,158,11,0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px',
          }}>
            <Lock size={32} color="var(--accent)" />
          </div>
          <h2 className="font-display" style={{ fontSize: '2rem', color: 'var(--text-primary)', marginBottom: 8 }}>
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
          />
          <button className="btn-primary" type="submit" disabled={unlocking}
            style={{ opacity: unlocking ? 0.7 : 1 }}>
            {unlocking ? 'Unlocking...' : 'Unlock Vault'}
          </button>
        </form>
        <button onClick={handleLogout} className="btn-ghost" style={{ width: '100%', marginTop: 12 }}>
          Sign out
        </button>
      </div>
    </div>
  );
}

function MainDashboard(props: Readonly<any>) {
  const { user, category, search, handleExport, lockVault, handleLogout, vaultItems, setShowAddModal, selectedItem, setSelectedItem, handleToggleFav, handleOpenEdit, handleDelete, deletingId, copyToClipboard, hibp, setHibp, showAddModal, newItem, setNewItem, savingItem, genOptions, handleAddItem, showEditModal, setShowEditModal, editForm, setEditForm, updatingItem, handleEditItem, filteredItems } = props;

  return (
    <div style={{ display: 'flex', height: '100vh', background: 'var(--bg)', overflow: 'hidden' }}>
      <aside style={{
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

      <div style={{ width: 320, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
        <div style={{ padding: '20px 16px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ position: 'relative', marginBottom: 12 }}>
            <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
            <input
              className="input-field"
              placeholder="Search vault..."
              value={search}
              onChange={(e) => props.search(e.target.value)}
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
              <button key={item.id} onClick={() => setSelectedItem(item)} style={{
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

      <div style={{ flex: 1, overflowY: 'auto', padding: '32px' }}>
        {selectedItem == null ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column', gap: 12, opacity: 0.4 }}>
            <Shield size={48} color="var(--text-secondary)" />
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Select an item to view details</p>
          </div>
        ) : (
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

function Modal({ children, onClose, title }: Readonly<{ children: React.ReactNode; onClose: () => void; title: string }>) {
  const dialogRef = React.useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (dialogRef.current && !dialogRef.current.open) {
      dialogRef.current.showModal();
    }
    const dialog = dialogRef.current;
    const handleCancel = (e: Event) => {
      e.preventDefault();
      onClose();
    };
    dialog?.addEventListener('cancel', handleCancel);
    return () => {
      dialog?.removeEventListener('cancel', handleCancel);
    };
  }, [onClose]);

  return (
    <dialog
      ref={dialogRef}
      aria-label={title}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 20,
        border: 'none',
      }}
    >
      <div
        className="glass animate-fade-up"
        style={{ borderRadius: 20, padding: 32, width: '100%', maxWidth: 500, maxHeight: '90vh', overflowY: 'auto' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <h3 className="font-display" style={{ fontSize: '1.5rem', color: 'var(--text-primary)' }}>{title}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}>
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}

function AddItemModal({ newItem, setNewItem, savingItem, genOptions, onSubmit, onClose }: Readonly<{
  newItem: any; setNewItem: (f: any) => void; savingItem: boolean; genOptions: any; onSubmit: (e: React.FormEvent) => void; onClose: () => void;
}>) {
  return (
    <Modal onClose={onClose} title="Add Item">
      <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label htmlFor="item-name" style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: 6 }}>NAME *</label>
            <input id="item-name" className="input-field" required placeholder="GitHub" value={newItem.name} onChange={(e) => setNewItem({ ...newItem, name: e.target.value })} />
          </div>
          <div>
            <label htmlFor="item-category" style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: 6 }}>CATEGORY</label>
            <select id="item-category" className="input-field" value={newItem.category} onChange={(e) => setNewItem({ ...newItem, category: e.target.value })} style={{ cursor: 'pointer' }}>
              <option value="login">Login</option>
              <option value="card">Card</option>
              <option value="note">Note</option>
              <option value="identity">Identity</option>
            </select>
          </div>
        </div>
        {newItem.category === 'login' && <LoginFormFields form={newItem} setForm={setNewItem} genOptions={genOptions} />}
        {newItem.category === 'card' && <CardFormFields form={newItem} setForm={setNewItem} prefix="add" />}
        {newItem.category === 'identity' && <IdentityFormFields form={newItem} setForm={setNewItem} prefix="add" />}
        <div>
          <label htmlFor="item-notes" style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: 6 }}>NOTES</label>
          <textarea id="item-notes" className="input-field" rows={3} placeholder="Additional notes..." value={newItem.notes}
            onChange={(e) => setNewItem({ ...newItem, notes: e.target.value })} style={{ resize: 'vertical' }} />
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
          <button type="button" className="btn-ghost" onClick={onClose} style={{ flex: 1 }}>Cancel</button>
          <button type="submit" className="btn-primary" style={{ flex: 2, opacity: savingItem ? 0.5 : 1 }} disabled={savingItem}>
            {savingItem ? 'Saving...' : 'Save to Vault'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function EditItemModal({ editForm, setEditForm, updatingItem, genOptions, onSubmit, onClose }: Readonly<{
  editForm: any; setEditForm: (f: any) => void; updatingItem: boolean; genOptions: any; onSubmit: (e: React.FormEvent) => void; onClose: () => void;
}>) {
  return (
    <Modal onClose={onClose} title="Edit Item">
      <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label htmlFor="edit-name" style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: 6 }}>NAME *</label>
            <input id="edit-name" className="input-field" required placeholder="GitHub" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
          </div>
          <div>
            <label htmlFor="edit-category" style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: 6 }}>CATEGORY</label>
            <select id="edit-category" className="input-field" value={editForm.category} onChange={(e) => setEditForm({ ...editForm, category: e.target.value })} style={{ cursor: 'pointer' }}>
              <option value="login">Login</option>
              <option value="card">Card</option>
              <option value="note">Note</option>
              <option value="identity">Identity</option>
            </select>
          </div>
        </div>
        {editForm.category === 'login' && <LoginFormFields form={editForm} setForm={setEditForm} genOptions={genOptions} />}
        {editForm.category === 'card' && <CardFormFields form={editForm} setForm={setEditForm} prefix="edit" />}
        {editForm.category === 'identity' && <IdentityFormFields form={editForm} setForm={setEditForm} prefix="edit" />}
        <div>
          <label htmlFor="edit-notes" style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: 6 }}>NOTES</label>
          <textarea id="edit-notes" className="input-field" rows={3} placeholder="Additional notes..." value={editForm.notes}
            onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} style={{ resize: 'vertical' }} />
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
          <button type="button" className="btn-ghost" onClick={onClose} style={{ flex: 1 }}>Cancel</button>
          <button type="submit" className="btn-primary" style={{ flex: 2, opacity: updatingItem ? 0.5 : 1 }} disabled={updatingItem}>
            {updatingItem ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function LoginFormFields({ form, setForm, genOptions }: Readonly<{ form: any; setForm: (f: any) => void; genOptions: any }>) {
  return (
    <>
      <div>
        <label htmlFor="login-url" style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: 6 }}>URL</label>
        <input id="login-url" className="input-field" placeholder="https://github.com" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
      </div>
      <div>
        <label htmlFor="login-username" style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: 6 }}>USERNAME / EMAIL</label>
        <input id="login-username" className="input-field" placeholder="you@example.com" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
      </div>
      <div>
        <label htmlFor="login-password" style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: 6 }}>PASSWORD</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input id="login-password" className="input-field" type="password" placeholder="••••••••" value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })} style={{ flex: 1 }} />
          <button type="button" className="btn-ghost" style={{ padding: '10px 14px', flexShrink: 0 }}
            onClick={() => setForm({ ...form, password: generatePassword(genOptions) })} title="Generate password">
            <RefreshCw size={14} />
          </button>
        </div>
        {form.password && (() => {
          const s = passwordStrength(form.password);
          return <div style={{ marginTop: 6 }}><div style={{ display: 'flex', gap: 3 }}>
            {[0, 1, 2, 3, 4].map(i => <div key={i} style={{ height: 3, flex: 1, borderRadius: 2, background: i <= s.score ? s.color : 'rgba(255,255,255,0.1)' }} />)}
          </div></div>;
        })()}
      </div>
    </>
  );
}

function CardFormFields({ form, setForm, prefix }: Readonly<{ form: any; setForm: (f: any) => void; prefix: string }>) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      <div style={{ gridColumn: '1 / -1' }}>
        <label htmlFor={`${prefix}-card-number`} style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: 6 }}>CARD NUMBER</label>
        <input id={`${prefix}-card-number`} className="input-field" placeholder="4111 1111 1111 1111" value={form.cardNumber} onChange={(e) => setForm({ ...form, cardNumber: e.target.value })} />
      </div>
      <div style={{ gridColumn: '1 / -1' }}>
        <label htmlFor={`${prefix}-card-holder`} style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: 6 }}>CARDHOLDER NAME</label>
        <input id={`${prefix}-card-holder`} className="input-field" placeholder="Jane Smith" value={form.cardHolder} onChange={(e) => setForm({ ...form, cardHolder: e.target.value })} />
      </div>
      <div>
        <label htmlFor={`${prefix}-expiry`} style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: 6 }}>EXPIRY</label>
        <input id={`${prefix}-expiry`} className="input-field" placeholder="MM/YY" value={form.expiry} onChange={(e) => setForm({ ...form, expiry: e.target.value })} />
      </div>
      <div>
        <label htmlFor={`${prefix}-cvv`} style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: 6 }}>CVV</label>
        <input id={`${prefix}-cvv`} className="input-field" placeholder="•••" type="password" value={form.cvv} onChange={(e) => setForm({ ...form, cvv: e.target.value })} />
      </div>
    </div>
  );
}

function IdentityFormFields({ form, setForm, prefix }: Readonly<{ form: any; setForm: (f: any) => void; prefix: string }>) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      <div>
        <label htmlFor={`${prefix}-first-name`} style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: 6 }}>FIRST NAME</label>
        <input id={`${prefix}-first-name`} className="input-field" placeholder="Jane" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
      </div>
      <div>
        <label htmlFor={`${prefix}-last-name`} style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: 6 }}>LAST NAME</label>
        <input id={`${prefix}-last-name`} className="input-field" placeholder="Smith" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
      </div>
      <div>
        <label htmlFor={`${prefix}-phone`} style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: 6 }}>PHONE</label>
        <input id={`${prefix}-phone`} className="input-field" placeholder="+1 555 000 0000" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
      </div>
      <div style={{ gridColumn: '1 / -1' }}>
        <label htmlFor={`${prefix}-address`} style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: 6 }}>ADDRESS</label>
        <input id={`${prefix}-address`} className="input-field" placeholder="123 Main St, City" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
      </div>
    </div>
  );
}
