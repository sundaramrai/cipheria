'use client';
import { Archive, ArrowLeft, Key, Settings, Shield, Download, Lock, LogOut, Star } from 'lucide-react';
import { ITEM_CATEGORIES } from './types';
import type { Category } from './types';
import { useSignOut } from './hooks/useSignOut';
import type { SidebarCounts, UserProfile, VaultItem } from '@/lib/types';

const NAV_ITEMS = [
  { id: 'all', label: 'All Items', icon: Shield },
  ...ITEM_CATEGORIES,
] as const;

interface DesktopSidebarProps {
  user: Pick<UserProfile, 'email'> | null;
  category: Category;
  sidebarCounts: SidebarCounts;
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
    <aside className="hidden w-57.5 shrink-0 flex-col border-r border-(--border) bg-(--bg-card) px-3 py-5 lg:flex xl:w-65 2xl:w-75">
      {/* Logo */}
      <div className="mb-3 flex items-center gap-2.5 border-b border-(--border) px-2 pt-1.5 pb-5">
        <div className="flex size-7.5 shrink-0 items-center justify-center rounded-lg bg-(--accent) shadow-(--logo-shadow)">
          <Key size={15} color="var(--accent-ink)" strokeWidth={2.5} />
        </div>
        <span className="font-display text-[1.35rem] leading-none tracking-tight text-(--text-primary)">
          Cipheria
        </span>
      </div>

      {/* Nav */}
      <nav className="flex flex-1 flex-col gap-0.5">
        {NAV_ITEMS.map(({ id, label, icon: Icon }) => {
          const count = sidebarCounts[id];
          return (
            <button key={id} type="button" onClick={() => setCategory(id)}
              className={`nav-item${category === id && !isTrashView && !isFavouritesView ? ' active' : ''}`}>
              <Icon size={15} className="shrink-0" />
              {label}
              <span className="count">{count}</span>
            </button>
          );
        })}
        <button type="button" onClick={onToggleFavourites} className={`nav-item${isFavouritesView ? ' active' : ''}`}>
          <Star size={15} className="shrink-0" />
          Favourites
          <span className="count">{sidebarCounts.favourites}</span>
        </button>
        <button type="button" data-trash-navigation="" onClick={onToggleTrash} className={`nav-item${isTrashView ? ' active' : ''}`}>
          <Archive size={15} className="shrink-0" />
          Trash
          <span className="count">{sidebarCounts.trash}</span>
        </button>
      </nav>

      {/* Footer */}
      <div className="mt-3 flex flex-col gap-1 border-t border-(--border) pt-3">
        <button type="button" onClick={handleExport} className="nav-item">
          <Download size={13} /> Export Vault
        </button>
        <button type="button" onClick={onOpenSettings} className="nav-item">
          <Settings size={13} /> Settings
        </button>
        <button type="button" onClick={lockVault} className="nav-item">
          <Lock size={13} /> Lock Vault
        </button>
        <button type="button" onClick={handleSignout} disabled={signingOut}
          className="nav-item text-(--danger)! disabled:opacity-50">
          <LogOut size={13} /> {signingOut ? 'Signing out…' : 'Sign Out'}
        </button>
        <p className="truncate px-3 pt-2 text-xs text-(--text-secondary)">
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
    <div className="fixed inset-x-0 top-0 z-50 flex items-center justify-between border-b border-(--border) bg-(--surface-veil-strong) px-3.5 py-2.75 backdrop-blur-md lg:hidden">
      {/* Left: back or logo */}
      <div className="flex items-center gap-2">
        {showBack ? (
          <button type="button" onClick={onBack} className="flex cursor-pointer items-center gap-1 py-1 text-sm text-(--accent)">
            <ArrowLeft size={17} aria-hidden="true" /> Back
          </button>
        ) : (
          <>
            <div className="flex size-6.5 items-center justify-center rounded-md bg-(--accent)">
              <Key size={13} color="var(--accent-ink)" strokeWidth={2.5} />
            </div>
            <span className="font-display text-xl text-(--text-primary)">
              Cipheria
            </span>
          </>
        )}
      </div>

      {/* Right: actions */}
      <div className="flex gap-1">
        <button type="button" onClick={onOpenSettings} className="btn-icon size-9!" title="Settings" aria-label="Settings">
          <Settings size={17} />
        </button>
        <button type="button" onClick={lockVault} className="btn-icon size-9!" title="Lock Vault" aria-label="Lock Vault">
          <Lock size={17} />
        </button>
        <button type="button" onClick={handleSignout} disabled={signingOut} className="btn-icon size-9! text-(--danger)! disabled:opacity-50" title="Sign Out" aria-label="Sign Out">
          <LogOut size={17} />
        </button>
      </div>
    </div>
  );
}
