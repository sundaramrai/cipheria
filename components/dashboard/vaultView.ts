import { vaultApi } from '@/lib/api';
import type { SidebarCounts, VaultItem } from '@/lib/types';
import type { Category } from './types';

export const PAGE_SIZE = 50;

export const EMPTY_SIDEBAR_COUNTS: SidebarCounts = {
  all: 0,
  login: 0,
  card: 0,
  note: 0,
  identity: 0,
  favourites: 0,
  trash: 0,
};

export type ViewRequest = {
  category: Category;
  deletedOnly: boolean;
  favouritesOnly: boolean;
};

export type CachedViewState = {
  items: VaultItem[];
  page: number;
  totalPages: number;
  totalItems: number;
};

type CachedViewKey = 'all' | 'favourites' | 'trash';

export function buildViewRequest(category: Category, isFavouritesView: boolean, isTrashView: boolean): ViewRequest {
  if (isTrashView) return { category: 'all', deletedOnly: true, favouritesOnly: false };
  if (isFavouritesView) return { category: 'all', deletedOnly: false, favouritesOnly: true };
  return { category, deletedOnly: false, favouritesOnly: false };
}

export function getViewCacheKey(view: ViewRequest): CachedViewKey | `category:${Exclude<Category, 'all'>}` {
  if (view.deletedOnly) return 'trash';
  if (view.favouritesOnly) return 'favourites';
  return view.category === 'all' ? 'all' : `category:${view.category}`;
}

export function buildVaultListParams(view: ViewRequest, page: number, search?: string) {
  return {
    deleted_only: view.deletedOnly,
    favourites_only: !view.deletedOnly && view.favouritesOnly,
    page,
    page_size: PAGE_SIZE,
    ...(search !== undefined && { search }),
    ...(!view.deletedOnly && !view.favouritesOnly && view.category !== 'all' && { category: view.category }),
  };
}

export async function requestVaultPage(view: ViewRequest, page: number, search?: string, signal?: AbortSignal) {
  while (true) {
    const { data } = await vaultApi.list(buildVaultListParams(view, page, search), signal);
    if (data.total_pages > 0 && page > data.total_pages) {
      page = data.total_pages;
      continue;
    }
    return { data, page: data.total_pages > 0 ? page : 1 };
  }
}

export function rehydrateListItem(item: VaultItem, storeItems: VaultItem[]): VaultItem {
  const cached = storeItems.find((storeItem) => storeItem.id === item.id);
  return cached?.decrypted ? { ...item, decrypted: cached.decrypted } : item;
}

export function sortByUpdatedDesc(items: VaultItem[]): VaultItem[] {
  return [...items].sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
}

export function itemMatchesView(item: VaultItem, view: ViewRequest): boolean {
  if (view.deletedOnly) return Boolean(item.is_deleted);
  if (item.is_deleted) return false;
  if (view.favouritesOnly && !item.is_favourite) return false;
  return view.category === 'all' || item.category === view.category;
}

export function itemMatchesSearch(item: VaultItem, term: string): boolean {
  if (!term) return true;
  return item.name.toLowerCase().includes(term.toLowerCase());
}

export function reconcileVisibleItems(
  items: VaultItem[],
  before: VaultItem | null,
  after: VaultItem | null,
  view: ViewRequest,
  searchTerm: string,
  page: number,
): VaultItem[] {
  const existing = items.some((item) => item.id === before?.id || item.id === after?.id);
  let nextItems = before ? items.filter((item) => item.id !== before.id) : [...items];

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

export function computeTotalPages(totalItems: number): number {
  return totalItems === 0 ? 0 : Math.ceil(totalItems / PAGE_SIZE);
}

export function clampPage(page: number, totalPages: number): number {
  return Math.min(page, Math.max(1, totalPages));
}

export function getMatchDelta(
  before: VaultItem | null,
  after: VaultItem | null,
  matches: (item: VaultItem) => boolean,
): number {
  return Number(Boolean(after && matches(after))) - Number(Boolean(before && matches(before)));
}

export function getViewTotalCount(view: ViewRequest, counts: SidebarCounts): number {
  if (view.deletedOnly) return counts.trash;
  if (view.favouritesOnly) return counts.favourites;
  if (view.category === 'all') return counts.all;
  return counts[view.category];
}

export function applySidebarDelta(counts: SidebarCounts, before: VaultItem | null, after: VaultItem | null): SidebarCounts {
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
    if (item.is_favourite) next.favourites += direction;
  };

  if (before) applyItem(before, -1);
  if (after) applyItem(after, 1);

  for (const key of Object.keys(next) as (keyof SidebarCounts)[]) {
    next[key] = Math.max(0, next[key]);
  }
  return next;
}
