'use client';
import { useState, useCallback, useMemo } from 'react';
import Image from 'next/image';
import { RotateCcw, Search, Plus, Shield, Globe, CreditCard, StickyNote, User, Trash2, Download, Star, Edit2, ChevronRight } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { checkHIBP } from '@/lib/crypto';
import { CATEGORY_ICONS } from './types';
import { DesktopSidebar, MobileTopBar } from './Sidebar';
import { Pagination } from './Pagination';
import { Field, HibpCheck } from './Field';
import { AddItemModal, EditItemModal } from './ItemModal';
import type { DecryptedPayload, SidebarCounts, UserProfile, VaultItem } from '@/lib/types';
import type { Category, ItemForm } from './types';

const CATEGORIES = [
    { id: 'all', label: 'All', icon: Shield },
    { id: 'login', label: 'Logins', icon: Globe },
    { id: 'card', label: 'Cards', icon: CreditCard },
    { id: 'note', label: 'Notes', icon: StickyNote },
    { id: 'identity', label: 'Identities', icon: User },
] as const;

const ELLIPSIS_STYLE = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as const;
const passthroughImageLoader = ({ src }: { src: string }) => src;
type HibpState = { checking: boolean; count: number | null };
type MaybePromiseVoid = void | Promise<void>;
type PasswordGeneratorOptions = {
    length: number;
    uppercase: boolean;
    lowercase: boolean;
    numbers: boolean;
    symbols: boolean;
};

function SearchSkeleton({ iconSize = 36 }: Readonly<{ iconSize?: number }>) {
    return (
        <>
            {[0, 1, 2, 3, 4].map(i => (
                <div key={i} className="search-skeleton-item" style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: 12, borderRadius: 10, marginBottom: 2,
                    animationDelay: `${i * 0.08}s`,
                }}>
                    <div style={{ width: iconSize, height: iconSize, borderRadius: 8, background: 'var(--skeleton-2)', flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                        <div style={{ height: 13, width: '55%', borderRadius: 6, background: 'var(--skeleton-2)', marginBottom: 7 }} />
                        <div style={{ height: 11, width: '38%', borderRadius: 6, background: 'var(--skeleton-1)' }} />
                    </div>
                </div>
            ))}
        </>
    );
}

function FaviconImage({ src, size }: Readonly<{ src: string; size: number }>) {
    const [failed, setFailed] = useState(false);
    const handleError = useCallback(() => setFailed(true), []);

    if (failed) return null;

    return (
        <Image
            src={src}
            alt=""
            width={size}
            height={size}
            unoptimized
            loader={passthroughImageLoader}
            onError={handleError}
        />
    );
}

function ItemIcon({ item, size }: Readonly<{ item: VaultItem; size: number }>) {
    const Icon = CATEGORY_ICONS[item.category] || Globe;
    const px = Math.round(size * 0.55);
    return (
        <div style={{
            width: size, height: size, borderRadius: size > 38 ? 10 : 8, flexShrink: 0,
            background: 'var(--skeleton-1)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
        }}>
            {item.favicon_url
                ? <FaviconImage src={item.favicon_url} size={px} />
                : <Icon size={px} color="var(--text-secondary)" />}
        </div>
    );
}

function ItemButton({ item, isSelected, isMobile, iconSize, fontSize, padding, onSelect }: Readonly<{
    item: VaultItem; isSelected: boolean; isMobile: boolean;
    iconSize: number; fontSize: string; padding: string;
    onSelect: (item: VaultItem) => void;
}>) {
    const handleClick = useCallback(() => onSelect(item), [onSelect, item]);
    return (
        <button onClick={handleClick} style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: 12,
            borderRadius: 10, border: 'none', cursor: 'pointer', marginBottom: 2,
            background: isSelected ? 'var(--accent-dim)' : 'transparent',
            borderLeft: isSelected ? '2px solid var(--accent)' : '2px solid transparent',
            transition: 'all 0.15s', padding,
        }}>
            <ItemIcon item={item} size={iconSize} />
            <div style={{ flex: 1, textAlign: 'left', minWidth: 0 }}>
                <p style={{ fontSize, color: 'var(--text-primary)', fontWeight: 500, ...ELLIPSIS_STYLE }}>
                    {item.name}
                </p>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', ...ELLIPSIS_STYLE }}>
                    {item.decrypted?.username || item.decrypted?.url || item.category}
                </p>
            </div>
            {item.is_favourite && (
                <Star size={isMobile ? 14 : 12} color="var(--accent)" fill="var(--accent)" />
            )}
            {isMobile && (
                <ChevronRight size={16} color="var(--text-secondary)" style={{ opacity: 0.4 }} />
            )}
        </button>
    );
}

