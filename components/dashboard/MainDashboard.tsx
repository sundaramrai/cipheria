'use client';
import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { RotateCcw, Search, Plus, Shield, Globe, Trash2, Download, Star, Edit2, ChevronRight } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { checkHIBP } from '@/lib/crypto';
import { CATEGORY_ICONS, ITEM_CATEGORIES } from './types';
import { DesktopSidebar, MobileTopBar } from './Sidebar';
import { Pagination } from './Pagination';
import { Field, HibpCheck } from './Field';
import { ItemModal, ITEM_FIELDS, Modal } from './ItemModal';
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

type HibpState = { checking: boolean; count: number | null };
type MaybePromiseVoid = void | Promise<void>;
function SearchSkeleton({ isMobile }: Readonly<{ isMobile: boolean }>) {
    return (
        <>
            {[0, 1, 2, 3, 4].map(i => (
                <div key={i} className="mb-0.5 flex animate-pulse items-center gap-3 rounded-lg p-3">
                    <div className={`shrink-0 rounded-lg bg-(--skeleton-2) ${isMobile ? 'size-10' : 'size-9'}`} />
                    <div className="flex-1">
                        <div className="mb-2 h-3 w-[55%] rounded-md bg-(--skeleton-2)" />
                        <div className="h-2.5 w-[38%] rounded-md bg-(--skeleton-1)" />
                    </div>
                </div>
            ))}
        </>
    );
}

function ItemIcon({ item, isMobile }: Readonly<{ item: VaultItem; isMobile: boolean }>) {
    const Icon = CATEGORY_ICONS[item.category] || Globe;
    const px = isMobile ? 22 : 20;
    return (
        <div className={`flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-(--skeleton-1) ${isMobile ? 'size-10' : 'size-9'}`}>
            <Icon size={px} color="var(--text-secondary)" />
        </div>
    );
}

