import { create } from 'zustand';
import { authApi } from '@/lib/api';

interface User {
  id: string;
  email: string;
  full_name?: string;
  vault_salt: string;
  master_hint?: string;
}

interface VaultItem {
  id: string;
  name: string;
  category: string;
  encrypted_data: string;
  favicon_url?: string;
  is_favourite: boolean;
  created_at: string;
  updated_at: string;
  // Decrypted fields (populated client-side)
  decrypted?: {
    username?: string;
    password?: string;
    url?: string;
    notes?: string;
    cardNumber?: string;
    cardHolder?: string;
    expiry?: string;
    cvv?: string;
  };
}

interface AuthStore {
  user: User | null;
  cryptoKey: CryptoKey | null;
  isAuthenticated: boolean;
  vaultItems: VaultItem[];
  isVaultLocked: boolean;

  setAuth: (user: User, accessToken: string, refreshToken: string) => void;
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

  setAuth: (user, accessToken, refreshToken) => {
    sessionStorage.setItem('access_token', accessToken);
    localStorage.setItem('refresh_token', refreshToken);
    localStorage.setItem('vault_salt', user.vault_salt);
    set({ user, isAuthenticated: true });
  },

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

  restoreSession: async () => {
    try {
      let token = sessionStorage.getItem('access_token');
      if (!token) {
        const refreshToken = localStorage.getItem('refresh_token');
        if (!refreshToken) return false;
        const { data: refreshData } = await authApi.refresh(refreshToken);
        token = refreshData.access_token;
        sessionStorage.setItem('access_token', token as string);
        localStorage.setItem('refresh_token', refreshData.refresh_token);
        localStorage.setItem('vault_salt', refreshData.vault_salt);
      }
      const { data: user } = await authApi.me();
      localStorage.setItem('vault_salt', user.vault_salt);
      set({ user, isAuthenticated: true });
      return true;
    } catch {
      sessionStorage.removeItem('access_token');
      return false;
    }
  },

  logout: () => {
    sessionStorage.clear();
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('vault_salt');
    set({
      user: null,
      cryptoKey: null,
      isAuthenticated: false,
      vaultItems: [],
      isVaultLocked: true,
    });
  },
}));
