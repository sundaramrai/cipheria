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

  lockVault: () => set({ cryptoKey: null, isVaultLocked: true, vaultItems: [] }),

  restoreSession: (() => {
    let pending: Promise<boolean> | null = null;

    return () => {
      if (pending) return pending;
      pending = (async () => {
        try {
          const token = getAccessToken();
          if (!token) {
            const { data } = await authApi.refresh();
            setAccessToken(data.access_token);
            set({ user: data.user, isAuthenticated: true });
            return true;
          }

          const { data } = await authApi.me();
          set({ user: data, isAuthenticated: true });
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
          pending = null;
        }
      })();

      return pending;
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
