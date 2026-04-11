'use client';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { toastService } from '@/lib/toast';
import { getItemLoadError, getSessionAwareError, parseApiError } from '@/lib/errors';
import { useAuthStore } from '@/lib/store';
import type { SidebarCounts, VaultItem } from '@/lib/types';
import { vaultApi, authApi } from '@/lib/api';
import { emitAuthEvent, subscribeToAuthEvents } from '@/lib/authSync';
import type { AuthSyncEvent } from '@/lib/authSync';
import { deriveKey, deriveMasterPasswordVerifier, encryptData, decryptData, generateSaltHex } from '@/lib/crypto';
import { Category, genOptions, emptyForm } from '../../../components/dashboard/types';
import type { ItemForm } from '../../../components/dashboard/types';
import { tryGetFaviconUrl, fetchAndDecryptItem, buildPayload } from '../../../components/dashboard/utils';
import { useIdleTimer } from '@/components/dashboard/hooks/useIdleTimer';
import { LockedVaultScreen } from '../../../components/dashboard/LockedVaultScreen';
import { MainDashboard } from '../../../components/dashboard/MainDashboard';
import { SettingsModal } from '@/components/dashboard/SettingsModal';

async function decryptSearchItem(item: VaultItem, key: CryptoKey, storeItems: VaultItem[]): Promise<VaultItem> {
  const cached = storeItems.find((v) => v.id === item.id);
  if (cached?.decrypted) return cached;
  if (!item.encrypted_data) return item;
  try {
    return { ...item, decrypted: await decryptData(item.encrypted_data, key) };
  } catch {
    return item;
  }
}

function toItemFormCategory(category: string): ItemForm['category'] {
  return category === 'card' || category === 'note' || category === 'identity'
    ? category
    : 'login';
}

function rehydrateListItem(item: VaultItem, storeItems: VaultItem[]): VaultItem {
  const cached = storeItems.find((storeItem) => storeItem.id === item.id);
  return cached?.decrypted ? { ...item, decrypted: cached.decrypted } : item;
}

const EMPTY_SIDEBAR_COUNTS: SidebarCounts = {
  all: 0,
  login: 0,
  card: 0,
  note: 0,
  identity: 0,
  favourites: 0,
  trash: 0,
};

type ViewRequest = {
  category: Category;
  deletedOnly: boolean;
  favouritesOnly: boolean;
};

const PAGE_SIZE = 50;

function FullScreenMessage({ message }: Readonly<{ message: string }>) {
  return (
    <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
      <div style={{ color: 'var(--text-secondary)', fontSize: 14 }}>{message}</div>
    </div>
  );
}

type CachedViewKey = 'all' | 'favourites' | 'trash';

type CachedViewState = {
  items: VaultItem[];
  page: number;
  totalPages: number;
  totalItems: number;
};

function buildViewRequest(category: Category, isFavouritesView: boolean, isTrashView: boolean): ViewRequest {
  if (isTrashView) {
    return { category: 'all', deletedOnly: true, favouritesOnly: false };
  }
  if (isFavouritesView) {
    return { category: 'all', deletedOnly: false, favouritesOnly: true };
  }
  return { category, deletedOnly: false, favouritesOnly: false };
}

function getViewCacheKey(view: ViewRequest): CachedViewKey | `category:${Exclude<Category, 'all'>}` {
  if (view.deletedOnly) return 'trash';
  if (view.favouritesOnly) return 'favourites';
  return view.category === 'all' ? 'all' : `category:${view.category}`;
}

function sortByUpdatedDesc(items: VaultItem[]): VaultItem[] {
  return [...items].sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
}

function itemMatchesView(item: VaultItem, view: ViewRequest): boolean {
  if (view.deletedOnly) return Boolean(item.is_deleted);
  if (item.is_deleted) return false;
  if (view.favouritesOnly && !item.is_favourite) return false;
  return view.category === 'all' || item.category === view.category;
}

function itemMatchesSearch(item: VaultItem, term: string): boolean {
  if (!term) return true;
  return item.name.toLowerCase().includes(term.toLowerCase());
}

function reconcileVisibleItems(
  items: VaultItem[],
  before: VaultItem | null,
  after: VaultItem | null,
  view: ViewRequest,
  searchTerm: string,
  page: number,
): VaultItem[] {
  const existing = items.find((item) => item.id === before?.id || item.id === after?.id);
  let nextItems = before
    ? items.filter((item) => item.id !== before.id)
    : [...items];

  if (
    after &&
    itemMatchesView(after, view) &&
    itemMatchesSearch(after, searchTerm) &&
    (page === 1 || Boolean(existing))
  ) {
    nextItems = sortByUpdatedDesc([after, ...nextItems]);
  }

  return page === 1 ? nextItems.slice(0, PAGE_SIZE) : nextItems;
}

