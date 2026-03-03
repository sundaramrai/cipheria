import { create } from 'zustand';
import { authApi, setAccessToken, getAccessToken } from '@/lib/api';

interface User {
  id: string;
  email: string;
  full_name?: string;
  vault_salt: string;
  master_hint?: string;
}

export interface VaultItem {
  id: string;
  name: string;
  category: string;
  encrypted_data?: string;  // Only present after fetching the detail endpoint
  favicon_url?: string;
  is_favourite: boolean;
  created_at: string;
  updated_at: string;
  // Decrypted fields (populated client-side)
  decrypted?: {
    // login
    username?: string;
    password?: string;
    url?: string;
    // card
    cardNumber?: string;
    cardHolder?: string;
    expiry?: string;
    cvv?: string;
    // identity
    firstName?: string;
    lastName?: string;
    phone?: string;
    address?: string;
    // shared
    notes?: string;
  };
}

interface AuthStore {
  user: User | null;
  cryptoKey: CryptoKey | null;
  isAuthenticated: boolean;
  vaultItems: VaultItem[];
  isVaultLocked: boolean;

  setAuth: (user: User, accessToken: string) => void;
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

  setAuth: (user, accessToken) => {
    setAccessToken(accessToken);
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
      let token = getAccessToken();
      if (!token) {
        // Cookie is sent automatically — no localStorage needed
        const { data: refreshData } = await authApi.refresh();
        token = refreshData.access_token;
        setAccessToken(token as string);
      }
      const { data: user } = await authApi.me();
      set({ user, isAuthenticated: true });
      return true;
    } catch {
      setAccessToken(null);
      return false;
    }
  },

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
