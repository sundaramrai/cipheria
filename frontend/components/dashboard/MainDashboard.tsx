'use client';
import { useState, useCallback, useMemo } from 'react';
import { Search, Plus, Shield, Globe, CreditCard, StickyNote, User, Trash2, Download, Star, Edit2, ChevronRight } from 'lucide-react';
import { checkHIBP } from '@/lib/crypto';
import { CATEGORY_ICONS } from './types';
import { DesktopSidebar, MobileTopBar } from './Sidebar';
import { Pagination } from './Pagination';
import { Field, HibpCheck } from './Field';
import { AddItemModal, EditItemModal } from './ItemModal';

const CATEGORIES = [
    { id: 'all', label: 'All', icon: Shield },
    { id: 'login', label: 'Logins', icon: Globe },
    { id: 'card', label: 'Cards', icon: CreditCard },
    { id: 'note', label: 'Notes', icon: StickyNote },
    { id: 'identity', label: 'Identities', icon: User },
] as const;

const ELLIPSIS_STYLE = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as const;

function SearchSkeleton({ iconSize = 36 }: Readonly<{ iconSize?: number }>) {
    return (
        <>
            {[0, 1, 2, 3, 4].map(i => (
                <div key={i} className="search-skeleton-item" style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: 12, borderRadius: 10, marginBottom: 2,
                    animationDelay: `${i * 0.08}s`,
                }}>
                    <div style={{ width: iconSize, height: iconSize, borderRadius: 8, background: 'rgba(255,255,255,0.07)', flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                        <div style={{ height: 13, width: '55%', borderRadius: 6, background: 'rgba(255,255,255,0.07)', marginBottom: 7 }} />
                        <div style={{ height: 11, width: '38%', borderRadius: 6, background: 'rgba(255,255,255,0.05)' }} />
                    </div>
                </div>
            ))}
        </>
    );
}

function ItemIcon({ item, size }: Readonly<{ item: any; size: number }>) {
    const Icon = CATEGORY_ICONS[item.category] || Globe;
    const px = Math.round(size * 0.55);
    return (
        <div style={{
            width: size, height: size, borderRadius: size > 38 ? 10 : 8, flexShrink: 0,
            background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
        }}>
            {item.favicon_url
                ? <img src={item.favicon_url} alt="" width={px} height={px} onError={(e: any) => { e.target.style.display = 'none'; }} />
                : <Icon size={px} color="var(--text-secondary)" />}
        </div>
    );
}