function ItemList({ items, loading, selectedId, onSelect, variant }: Readonly<{
    items: VaultItem[];
    loading: boolean;
    selectedId?: string;
    onSelect: (item: VaultItem) => void;
    variant: 'mobile' | 'desktop';
}>) {
    const isMobile = variant === 'mobile';
    const iconSize = isMobile ? 40 : 36;
    const padding = isMobile ? '14px 12px' : '12px';
    const fontSize = isMobile ? '0.9rem' : '0.875rem';

    if (loading) return <SearchSkeleton iconSize={iconSize} />;
    if (!items.length) return (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-secondary)' }}>
            <Shield size={32} style={{ opacity: 0.3, margin: '0 auto 12px' }} />
            <p style={{ fontSize: '0.875rem' }}>No items found</p>
        </div>
    );

    return (
        <>
            {items.map(item => (
                <ItemButton
                    key={item.id}
                    item={item}
                    isSelected={!isMobile && selectedId === item.id}
                    isMobile={isMobile}
                    iconSize={iconSize}
                    fontSize={fontSize}
                    padding={padding}
                    onSelect={onSelect}
                />
            ))}
        </>
    );
}

function FieldRows({ d, copy, hibp, onCheckHibp }: Readonly<{
    d: DecryptedPayload;
    copy: (val: string, label: string) => () => void;
    hibp: HibpState;
    onCheckHibp: () => void;
}>) {
    return (
        <>
            {d?.url && <Field label="URL" value={d.url} onCopy={copy(d.url, 'URL')} />}
            {d?.username && <Field label="Username / Email" value={d.username} onCopy={copy(d.username, 'Username')} />}
            {d?.password && <>
                <Field label="Password" value={d.password} secret onCopy={copy(d.password, 'Password')} />
                <HibpCheck hibp={hibp} onCheck={onCheckHibp} />
            </>}
            {d?.cardNumber && <Field label="Card Number" value={d.cardNumber} secret onCopy={copy(d.cardNumber, 'Card number')} />}
            {d?.cardHolder && <Field label="Cardholder Name" value={d.cardHolder} onCopy={copy(d.cardHolder, 'Cardholder')} />}
            {d?.expiry && <Field label="Expiry" value={d.expiry} onCopy={copy(d.expiry, 'Expiry')} />}
            {d?.cvv && <Field label="CVV" value={d.cvv} secret onCopy={copy(d.cvv, 'CVV')} />}
            {d?.firstName && <Field label="First Name" value={d.firstName} onCopy={copy(d.firstName, 'First name')} />}
            {d?.lastName && <Field label="Last Name" value={d.lastName} onCopy={copy(d.lastName, 'Last name')} />}
            {d?.phone && <Field label="Phone" value={d.phone} onCopy={copy(d.phone, 'Phone')} />}
            {d?.address && <Field label="Address" value={d.address} multiline />}
            {d?.notes && <Field label="Notes" value={d.notes} multiline />}
        </>
    );
}

function ItemDetailFields({ selectedItem, copyToClipboard, hibp, setHibp }: Readonly<{
    selectedItem: VaultItem;
    copyToClipboard: (text: string, label: string) => void | Promise<void>;
    hibp: HibpState;
    setHibp: (v: HibpState) => void;
}>) {
    const d = selectedItem.decrypted ?? {};
    const password = typeof d.password === 'string' ? d.password : '';
    const copy = useMemo(
        () => (val: string, label: string) => () => copyToClipboard(val, label),
        [copyToClipboard],
    );
    const handleCheckHibp = useCallback(async () => {
        if (!password) return;
        setHibp({ checking: true, count: null });
        try { setHibp({ checking: false, count: await checkHIBP(password) }); }
        catch { setHibp({ checking: false, count: -1 }); }
    }, [password, setHibp]);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <FieldRows d={d} copy={copy} hibp={hibp} onCheckHibp={handleCheckHibp} />
        </div>
    );
}

