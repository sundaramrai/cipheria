'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getSessionAwareError } from '@/lib/errors';
import { useAuthStore } from '@/lib/store';
import { toastService } from '@/lib/toast';
import type { SidebarCounts, VaultItem } from '@/lib/types';
import type { Category } from '../types';
import {
  EMPTY_SIDEBAR_COUNTS, PAGE_SIZE, buildViewRequest, computeTotalPages,
  getViewCacheKey, getViewTotalCount, itemMatchesView, rehydrateListItem,
  requestVaultPage, sortByUpdatedDesc,
} from '../vaultView';
import type { CachedViewState, ViewRequest } from '../vaultView';

type VaultViewOptions = {
  isAuthenticated: boolean;
  isVaultLocked: boolean;
  setVaultItems: (items: VaultItem[]) => void;
  clearSelection: () => void;
};

type LoadedViewState = CachedViewState & { sidebarCounts?: SidebarCounts | null };
export type ViewMode = 'category' | 'favourites' | 'trash';

export function useVaultViews({ isAuthenticated, isVaultLocked, setVaultItems, clearSelection }: VaultViewOptions) {
  const [category, setCategory] = useState<Category>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('category');
  const isFavouritesView = viewMode === 'favourites';
  const isTrashView = viewMode === 'trash';
  const [listLoading, setListLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState<number | null>(null);
  const [sidebarCounts, setSidebarCounts] = useState<SidebarCounts>(EMPTY_SIDEBAR_COUNTS);
  const [search, setSearch] = useState('');
  const viewCacheRef = useRef<Record<string, CachedViewState>>({});
  const normalItemsRef = useRef<VaultItem[] | null>(null);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);
  const shouldRestoreActiveViewRef = useRef(false);
  const listRequestIdRef = useRef(0);
  const inFlightViewLoadsRef = useRef<Record<string, Promise<LoadedViewState>>>({});

  const getCurrentView = useCallback(
    (overrides: Partial<ViewRequest> = {}): ViewRequest => ({
      ...buildViewRequest(category, isFavouritesView, isTrashView),
      ...overrides,
    }),
    [category, isFavouritesView, isTrashView],
  );

  const setCachedView = useCallback((key: string, state: CachedViewState) => {
    viewCacheRef.current[key] = state;
  }, []);

  const cacheAllView = useCallback((items: VaultItem[], nextTotalPages: number, nextTotalItems: number) => {
    setCachedView('all', { items, page: 1, totalPages: nextTotalPages, totalItems: nextTotalItems });
  }, [setCachedView]);

  const invalidateCachedViews = useCallback((exceptKey?: string) => {
    normalItemsRef.current = null;
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
    clearSelection();
    return true;
  }, [clearSelection, setVaultItems]);

  const applyResolvedView = useCallback((
    view: ViewRequest, nextState: CachedViewState, preserveSelection = false, cache = true,
  ) => {
    setVaultItems(nextState.items);
    setPage(nextState.page);
    setTotalPages(nextState.totalPages);
    setTotalItems(nextState.totalItems);
    if (cache) setCachedView(getViewCacheKey(view), nextState);
    if (!preserveSelection) clearSelection();
  }, [clearSelection, setCachedView, setVaultItems]);

  const hydrateViewFromLocalData = useCallback((view: ViewRequest) => {
    const totalCount = getViewTotalCount(view, sidebarCounts);
    if (totalCount === 0) {
      applyResolvedView(view, { items: [], page: 1, totalPages: 0, totalItems: 0 });
      return true;
    }
    if (view.deletedOnly) return false;

    const cachedAllView = viewCacheRef.current.all;
    if (!cachedAllView || cachedAllView.page !== 1 ||
        cachedAllView.totalItems !== sidebarCounts.all ||
        cachedAllView.items.length !== cachedAllView.totalItems) return false;

    const matchingItems = sortByUpdatedDesc(cachedAllView.items.filter((item) => itemMatchesView(item, view)));
    applyResolvedView(view, {
      items: matchingItems.slice(0, PAGE_SIZE),
      page: 1,
      totalPages: computeTotalPages(matchingItems.length),
      totalItems: matchingItems.length,
    });
    return true;
  }, [applyResolvedView, sidebarCounts]);

  const restoreOrHydrateView = useCallback((view: ViewRequest) => {
    if (restoreCachedView(getViewCacheKey(view))) return true;
    return hydrateViewFromLocalData(view);
  }, [hydrateViewFromLocalData, restoreCachedView]);

  const fetchVaultPage = useCallback(async (
    requestedPage: number, view: ViewRequest, term?: string, signal?: AbortSignal,
  ): Promise<LoadedViewState> => {
    const requestKey = `${getViewCacheKey(view)}:${requestedPage}`;
    const existingRequest = term ? undefined : inFlightViewLoadsRef.current[requestKey];
    if (existingRequest !== undefined) return await existingRequest;

    const requestPromise = (async () => {
      const { data, page } = await requestVaultPage(view, requestedPage, term, signal);
      const { vaultItems: storeItems } = useAuthStore.getState();
      const cachedItems = term ? [...storeItems, ...(normalItemsRef.current ?? [])] : storeItems;
      return {
        items: data.items.map((item: VaultItem) => term
          ? cachedItems.find((cached) => cached.id === item.id && cached.decrypted) ?? item
          : rehydrateListItem(item, storeItems)),
        page,
        totalPages: data.total_pages ?? 0,
        totalItems: data.total ?? 0,
        sidebarCounts: data.sidebar_counts,
      };
    })();

    if (!term) inFlightViewLoadsRef.current[requestKey] = requestPromise;
    try {
      return await requestPromise;
    } finally {
      if (!term) delete inFlightViewLoadsRef.current[requestKey];
    }
  }, []);

  const loadVaultPage = useCallback(async (
    newPage: number,
    view: ViewRequest = buildViewRequest(category, isFavouritesView, isTrashView),
    preserveSelection = false,
    term?: string,
    signal?: AbortSignal,
  ) => {
    const requestId = ++listRequestIdRef.current;
    if (!preserveSelection) clearSelection();
    setListLoading(true);
    try {
      const nextState = await fetchVaultPage(newPage, view, term, signal);
      if (signal?.aborted || requestId !== listRequestIdRef.current) return;
      if (nextState.sidebarCounts) setSidebarCounts(nextState.sidebarCounts);
      applyResolvedView(view, nextState, preserveSelection, !term);
    } finally {
      if (requestId === listRequestIdRef.current) setListLoading(false);
    }
  }, [applyResolvedView, category, clearSelection, fetchVaultPage, isFavouritesView, isTrashView]);

  const resetSearch = useCallback(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchAbortRef.current?.abort();
    listRequestIdRef.current += 1;
    normalItemsRef.current = null;
    setSearch('');
    setListLoading(false);
  }, []);

  const runSearch = useCallback(async (
    term: string, requestedPage = 1, view: ViewRequest = getCurrentView(), preserveSelection = false,
  ) => {
    searchAbortRef.current?.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;
    try {
      await loadVaultPage(requestedPage, view, preserveSelection, term, controller.signal);
    } catch (err: unknown) {
      const error = err as { code?: string; name?: string };
      if (!controller.signal.aborted && error?.code !== 'ERR_CANCELED' && error?.name !== 'AbortError') {
        console.error('Search error:', err);
        toastService.error(getSessionAwareError(err, 'Search is temporarily unavailable'));
      }
    }
  }, [getCurrentView, loadVaultPage]);

  const queueSearch = useCallback((value: string) => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchAbortRef.current?.abort();
    listRequestIdRef.current += 1;
    if (!normalItemsRef.current) normalItemsRef.current = useAuthStore.getState().vaultItems;
    setSearch(value);
    setVaultItems([]);
    setPage(1);
    setTotalPages(0);
    setTotalItems(0);
    setListLoading(true);
    searchDebounceRef.current = setTimeout(() => { void runSearch(value); }, 300);
  }, [runSearch, setVaultItems]);

  useEffect(() => {
    if (isVaultLocked) {
      resetSearch();
      shouldRestoreActiveViewRef.current = true;
      inFlightViewLoadsRef.current = {};
      setSidebarCounts(EMPTY_SIDEBAR_COUNTS);
      viewCacheRef.current = {};
    }
  }, [isVaultLocked, resetSearch]);

  useEffect(() => () => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchAbortRef.current?.abort();
  }, []);

  useEffect(() => {
    if (!isAuthenticated || isVaultLocked || totalItems !== null) return;
    void loadVaultPage(1).catch((err) => {
      toastService.error(getSessionAwareError(err, 'Vault is temporarily unavailable'));
      console.error('[initial-vault-load] Failed to load vault', err);
    });
  }, [isAuthenticated, isVaultLocked, loadVaultPage, totalItems]);

  useEffect(() => {
    if (isVaultLocked || !shouldRestoreActiveViewRef.current) return;

    shouldRestoreActiveViewRef.current = false;
    const view = getCurrentView();
    if (!view.deletedOnly && !view.favouritesOnly && view.category === 'all') return;
    if (restoreOrHydrateView(view)) return;

    void loadVaultPage(1, view).catch((err) => {
      toastService.error(getSessionAwareError(err, 'Vault is temporarily unavailable'));
      console.error('[unlock-view-restore] Failed to restore active view', err);
    });
  }, [getCurrentView, isVaultLocked, loadVaultPage, restoreOrHydrateView]);

  return {
    category, setCategory, viewMode, setViewMode, isFavouritesView, isTrashView,
    listLoading, page, setPage, totalPages, setTotalPages, totalItems, setTotalItems,
    sidebarCounts, setSidebarCounts, getCurrentView, setCachedView, cacheAllView,
    invalidateCachedViews, restoreCachedView, restoreOrHydrateView, loadVaultPage,
    search, resetSearch, runSearch, queueSearch,
  };
}
