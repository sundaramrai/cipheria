import { create } from 'zustand';
import { authApi, setAccessToken, getAccessToken } from '@/lib/api';
import type { UserProfile, VaultItem } from '@/lib/types';

interface AuthStore {
  user: UserProfile | null;
  cryptoKey: CryptoKey | null;
  isAuthenticated: boolean;
  vaultItems: VaultItem[];
  isVaultLocked: boolean;

  completeAuth: (user: UserProfile, accessToken: string, key: CryptoKey) => void;
  setUser: (user: UserProfile | null) => void;
  setVaultKey: (key: CryptoKey) => void;
  setVaultItems: (items: VaultItem[]) => void;
  updateVaultItem: (id: string, item: VaultItem) => void;
  removeVaultItem: (id: string) => void;
  addVaultItem: (item: VaultItem) => void;
  logout: () => void;
  lockVault: () => void;
  restoreSession: () => Promise<boolean>;
}

export const useAuthStore = create<AuthStore>((set) => ({
  user: null,
  cryptoKey: null,
  isAuthenticated: false,
  vaultItems: [],
  isVaultLocked: true,

  completeAuth: (user, accessToken, key) => {
    setAccessToken(accessToken);
    set({
      user,
      cryptoKey: key,
      isAuthenticated: true,
      isVaultLocked: false,
    });
  },

  setUser: (user) => set({ user }),

  setVaultKey: (key) => set({ cryptoKey: key, isVaultLocked: false }),

  setVaultItems: (items) => set({ vaultItems: items }),

  updateVaultItem: (id, item) =>
    set((state) => ({
      vaultItems: state.vaultItems.map((v) => (v.id === id ? item : v)),
    })),

  addVaultItem: (item) =>
    set((state) => ({ vaultItems: [item, ...state.vaultItems] })),

  removeVaultItem: (id) =>
    set((state) => ({ vaultItems: state.vaultItems.filter((v) => v.id !== id) })),

  lockVault: () => set({ cryptoKey: null, isVaultLocked: true, vaultItems: [] }),

  restoreSession: (() => {
    /**
     * Shared promise — prevents concurrent callers (StrictMode, multi-page mounts)
     * from each firing their own refresh bootstrap work.
     */
    let _pending: Promise<boolean> | null = null;

    return () => {
      if (_pending) return _pending;
      _pending = (async () => {
        try {
          let token = getAccessToken();
          let user = null;
          if (!token) {
            // HttpOnly cookie sent automatically — no localStorage needed
            const { data: refreshData } = await authApi.refresh();
            token = refreshData.access_token;
            user = refreshData.user;
            setAccessToken(token);
          }
          if (!user) {
            const { data } = await authApi.me();
            user = data;
          }
          set({ user, isAuthenticated: true });
          return true;
        } catch {
          setAccessToken(null);
          set({
            user: null,
            cryptoKey: null,
            isAuthenticated: false,
            vaultItems: [],
            isVaultLocked: true,
          });
          return false;
        } finally {
          _pending = null;
        }
      })();
      return _pending;
    };
  })(),

  logout: () => {
    setAccessToken(null);
    set({
      user: null,
      cryptoKey: null,
      isAuthenticated: false,
      vaultItems: [],
      isVaultLocked: true,
    });
  },
}));