function ItemDetailActions({ item, btnPad, iconPx, deletingId, onFav, onEdit, onDelete, onRestore, onDeletePermanent }: Readonly<{
    item: VaultItem; btnPad: string; iconPx: number; deletingId: string | null;
    onFav: () => void; onEdit: () => void; onDelete: () => void;
    onRestore: () => void; onDeletePermanent: () => void;
}>) {
    const dangerStyle = { padding: btnPad, color: 'var(--danger)', borderColor: 'var(--danger-border-soft)', opacity: deletingId === item.id ? 0.5 : 1 };
    return (
        <div style={{ display: 'flex', gap: btnPad === '8px 10px' ? 4 : 8 }}>
            {item.is_deleted ? (
                <button onClick={onRestore} className="btn-ghost" style={{ padding: btnPad }}>
                    <RotateCcw size={iconPx} />
                </button>
            ) : (
                <>
                    <button onClick={onFav} className="btn-ghost" style={{ padding: btnPad }}>
                        <Star size={iconPx}
                            color={item.is_favourite ? 'var(--accent)' : 'var(--text-secondary)'}
                            fill={item.is_favourite ? 'var(--accent)' : 'none'} />
                    </button>
                    <button onClick={onEdit} className="btn-ghost" style={{ padding: btnPad }}>
                        <Edit2 size={iconPx} />
                    </button>
                </>
            )}
            {!item.is_deleted && (
                <button onClick={onDelete} className="btn-ghost" disabled={deletingId === item.id} style={dangerStyle}>
                    <Trash2 size={iconPx} />
                </button>
            )}
            {item.is_deleted && (
                <button onClick={onDeletePermanent} className="btn-ghost" disabled={deletingId === item.id} style={dangerStyle}>
                    <Trash2 size={iconPx} />
                </button>
            )}
        </div>
    );
}

function ItemDetailHeader({ item, isMobile, handleToggleFav, handleOpenEdit, handleDelete, handleRestoreItem, handleDeletePermanent, deletingId }: Readonly<{
    item: VaultItem;
    isMobile?: boolean;
    handleToggleFav: (item: VaultItem) => MaybePromiseVoid;
    handleOpenEdit: (item: VaultItem) => void;
    handleDelete: (id: string, cb?: () => void) => MaybePromiseVoid;
    handleRestoreItem?: (id: string) => MaybePromiseVoid;
    handleDeletePermanent?: (id: string) => MaybePromiseVoid;
    deletingId: string | null;
}>) {
    const Icon = CATEGORY_ICONS[item.category] || Globe;
    const iconSize = isMobile ? 48 : 52;
    const btnPad = isMobile ? '8px 10px' : '8px 12px';
    const iconPx = isMobile ? 15 : 16;
    const onFav = useCallback(() => {
        void handleToggleFav(item);
    }, [handleToggleFav, item]);
    const onEdit = useCallback(() => handleOpenEdit(item), [handleOpenEdit, item]);
    const onDelete = useCallback(() => {
        void handleDelete(item.id);
    }, [handleDelete, item.id]);
    const onRestore = useCallback(() => {
        void handleRestoreItem?.(item.id);
    }, [handleRestoreItem, item.id]);
    const onDeletePermanent = useCallback(() => {
        void handleDeletePermanent?.(item.id);
    }, [handleDeletePermanent, item.id]);

    return (
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: isMobile ? 24 : 32 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 12 : 16 }}>
                <div style={{
                    width: iconSize, height: iconSize, borderRadius: isMobile ? 10 : 12,
                    background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>
                    {item.favicon_url
                        ? <FaviconImage src={item.favicon_url} size={iconSize - 22} />
                        : <Icon size={iconSize - 26} color="var(--accent)" />}
                </div>
                <div>
                    <h2 className="font-display" style={{ fontSize: isMobile ? 'clamp(1.25rem, 5vw, 1.75rem)' : '1.75rem', color: 'var(--text-primary)' }}>
                        {item.name}
                    </h2>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', textTransform: 'capitalize' }}>
                        {item.category}
                    </span>
                </div>
            </div>

            <ItemDetailActions
                item={item} btnPad={btnPad} iconPx={iconPx} deletingId={deletingId}
                onFav={onFav} onEdit={onEdit} onDelete={onDelete}
                onRestore={onRestore} onDeletePermanent={onDeletePermanent}
            />
        </div>
    );
}

interface ItemDetailPanelProps {
    selectedItem: VaultItem | null;
    selectedItemLoading: boolean;
    isMobile?: boolean;
    handleToggleFav: (item: VaultItem) => MaybePromiseVoid;
    handleOpenEdit: (item: VaultItem) => void;
    handleDelete: (id: string, cb?: () => void) => MaybePromiseVoid;
    handleRestoreItem?: (id: string) => MaybePromiseVoid;
    handleDeletePermanent?: (id: string) => MaybePromiseVoid;
    deletingId: string | null;
    copyToClipboard: (text: string, label: string) => MaybePromiseVoid;
    hibp: HibpState;
    setHibp: (v: HibpState) => void;
    onDeleteSuccess?: () => void;
}

