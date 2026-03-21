'use client';
import { Archive, Key, Settings, Shield, Globe, CreditCard, StickyNote, User, Download, Lock, LogOut, Star } from 'lucide-react';
import { Category } from './types';
import { useSignOut } from './hooks/useSignOut';
import type { UserProfile, VaultItem } from '@/lib/types';

const NAV_ITEMS = [
  { id: 'all', label: 'All Items', icon: Shield },
  { id: 'login', label: 'Logins', icon: Globe },
  { id: 'card', label: 'Cards', icon: CreditCard },
  { id: 'note', label: 'Notes', icon: StickyNote },
  { id: 'identity', label: 'Identities', icon: User },
] as const;

const ELLIPSIS_STYLE = {
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
} as const;

interface DesktopSidebarProps {
  user: Pick<UserProfile, 'email'> | null;
  category: string;
  sidebarCounts: {
    all: number;
    login: number;
    card: number;
    note: number;
    identity: number;
    favourites: number;
    trash: number;
  };
  setCategory: (c: Category) => void;
  handleExport: () => void;
  lockVault: () => void;
  handleLogout: () => Promise<void>;
  onOpenSettings: () => void;
  onToggleFavourites: () => void;
  onToggleTrash: () => void;
  isFavouritesView: boolean;
  isTrashView: boolean;
}

export function DesktopSidebar({ user, category, sidebarCounts, setCategory, handleExport, lockVault, handleLogout, onOpenSettings, onToggleFavourites, onToggleTrash, isFavouritesView, isTrashView }: Readonly<DesktopSidebarProps>) {
  const { signingOut, handleSignout } = useSignOut(handleLogout);

  return (
    <aside className="desktop-sidebar" style={{
      flex: '0 1 18%',
      minWidth: 220,
      maxWidth: 300,
      borderRight: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column',
      padding: '20px 12px',
      background: 'var(--bg-card)', gap: 0,
    }}>
      {/* Logo */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '6px 8px 20px', borderBottom: '1px solid var(--border)', marginBottom: 12,
      }}>
        <div style={{
          width: 30, height: 30, borderRadius: 8, background: 'var(--accent)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0, boxShadow: 'var(--logo-shadow)',
        }}>
          <Key size={15} color="var(--accent-ink)" strokeWidth={2.5} />
        </div>
        <span className="font-display" style={{ fontSize: '1.35rem', color: 'var(--text-primary)', letterSpacing: '-0.01em', lineHeight: 1 }}>
          Cipheria
        </span>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {NAV_ITEMS.map(({ id, label, icon: Icon }) => {
          const count = sidebarCounts[id as keyof typeof sidebarCounts] ?? 0;
          return (
            <button key={id} onClick={() => setCategory(id as Category)}
              className={`nav-item${category === id && !isTrashView && !isFavouritesView ? ' active' : ''}`}>
              <Icon size={15} style={{ flexShrink: 0 }} />
              {label}
              <span className="count">{count}</span>
            </button>
          );
        })}
        <button onClick={onToggleFavourites} className={`nav-item${isFavouritesView ? ' active' : ''}`}>
          <Star size={15} style={{ flexShrink: 0 }} />
          Favourites
          <span className="count">{sidebarCounts.favourites}</span>
        </button>
        <button onClick={onToggleTrash} className={`nav-item${isTrashView ? ' active' : ''}`}>
          <Archive size={15} style={{ flexShrink: 0 }} />
          Trash
          <span className="count">{sidebarCounts.trash}</span>
        </button>
      </nav>

      {/* Footer */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 12 }}>
        <button onClick={handleExport} className="btn-ghost" style={{ width: '100%', fontSize: '0.8rem', justifyContent: 'center', padding: '8px 11px', minHeight: 38 }}>
          <Download size={13} /> Export Vault
        </button>
        <button onClick={onOpenSettings} className="btn-ghost" style={{ width: '100%', fontSize: '0.8rem', justifyContent: 'center', padding: '8px 11px', minHeight: 38 }}>
          <Settings size={13} /> Settings
        </button>
        <button onClick={lockVault} className="btn-ghost" style={{ width: '100%', fontSize: '0.8rem', justifyContent: 'center', padding: '8px 11px', minHeight: 38 }}>
          <Lock size={13} /> Lock Vault
        </button>
        <button onClick={handleSignout} disabled={signingOut}
          className="btn-ghost btn-danger"
          style={{ width: '100%', fontSize: '0.8rem', justifyContent: 'center', padding: '8px 11px', minHeight: 38 }}>
          <LogOut size={13} /> {signingOut ? 'Signing out…' : 'Sign Out'}
        </button>
        <p style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', textAlign: 'center', paddingTop: 10, ...ELLIPSIS_STYLE }}>
          {user?.email}
        </p>
      </div>
    </aside>
  );
}

/* Mobile top bar */
interface MobileTopBarProps {
  mobilePanel: 'list' | 'detail';
  selectedItem: VaultItem | null;
  onBack: () => void;
  lockVault: () => void;
  handleLogout: () => Promise<void>;
  onOpenSettings: () => void;
}

export function MobileTopBar({ mobilePanel, selectedItem, onBack, lockVault, handleLogout, onOpenSettings }: Readonly<MobileTopBarProps>) {
  const { signingOut, handleSignout } = useSignOut(handleLogout);
  const showBack = mobilePanel === 'detail' && selectedItem;

  return (
    <div className="mobile-topbar" style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 50,
      background: 'var(--surface-veil-strong)',
      backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
      borderBottom: '1px solid var(--border)',
      padding: '11px 14px', alignItems: 'center', justifyContent: 'space-between',
    }}>
      {/* Left: back or logo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {showBack ? (
          <button onClick={onBack} style={{
            background: 'none', border: 'none', color: 'var(--accent)',
            cursor: 'pointer', fontSize: '0.875rem', padding: '4px 0',
            display: 'flex', alignItems: 'center', gap: 4,
            fontFamily: 'var(--font-body)',
          }}>
            ← Back
          </button>
        ) : (
          <>
            <div style={{
              width: 26, height: 26, borderRadius: 7, background: 'var(--accent)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Key size={13} color="var(--accent-ink)" strokeWidth={2.5} />
            </div>
            <span className="font-display" style={{ fontSize: '1.2rem', color: 'var(--text-primary)' }}>
              Cipheria
            </span>
          </>
        )}
      </div>

      {/* Right: actions */}
      <div style={{ display: 'flex', gap: 4 }}>
        <button onClick={onOpenSettings} className="btn-icon" title="Settings" style={{ width: 38, height: 38 }}>
          <Settings size={17} />
        </button>
        <button onClick={lockVault} className="btn-icon" title="Lock Vault" style={{ width: 38, height: 38 }}>
          <Lock size={17} />
        </button>
        <button onClick={handleSignout} disabled={signingOut} className="btn-icon" title="Sign Out"
          style={{ width: 38, height: 38, color: signingOut ? 'var(--text-tertiary)' : 'var(--danger)', opacity: signingOut ? 0.5 : 1 }}>
          <LogOut size={17} />
        </button>
      </div>
    </div>
  );
}
