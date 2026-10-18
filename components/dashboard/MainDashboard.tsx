'use client';
import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import Image from 'next/image';
import { RotateCcw, Search, Plus, Shield, Globe, Trash2, Download, Star, Edit2, ChevronRight } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { checkHIBP } from '@/lib/crypto';
import { CATEGORY_ICONS, ITEM_CATEGORIES } from './types';
import { DesktopSidebar, MobileTopBar } from './Sidebar';
import { Pagination } from './Pagination';
import { Field, HibpCheck } from './Field';
import { AddItemModal, EditItemModal, ITEM_FIELDS, Modal } from './ItemModal';
import type { DecryptedPayload, SidebarCounts, UserProfile, VaultItem } from '@/lib/types';
import type { Category, ItemForm } from './types';

const CATEGORIES = [
    { id: 'all', label: 'All', icon: Shield },
    ...ITEM_CATEGORIES,
] as const;

const EMPTY_CATEGORY_COPY: Record<Category, { title: string; description: string; action: string }> = {
    all: { title: 'Your vault starts here.', description: 'Keep your logins, cards, notes, and identities together in one private place.', action: 'Add your first item' },
    login: { title: 'Keep your logins close.', description: 'Save a login to keep its username and password together.', action: 'Add a login' },
    card: { title: 'Your cards, within reach.', description: 'Save a payment card so its details are easy to find when you need them.', action: 'Add a card' },
    note: { title: 'A place for private notes.', description: 'Save information you want to keep in your vault.', action: 'Add a note' },
    identity: { title: 'Your details, in one place.', description: 'Save an identity to keep personal details together.', action: 'Add an identity' },
};

const passthroughImageLoader = ({ src }: { src: string }) => src;
type HibpState = { checking: boolean; count: number | null };
type MaybePromiseVoid = void | Promise<void>;
function SearchSkeleton({ isMobile }: Readonly<{ isMobile: boolean }>) {
    return (
        <>
            {[0, 1, 2, 3, 4].map(i => (
                <div key={i} className="mb-0.5 flex animate-pulse items-center gap-3 rounded-lg p-3">
                    <div className={`shrink-0 rounded-lg bg-[var(--skeleton-2)] ${isMobile ? 'size-10' : 'size-9'}`} />
                    <div className="flex-1">
                        <div className="mb-2 h-3 w-[55%] rounded-md bg-[var(--skeleton-2)]" />
                        <div className="h-2.5 w-[38%] rounded-md bg-[var(--skeleton-1)]" />
                    </div>
                </div>
            ))}
        </>
    );
}

function FaviconImage({ src, size }: Readonly<{ src: string; size: number }>) {
    const [failed, setFailed] = useState(false);

    if (failed) return null;

    return (
        <Image
            src={src}
            alt=""
            width={size}
            height={size}
            unoptimized
            loader={passthroughImageLoader}
            onError={() => setFailed(true)}
        />
    );
}

function ItemIcon({ item, isMobile }: Readonly<{ item: VaultItem; isMobile: boolean }>) {
    const Icon = CATEGORY_ICONS[item.category] || Globe;
    const px = isMobile ? 22 : 20;
    return (
        <div className={`flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[var(--skeleton-1)] ${isMobile ? 'size-10' : 'size-9'}`}>
            {item.favicon_url
                ? <FaviconImage src={item.favicon_url} size={px} />
                : <Icon size={px} color="var(--text-secondary)" />}
        </div>
    );
}

function ItemButton({ item, isSelected, isMobile, onSelect }: Readonly<{
    item: VaultItem; isSelected: boolean; isMobile: boolean;
    onSelect: (item: VaultItem) => void;
}>) {
    return (
        <button type="button" onClick={() => onSelect(item)} aria-current={isSelected ? 'true' : undefined}
            className={`mb-0.5 flex w-full cursor-pointer items-center gap-3 rounded-lg border-l-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-[var(--accent)] ${isMobile ? 'px-3 py-3.5' : 'p-3'} ${isSelected ? 'border-[var(--accent)] bg-[var(--accent-dim)] hover:bg-[var(--accent-dim)]' : 'border-transparent hover:bg-[var(--bg-elevated)]'}`}>
            <ItemIcon item={item} isMobile={isMobile} />
            <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-[var(--text-primary)]">
                    {item.name}
                </p>
                <p className="truncate text-[13px] font-normal text-[var(--text-secondary)]">
                    {item.decrypted?.username || item.decrypted?.url || item.category}
                </p>
            </div>
            {item.is_favourite && (
                <Star size={14} color="var(--accent)" fill="var(--accent)" />
            )}
            {isMobile && (
                <ChevronRight size={16} className="text-[var(--text-secondary)]" />
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

    if (loading) return <SearchSkeleton isMobile={isMobile} />;
    if (!items.length) return (
        <div className="px-5 py-10 text-center text-[var(--text-secondary)]">
            <Shield size={32} className="mx-auto mb-3 opacity-60" />
            <p className="text-sm">No items found</p>
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
                    onSelect={onSelect}
                />
            ))}
        </>
    );
}