function ItemDetailPanel({ selectedItem, selectedItemLoading, isMobile, handleToggleFav, handleOpenEdit, handleDelete, handleRestoreItem, handleDeletePermanent, deletingId, copyToClipboard, hibp, setHibp }: Readonly<ItemDetailPanelProps>) {

    if (!selectedItem) return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column', gap: 12, opacity: 0.4 }}>
            <Shield size={48} color="var(--text-secondary)" />
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Select an item to view details</p>
        </div>
    );

    if (selectedItemLoading) return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: isMobile ? 200 : '100%', flexDirection: 'column', gap: 12, opacity: 0.5 }}>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Decrypting…</p>
        </div>
    );

    return (
        <div className="animate-fade-up" style={isMobile ? undefined : { width: '100%', maxWidth: 720 }}>
            <ItemDetailHeader
                item={selectedItem} isMobile={isMobile}
                handleToggleFav={handleToggleFav} handleOpenEdit={handleOpenEdit}
                handleDelete={handleDelete} handleRestoreItem={handleRestoreItem}
                handleDeletePermanent={handleDeletePermanent} deletingId={deletingId}
            />
            <ItemDetailFields
                selectedItem={selectedItem} copyToClipboard={copyToClipboard}
                hibp={hibp} setHibp={setHibp}
            />
            <p style={{ marginTop: isMobile ? 20 : 24, fontSize: '0.72rem', color: 'var(--text-secondary)', opacity: 0.6 }}>
                Last updated {new Date(selectedItem.updated_at).toLocaleDateString()}
            </p>
        </div>
    );
}

function CategoryPill({ label, icon: Icon, isActive, onSelect }: Readonly<{
    label: string; icon: LucideIcon;
    isActive: boolean; onSelect: () => void;
}>) {
    const handleClick = useCallback(() => onSelect(), [onSelect]);
    return (
        <button onClick={handleClick} style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px',
            borderRadius: 20, border: '1px solid',
            borderColor: isActive ? 'var(--accent)' : 'var(--border)',
            background: isActive ? 'var(--accent-dim)' : 'transparent',
            color: isActive ? 'var(--accent)' : 'var(--text-secondary)',
            fontSize: '0.8rem', fontFamily: 'Outfit, sans-serif',
            cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
        }}>
            <Icon size={13} /> {label}
        </button>
    );
}

interface MainDashboardProps {
    user: UserProfile | null;
    category: Category;
    setCategory: (category: Category) => MaybePromiseVoid;
    searchValue: string;
    onSearchChange: (value: string) => void;
    handleExport: () => MaybePromiseVoid;
    onOpenSettings: () => void;
    onToggleFavourites: () => MaybePromiseVoid;
    onToggleTrash: () => MaybePromiseVoid;
    isFavouritesView: boolean;
    isTrashView: boolean;
    lockVault: () => void;
    handleLogout: () => Promise<void>;
    vaultItems: VaultItem[];
    sidebarCounts: SidebarCounts;
    selectedItem: VaultItem | null;
    handleSelectItem: (item: VaultItem) => MaybePromiseVoid;
    selectedItemLoading: boolean;
    handleToggleFav: (item: VaultItem) => MaybePromiseVoid;
    handleOpenEdit: (item: VaultItem) => void;
    handleDelete: (id: string, cb?: () => void) => MaybePromiseVoid;
    handleRestoreItem: (id: string) => MaybePromiseVoid;
    handleDeletePermanent: (id: string) => MaybePromiseVoid;
    deletingId: string | null;
    copyToClipboard: (text: string, label: string) => MaybePromiseVoid;
    hibp: HibpState;
    setHibp: (value: HibpState) => void;
    showAddModal: boolean;
    setShowAddModal: (value: boolean) => void;
    newItem: ItemForm;
    setNewItem: (form: ItemForm) => void;
    savingItem: boolean;
    genOptions: PasswordGeneratorOptions;
    handleAddItem: (e: React.SyntheticEvent) => MaybePromiseVoid;
    showEditModal: boolean;
    setShowEditModal: (value: boolean) => void;
    editForm: ItemForm | null;
    setEditForm: (form: ItemForm | null) => void;
    updatingItem: boolean;
    handleEditItem: (e: React.SyntheticEvent) => MaybePromiseVoid;
    filteredItems: VaultItem[];
    page: number;
    totalPages: number;
    onPageChange: (page: number) => MaybePromiseVoid;
    isSearchActive: boolean;
    searchLoading: boolean;
}

