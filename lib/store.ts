import { create } from 'zustand';
import { authApi, setAccessToken, getAccessToken } from '@/lib/api';
import type { UserProfile, VaultItem } from '@/lib/types';

interface AuthStore {
  user: UserProfile | null;
  cryptoKey: CryptoKey | null;
  isAuthenticated: boolean;
  vaultItems: VaultItem[];
  isVaultLocked: boolean;
  lockVersion: number;

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
  lockVersion: 0,

  completeAuth: (user, accessToken, key) => {
    setAccessToken(accessToken);
    set(state => ({
      user,
      cryptoKey: key,
      isAuthenticated: true,
      isVaultLocked: false,
      lockVersion: state.lockVersion + 1,
    }));
  },

  setUser: (user) => set((state) => {
    // A profile event must never attach an existing key to a different account
    // or salt, even if a separate cross-tab lock event is delayed or lost.
    if (user?.id !== state.user?.id || user?.vault_salt !== state.user?.vault_salt
      || user?.key_envelope?.key_id !== state.user?.key_envelope?.key_id
      || user?.key_envelope?.vault_id !== state.user?.key_envelope?.vault_id) {
      return { user, cryptoKey: null, isVaultLocked: true, vaultItems: [], lockVersion: state.lockVersion + 1 };
    }
    return { user };
  }),

  setVaultKey: (key) => set({ cryptoKey: key, isVaultLocked: false }),

  setVaultItems: (items) => set({ vaultItems: items }),

  updateVaultItem: (id, item) =>
    set((state) => ({
      vaultItems: state.vaultItems.map((v) => (v.id === id ? item : v)),
    })),

  // Increment even when already locked so a pending unlock cannot undo a new lock.
  lockVault: () => set(state => ({ cryptoKey: null, isVaultLocked: true, vaultItems: [], lockVersion: state.lockVersion + 1 })),

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
    set(state => ({
      user: null,
      cryptoKey: null,
      isAuthenticated: false,
      vaultItems: [],
      isVaultLocked: true,
      lockVersion: state.lockVersion + 1,
    }));
  },
}));
