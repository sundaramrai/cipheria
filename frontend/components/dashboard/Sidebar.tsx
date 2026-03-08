'use client';
import { useState } from 'react';
import { Key, Shield, Globe, CreditCard, StickyNote, User, Download, Lock, LogOut } from 'lucide-react';
import { VaultItem } from '@/lib/store';
import { Category } from './types';

const NAV_ITEMS = [
  { id: 'all', label: 'All Items', icon: Shield },
  { id: 'login', label: 'Logins', icon: Globe },
  { id: 'card', label: 'Cards', icon: CreditCard },
  { id: 'note', label: 'Notes', icon: StickyNote },
  { id: 'identity', label: 'Identities', icon: User },
] as const;

interface DesktopSidebarProps {
  user: any;
  category: string;
  vaultItems: VaultItem[];
  setCategory: (c: Category) => void;
  handleExport: () => void;
  lockVault: () => void;
  handleLogout: () => Promise<void>;
}

export function DesktopSidebar({ user, category, vaultItems, setCategory, handleExport, lockVault, handleLogout }: Readonly<DesktopSidebarProps>) {
  const [signingOut, setSigningOut] = useState(false);

  const handleSignout = async () => {
    setSigningOut(true);
    try { await handleLogout(); } finally { setSigningOut(false); }
  };

  return (
    <aside
      className="desktop-sidebar"
      style={{
        width: 232,
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        padding: '20px 12px',
        flexShrink: 0,
        background: 'var(--bg-card)',
        gap: 0,
      }}
    >
      {/* Logo */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '6px 8px 20px',
          borderBottom: '1px solid var(--border)',
          marginBottom: 12,
        }}
      >
        <div
          style={{
            width: 30,
            height: 30,
            borderRadius: 8,
            background: 'var(--accent)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            boxShadow: '0 2px 8px rgba(245,158,11,0.3)',
          }}
        >
          <Key size={15} color="#060504" strokeWidth={2.5} />
        </div>
        <span
          className="font-display"
          style={{ fontSize: '1.35rem', color: 'var(--text-primary)', letterSpacing: '-0.01em', lineHeight: 1 }}
        >
          Cipheria
        </span>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {NAV_ITEMS.map(({ id, label, icon: Icon }) => {
          const count = id === 'all'
            ? vaultItems.length
            : vaultItems.filter((i: VaultItem) => i.category === id).length;
          return (
            <button
              key={id}
              onClick={() => setCategory(id as Category)}
              className={`nav-item${category === id ? ' active' : ''}`}
            >
              <Icon size={15} style={{ flexShrink: 0 }} />
              {label}
              <span className="count">{count}</span>
            </button>
          );
        })}
      </nav>

      {/* Footer actions */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 12, }}>
        <button onClick={handleExport} className="btn-ghost" style={{ width: '100%', fontSize: '0.8rem', justifyContent: 'center', padding: '8px 11px', minHeight: 38 }}>
          <Download size={13} /> Export Vault
        </button>
        <button onClick={lockVault} className="btn-ghost" style={{ width: '100%', fontSize: '0.8rem', justifyContent: 'center', padding: '8px 11px', minHeight: 38 }}>
          <Lock size={13} /> Lock Vault
        </button>
        <button
          onClick={handleSignout}
          disabled={signingOut}
          className="btn-ghost btn-danger"
          style={{ width: '100%', fontSize: '0.8rem', justifyContent: 'center', padding: '8px 11px', minHeight: 38 }}
        >
          <LogOut size={13} /> {signingOut ? 'Signing out…' : 'Sign Out'}
        </button>

        {/* User email */}
        <p style={{
          fontSize: '0.7rem', color: 'var(--text-tertiary)', textAlign: 'center', paddingTop: 10,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        >
          {user?.email}
        </p>
      </div>
    </aside>
  );
}

/* Mobile top bar */
interface MobileTopBarProps {
  mobilePanel: 'list' | 'detail';
  selectedItem: any;
  onBack: () => void;
  lockVault: () => void;
  handleLogout: () => Promise<void>;
}

export function MobileTopBar({ mobilePanel, selectedItem, onBack, lockVault, handleLogout }: Readonly<MobileTopBarProps>) {
  const [signingOut, setSigningOut] = useState(false);

  const handleSignout = async () => {
    setSigningOut(true);
    try { await handleLogout(); } finally { setSigningOut(false); }
  };

  return (
    <div
      className="mobile-topbar"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 50,
        background: 'rgba(8,7,6,0.96)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        borderBottom: '1px solid var(--border)',
        padding: '11px 14px',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}
    >
      {/* Left: back or logo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {mobilePanel === 'detail' && selectedItem ? (
          <button
            onClick={onBack}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--accent)',
              cursor: 'pointer',
              fontSize: '0.875rem',
              padding: '4px 0',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontFamily: 'var(--font-body)',
            }}
          >
            ← Back
          </button>
        ) : (
          <>
            <div
              style={{
                width: 26,
                height: 26,
                borderRadius: 7,
                background: 'var(--accent)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Key size={13} color="#060504" strokeWidth={2.5} />
            </div>
            <span
              className="font-display"
              style={{ fontSize: '1.2rem', color: 'var(--text-primary)' }}
            >
              Cipheria
            </span>
          </>
        )}
      </div>

      {/* Right: actions */}
      <div style={{ display: 'flex', gap: 4 }}>
        <button
          onClick={lockVault}
          className="btn-icon"
          title="Lock Vault"
          style={{ width: 38, height: 38 }}
        >
          <Lock size={17} />
        </button>
        <button
          onClick={handleSignout}
          disabled={signingOut}
          className="btn-icon"
          title="Sign Out"
          style={{ width: 38, height: 38, color: signingOut ? 'var(--text-tertiary)' : 'var(--danger)', opacity: signingOut ? 0.5 : 1 }}
        >
          <LogOut size={17} />
        </button>
      </div>
    </div>
  );
}