export function MainDashboard(props: Readonly<MainDashboardProps>) {
    const {
        user, category, searchValue, onSearchChange, handleExport, lockVault, handleLogout,
        onOpenSettings, onToggleFavourites, onToggleTrash, isFavouritesView, isTrashView,
        sidebarCounts, setShowAddModal, setCategory, selectedItem, handleSelectItem, selectedItemLoading,
        handleToggleFav, handleOpenEdit, handleDelete, handleRestoreItem, handleDeletePermanent, deletingId, copyToClipboard,
        hibp, setHibp, showAddModal, newItem, setNewItem, savingItem, genOptions, handleAddItem,
        showEditModal, setShowEditModal, editForm, setEditForm, updatingItem, handleEditItem,
        filteredItems, page, totalPages, onPageChange, isSearchActive, searchLoading,
    } = props;

    const [mobilePanel, setMobilePanel] = useState<'list' | 'detail'>('list');
    const categoryPills = useMemo(
        () => CATEGORIES.map(categoryOption => ({
            ...categoryOption,
            onSelect: () => {
                void setCategory(categoryOption.id);
            },
        })),
        [setCategory],
    );

    const handleSelectItemMobile = useCallback((item: VaultItem) => {
        void handleSelectItem(item);
        setMobilePanel('detail');
    }, [handleSelectItem]);

    const handleMobileBack = useCallback(() => setMobilePanel('list'), []);
    const handleAddClose = useCallback(() => setShowAddModal(false), [setShowAddModal]);
    const handleEditClose = useCallback(() => { setShowEditModal(false); setEditForm(null); }, [setShowEditModal, setEditForm]);
    const handleOpenAddModal = useCallback(() => setShowAddModal(true), [setShowAddModal]);
    const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => onSearchChange(e.target.value), [onSearchChange]);
    const handleFavouritesPill = useCallback(() => {
        void onToggleFavourites();
    }, [onToggleFavourites]);
    const handleTrashPill = useCallback(() => {
        void onToggleTrash();
    }, [onToggleTrash]);

    const detailPanelProps: Omit<ItemDetailPanelProps, 'isMobile' | 'handleDelete' | 'onDeleteSuccess'> = {
        selectedItem, selectedItemLoading,
        handleToggleFav, handleOpenEdit, handleRestoreItem, handleDeletePermanent, deletingId, copyToClipboard, hibp, setHibp,
    };

    return (
        <div style={{ display: 'flex', height: '100dvh', background: 'var(--bg)', overflow: 'hidden' }}>
            <MobileTopBar
                mobilePanel={mobilePanel} selectedItem={selectedItem}
                onBack={handleMobileBack} lockVault={lockVault} handleLogout={handleLogout}
                onOpenSettings={onOpenSettings}
            />

            <style>{`
                @media (max-width: 768px) {
                    .desktop-sidebar, .desktop-list-col, .desktop-detail-col { display: none !important; }
                    .mobile-topbar { display: flex !important; }
                }
                @media (min-width: 769px) {
                    .mobile-topbar, .mobile-list-panel, .mobile-detail-panel { display: none !important; }
                    .desktop-sidebar { display: flex !important; }
                    .desktop-list-col, .desktop-detail-col { display: block !important; }
                }
                @keyframes shimmer {
                    0%, 100% { opacity: 0.45; }
                    50%      { opacity: 0.85; }
                }
                .search-skeleton-item { animation: shimmer 1.3s ease-in-out infinite; }
            `}</style>

            {/* Mobile: list panel */}
            <div className="mobile-list-panel" style={{
                display: mobilePanel === 'list' ? 'flex' : 'none',
                position: 'fixed', inset: 0, zIndex: 10,
                flexDirection: 'column', background: 'var(--bg)', paddingTop: 57,
            }}>
                {/* Category pills */}
                <div style={{ overflowX: 'auto', display: 'flex', gap: 8, padding: '12px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
                    {categoryPills.map(({ id, label, icon, onSelect }) => (
                        <CategoryPill key={id} label={label} icon={icon}
                            isActive={!isTrashView && !isFavouritesView && category === id} onSelect={onSelect} />
                    ))}
                    <CategoryPill label="Favourites" icon={Star}
                        isActive={isFavouritesView} onSelect={handleFavouritesPill} />
                    <CategoryPill label="Trash" icon={Trash2}
                        isActive={isTrashView} onSelect={handleTrashPill} />
                </div>

                <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, flexShrink: 0 }}>
                    <div style={{ position: 'relative', flex: 1 }}>
                        <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
                        <input className="input-field" placeholder="Search vault..." value={searchValue}
                            onChange={handleSearchChange} style={{ paddingLeft: 36, fontSize: 'max(16px, 0.9rem)' }} />
                    </div>
                    {!isTrashView && <button className="btn-primary" onClick={handleOpenAddModal}
                        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 16px', flexShrink: 0 }}>
                        <Plus size={16} />
                    </button>}
                </div>

                <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
                    <ItemList variant="mobile" items={filteredItems} loading={searchLoading} onSelect={handleSelectItemMobile} />
                </div>

                {!isSearchActive && <Pagination page={page} totalPages={totalPages} onPageChange={onPageChange} />}

                <div style={{ borderTop: '1px solid var(--border)', padding: '12px 16px', display: 'flex', gap: 8, paddingBottom: 'calc(12px + env(safe-area-inset-bottom, 0px))' }}>
                    <button onClick={handleExport} className="btn-ghost" style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center', fontSize: '0.8rem' }}>
                        <Download size={14} /> Export
                    </button>
                    <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', padding: '0 8px', opacity: 0.6, flex: 1, justifyContent: 'center', ...ELLIPSIS_STYLE }}>
                        {user?.email}
                    </p>
                </div>
            </div>

            {/* Mobile: detail panel */}
            <div className="mobile-detail-panel" style={{
                display: mobilePanel === 'detail' ? 'flex' : 'none',
                position: 'fixed', inset: 0, zIndex: 10,
                flexDirection: 'column', background: 'var(--bg)', paddingTop: 57, overflowY: 'auto',
            }}>
                <div style={{ padding: '24px 16px', flex: 1 }}>
                    <ItemDetailPanel {...detailPanelProps} isMobile handleDelete={handleDelete} onDeleteSuccess={handleMobileBack} />
                </div>
            </div>

            {/* Desktop layout */}
            <DesktopSidebar
                user={user} category={category} sidebarCounts={sidebarCounts}
                setCategory={setCategory} handleExport={handleExport}
                lockVault={lockVault} handleLogout={handleLogout}
                onOpenSettings={onOpenSettings} onToggleFavourites={onToggleFavourites}
                onToggleTrash={onToggleTrash} isFavouritesView={isFavouritesView} isTrashView={isTrashView}
            />

            <div className="desktop-list-col" style={{
                flex: '0 1 24%',
                minWidth: 280,
                maxWidth: 420,
                borderRight: '1px solid var(--border)',
                display: 'flex',
                flexDirection: 'column',
            }}>
                <div style={{ padding: '20px 16px', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ position: 'relative', marginBottom: 12 }}>
                        <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
                        <input className="input-field" placeholder="Search vault..." value={searchValue}
                            onChange={handleSearchChange} style={{ paddingLeft: 36 }} />
                    </div>
                    {!isTrashView && <button className="btn-primary" onClick={handleOpenAddModal}
                        style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                        <Plus size={16} /> Add Item
                    </button>}
                </div>
                <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
                    <ItemList variant="desktop" items={filteredItems} loading={searchLoading}
                        selectedId={selectedItem?.id} onSelect={handleSelectItem} />
                </div>
                {!isSearchActive && <Pagination page={page} totalPages={totalPages} onPageChange={onPageChange} />}
            </div>

            <div className="desktop-detail-col" style={{ flex: '1 1 0', minWidth: 0, overflowY: 'auto', padding: 32 }}>
                <ItemDetailPanel {...detailPanelProps} handleDelete={handleDelete} />
            </div>

            {showAddModal && (
                <AddItemModal newItem={newItem} setNewItem={setNewItem} savingItem={savingItem}
                    genOptions={genOptions} onSubmit={handleAddItem} onClose={handleAddClose} />
            )}
            {showEditModal && editForm && (
                <EditItemModal editForm={editForm} setEditForm={setEditForm} updatingItem={updatingItem}
                    genOptions={genOptions} onSubmit={handleEditItem} onClose={handleEditClose} />
            )}
        </div>
    );
}