function computeTotalPages(totalItems: number): number {
  return totalItems === 0 ? 0 : Math.ceil(totalItems / PAGE_SIZE);
}

function getViewTotalCount(view: ViewRequest, counts: SidebarCounts): number {
  if (view.deletedOnly) return counts.trash;
  if (view.favouritesOnly) return counts.favourites;
  if (view.category === 'all') return counts.all;
  return counts[view.category];
}

function applySidebarDelta(counts: SidebarCounts, before: VaultItem | null, after: VaultItem | null): SidebarCounts {
  const next = { ...counts };

  const applyItem = (item: VaultItem, direction: 1 | -1) => {
    if (item.is_deleted) {
      next.trash += direction;
      return;
    }

    next.all += direction;
    if (item.category === 'login' || item.category === 'card' || item.category === 'note' || item.category === 'identity') {
      next[item.category] += direction;
    }
    if (item.is_favourite) {
      next.favourites += direction;
    }
  };

  if (before) applyItem(before, -1);
  if (after) applyItem(after, 1);

  return {
    all: Math.max(0, next.all),
    login: Math.max(0, next.login),
    card: Math.max(0, next.card),
    note: Math.max(0, next.note),
    identity: Math.max(0, next.identity),
    favourites: Math.max(0, next.favourites),
    trash: Math.max(0, next.trash),
  };
}

// Vault unlock sub-hook
function useVaultUnlock(
  user: { vault_salt?: string } | null,
  setVaultKey: (k: CryptoKey) => void,
  setVaultItems: (items: VaultItem[]) => void,
  setTotalPages: (n: number) => void,
  setTotalItems: (n: number) => void,
  setSidebarCounts: (counts: SidebarCounts) => void,
  cacheAllView: (items: VaultItem[], totalPages: number, totalItems: number) => void,
) {
  const [masterPassword, setMasterPassword] = useState('');
  const [unlocking, setUnlocking] = useState(false);
  const unlockVault = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    setUnlocking(true);
    try {
      await toastService.withProgress(
        'Unlocking vault...',
        async (update) => {
          const salt = user?.vault_salt;
          if (!salt) throw new Error('NO_SALT');
          const key = await deriveKey(masterPassword, salt);
          const verifier = await deriveMasterPasswordVerifier(masterPassword, salt);
          update('Unlocking vault...');
          const { data: listResult } = await authApi.unlock(verifier);
          const items: VaultItem[] = listResult.items;
          setVaultKey(key);
          update('Decrypting items...');
          const decryptedItems = await Promise.all(
            items.map(async (item) => {
              if (!item.encrypted_data) return item;
              try {
                return { ...item, decrypted: await decryptData(item.encrypted_data, key) };
              } catch {
                return item;
              }
            }),
          );
          setVaultItems(decryptedItems);
          setTotalPages(listResult.total_pages ?? 1);
          setTotalItems(listResult.total ?? 0);
          if (listResult.sidebar_counts) {
            setSidebarCounts(listResult.sidebar_counts);
          }
          cacheAllView(
            decryptedItems,
            listResult.total_pages ?? 1,
            listResult.total ?? 0,
          );
          setMasterPassword('');
        },
        'Vault unlocked',
        {
          getError: (err: unknown) => {
            const e = err as Error;
            const apiMessage = parseApiError(err, '');
            if (e?.message === 'WRONG_PASSWORD' || apiMessage === 'Invalid master password') {
              return 'Wrong master password';
            }
            if (e?.message === 'NO_SALT') return 'Session error - please sign out and sign in again';
            if ((err as { response?: { status?: number } })?.response?.status === 401) {
              return getSessionAwareError(err, 'Session expired - please sign in again');
            }
            console.error('[unlock] Error:', err);
            return parseApiError(err, 'Failed to unlock vault');
          },
        },
      );
    } finally {
      setUnlocking(false);
    }
  };
  return { masterPassword, setMasterPassword, unlocking, unlockVault };
}