function FieldRows({ d, copy, hibp, onCheckHibp }: Readonly<{
    d: DecryptedPayload;
    copy: (val: string, label: string) => () => Promise<boolean>;
    hibp: HibpState;
    onCheckHibp: () => void;
}>) {
    return (
        <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-card)]">
            {(Object.keys(ITEM_FIELDS) as (keyof DecryptedPayload)[]).map((name) => {
                const value = d[name];
                if (!value) return null;
                const definition: { label: string; copyLabel?: string; secret?: boolean; multiline?: boolean } = ITEM_FIELDS[name];
                return <div key={name} className="border-b border-[var(--border)] last:border-b-0">
                    <Field label={definition.label} value={value} secret={definition.secret}
                        multiline={definition.multiline}
                        onCopy={definition.copyLabel ? copy(value, definition.copyLabel) : undefined} />
                    {name === 'password' && <HibpCheck hibp={hibp} onCheck={onCheckHibp} />}
                </div>;
            })}
        </div>
    );
}

function ItemDetailFields({ selectedItem, copyToClipboard, hibp, setHibp }: Readonly<{
    selectedItem: VaultItem;
    copyToClipboard: (text: string, label: string) => Promise<boolean>;
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

    return <FieldRows key={selectedItem.id} d={d} copy={copy} hibp={hibp} onCheckHibp={handleCheckHibp} />;
}

function ItemDetailActions({ item, deletingId, onFav, onEdit, onDelete, onRestore, onDeletePermanent }: Readonly<{
    item: VaultItem; deletingId: string | null;
    onFav: () => void; onEdit: () => void; onDelete: () => void;
    onRestore: () => void; onDeletePermanent: () => void;
}>) {
    return (
        <div className="flex shrink-0 items-center gap-2">
            {item.is_deleted ? (
                <button type="button" onClick={onRestore} className="btn-ghost !px-3" aria-label="Restore item">
                    <RotateCcw size={16} /> <span className="hidden sm:inline">Restore</span>
                </button>
            ) : (
                <>
                    <button type="button" onClick={onFav} className="btn-ghost !px-3" title={item.is_favourite ? 'Remove from favourites' : 'Add to favourites'} aria-label={item.is_favourite ? 'Remove from favourites' : 'Add to favourites'}>
                        <Star size={16}
                            color={item.is_favourite ? 'var(--accent)' : 'var(--text-secondary)'}
                            fill={item.is_favourite ? 'var(--accent)' : 'none'} />
                    </button>
                    <button type="button" onClick={onEdit} className="btn-ghost !px-3" aria-label="Edit item">
                        <Edit2 size={16} /> <span className="hidden sm:inline">Edit</span>
                    </button>
                </>
            )}
            {!item.is_deleted && (
                <button type="button" onClick={onDelete} className="btn-ghost btn-danger !px-3" disabled={deletingId === item.id} title="Move to trash" aria-label="Move to trash">
                    <Trash2 size={16} />
                </button>
            )}
            {item.is_deleted && (
                <button type="button" onClick={onDeletePermanent} className="btn-ghost btn-danger !px-3" disabled={deletingId === item.id} title="Delete permanently" aria-label="Delete permanently">
                    <Trash2 size={16} />
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
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4 sm:mb-8">
            <div className="flex min-w-0 items-center gap-3">
                <div className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] sm:size-12">
                    {item.favicon_url
                        ? <FaviconImage src={item.favicon_url} size={26} />
                        : <Icon size={23} color="var(--accent)" />}
                </div>
                <div className="min-w-0">
                    <h2 className="font-display truncate text-2xl text-[var(--text-primary)] sm:text-3xl">
                        {item.name}
                    </h2>
                    <p className="text-xs text-[var(--text-secondary)] sm:text-sm">
                        <span className="capitalize">{item.category}</span>
                        {!isMobile && <> · Updated {new Date(item.updated_at).toLocaleDateString()}</>}
                    </p>
                </div>
            </div>

            <ItemDetailActions
                item={item} deletingId={deletingId}
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
    copyToClipboard: (text: string, label: string) => Promise<boolean>;
    hibp: HibpState;
    setHibp: (v: HibpState) => void;
}

function ItemDetailPanel({ selectedItem, selectedItemLoading, isMobile, handleToggleFav, handleOpenEdit, handleDelete, handleRestoreItem, handleDeletePermanent, deletingId, copyToClipboard, hibp, setHibp }: Readonly<ItemDetailPanelProps>) {

    if (!selectedItem) return (
        <div className="flex h-full flex-col items-center justify-center gap-3 text-[var(--text-secondary)]">
            <Shield size={40} className="opacity-70" />
            <p className="text-sm">Select an item to view details</p>
        </div>
    );

    if (selectedItemLoading) return (
        <div className={`flex flex-col items-center justify-center gap-3 text-[var(--text-secondary)] ${isMobile ? 'h-48' : 'h-full'}`}>
            <p className="text-sm">Decrypting…</p>
        </div>
    );

    return (
        <div className="animate-fade-up mx-auto w-full max-w-[960px]">
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
            {isMobile && <p className="mt-5 text-xs text-[var(--text-secondary)]">
                Last updated {new Date(selectedItem.updated_at).toLocaleDateString()}
            </p>}
        </div>
    );
}

function CategoryPill({ label, icon: Icon, isActive, onSelect }: Readonly<{
    label: string; icon: LucideIcon;
    isActive: boolean; onSelect: () => void;
}>) {
    return (
        <button type="button" onClick={onSelect}
            data-trash-navigation={label === 'Trash' ? '' : undefined}
            className={`flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 py-2 text-xs ${isActive ? 'border-[var(--accent)] bg-[var(--accent-dim)] text-[var(--accent)]' : 'border-[var(--border)] text-[var(--text-secondary)]'}`}>
            <Icon size={13} /> {label}
        </button>
    );
}

function EmptyView({ title, description, icon: Icon, action }: Readonly<{
    title: string;
    description: string;
    icon: LucideIcon;
    action?: React.ReactNode;
}>) {
    return (
        <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center text-[var(--text-secondary)]">
            <div className="flex size-14 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--accent)]">
                <Icon size={26} />
            </div>
            <h2 className="font-display text-2xl text-[var(--text-primary)]">{title}</h2>
            <p className="max-w-sm text-sm">{description}</p>
            {action && <div className="mt-3">{action}</div>}
        </div>
    );
}

function EmptyArtwork({ icon: Icon, label }: Readonly<{ icon: LucideIcon; label: string }>) {
    return (
        <div aria-hidden="true" className="relative mx-auto aspect-[5/4] w-full max-w-[460px]">
            <div className="absolute inset-5 rotate-6 rounded-[28px] border border-[var(--border)]" />
            <div className="absolute inset-5 -rotate-6 rounded-[28px] border border-[var(--border)] bg-[var(--bg-card)]" />
            <div className="absolute inset-9 flex flex-col justify-between rounded-[24px] border border-[var(--border)] bg-[var(--bg-elevated)] p-7 shadow-2xl shadow-black/30 sm:p-9">
                <div className="flex items-start justify-between gap-4">
                    <div className="flex size-14 items-center justify-center rounded-2xl bg-[var(--accent-dim)] text-[var(--accent)]">
                        <Icon size={30} strokeWidth={1.6} />
                    </div>
                    <span className="text-[10px] font-medium uppercase tracking-[0.22em] text-[var(--text-secondary)]">Cipheria</span>
                </div>
                <div>
                    <div className="mb-5 h-px w-full bg-[var(--border)]" />
                    <p className="text-sm font-medium text-[var(--text-secondary)]">{label}</p>
                    <div className="mt-3 h-2 w-2/3 rounded-full bg-[var(--border)]" />
                    <div className="mt-2 h-2 w-1/3 rounded-full bg-[var(--border)]" />
                </div>
            </div>
        </div>
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
    sidebarCounts: SidebarCounts;
    selectedItem: VaultItem | null;
    handleSelectItem: (item: VaultItem) => MaybePromiseVoid;
    selectedItemLoading: boolean;
    handleToggleFav: (item: VaultItem) => MaybePromiseVoid;
    handleOpenEdit: (item: VaultItem) => void;
    handleDelete: (id: string, cb?: () => void) => MaybePromiseVoid;
    handleRestoreItem: (id: string) => MaybePromiseVoid;
    handleDeletePermanent: (id: string) => Promise<boolean>;
    deletingId: string | null;
    copyToClipboard: (text: string, label: string) => Promise<boolean>;
    hibp: HibpState;
    setHibp: (value: HibpState) => void;
    showAddModal: boolean;
    setShowAddModal: (value: boolean) => void;
    newItem: ItemForm;
    setNewItem: (form: ItemForm) => void;
    savingItem: boolean;
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
    searchLoading: boolean;
}

export function MainDashboard(props: Readonly<MainDashboardProps>) {
    const {
        user, category, searchValue, onSearchChange, handleExport, lockVault, handleLogout,
        onOpenSettings, onToggleFavourites, onToggleTrash, isFavouritesView, isTrashView,
        sidebarCounts, setShowAddModal, setCategory, selectedItem, handleSelectItem, selectedItemLoading,
        handleToggleFav, handleOpenEdit, handleDelete, handleRestoreItem, handleDeletePermanent, deletingId, copyToClipboard,
        hibp, setHibp, showAddModal, newItem, setNewItem, savingItem, handleAddItem,
        showEditModal, setShowEditModal, editForm, setEditForm, updatingItem, handleEditItem,
        filteredItems, page, totalPages, onPageChange, searchLoading,
    } = props;

    const [mobilePanel, setMobilePanel] = useState<'list' | 'detail'>('list');
    const [pendingPermanentDelete, setPendingPermanentDelete] = useState<{ id: string; name: string } | null>(null);
    const mobileDetailHistoryRef = useRef(false);
    const closePermanentDelete = useCallback(() => setPendingPermanentDelete(null), []);
    const requestPermanentDelete = useCallback((id: string) => {
        if (selectedItem?.id === id) setPendingPermanentDelete({ id, name: selectedItem.name });
    }, [selectedItem]);
    const confirmPermanentDelete = useCallback(async () => {
        if (!pendingPermanentDelete || deletingId) return;
        if (await handleDeletePermanent(pendingPermanentDelete.id)) {
            setPendingPermanentDelete(null);
            requestAnimationFrame(() => {
                const trashButtons = document.querySelectorAll<HTMLButtonElement>('[data-trash-navigation]');
                Array.from(trashButtons).find(button => button.getClientRects().length > 0)?.focus();
            });
        }
    }, [deletingId, handleDeletePermanent, pendingPermanentDelete]);
    const handleSelectItemMobile = useCallback((item: VaultItem) => {
        void handleSelectItem(item);
        // The detail view is a client-side panel rather than a route. Add a
        // same-page history entry so the device Back button closes it instead
        // of leaving the dashboard.
        window.history.pushState(
            { ...window.history.state, cipheriaMobileDetail: true },
            '',
        );
        mobileDetailHistoryRef.current = true;
        setMobilePanel('detail');
    }, [handleSelectItem]);

    const handleMobileBack = useCallback(() => {
        if (mobileDetailHistoryRef.current) {
            window.history.back();
            return;
        }
        setMobilePanel('list');
    }, []);
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

    useEffect(() => {
        if (mobilePanel === 'detail' && !selectedItem) {
            setMobilePanel('list');
        }
    }, [mobilePanel, selectedItem]);

    useEffect(() => {
        if (selectedItem || searchLoading || !filteredItems.length ||
            !window.matchMedia('(min-width: 1024px)').matches) return;
        void handleSelectItem(filteredItems[0]);
    }, [filteredItems, handleSelectItem, searchLoading, selectedItem]);

    useEffect(() => {
        const handlePopState = (event: PopStateEvent) => {
            mobileDetailHistoryRef.current = Boolean(event.state?.cipheriaMobileDetail);
            setMobilePanel(event.state?.cipheriaMobileDetail ? 'detail' : 'list');
        };

        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, []);

    const detailPanelProps: Omit<ItemDetailPanelProps, 'isMobile' | 'handleDelete'> = {
        selectedItem, selectedItemLoading,
        handleToggleFav, handleOpenEdit, handleRestoreItem, handleDeletePermanent: requestPermanentDelete,
        deletingId, copyToClipboard, hibp, setHibp,
    };
    const hasSearch = searchValue.trim().length > 0;
    const hasNoItems = !searchLoading && filteredItems.length === 0;
    const showEmptyCategory = hasNoItems && !hasSearch;
    const emptyViewTitle = hasSearch ? 'No matching items'
        : isTrashView ? 'Trash is empty'
            : isFavouritesView ? 'No favourites yet'
                : category === 'all' ? 'Your vault is empty'
                    : `No ${ITEM_CATEGORIES.find(({ id }) => id === category)?.label.toLowerCase() ?? 'items'} yet`;
    const emptyViewDescription = hasSearch ? 'Try a different search term.'
        : isTrashView ? 'Deleted items will appear here.'
            : isFavouritesView ? 'Favourite an item to find it here.'
                : category === 'all' ? 'Items you add will appear here.'
                    : 'Items in this category will appear here.';
    const emptyViewIcon = hasSearch ? Search
        : isTrashView ? Trash2
            : isFavouritesView ? Star : CATEGORY_ICONS[category] || Shield;
    const emptyCategoryLabel = isTrashView ? 'Trash'
        : isFavouritesView ? 'Favourites'
            : category === 'all' ? 'All Items'
                : ITEM_CATEGORIES.find(({ id }) => id === category)?.label ?? 'Items';
    const desktopEmptyCopy = isTrashView
            ? { title: 'Nothing in the trash.', description: 'Items you delete will appear here until you remove them permanently.' }
            : isFavouritesView
                ? { title: 'Keep favourites close.', description: 'Star an item and it will appear here for quick access.' }
                : EMPTY_CATEGORY_COPY[category];
    const emptyAction = hasSearch
        ? <button type="button" className="btn-ghost" onClick={() => onSearchChange('')}>Clear search</button>
        : !isTrashView && !isFavouritesView
            ? <button type="button" className="btn-primary" onClick={() => {
                if (category !== 'all') setNewItem({ ...newItem, category });
                handleOpenAddModal();
            }}><Plus size={16} /> {EMPTY_CATEGORY_COPY[category].action}</button>
            : undefined;
    const desktopControls = (
        <div className="border-b border-[var(--border)] px-4 py-5">
            <div className="w-full max-w-[448px]">
                <div className={`relative ${isTrashView ? '' : 'mb-3'}`}>
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" />
                    <input className="input-field vault-search-input" aria-label="Search vault" placeholder="Search vault..." value={searchValue}
                        onChange={handleSearchChange} />
                </div>
                {!isTrashView && <button type="button" className="btn-primary w-full" onClick={handleOpenAddModal}>
                    <Plus size={16} /> Add Item
                </button>}
            </div>
        </div>
    );

    return (
        <div className="flex h-dvh w-full overflow-hidden bg-[var(--bg)]">
            <MobileTopBar
                mobilePanel={mobilePanel} selectedItem={selectedItem}
                onBack={handleMobileBack} lockVault={lockVault} handleLogout={handleLogout}
                onOpenSettings={onOpenSettings}
            />

            {/* Mobile: list panel */}
            <div className={`fixed inset-0 z-10 flex-col bg-[var(--bg)] pt-[57px] lg:hidden ${mobilePanel === 'list' ? 'flex' : 'hidden'}`}>
                {/* Category pills */}
                <div className="flex shrink-0 gap-2 overflow-x-auto border-b border-[var(--border)] px-4 py-3">
                    {CATEGORIES.map(({ id, label, icon }) => (
                        <CategoryPill key={id} label={label} icon={icon}
                            isActive={!isTrashView && !isFavouritesView && category === id}
                            onSelect={() => { void setCategory(id); }} />
                    ))}
                    <CategoryPill label="Favourites" icon={Star}
                        isActive={isFavouritesView} onSelect={handleFavouritesPill} />
                    <CategoryPill label="Trash" icon={Trash2}
                        isActive={isTrashView} onSelect={handleTrashPill} />
                </div>

                <div className="flex shrink-0 gap-2 border-b border-[var(--border)] px-4 py-3">
                    <div className="relative flex-1">
                        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" />
                        <input className="input-field vault-search-input" aria-label="Search vault" placeholder="Search vault..." value={searchValue}
                            onChange={handleSearchChange} />
                    </div>
                    {!isTrashView && <button type="button" className="btn-primary" onClick={handleOpenAddModal}
                        aria-label="Add item" title="Add item">
                        <Plus size={16} />
                    </button>}
                </div>

                <div className="flex-1 overflow-y-auto p-2">
                    {hasNoItems
                        ? <EmptyView title={emptyViewTitle} description={emptyViewDescription} icon={emptyViewIcon}
                            action={hasSearch ? emptyAction : undefined} />
                        : <ItemList variant="mobile" items={filteredItems} loading={searchLoading} onSelect={handleSelectItemMobile} />}
                </div>

                <Pagination page={page} totalPages={totalPages} onPageChange={onPageChange} />

                <div className="flex gap-2 border-t border-[var(--border)] px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom,0px))]">
                    <button type="button" onClick={handleExport} className="btn-ghost flex-1 text-xs">
                        <Download size={14} /> Export
                    </button>
                    <p className="flex flex-1 items-center justify-center truncate px-2 text-xs text-[var(--text-secondary)]">
                        {user?.email}
                    </p>
                </div>
            </div>

            {/* Mobile: detail panel */}
            <div className={`fixed inset-0 z-10 flex-col overflow-y-auto bg-[var(--bg)] pt-[57px] lg:hidden ${mobilePanel === 'detail' ? 'flex' : 'hidden'}`}>
                <div className="flex-1 px-4 py-6 sm:px-6">
                    <ItemDetailPanel {...detailPanelProps} isMobile handleDelete={handleDelete} />
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

            {showEmptyCategory ? (
                <div className="hidden min-w-0 flex-1 overflow-y-auto lg:block">
                    <div className="mx-auto grid min-h-full w-full max-w-[1200px] grid-cols-2 items-center gap-10 px-8 py-12 xl:gap-16 xl:px-12">
                        <div className="min-w-0">
                            <p className="mb-6 text-xs font-medium uppercase tracking-[0.2em] text-[var(--accent)]">{emptyCategoryLabel} / 0 items</p>
                            <h1 className="font-display text-4xl leading-tight text-[var(--text-primary)] xl:text-5xl">{desktopEmptyCopy.title}</h1>
                            <p className="mt-5 max-w-md text-base leading-7 text-[var(--text-secondary)]">{desktopEmptyCopy.description}</p>
                            {emptyAction && <div className="mt-8">{emptyAction}</div>}
                        </div>
                        <EmptyArtwork icon={emptyViewIcon} label={emptyCategoryLabel} />
                    </div>
                </div>
            ) : (
                <>
                    <div className="hidden w-[320px] shrink-0 flex-col border-r border-[var(--border)] xl:w-[380px] 2xl:w-[480px] lg:flex">
                        {desktopControls}
                        <div className="flex-1 overflow-y-auto p-2">
                            {hasNoItems ? <p className="px-3 py-4 text-sm text-[var(--text-secondary)]">0 matches</p>
                                : <ItemList variant="desktop" items={filteredItems} loading={searchLoading}
                                    selectedId={selectedItem?.id} onSelect={handleSelectItem} />}
                        </div>
                        <Pagination page={page} totalPages={totalPages} onPageChange={onPageChange} />
                    </div>

                    <div className="hidden min-w-0 flex-1 overflow-y-auto px-6 py-8 lg:block xl:px-10 xl:py-10">
                        {hasNoItems
                            ? <EmptyView title={emptyViewTitle} description={emptyViewDescription} icon={emptyViewIcon} action={emptyAction} />
                            : <ItemDetailPanel {...detailPanelProps} handleDelete={handleDelete} />}
                    </div>
                </>
            )}

            {showAddModal && (
                <AddItemModal newItem={newItem} setNewItem={setNewItem} savingItem={savingItem}
                    onSubmit={handleAddItem} onClose={handleAddClose} />
            )}
            {showEditModal && editForm && (
                <EditItemModal editForm={editForm} setEditForm={setEditForm} updatingItem={updatingItem}
                    onSubmit={handleEditItem} onClose={handleEditClose} />
            )}
            {pendingPermanentDelete && (
                <Modal title="Delete permanently?" icon={<Trash2 size={17} color="var(--danger)" />}
                    onClose={closePermanentDelete} closeDisabled={Boolean(deletingId)}>
                    <p className="text-sm leading-6 text-[var(--text-secondary)]">
                        Delete <strong className="text-[var(--text-primary)]">{pendingPermanentDelete.name}</strong> permanently? This cannot be undone.
                    </p>
                    <div className="mt-6 flex justify-end gap-3">
                        <button type="button" className="btn-ghost" onClick={closePermanentDelete} disabled={Boolean(deletingId)}>Cancel</button>
                        <button type="button" className="btn-ghost btn-danger" onClick={() => { void confirmPermanentDelete(); }} disabled={Boolean(deletingId)}>
                            <Trash2 size={16} /> {deletingId ? 'Deleting…' : 'Delete permanently'}
                        </button>
                    </div>
                </Modal>
            )}
        </div>
    );
}