function ItemButton({ item, isSelected, isMobile, iconSize, fontSize, padding, onSelect }: Readonly<{
    item: any; isSelected: boolean; isMobile: boolean;
    iconSize: number; fontSize: string; padding: string;
    onSelect: (item: any) => void;
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
    items: any[];
    loading: boolean;
    selectedId?: string;
    onSelect: (item: any) => void;
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

function ItemDetailFields({ selectedItem, copyToClipboard, hibp, setHibp }: Readonly<{
    selectedItem: any;
    copyToClipboard: (text: string, label: string) => void;
    hibp: { checking: boolean; count: number | null };
    setHibp: (v: { checking: boolean; count: number | null }) => void;
}>) {
    const d = selectedItem.decrypted;
    const copy = useMemo(
        () => (val: string, label: string) => () => copyToClipboard(val, label),
        [copyToClipboard],
    );

    const handleCheckHibp = useCallback(async () => {
        setHibp({ checking: true, count: null });
        try { setHibp({ checking: false, count: await checkHIBP(d.password) }); }
        catch { setHibp({ checking: false, count: -1 }); }
    }, [d.password, setHibp]);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {d?.url && <Field label="URL" value={d.url} onCopy={copy(d.url, 'URL')} />}
            {d?.username && <Field label="Username / Email" value={d.username} onCopy={copy(d.username, 'Username')} />}
            {d?.password && <>
                <Field label="Password" value={d.password} secret onCopy={copy(d.password, 'Password')} />
                <HibpCheck hibp={hibp} onCheck={handleCheckHibp} />
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
        </div>
    );
}

function ItemDetailHeader({ item, isMobile, handleToggleFav, handleOpenEdit, handleDelete, deletingId }: Readonly<{
    item: any;
    isMobile?: boolean;
    handleToggleFav: (item: any) => void;
    handleOpenEdit: (item: any) => void;
    handleDelete: (id: string, cb?: () => void) => void;
    deletingId: string | null;
}>) {
    const Icon = CATEGORY_ICONS[item.category] || Globe;
    const iconSize = isMobile ? 48 : 52;
    const btnPad = isMobile ? '8px 10px' : '8px 12px';
    const iconPx = isMobile ? 15 : 16;
    const onFav = useCallback(() => handleToggleFav(item), [handleToggleFav, item]);
    const onEdit = useCallback(() => handleOpenEdit(item), [handleOpenEdit, item]);
    const onDelete = useCallback(() => handleDelete(item.id), [handleDelete, item.id]);

    return (
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: isMobile ? 24 : 32 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 12 : 16 }}>
                <div style={{
                    width: iconSize, height: iconSize, borderRadius: isMobile ? 10 : 12,
                    background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>
                    {item.favicon_url
                        ? <img src={item.favicon_url} alt="" width={iconSize - 22} height={iconSize - 22} />
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

            <div style={{ display: 'flex', gap: isMobile ? 4 : 8 }}>
                <button onClick={onFav} className="btn-ghost" style={{ padding: btnPad }}>
                    <Star size={iconPx}
                        color={item.is_favourite ? 'var(--accent)' : 'var(--text-secondary)'}
                        fill={item.is_favourite ? 'var(--accent)' : 'none'} />
                </button>
                <button onClick={onEdit} className="btn-ghost" style={{ padding: btnPad }}>
                    <Edit2 size={iconPx} />
                </button>
                <button onClick={onDelete} className="btn-ghost"
                    disabled={deletingId === item.id}
                    style={{ padding: btnPad, color: 'var(--danger)', borderColor: 'rgba(239,68,68,0.2)', opacity: deletingId === item.id ? 0.5 : 1 }}>
                    <Trash2 size={iconPx} />
                </button>
            </div>
        </div>
    );
}

interface ItemDetailPanelProps {
    selectedItem: any;
    selectedItemLoading: boolean;
    isMobile?: boolean;
    handleToggleFav: (item: any) => void;
    handleOpenEdit: (item: any) => void;
    handleDelete: (id: string, cb?: () => void) => void;
    deletingId: string | null;
    copyToClipboard: (text: string, label: string) => void;
    hibp: { checking: boolean; count: number | null };
    setHibp: (v: { checking: boolean; count: number | null }) => void;
    onDeleteSuccess?: () => void;
}

function ItemDetailPanel({ selectedItem, selectedItemLoading, isMobile, handleToggleFav, handleOpenEdit, handleDelete, deletingId, copyToClipboard, hibp, setHibp }: Readonly<ItemDetailPanelProps>) {

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
                handleDelete={handleDelete} deletingId={deletingId}
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

function CategoryPill({ id, label, icon: Icon, isActive, onSelect }: Readonly<{
    id: string; label: string; icon: any;
    isActive: boolean; onSelect: (id: string) => void;
}>) {
    const handleClick = useCallback(() => onSelect(id), [onSelect, id]);
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

export function MainDashboard(props: Readonly<any>) {
    const {
        user, category, searchValue, onSearchChange, handleExport, lockVault, handleLogout,
        vaultItems, setShowAddModal, setCategory, selectedItem, handleSelectItem, selectedItemLoading,
        handleToggleFav, handleOpenEdit, handleDelete, deletingId, copyToClipboard,
        hibp, setHibp, showAddModal, newItem, setNewItem, savingItem, genOptions, handleAddItem,
        showEditModal, setShowEditModal, editForm, setEditForm, updatingItem, handleEditItem,
        filteredItems, page, totalPages, onPageChange, isSearchActive, searchLoading,
    } = props;

    const [mobilePanel, setMobilePanel] = useState<'list' | 'detail'>('list');

    const handleSelectItemMobile = useCallback((item: any) => {
        handleSelectItem(item);
        setMobilePanel('detail');
    }, [handleSelectItem]);

    const handleMobileBack = useCallback(() => setMobilePanel('list'), []);
    const handleAddClose = useCallback(() => setShowAddModal(false), [setShowAddModal]);
    const handleEditClose = useCallback(() => { setShowEditModal(false); setEditForm(null); }, [setShowEditModal, setEditForm]);
    const handleOpenAddModal = useCallback(() => setShowAddModal(true), [setShowAddModal]);
    const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => onSearchChange(e.target.value), [onSearchChange]);

    const detailPanelProps: Omit<ItemDetailPanelProps, 'isMobile' | 'handleDelete' | 'onDeleteSuccess'> = {
        selectedItem, selectedItemLoading,
        handleToggleFav, handleOpenEdit, deletingId, copyToClipboard, hibp, setHibp,
    };

    return (
        <div style={{ display: 'flex', height: '100dvh', background: 'var(--bg)', overflow: 'hidden' }}>
            <MobileTopBar
                mobilePanel={mobilePanel} selectedItem={selectedItem}
                onBack={handleMobileBack} lockVault={lockVault} handleLogout={handleLogout}
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
                    {CATEGORIES.map(({ id, label, icon }) => (
                        <CategoryPill key={id} id={id} label={label} icon={icon}
                            isActive={category === id} onSelect={setCategory} />
                    ))}
                </div>

                <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, flexShrink: 0 }}>
                    <div style={{ position: 'relative', flex: 1 }}>
                        <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
                        <input className="input-field" placeholder="Search vault..." value={searchValue}
                            onChange={handleSearchChange} style={{ paddingLeft: 36, fontSize: 'max(16px, 0.9rem)' }} />
                    </div>
                    <button className="btn-primary" onClick={handleOpenAddModal}
                        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 16px', flexShrink: 0 }}>
                        <Plus size={16} />
                    </button>
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
                user={user} category={category} vaultItems={vaultItems}
                setCategory={setCategory} handleExport={handleExport}
                lockVault={lockVault} handleLogout={handleLogout}
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
                    <button className="btn-primary" onClick={handleOpenAddModal}
                        style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                        <Plus size={16} /> Add Item
                    </button>
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