function ItemButton({ item, isSelected, isMobile, onSelect }: Readonly<{
    item: VaultItem; isSelected: boolean; isMobile: boolean;
    onSelect: (item: VaultItem) => void;
}>) {
    return (
        <button type="button" data-vault-item-id={item.id} onClick={() => onSelect(item)} aria-current={isSelected ? 'true' : undefined}
            className={`mb-0.5 flex w-full cursor-pointer items-center gap-3 rounded-lg border-l-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-(--accent) ${isMobile ? 'px-3 py-3.5' : 'p-3'} ${isSelected ? 'border-(--accent) bg-(--accent-dim) hover:bg-(--accent-dim)' : 'border-transparent hover:bg-(--bg-elevated)'}`}>
            <ItemIcon item={item} isMobile={isMobile} />
            <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-(--text-primary)">
                    {item.name}
                </p>
                <p className="truncate text-[13px] font-normal text-(--text-secondary)">
                    {item.decrypted?.username || item.search_fields?.username || item.decrypted?.url || item.search_fields?.url || item.category}
                </p>
            </div>
            {item.is_favourite && (
                <Star size={14} color="var(--accent)" fill="var(--accent)" />
            )}
            {isMobile && (
                <ChevronRight size={16} className="text-(--text-secondary)" />
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
        <div className="px-5 py-10 text-center text-(--text-secondary)">
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
        <div className="overflow-hidden rounded-xl border border-(--border) bg-(--bg-card)">
            {(Object.keys(ITEM_FIELDS) as (keyof typeof ITEM_FIELDS)[]).map((name) => {
                const value = d[name];
                if (!value) return null;
                const definition: { label: string; copyLabel?: string; secret?: boolean; multiline?: boolean } = ITEM_FIELDS[name];
                return <div key={name} className="border-b border-(--border) last:border-b-0">
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
    const checkRequestRef = useRef(0);
    useEffect(() => () => { checkRequestRef.current += 1; }, [password, selectedItem.id]);
    const handleCheckHibp = useCallback(async () => {
        if (!password) return;
        const request = ++checkRequestRef.current;
        setHibp({ checking: true, count: null });
        try {
            const count = await checkHIBP(password);
            if (request === checkRequestRef.current) setHibp({ checking: false, count });
        } catch {
            if (request === checkRequestRef.current) setHibp({ checking: false, count: -1 });
        }
    }, [password, setHibp]);

    return <>
        <FieldRows key={selectedItem.id} d={d} copy={copy} hibp={hibp} onCheckHibp={handleCheckHibp} />
        {selectedItem.category === 'login' && Array.isArray(d.password_history) && d.password_history.length > 0 && (
            <details key={`${selectedItem.id}-history`} className="mt-6 rounded-xl border border-(--border) bg-(--bg-card)">
                <summary className="cursor-pointer px-5 py-4 text-sm text-(--text-primary)">Password history ({d.password_history.length})</summary>
                <p className="px-5 pb-2 text-xs text-(--text-secondary)">The last five replaced passwords. Changing a saved password does not change it on the website.</p>
                {d.password_history.map((entry, index) => (
                    <Field key={`${entry.replaced_at}:${index}`} label={`Replaced ${new Date(entry.replaced_at).toLocaleString()}`}
                        value={entry.password} secret onCopy={copy(entry.password, 'Previous password')} />
                ))}
            </details>
        )}
    </>;
}

function ItemDetailActions({ item, deletingId, onFav, onEdit, onDelete, onRestore, onDeletePermanent }: Readonly<{
    item: VaultItem; deletingId: string | null;
    onFav: () => void; onEdit: () => void; onDelete: () => void;
    onRestore: () => void; onDeletePermanent: () => void;
}>) {
    return (
        <div className="flex shrink-0 items-center gap-2">
            {item.is_deleted ? (
                <button type="button" onClick={onRestore} className="btn-ghost px-3!" aria-label="Restore item">
                    <RotateCcw size={16} /> <span className="hidden sm:inline">Restore</span>
                </button>
            ) : (
                <>
                    <button type="button" onClick={onFav} className="btn-ghost px-3!" title={item.is_favourite ? 'Remove from favourites' : 'Add to favourites'} aria-label={item.is_favourite ? 'Remove from favourites' : 'Add to favourites'}>
                        <Star size={16}
                            color={item.is_favourite ? 'var(--accent)' : 'var(--text-secondary)'}
                            fill={item.is_favourite ? 'var(--accent)' : 'none'} />
                    </button>
                    <button type="button" onClick={onEdit} className="btn-ghost px-3!" aria-label="Edit item">
                        <Edit2 size={16} /> <span className="hidden sm:inline">Edit</span>
                    </button>
                </>
            )}
            {!item.is_deleted && (
                <button type="button" onClick={onDelete} className="btn-ghost btn-danger px-3!" disabled={deletingId === item.id} title="Move to trash" aria-label="Move to trash">
                    <Trash2 size={16} />
                </button>
            )}
            {item.is_deleted && (
                <button type="button" onClick={onDeletePermanent} className="btn-ghost btn-danger px-3!" disabled={deletingId === item.id} title="Delete permanently" aria-label="Delete permanently">
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
                <div className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-(--border) bg-(--bg-elevated) sm:size-12">
                    <Icon size={23} color="var(--accent)" />
                </div>
                <div className="min-w-0">
                    <h2 className="font-display truncate text-2xl text-(--text-primary) sm:text-3xl">
                        {item.name}
                    </h2>
                    <p className="text-xs text-(--text-secondary) sm:text-sm">
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
    onClose: () => void;
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

function ItemDetailPanel({ selectedItem, selectedItemLoading, isMobile, handleToggleFav, handleOpenEdit, handleDelete, handleRestoreItem, handleDeletePermanent, deletingId, copyToClipboard, hibp, setHibp, onClose }: Readonly<ItemDetailPanelProps>) {

    if (!selectedItem) return (
        <div className="flex h-full flex-col items-center justify-center gap-3 text-(--text-secondary)">
            <Shield size={40} className="opacity-70" />
            <p className="text-sm">Select an item to view details</p>
        </div>
    );

    if (selectedItemLoading) return (
        <div className={`flex flex-col items-center justify-center gap-3 text-(--text-secondary) ${isMobile ? 'h-48' : 'h-full'}`}>
            <p className="text-sm">Decrypting…</p>
            <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
        </div>
    );

    return (
        <div className="animate-fade-up mx-auto w-full max-w-240">
            <ItemDetailHeader
                item={selectedItem} isMobile={isMobile}
                handleToggleFav={handleToggleFav} handleOpenEdit={handleOpenEdit}
                handleDelete={handleDelete} handleRestoreItem={handleRestoreItem}
                handleDeletePermanent={handleDeletePermanent} deletingId={deletingId}
            />
            <ItemDetailFields
                key={`${selectedItem.id}:${selectedItem.updated_at}`}
                selectedItem={selectedItem} copyToClipboard={copyToClipboard}
                hibp={hibp} setHibp={setHibp}
            />
            {isMobile && <p className="mt-5 text-xs text-(--text-secondary)">
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
            className={`flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 py-2 text-xs ${isActive ? 'border-(--accent) bg-(--accent-dim) text-(--accent)' : 'border-(--border) text-(--text-secondary)'}`}>
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
        <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center text-(--text-secondary)">
            <div className="flex size-14 items-center justify-center rounded-2xl border border-(--border) bg-(--bg-elevated) text-(--accent)">
                <Icon size={26} />
            </div>
            <h2 className="font-display text-2xl text-(--text-primary)">{title}</h2>
            <p className="max-w-sm text-sm">{description}</p>
            {action && <div className="mt-3">{action}</div>}
        </div>
    );
}

function EmptyArtwork({ icon: Icon, label }: Readonly<{ icon: LucideIcon; label: string }>) {
    return (
        <div aria-hidden="true" className="relative mx-auto aspect-5/4 w-full max-w-115">
            <div className="absolute inset-5 rotate-6 rounded-[28px] border border-(--border)" />
            <div className="absolute inset-5 -rotate-6 rounded-[28px] border border-(--border) bg-(--bg-card)" />
            <div className="absolute inset-9 flex flex-col justify-between rounded-3xl border border-(--border) bg-(--bg-elevated) p-7 shadow-2xl shadow-black/30 sm:p-9">
                <div className="flex items-start justify-between gap-4">
                    <div className="flex size-14 items-center justify-center rounded-2xl bg-(--accent-dim) text-(--accent)">
                        <Icon size={30} strokeWidth={1.6} />
                    </div>
                    <span className="text-[10px] font-medium uppercase tracking-[0.22em] text-(--text-secondary)">Cipheria</span>
                </div>
                <div>
                    <div className="mb-5 h-px w-full bg-(--border)" />
                    <p className="text-sm font-medium text-(--text-secondary)">{label}</p>
                    <div className="mt-3 h-2 w-2/3 rounded-full bg-(--border)" />
                    <div className="mt-2 h-2 w-1/3 rounded-full bg-(--border)" />
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
    searchError: string | null;
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
    clearSelection: () => void;
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

function getEmptyViewInfo({ category, isTrashView, isFavouritesView, searchValue, searchError }: Pick<
    MainDashboardProps, 'category' | 'isTrashView' | 'isFavouritesView' | 'searchValue' | 'searchError'
>) {
    const categoryLabel = ITEM_CATEGORIES.find(({ id }) => id === category)?.label ?? 'Items';
    const { title, description } = EMPTY_CATEGORY_COPY[category];
    let view = {
        label: category === 'all' ? 'All Items' : categoryLabel,
        title: category === 'all' ? 'Your vault is empty' : `No ${categoryLabel.toLowerCase()} yet`,
        description: category === 'all' ? 'Items you add will appear here.' : 'Items in this category will appear here.',
        icon: CATEGORY_ICONS[category] || Shield,
        desktopCopy: { title, description },
    };
    if (isTrashView) view = {
        label: 'Trash', title: 'Trash is empty', description: 'Deleted items will appear here.', icon: Trash2,
        desktopCopy: { title: 'Nothing in the trash.', description: 'Items you delete will appear here until you remove them permanently.' },
    };
    else if (isFavouritesView) view = {
        label: 'Favourites', title: 'No favourites yet', description: 'Favourite an item to find it here.', icon: Star,
        desktopCopy: { title: 'Keep favourites close.', description: 'Star an item and it will appear here for quick access.' },
    };
    const hasSearch = searchValue.trim().length > 0;
    if (hasSearch) view = { ...view, title: 'No matching items', description: 'Try a different search term.', icon: Search };
    if (searchError) view = { ...view, title: 'Search could not finish' };
    view.description = searchError ?? view.description;
    const searchPlaceholder = category === 'all' || category === 'login' || isFavouritesView || isTrashView
        ? 'Search name, website or username…' : 'Search by name…';
    const hasAction = hasSearch || (!isTrashView && !isFavouritesView);
    const noMatchesLabel = searchError ? 'Search unavailable' : '0 matches';
    return { ...view, hasSearch, hasAction, searchPlaceholder, noMatchesLabel };
}

function EmptyViewAction({ hasSearch, searchError, searchValue, onSearchChange, category,
    newItem, setNewItem, onAdd }: Readonly<Pick<MainDashboardProps,
        'searchError' | 'searchValue' | 'onSearchChange' | 'category' | 'newItem' | 'setNewItem'
    > & { hasSearch: boolean; onAdd: () => void }>) {
    if (hasSearch) return <div className="flex flex-wrap justify-center gap-3">
        {searchError && <button type="button" className="btn-primary" onClick={() => onSearchChange(searchValue)}>Retry search</button>}
        <button type="button" className="btn-ghost" onClick={() => onSearchChange('')}>Clear search</button>
    </div>;
    return <button type="button" className="btn-primary" onClick={() => {
        if (category !== 'all') setNewItem({ ...newItem, category });
        onAdd();
    }}><Plus size={16} /> {EMPTY_CATEGORY_COPY[category].action}</button>;
}

export function MainDashboard(props: Readonly<MainDashboardProps>) {
    const {
        user, category, searchValue, onSearchChange, handleExport, lockVault, handleLogout,
        onOpenSettings, onToggleFavourites, onToggleTrash, isFavouritesView, isTrashView,
        sidebarCounts, setShowAddModal, setCategory, selectedItem, clearSelection, handleSelectItem, selectedItemLoading,
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
        if (!mobileDetailHistoryRef.current) window.history.pushState(
            { ...window.history.state, cipheriaMobileDetail: true }, '',
        );
        mobileDetailHistoryRef.current = true;
        setMobilePanel('detail');
    }, [handleSelectItem]);

    const handleCloseDetails = useCallback(() => {
        const closedId = selectedItem?.id;
        clearSelection();
        setMobilePanel('list');
        if (mobileDetailHistoryRef.current) {
            mobileDetailHistoryRef.current = false;
            window.history.back();
        }
        requestAnimationFrame(() => {
            const rows = document.querySelectorAll<HTMLButtonElement>('[data-vault-item-id]');
            Array.from(rows).find(row => row.dataset.vaultItemId === closedId && row.getClientRects().length > 0)?.focus();
        });
    }, [clearSelection, selectedItem]);
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
            handleCloseDetails();
        }
    }, [handleCloseDetails, mobilePanel, selectedItem]);


    useEffect(() => {
        const handlePopState = (event: PopStateEvent) => {
            mobileDetailHistoryRef.current = false;
            clearSelection();
            setMobilePanel('list');
            // Forward must not revive closed or deleted details.
            if (event.state?.cipheriaMobileDetail) {
                const state = { ...event.state };
                delete state.cipheriaMobileDetail;
                window.history.replaceState(state, '');
            }
        };

        window.addEventListener('popstate', handlePopState);
        return () => {
            window.removeEventListener('popstate', handlePopState);
            if (window.history.state?.cipheriaMobileDetail) {
                const state = { ...window.history.state };
                delete state.cipheriaMobileDetail;
                window.history.replaceState(state, '');
            }
        };
    }, [clearSelection]);

    useEffect(() => {
        if (!selectedItem) return;
        const handleEscape = (event: KeyboardEvent) => {
            if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing ||
                document.querySelector('dialog[open]')) return;
            event.preventDefault();
            handleCloseDetails();
        };
        window.addEventListener('keydown', handleEscape);
        return () => window.removeEventListener('keydown', handleEscape);
    }, [handleCloseDetails, selectedItem]);

    const detailPanelProps: Omit<ItemDetailPanelProps, 'isMobile' | 'handleDelete'> = {
        selectedItem, selectedItemLoading, onClose: handleCloseDetails,
        handleToggleFav, handleOpenEdit, handleRestoreItem, handleDeletePermanent: requestPermanentDelete,
        deletingId, copyToClipboard, hibp, setHibp,
    };
    const { hasSearch, hasAction, searchPlaceholder, noMatchesLabel, title: emptyViewTitle, description: emptyViewDescription,
        icon: emptyViewIcon, label: emptyCategoryLabel, desktopCopy: desktopEmptyCopy } = getEmptyViewInfo(props);
    const hasNoItems = !searchLoading && filteredItems.length === 0;
    const showEmptyCategory = hasNoItems && !hasSearch;
    const emptyAction = hasAction ? <EmptyViewAction {...props} hasSearch={hasSearch} onAdd={handleOpenAddModal} /> : undefined;
    const desktopControls = (
        <div className="border-b border-(--border) px-4 py-5">
            <div className="w-full max-w-md">
                <div className={`relative ${isTrashView ? '' : 'mb-3'}`}>
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-(--text-secondary)" />
                    <input className="input-field vault-search-input" aria-label={`Search ${emptyCategoryLabel}`} placeholder={searchPlaceholder} value={searchValue}
                        onChange={handleSearchChange} />
                </div>
                {!isTrashView && <button type="button" className="btn-primary w-full" onClick={handleOpenAddModal}>
                    <Plus size={16} /> Add Item
                </button>}
            </div>
        </div>
    );

    return (
        <div className="flex h-dvh w-full overflow-hidden bg-(--bg)">
            <MobileTopBar
                mobilePanel={mobilePanel} selectedItem={selectedItem}
                onBack={handleCloseDetails} lockVault={lockVault} handleLogout={handleLogout}
                onOpenSettings={onOpenSettings}
            />

            {/* Mobile: list panel */}
            <div className={`fixed inset-0 z-10 flex-col bg-(--bg) pt-14.25 lg:hidden ${mobilePanel === 'list' ? 'flex' : 'hidden'}`}>
                {/* Category pills */}
                <div className="flex shrink-0 gap-2 overflow-x-auto border-b border-(--border) px-4 py-3">
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

                <div className="flex shrink-0 gap-2 border-b border-(--border) px-4 py-3">
                    <div className="relative flex-1">
                        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-(--text-secondary)" />
                        <input className="input-field vault-search-input" aria-label={`Search ${emptyCategoryLabel}`} placeholder={searchPlaceholder} value={searchValue}
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

                <div className="flex gap-2 border-t border-(--border) px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom,0px))]">
                    <button type="button" onClick={handleExport} className="btn-ghost flex-1 text-xs">
                        <Download size={14} /> Export
                    </button>
                    <p className="flex flex-1 items-center justify-center truncate px-2 text-xs text-(--text-secondary)">
                        {user?.email}
                    </p>
                </div>
            </div>

            {/* Mobile: detail panel */}
            <div className={`fixed inset-0 z-10 flex-col overflow-y-auto bg-(--bg) pt-14.25 lg:hidden ${mobilePanel === 'detail' ? 'flex' : 'hidden'}`}>
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
                    <div className="mx-auto grid min-h-full w-full max-w-300 grid-cols-2 items-center gap-10 px-8 py-12 xl:gap-16 xl:px-12">
                        <div className="min-w-0">
                            <p className="mb-6 text-xs font-medium uppercase tracking-[0.2em] text-(--accent)">{emptyCategoryLabel} / 0 items</p>
                            <h1 className="font-display text-4xl leading-tight text-(--text-primary) xl:text-5xl">{desktopEmptyCopy.title}</h1>
                            <p className="mt-5 max-w-md text-base leading-7 text-(--text-secondary)">{desktopEmptyCopy.description}</p>
                            {emptyAction && <div className="mt-8">{emptyAction}</div>}
                        </div>
                        <EmptyArtwork icon={emptyViewIcon} label={emptyCategoryLabel} />
                    </div>
                </div>
            ) : (
                <>
                    <div className="hidden w-80 shrink-0 flex-col border-r border-(--border) xl:w-95 2xl:w-120 lg:flex">
                        {desktopControls}
                        <div className="flex-1 overflow-y-auto p-2">
                            {hasNoItems ? <p className="px-3 py-4 text-sm text-(--text-secondary)">{noMatchesLabel}</p>
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
                <ItemModal mode="add" form={newItem} setForm={setNewItem} saving={savingItem}
                    onSubmit={handleAddItem} onClose={handleAddClose} />
            )}
            {showEditModal && editForm && (
                <ItemModal mode="edit" form={editForm} setForm={setEditForm} saving={updatingItem}
                    onSubmit={handleEditItem} onClose={handleEditClose} />
            )}
            {pendingPermanentDelete && (
                <Modal title="Delete permanently?" icon={<Trash2 size={17} color="var(--danger)" />}
                    onClose={closePermanentDelete} closeDisabled={Boolean(deletingId)}>
                    <p className="text-sm leading-6 text-(--text-secondary)">
                        Delete <strong className="text-(--text-primary)">{pendingPermanentDelete.name}</strong> permanently? This cannot be undone.
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