export default function Page() {
  const router = useRouter();
  const {
    user, cryptoKey, isAuthenticated, vaultItems, isVaultLocked,
    setUser, setVaultKey, setVaultItems, updateVaultItem,
    logout, lockVault, restoreSession,
  } = useAuthStore();
  const [category, setCategory] = useState<Category>('all');
  const [search, setSearch] = useState('');
  const [isFavouritesView, setIsFavouritesView] = useState(false);
  const [isTrashView, setIsTrashView] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [selectedItem, setSelectedItem] = useState<VaultItem | null>(null);
  const [newItem, setNewItem] = useState<ItemForm>({ ...emptyForm });
  const [sessionLoading, setSessionLoading] = useState(true);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editForm, setEditForm] = useState<ItemForm | null>(null);
  const [savingItem, setSavingItem] = useState(false);
  const [updatingItem, setUpdatingItem] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [selectedItemLoading, setSelectedItemLoading] = useState(false);
  const [searchResults, setSearchResults] = useState<VaultItem[] | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [listLoading, setListLoading] = useState(false);
  const [hibp, setHibp] = useState<{ checking: boolean; count: number | null }>({ checking: false, count: null });
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState<number | null>(null);
  const [sidebarCounts, setSidebarCounts] = useState<SidebarCounts>(EMPTY_SIDEBAR_COUNTS);
  const [profileForm, setProfileForm] = useState({ full_name: '', master_hint: '' });
  const [masterPasswordForm, setMasterPasswordForm] = useState({ password: '', confirm: '', master_hint: '' });
  const [deletePassword, setDeletePassword] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [verificationSending, setVerificationSending] = useState(false);
  const [masterPasswordSaving, setMasterPasswordSaving] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);
  const decryptingItemIds = useRef(new Set<string>());
  const currentSelectionRef = useRef<string | null>(null);
  const viewCacheRef = useRef<Record<string, CachedViewState>>({});
  const shouldRestoreActiveViewRef = useRef(false);
  const listRequestIdRef = useRef(0);
  const inFlightViewLoadsRef = useRef<Record<string, Promise<CachedViewState & { sidebarCounts?: SidebarCounts | null }>>>({});
  const setCachedView = useCallback((key: string, items: VaultItem[], currentPage: number, nextTotalPages: number, nextTotalItems: number) => {
    viewCacheRef.current[key] = {
      items,
      page: currentPage,
      totalPages: nextTotalPages,
      totalItems: nextTotalItems,
    };
  }, []);
  const invalidateCachedViews = useCallback((exceptKey?: string) => {
    if (!exceptKey) {
      viewCacheRef.current = {};
      return;
    }
    const preserved = viewCacheRef.current[exceptKey];
    viewCacheRef.current = preserved ? { [exceptKey]: preserved } : {};
  }, []);
  const restoreCachedView = useCallback((key: string) => {
    const cached = viewCacheRef.current[key];
    if (!cached) return false;
    setVaultItems(cached.items);
    setPage(cached.page);
    setTotalPages(cached.totalPages);
    setTotalItems(cached.totalItems);
    decryptingItemIds.current.clear();
    setSelectedItem(null);
    return true;
  }, [setVaultItems]);
  const applyResolvedView = useCallback((view: ViewRequest, nextState: CachedViewState) => {
    setVaultItems(nextState.items);
    setPage(nextState.page);
    setTotalPages(nextState.totalPages);
    setTotalItems(nextState.totalItems);
    setCachedView(
      getViewCacheKey(view),
      nextState.items,
      nextState.page,
      nextState.totalPages,
      nextState.totalItems,
    );
    decryptingItemIds.current.clear();
    setSelectedItem(null);
  }, [setCachedView, setVaultItems]);
  const getCompleteAllViewItems = useCallback(() => {
    const cachedAllView = viewCacheRef.current.all;
    if (!cachedAllView) return null;
    if (cachedAllView.page !== 1) return null;
    if (cachedAllView.totalItems !== sidebarCounts.all) return null;
    if (cachedAllView.items.length !== cachedAllView.totalItems) return null;
    return cachedAllView.items;
  }, [sidebarCounts.all]);
  const hydrateViewFromLocalData = useCallback((view: ViewRequest) => {
    const totalCount = getViewTotalCount(view, sidebarCounts);
    if (totalCount === 0) {
      applyResolvedView(view, {
        items: [],
        page: 1,
        totalPages: 0,
        totalItems: 0,
      });
      return true;
    }
    if (view.deletedOnly) return false;

    const allItems = getCompleteAllViewItems();
    if (!allItems) return false;

    const matchingItems = sortByUpdatedDesc(allItems.filter((item) => itemMatchesView(item, view)));
    applyResolvedView(view, {
      items: matchingItems.slice(0, PAGE_SIZE),
      page: 1,
      totalPages: computeTotalPages(matchingItems.length),
      totalItems: matchingItems.length,
    });
    return true;
  }, [applyResolvedView, getCompleteAllViewItems, sidebarCounts]);
  const restoreOrHydrateView = useCallback((view: ViewRequest) => {
    const cacheKey = getViewCacheKey(view);
    if (restoreCachedView(cacheKey)) return true;
    return hydrateViewFromLocalData(view);
  }, [hydrateViewFromLocalData, restoreCachedView]);
  const { masterPassword, setMasterPassword, unlocking, unlockVault } =
    useVaultUnlock(
      user,
      setVaultKey,
      setVaultItems,
      setTotalPages,
      setTotalItems,
      setSidebarCounts,
      (items, nextTotalPages, nextTotalItems) => setCachedView('all', items, 1, nextTotalPages, nextTotalItems),
    );

  const getCurrentView = useCallback(
    (overrides: Partial<ViewRequest> = {}): ViewRequest => ({
      ...buildViewRequest(category, isFavouritesView, isTrashView),
      ...overrides,
    }),
    [category, isFavouritesView, isTrashView],
  );

  const applyOptimisticMutation = useCallback((
    before: VaultItem | null,
    after: VaultItem | null,
    view = getCurrentView(),
  ) => {
    const activeSearch = search.trim().toLowerCase();
    const previousVisibleMatch = before ? itemMatchesView(before, view) && itemMatchesSearch(before, activeSearch) : false;
    const nextVisibleMatch = after ? itemMatchesView(after, view) && itemMatchesSearch(after, activeSearch) : false;
    const totalDelta = (nextVisibleMatch ? 1 : 0) - (previousVisibleMatch ? 1 : 0);
    const nextTotalItems = Math.max(0, (totalItems ?? 0) + totalDelta);
    const nextTotalPages = computeTotalPages(nextTotalItems);

    setSidebarCounts((current) => applySidebarDelta(current, before, after));
    setTotalItems(nextTotalItems);
    setTotalPages(nextTotalPages);
    if (nextTotalPages === 0) {
      setPage(1);
    } else if (page > nextTotalPages) {
      setPage(nextTotalPages);
    }

    if (activeSearch) {
      setSearchResults((current) => (
        current
          ? reconcileVisibleItems(current, before, after, view, activeSearch, page)
          : current
      ));
      invalidateCachedViews();
      return;
    }

    const nextItems = reconcileVisibleItems(vaultItems, before, after, view, '', page);
    setVaultItems(nextItems);
    invalidateCachedViews(getViewCacheKey(view));
    setCachedView(
      getViewCacheKey(view),
      nextItems,
      nextTotalPages > 0 ? Math.min(page, nextTotalPages) : 1,
      nextTotalPages,
      nextTotalItems,
    );
  }, [getCurrentView, invalidateCachedViews, page, search, setCachedView, setVaultItems, totalItems, vaultItems]);

  const getKnownItemById = useCallback((id: string) => {
    if (selectedItem?.id === id) return selectedItem;
    return (searchResults ?? vaultItems).find((item) => item.id === id) ?? null;
  }, [searchResults, selectedItem, vaultItems]);

  // Idle auto-lock (extracted hook)
  const handleLockVault = useCallback(() => {
    lockVault();
    emitAuthEvent('lock');
  }, [lockVault]);

  useIdleTimer(isVaultLocked, handleLockVault);
  // Session restore
  useEffect(() => {
    let active = true;

    if (isAuthenticated) {
      setSessionLoading(false);
      return () => {
        active = false;
      };
    }

    void restoreSession().then((ok) => {
      if (!active) return;
      setSessionLoading(false);
      if (ok) return;
      router.replace('/auth');
    });

    return () => {
      active = false;
    };
  }, [isAuthenticated, restoreSession, router]);

  useEffect(() => {
    return subscribeToAuthEvents((event: AuthSyncEvent) => {
      if (event.type === 'logout') {
        logout();
        router.replace('/auth');
        return;
      }

      if (event.type === 'lock') {
        lockVault();
        return;
      }

      if (event.type === 'user-updated') {
        if (event.user) {
          setUser(event.user);
          return;
        }
        void authApi.me()
          .then(({ data }) => setUser(data))
          .catch(() => {
            // Ignore transient sync failures; the next restore/me path will recover.
          });
      }
    });
  }, [lockVault, logout, router, setUser]);

  useEffect(() => {
    if (isVaultLocked) {
      shouldRestoreActiveViewRef.current = true;
      listRequestIdRef.current += 1;
      inFlightViewLoadsRef.current = {};
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
      searchAbortRef.current?.abort();
      setSearch('');
      setSearchResults(null);
      setListLoading(false);
      setSidebarCounts(EMPTY_SIDEBAR_COUNTS);
      viewCacheRef.current = {};
      decryptingItemIds.current.clear();
      currentSelectionRef.current = null;
    }
  }, [isVaultLocked]);

  useEffect(() => {
    setProfileForm({
      full_name: user?.full_name ?? '',
      master_hint: user?.master_hint ?? '',
    });
    setMasterPasswordForm((prev) => ({ ...prev, master_hint: user?.master_hint ?? '' }));
  }, [user]);

  useEffect(() => {
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
      searchAbortRef.current?.abort();
    };
  }, []);

  const fetchVaultPage = useCallback(async (
    requestedPage: number,
    view: ViewRequest,
  ): Promise<CachedViewState & { sidebarCounts?: SidebarCounts | null }> => {
    const requestKey = `${getViewCacheKey(view)}:${requestedPage}`;
    const existingRequest = inFlightViewLoadsRef.current[requestKey];
    if (existingRequest !== undefined) return await existingRequest;

    const requestPromise = (async () => {
      const params: {
        category?: Exclude<Category, 'all'>;
        deleted_only: boolean;
        favourites_only: boolean;
        page: number;
        page_size: number;
      } = {
        page: requestedPage,
        page_size: PAGE_SIZE,
        deleted_only: view.deletedOnly,
        favourites_only: view.deletedOnly ? false : view.favouritesOnly,
      };
      if (!view.deletedOnly && !view.favouritesOnly && view.category !== 'all') {
        params.category = view.category;
      }

      const { data } = await vaultApi.list(params);
      if (data.total_pages > 0 && requestedPage > data.total_pages) {
        return fetchVaultPage(data.total_pages, view);
      }

      const { vaultItems: storeItems } = useAuthStore.getState();
      return {
        items: data.items.map((item: VaultItem) => rehydrateListItem(item, storeItems)),
        page: data.total_pages > 0 ? requestedPage : 1,
        totalPages: data.total_pages ?? 0,
        totalItems: data.total ?? 0,
        sidebarCounts: data.sidebar_counts,
      };
    })();

    inFlightViewLoadsRef.current[requestKey] = requestPromise;
    try {
      return await requestPromise;
    } finally {
      delete inFlightViewLoadsRef.current[requestKey];
    }
  }, []);

  const loadVaultPage = useCallback(async (
    newPage: number,
    view: ViewRequest = buildViewRequest(category, isFavouritesView, isTrashView),
  ) => {
    const requestId = ++listRequestIdRef.current;
    setListLoading(true);
    try {
      const nextState = await fetchVaultPage(newPage, view);
      if (requestId !== listRequestIdRef.current) return;
      if (nextState.sidebarCounts) {
        setSidebarCounts(nextState.sidebarCounts);
      }
      applyResolvedView(view, nextState);
    } finally {
      if (requestId === listRequestIdRef.current) {
        setListLoading(false);
      }
    }
  }, [applyResolvedView, category, fetchVaultPage, isFavouritesView, isTrashView]);

  useEffect(() => {
    if (isVaultLocked || !shouldRestoreActiveViewRef.current) {
      return;
    }

    shouldRestoreActiveViewRef.current = false;
    const view = getCurrentView();
    if (!view.deletedOnly && !view.favouritesOnly && view.category === 'all') {
      return;
    }

    if (restoreOrHydrateView(view)) {
      return;
    }

    void loadVaultPage(1, view).catch((err) => {
      toastService.error(getSessionAwareError(err, 'Vault is temporarily unavailable'));
      console.error('[unlock-view-restore] Failed to restore active view', err);
    });
  }, [getCurrentView, isVaultLocked, loadVaultPage, restoreOrHydrateView]);

  const runSearch = useCallback(async (
    term: string,
    signal?: AbortSignal,
    view: ViewRequest = buildViewRequest(category, isFavouritesView, isTrashView),
  ) => {
    setSearchLoading(true);
    try {
      const params: {
        category?: Exclude<Category, 'all'>;
        search: string;
        deleted_only: boolean;
        favourites_only: boolean;
      } = {
        search: term,
        deleted_only: view.deletedOnly,
        favourites_only: view.deletedOnly ? false : view.favouritesOnly,
      };
      if (!view.deletedOnly && !view.favouritesOnly && view.category !== 'all') {
        params.category = view.category;
      }

      const { data } = await vaultApi.list(params, signal);
      if (signal?.aborted) return;

      const { cryptoKey: key, vaultItems: storeItems } = useAuthStore.getState();
      const resultsWithCachedData = data.items.map((item: VaultItem) => rehydrateListItem(item, storeItems));
      const hydratedResults = key
        ? await Promise.all(resultsWithCachedData.map((item) => decryptSearchItem(item, key, storeItems)))
        : resultsWithCachedData;
      if (!signal?.aborted) {
        setSearchResults(hydratedResults);
      }
    } catch (err: unknown) {
      const e = err as { code?: string; name?: string };
      if (e?.code !== 'ERR_CANCELED' && e?.name !== 'AbortError') {
        console.error('Search error:', err);
      }
    } finally {
      setSearchLoading(false);
    }
  }, [category, isFavouritesView, isTrashView]);

  const refreshCurrentView = useCallback(async (
    targetPage = page,
    view = getCurrentView(),
  ) => {
    if (search.trim()) {
      await runSearch(search, undefined, view);
      return;
    }
    await loadVaultPage(targetPage, view);
  }, [getCurrentView, loadVaultPage, page, runSearch, search]);

  const buildEncryptedPayload = useCallback(async (form: ItemForm) => {
    if (!cryptoKey) throw new Error('Crypto key not available');
    const payload = buildPayload(form);
    const encrypted_data = await encryptData(payload, cryptoKey);
    return { payload, encrypted_data };
  }, [cryptoKey]);

  const handleLogout = useCallback(async () => {
    try { await authApi.logout(); } catch { /* ignore network errors on logout */ }
    logout();
    emitAuthEvent('logout');
    router.replace('/auth');
  }, [logout, router]);

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
    if (cached?.decrypted) { setSelectedItem(cached); return; }
    if (item.decrypted || !liveKey) return;
    if (decryptingItemIds.current.has(item.id)) return;
    decryptingItemIds.current.add(item.id);
    setSelectedItemLoading(true);
    try {
      const enriched = await fetchAndDecryptItem(item, liveKey, updateVaultItem);
      if (currentSelectionRef.current === item.id) setSelectedItem(enriched);
    } catch (err: unknown) {
      console.error('[handleSelectItem] Failed for item', item.id, err);
      toastService.error(getItemLoadError(err));
      decryptingItemIds.current.delete(item.id);
    } finally {
      if (currentSelectionRef.current === item.id) setSelectedItemLoading(false);
    }
  }, [updateVaultItem]);

  // Debounced search
  const handleSearchChange = useCallback((val: string) => {
    setSearch(val);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchAbortRef.current?.abort();
    if (!val) {
      setSearchResults(null);
      setSearchLoading(false);
      const view = getCurrentView();
      if (!restoreOrHydrateView(view)) {
        void loadVaultPage(1, view);
      }
      return;
    }
    if (totalItems === 0) { setSearchResults([]); return; }
    searchDebounceRef.current = setTimeout(async () => {
      const controller = new AbortController();
      searchAbortRef.current = controller;
      await runSearch(val, controller.signal);
    }, 300);
  }, [getCurrentView, loadVaultPage, restoreOrHydrateView, runSearch, totalItems]);

  const handleAddItem = useCallback(async (e: React.SyntheticEvent) => {
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
          const { encrypted_data, payload } = await buildEncryptedPayload(newItem);
          const favicon_url = newItem.url ? tryGetFaviconUrl(newItem.url) : undefined;
          const { data } = await vaultApi.create({ name: newItem.name, category: newItem.category, encrypted_data, favicon_url });
          applyOptimisticMutation(null, { ...data, decrypted: payload });
          setShowAddModal(false);
          setNewItem({ ...emptyForm });
        },
        'Item added to vault',
        { fallbackError: 'Failed to save item' },
      );
    } finally { setSavingItem(false); }
  }, [applyOptimisticMutation, cryptoKey, newItem, buildEncryptedPayload]);

  const handleOpenEdit = useCallback((item: VaultItem) => {
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
          const previousItem = selectedItem;
          const { payload, encrypted_data } = await buildEncryptedPayload(editForm);
          const favicon_url = editForm.url
            ? (tryGetFaviconUrl(editForm.url) ?? selectedItem.favicon_url)
            : selectedItem.favicon_url;
          const { data } = await vaultApi.update(selectedItem.id, { name: editForm.name, category: editForm.category, encrypted_data, favicon_url });
          const updated = { ...data, decrypted: payload };
          updateVaultItem(selectedItem.id, updated);
          if (itemMatchesView(updated, getCurrentView()) && itemMatchesSearch(updated, search.trim().toLowerCase())) {
            setSelectedItem(updated);
          } else {
            setSelectedItem(null);
          }
          applyOptimisticMutation(previousItem, updated);
          setShowEditModal(false);
          setEditForm(null);
        },
        'Item updated',
        { fallbackError: 'Failed to update item' },
      );
    } finally { setUpdatingItem(false); }
  }, [applyOptimisticMutation, buildEncryptedPayload, cryptoKey, editForm, getCurrentView, search, selectedItem, updateVaultItem]);

  const handleDelete = useCallback(async (id: string, onAfterDelete?: () => void) => {
    if (deletingId) return;
    setDeletingId(id);
    try {
      await toastService.withProgress(
        'Moving item to trash...',
        async () => {
          const previousItem = getKnownItemById(id);
          await vaultApi.delete(id);
          if (previousItem) {
            applyOptimisticMutation(previousItem, {
              ...previousItem,
              is_deleted: true,
              deleted_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            });
          } else {
            await refreshCurrentView(page);
          }
          if (selectedItem?.id === id) {
            setSelectedItem(null);
            onAfterDelete?.();
          }
        },
        'Moved item to trash',
        { fallbackError: 'Failed to move item to trash' },
      );
    } finally { setDeletingId(null); }
  }, [applyOptimisticMutation, deletingId, getKnownItemById, page, refreshCurrentView, selectedItem]);

  const handleToggleFav = useCallback(async (item: VaultItem) => {
    const adding = !item.is_favourite;
    await toastService.withProgress(
      adding ? 'Adding to favourites...' : 'Removing from favourites...',
      async () => {
        const previousItem = selectedItem?.id === item.id ? selectedItem : item;
        await vaultApi.update(item.id, { is_favourite: adding });
        const updated = { ...previousItem, is_favourite: adding, updated_at: new Date().toISOString() };
        updateVaultItem(item.id, updated);
        if (selectedItem?.id === item.id && (!isFavouritesView || adding)) setSelectedItem(updated);
        if (isFavouritesView && !adding && selectedItem?.id === item.id) {
          setSelectedItem(null);
        }
        applyOptimisticMutation(previousItem, updated);
      },
      adding ? 'Added to favourites' : 'Removed from favourites',
      { fallbackError: 'Failed to update favourite' },
    );
  }, [applyOptimisticMutation, isFavouritesView, selectedItem, updateVaultItem]);

  const copyToClipboard = useCallback(async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toastService.success(`${label} copied!`);
    } catch {
      toastService.error(`Failed to copy ${label.toLowerCase()}`);
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

  const handleSaveProfile = useCallback(async (e: React.SyntheticEvent) => {
    e.preventDefault();
    setProfileSaving(true);
    try {
      const { data } = await authApi.updateProfile({
        full_name: profileForm.full_name || null,
        master_hint: profileForm.master_hint || null,
      });
      setUser(data);
      emitAuthEvent('user-updated', data);
      toastService.success('Profile updated');
    } catch (err) {
      toastService.error(getSessionAwareError(err, 'Failed to update profile'));
    } finally {
      setProfileSaving(false);
    }
  }, [profileForm, setUser]);

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

  const handleChangeMasterPassword = useCallback(async (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (!cryptoKey || !user) {
      toastService.error('Unlock the vault before changing the master password');
      return;
    }
    if (!masterPasswordForm.password || masterPasswordForm.password !== masterPasswordForm.confirm) {
      toastService.error('Master password confirmation does not match');
      return;
    }

    setMasterPasswordSaving(true);
    try {
      const newSalt = generateSaltHex();
      const nextKey = await deriveKey(masterPasswordForm.password, newSalt);
      const nextVerifier = await deriveMasterPasswordVerifier(masterPasswordForm.password, newSalt);
      const { data } = await vaultApi.export();
      const items = await Promise.all(
        (data.items as Array<{ id: string; encrypted_data: string }>).map(async (item) => {
          const payload = await decryptData(item.encrypted_data, cryptoKey);
          const encrypted_data = await encryptData(payload, nextKey);
          return { id: item.id, encrypted_data };
        }),
      );
      const { data: updatedUser } = await authApi.changeMasterPassword({
        new_vault_salt: newSalt,
        new_master_password_verifier: nextVerifier,
        master_hint: masterPasswordForm.master_hint || null,
        items,
      });
      setUser(updatedUser);
      emitAuthEvent('user-updated', updatedUser);
      setMasterPasswordForm({ password: '', confirm: '', master_hint: updatedUser.master_hint ?? '' });
      lockVault();
      emitAuthEvent('lock');
      setShowSettingsModal(false);
      toastService.success('Master password changed. Unlock with the new password.');
    } catch (err) {
      toastService.error(getSessionAwareError(err, 'Failed to change master password'));
    } finally {
      setMasterPasswordSaving(false);
    }
  }, [cryptoKey, lockVault, masterPasswordForm, setUser, user]);

  const handleDeleteAccount = useCallback(async (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (!deletePassword) {
      toastService.error('Enter your master password to delete the account');
      return;
    }
    if (!user?.vault_salt) {
      toastService.error('Session error - please sign out and sign in again');
      return;
    }
    setDeletingAccount(true);
    try {
      const verifier = await deriveMasterPasswordVerifier(deletePassword, user.vault_salt);
      await authApi.deleteAccount(verifier);
      emitAuthEvent('logout');
      logout();
      router.replace('/auth');
    } catch (err) {
      toastService.error(getSessionAwareError(err, 'Failed to delete account'));
    } finally {
      setDeletingAccount(false);
    }
  }, [deletePassword, logout, router, user]);

  const handleRestoreItem = useCallback(async (id: string) => {
    await toastService.withProgress(
      'Restoring item...',
      async () => {
        const previousItem = getKnownItemById(id);
        const { data } = await vaultApi.restore(id);
        if (selectedItem?.id === id) {
          setSelectedItem(null);
        }
        if (previousItem) {
          applyOptimisticMutation(previousItem, data);
        } else {
          await refreshCurrentView(page);
        }
      },
      'Restored item',
      { fallbackError: 'Failed to restore item' },
    );
  }, [applyOptimisticMutation, getKnownItemById, page, refreshCurrentView, selectedItem]);

  const handleDeletePermanent = useCallback(async (id: string) => {
    if (deletingId) return;
    setDeletingId(id);
    try {
      await toastService.withProgress(
        'Item deleting permanently...',
        async () => {
          const previousItem = getKnownItemById(id);
          await vaultApi.deletePermanent(id);
          if (selectedItem?.id === id) setSelectedItem(null);
          if (previousItem) {
            applyOptimisticMutation(previousItem, null);
          } else {
            await refreshCurrentView(page);
          }
        },
        'Item permanently deleted',
        { fallbackError: 'Failed to permanently delete item' },
      );
    } finally {
      setDeletingId(null);
    }
  }, [applyOptimisticMutation, deletingId, getKnownItemById, page, refreshCurrentView, selectedItem]);

  const handlePageChange = useCallback(async (newPage: number) => {
    try {
      await loadVaultPage(newPage);
    } catch (err) {
      console.error('[pagination] Failed to load page', newPage, err);
    }
  }, [loadVaultPage]);

  const handleCategoryChange = useCallback(async (nextCategory: Category) => {
    const previousCategory = category;
    const previousIsFavouritesView = isFavouritesView;
    const previousIsTrashView = isTrashView;
    const nextView = buildViewRequest(nextCategory, false, false);
    setCategory(nextCategory);
    setIsFavouritesView(false);
    setIsTrashView(false);
    setSearch('');
    setSearchResults(null);
    if (restoreCachedView(getViewCacheKey(nextView))) return;
    try {
      await loadVaultPage(1, nextView);
    } catch (err) {
      setCategory(previousCategory);
      setIsFavouritesView(previousIsFavouritesView);
      setIsTrashView(previousIsTrashView);
      toastService.error(getSessionAwareError(err, 'Vault is temporarily unavailable'));
      console.error('[category] Failed to switch view', err);
    }
  }, [category, isFavouritesView, isTrashView, loadVaultPage, restoreCachedView]);

  const handleToggleFavourites = useCallback(async () => {
    const previousIsFavouritesView = isFavouritesView;
    const previousIsTrashView = isTrashView;
    const next = !isFavouritesView;
    const nextView = buildViewRequest(category, next, false);
    setIsFavouritesView(next);
    setIsTrashView(false);
    setSearch('');
    setSearchResults(null);
    if (restoreCachedView(getViewCacheKey(nextView))) return;
    try {
      await loadVaultPage(1, nextView);
    } catch (err) {
      setIsFavouritesView(previousIsFavouritesView);
      setIsTrashView(previousIsTrashView);
      toastService.error(getSessionAwareError(err, 'Vault is temporarily unavailable'));
      console.error('[favourites] Failed to switch view', err);
    }
  }, [category, isFavouritesView, isTrashView, loadVaultPage, restoreCachedView]);

  const handleToggleTrash = useCallback(async () => {
    const previousIsTrashView = isTrashView;
    const previousIsFavouritesView = isFavouritesView;
    const next = !isTrashView;
    const nextView = buildViewRequest(category, false, next);
    setIsTrashView(next);
    setIsFavouritesView(false);
    setSearch('');
    setSearchResults(null);
    if (!next && restoreCachedView(getViewCacheKey(nextView))) return;
    try {
      await loadVaultPage(1, nextView);
    } catch (err) {
      setIsTrashView(previousIsTrashView);
      setIsFavouritesView(previousIsFavouritesView);
      toastService.error(getSessionAwareError(err, 'Vault is temporarily unavailable'));
      console.error('[trash] Failed to switch view', err);
    }
  }, [category, isFavouritesView, isTrashView, loadVaultPage, restoreCachedView]);

  const handleOpenSettings = useCallback(() => setShowSettingsModal(true), []);
  const handleCloseSettings = useCallback(() => setShowSettingsModal(false), []);

  const filteredItems = searchResults ?? vaultItems;

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
        user={user}
        category={category}
        setCategory={handleCategoryChange}
        searchValue={search}
        onSearchChange={handleSearchChange}
        handleExport={handleExport}
        onOpenSettings={handleOpenSettings}
        onToggleFavourites={handleToggleFavourites}
        onToggleTrash={handleToggleTrash}
        isFavouritesView={isFavouritesView}
        isTrashView={isTrashView}
        lockVault={handleLockVault}
        handleLogout={handleLogout}
        vaultItems={vaultItems}
        sidebarCounts={sidebarCounts}
        selectedItem={selectedItem}
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
        genOptions={genOptions}
        handleAddItem={handleAddItem}
        showEditModal={showEditModal}
        setShowEditModal={setShowEditModal}
        editForm={editForm}
        setEditForm={setEditForm}
        updatingItem={updatingItem}
        handleEditItem={handleEditItem}
        filteredItems={filteredItems}
        page={page}
        totalPages={totalPages}
        onPageChange={handlePageChange}
        isSearchActive={searchResults !== null}
        searchLoading={searchLoading || listLoading}
      />
      {showSettingsModal && (
        <SettingsModal
          user={user}
          profileForm={profileForm}
          setProfileForm={setProfileForm}
          masterPasswordForm={masterPasswordForm}
          setMasterPasswordForm={setMasterPasswordForm}
          deletePassword={deletePassword}
          setDeletePassword={setDeletePassword}
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
    </>
  );
}
