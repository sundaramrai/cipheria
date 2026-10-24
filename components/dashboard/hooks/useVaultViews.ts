'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getSessionAwareError } from '@/lib/errors';
import { useAuthStore } from '@/lib/store';
import { toastService } from '@/lib/toast';
import { vaultApi } from '@/lib/api';
import { decryptData } from '@/lib/crypto';
import { itemMatchesSearch, loadSearchItems } from '@/lib/vaultSearch';
import type { SidebarCounts, VaultItem } from '@/lib/types';
import type { Category } from '../types';
import {
  EMPTY_SIDEBAR_COUNTS, buildViewRequest,
  buildVaultListParams, getViewCacheKey, getViewTotalCount, itemMatchesView, paginateItems, rehydrateListItem,
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
  const [searchError, setSearchError] = useState<string | null>(null);
  const viewCacheRef = useRef<Record<string, CachedViewState>>({});
  const searchIndexRef = useRef<{ viewKey: string; key: CryptoKey; items: VaultItem[] } | null>(null);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);
  const shouldRestoreActiveViewRef = useRef(false);
  const listRequestIdRef = useRef(0);
  const inFlightViewLoadsRef = useRef<Record<string, Promise<LoadedViewState>>>({});

  const getCurrentView = useCallback(
    () => buildViewRequest(category, isFavouritesView, isTrashView),
    [category, isFavouritesView, isTrashView],
  );

  const setCachedView = useCallback((key: string, state: CachedViewState) => {
    viewCacheRef.current[key] = state;
  }, []);

  const cacheAllView = useCallback((items: VaultItem[], nextTotalPages: number, nextTotalItems: number) => {
    setCachedView('all', { items, page: 1, totalPages: nextTotalPages, totalItems: nextTotalItems });
  }, [setCachedView]);

  const invalidateCachedViews = useCallback((exceptKey?: string) => {
    searchIndexRef.current = null;
    if (!exceptKey) {
      viewCacheRef.current = {};
      return;
    }
    const preserved = viewCacheRef.current[exceptKey];
    viewCacheRef.current = preserved ? { [exceptKey]: preserved } : {};
  }, []);

  const applyResolvedView = useCallback((
    nextState: CachedViewState, preserveSelection = false, cacheKey?: string,
  ) => {
    setVaultItems(nextState.items);
    setPage(nextState.page);
    setTotalPages(nextState.totalPages);
    setTotalItems(nextState.totalItems);
    if (cacheKey) setCachedView(cacheKey, nextState);
    if (!preserveSelection) clearSelection();
  }, [clearSelection, setCachedView, setVaultItems]);

  const restoreCachedView = useCallback((key: string) => {
    const cached = viewCacheRef.current[key];
    if (!cached) return false;
    applyResolvedView(cached);
    return true;
  }, [applyResolvedView]);

  const hydrateViewFromLocalData = useCallback((view: ViewRequest) => {
    const totalCount = getViewTotalCount(view, sidebarCounts);
    if (totalCount === 0) {
      applyResolvedView(paginateItems([]), false, getViewCacheKey(view));
      return true;
    }
    if (view.deletedOnly) return false;

    const cachedAllView = viewCacheRef.current.all;
    if (cachedAllView?.page !== 1 ||
        cachedAllView.totalItems !== sidebarCounts.all ||
        cachedAllView.items.length !== cachedAllView.totalItems) return false;

    const matchingItems = sortByUpdatedDesc(cachedAllView.items.filter((item) => itemMatchesView(item, view)));
    applyResolvedView(paginateItems(matchingItems), false, getViewCacheKey(view));
    return true;
  }, [applyResolvedView, sidebarCounts]);

  const restoreOrHydrateView = useCallback((view: ViewRequest) => {
    if (restoreCachedView(getViewCacheKey(view))) return true;
    return hydrateViewFromLocalData(view);
  }, [hydrateViewFromLocalData, restoreCachedView]);

  const fetchVaultPage = useCallback(async (
    requestedPage: number, view: ViewRequest,
  ): Promise<LoadedViewState> => {
    const requestKey = `${getViewCacheKey(view)}:${requestedPage}`;
    const existingRequest = inFlightViewLoadsRef.current[requestKey];
    if (existingRequest !== undefined) return await existingRequest;

    const requestPromise = (async () => {
      const { data, page } = await requestVaultPage(view, requestedPage);
      const { vaultItems: storeItems } = useAuthStore.getState();
      return {
        items: data.items.map((item: VaultItem) => rehydrateListItem(item, storeItems)),
        page,
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
    view: ViewRequest = getCurrentView(),
    preserveSelection = false,
  ) => {
    const requestId = ++listRequestIdRef.current;
    if (!preserveSelection) clearSelection();
    setListLoading(true);
    try {
      const nextState = await fetchVaultPage(newPage, view);
      if (requestId !== listRequestIdRef.current) return;
      if (nextState.sidebarCounts) setSidebarCounts(nextState.sidebarCounts);
      applyResolvedView(nextState, preserveSelection, getViewCacheKey(view));
    } finally {
      if (requestId === listRequestIdRef.current) setListLoading(false);
    }
  }, [applyResolvedView, clearSelection, fetchVaultPage, getCurrentView]);

  const resetSearch = useCallback(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchAbortRef.current?.abort();
    listRequestIdRef.current += 1;
    searchIndexRef.current = null;
    setSearch('');
    setSearchError(null);
    setListLoading(false);
  }, []);

  const getSearchItems = useCallback(async (view: ViewRequest, key: CryptoKey, signal: AbortSignal) => {
    const viewKey = getViewCacheKey(view);
    const cached = searchIndexRef.current;
    if (cached?.viewKey === viewKey && cached.key === key) return cached.items;
    const items = await loadSearchItems(
      async page => {
        const { data } = await vaultApi.list({
          ...buildVaultListParams(view, page), page_size: 100, include_encrypted_data: true,
        }, signal);
        return data;
      },
      encrypted => decryptData(encrypted, key), signal,
    );
    signal.throwIfAborted();
    if (useAuthStore.getState().cryptoKey !== key) throw new DOMException('Vault locked', 'AbortError');
    searchIndexRef.current = { viewKey, key, items };
    return items;
  }, []);

  const runSearch = useCallback(async (
    term: string, requestedPage = 1, view: ViewRequest = getCurrentView(), preserveSelection = false,
  ) => {
    searchAbortRef.current?.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;
    const requestId = ++listRequestIdRef.current;
    const key = useAuthStore.getState().cryptoKey;
    if (!key) return;
    if (!preserveSelection) clearSelection();
    setListLoading(true);
    setSearchError(null);
    try {
      const items = await getSearchItems(view, key, controller.signal);
      if (requestId !== listRequestIdRef.current || controller.signal.aborted) return;
      const matches = sortByUpdatedDesc(items.filter(item => itemMatchesSearch(item, term)));
      applyResolvedView(paginateItems(matches, requestedPage), preserveSelection);
    } catch (err: unknown) {
      const error = err as { code?: string; name?: string };
      if (controller.signal.aborted || requestId !== listRequestIdRef.current ||
          error?.code === 'ERR_CANCELED' || error?.name === 'AbortError') return;
      console.error('Search error:', err);
      const message = getSessionAwareError(err, 'The search could not finish. Try again or clear your search.');
      setSearchError(message);
      toastService.error(message);
    } finally {
      if (requestId === listRequestIdRef.current) setListLoading(false);
    }
  }, [applyResolvedView, clearSelection, getCurrentView, getSearchItems]);

  const queueSearch = useCallback((value: string) => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchAbortRef.current?.abort();
    listRequestIdRef.current += 1;
    setSearch(value);
    setSearchError(null);
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
    search, searchError, resetSearch, runSearch, queueSearch,
  };
}
