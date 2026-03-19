import { create } from 'zustand';
import { authApi, setAccessToken, getAccessToken } from '@/lib/api';
import type { UserProfile, VaultItem } from '@/lib/types';

interface AuthStore {
  user: UserProfile | null;
  cryptoKey: CryptoKey | null;
  isAuthenticated: boolean;
  vaultItems: VaultItem[];
  isVaultLocked: boolean;

  setAuth: (user: UserProfile, accessToken: string) => void;
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

  /**
   * setAuth is the single source of truth for storing the access token.
   * Callers must NOT call setAccessToken separately before invoking this.
   */
  setAuth: (user, accessToken) => {
    setAccessToken(accessToken);
    set({ user, isAuthenticated: true });
  },

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
     * from each firing their own refresh + /me pair.
     */
    let _pending: Promise<boolean> | null = null;

    return () => {
      if (_pending) return _pending;
      _pending = (async () => {
        try {
          let token = getAccessToken();
          if (!token) {
            // HttpOnly cookie sent automatically — no localStorage needed
            const { data: refreshData } = await authApi.refresh();
            token = refreshData.access_token as string;
            setAccessToken(token);
          }
          const { data: user } = await authApi.me();
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
