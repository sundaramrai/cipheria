import axios from 'axios';
import type { AuthSession, PaginatedVaultItems, UserProfile, VaultItem } from '@/lib/types';

// In-memory access token — never touches Web Storage, invisible to XSS
let _accessToken: string | null = null;
export const setAccessToken = (token: string | null) => { _accessToken = token; };
export const getAccessToken = () => _accessToken;

const AUTO_REFRESH_EXCLUDED_PATHS = [
  '/api/auth/refresh',
  '/api/auth/login',
  '/api/auth/login/challenge',
  '/api/auth/register',
  '/api/auth/verify-email',
] as const;

/**
 * Refresh mutex — ensures only one refresh call is in-flight at a time.
 * All concurrent 401 retries await the same promise and reuse the new token.
 * The promise is cleared AFTER it settles so late concurrent callers still
 * receive the resolved token rather than racing to start a new refresh.
 */
let _refreshPromise: Promise<string> | null = null;

export const api = axios.create({
  timeout: 15_000,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true, // send HttpOnly refresh-token cookie automatically
});

// Attach access token to every request
api.interceptors.request.use((config) => {
  const token = _accessToken;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Auto-refresh on 401 (but not when the refresh endpoint itself fails)
api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    const requestUrl = original?.url ?? '';
    const shouldSkipAutoRefresh = AUTO_REFRESH_EXCLUDED_PATHS.some((path) =>
      requestUrl.includes(path),
    );
    if (error.response?.status === 401 && !original._retry && !shouldSkipAutoRefresh) {
      original._retry = true;
      try {
        if (!_refreshPromise) {
          // Start a new refresh and clear the mutex only after all awaiting
          // callers have received the token (i.e. after the microtask queue drains).
          const promise = axios
            .post('/api/auth/refresh', {}, { withCredentials: true })
            .then(({ data }) => {
              setAccessToken(data.access_token);
              return data.access_token as string;
            });
          _refreshPromise = promise;
          // Clear after current tick so concurrent callers still hit the same promise
          promise.finally(() => { _refreshPromise = null; });
        }
        const newToken = await _refreshPromise;
        original.headers = original.headers ?? {};
        original.headers.Authorization = `Bearer ${newToken}`;
        return api(original);
      } catch {
        // Refresh failed — clear token; callers handle redirect
        setAccessToken(null);
      }
    }
    throw error;
  },
);

// Auth

export const authApi = {
  register: (
    email: string,
    vaultSalt: string,
    masterPasswordVerifier: string,
    fullName?: string,
    masterHint?: string,
  ) => api.post<AuthSession>('/api/auth/register', {
    email,
    vault_salt: vaultSalt,
    master_password_verifier: masterPasswordVerifier,
    full_name: fullName,
    master_hint: masterHint,
  }),

  loginChallenge: (email: string) =>
    api.post<{ vault_salt: string }>('/api/auth/login/challenge', { email }),

  login: (email: string, masterPasswordVerifier: string) =>
    api.post<AuthSession>('/api/auth/login', { email, master_password_verifier: masterPasswordVerifier }),

  refresh: () =>
    api.post<AuthSession>('/api/auth/refresh'),

  logout: () =>
    api.post('/api/auth/logout'),

  me: () => api.get<UserProfile>('/api/auth/me'),

  requestEmailVerification: () =>
    api.post('/api/auth/verify-email/request'),

  verifyEmail: (token: string) =>
    api.post('/api/auth/verify-email', { token }),

  unlock: (masterPasswordVerifier: string) =>
    api.post<PaginatedVaultItems<VaultItem>>('/api/auth/unlock', {
      master_password_verifier: masterPasswordVerifier,
    }),

  updateProfile: (data: { full_name?: string | null; master_hint?: string | null }) =>
    api.patch<UserProfile>('/api/auth/profile', data),

  changeMasterPassword: (data: {
    new_vault_salt: string;
    new_master_password_verifier: string;
    master_hint?: string | null;
    items: Array<{ id: string; encrypted_data: string }>;
  }) => api.patch<UserProfile>('/api/auth/master-password', data),

  deleteAccount: (masterPasswordVerifier: string) =>
    api.delete('/api/auth/account', { data: { master_password_verifier: masterPasswordVerifier } }),
};

// Vault

export const vaultApi = {
  list: (params?: { category?: string; search?: string; favourites_only?: boolean; deleted_only?: boolean; page?: number; page_size?: number }, signal?: AbortSignal) =>
    api.get<PaginatedVaultItems<VaultItem>>('/api/vault', { params, signal }),

  get: (id: string) => api.get<VaultItem>(`/api/vault/${id}`),

  create: (data: {
    name: string;
    category: string;
    encrypted_data: string;
    favicon_url?: string;
    is_favourite?: boolean;
  }) => api.post<VaultItem>('/api/vault', data),

  update: (id: string, data: Partial<{
    name: string;
    category: string;
    encrypted_data: string;
    favicon_url: string;
    is_favourite: boolean;
  }>) => api.patch<VaultItem>(`/api/vault/${id}`, data),

  delete: (id: string) => api.delete(`/api/vault/${id}`),

  restore: (id: string) => api.post(`/api/vault/${id}/restore`),

  deletePermanent: (id: string) => api.delete(`/api/vault/${id}/permanent`),

  export: () => api.get('/api/vault/export/json'),
};
