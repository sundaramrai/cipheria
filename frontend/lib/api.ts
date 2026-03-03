import axios from 'axios';

// In dev: empty string → Next.js proxy forwards /api/* to the backend (keeps cookies same-origin).
// In prod: set NEXT_PUBLIC_API_URL to your API origin (e.g. https://api.example.com).
const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

// In-memory access token — never touches Web Storage, invisible to XSS
let _accessToken: string | null = null;
export const setAccessToken = (token: string | null) => { _accessToken = token; };
export const getAccessToken = () => _accessToken;

export const api = axios.create({
  baseURL: API_URL,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,  // send HttpOnly refresh-token cookie automatically
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
    const isRefreshCall = original?.url?.includes('/api/auth/refresh');
    if (error.response?.status === 401 && !original._retry && !isRefreshCall) {
      original._retry = true;
      try {
        // Cookie is sent automatically via withCredentials
        const { data } = await axios.post(`${API_URL}/api/auth/refresh`, {}, { withCredentials: true });
        setAccessToken(data.access_token);
        original.headers.Authorization = `Bearer ${data.access_token}`;
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
  register: (email: string, password: string, fullName?: string, masterHint?: string) =>
    api.post('/api/auth/register', { email, password, full_name: fullName, master_hint: masterHint }),

  login: (email: string, password: string) =>
    api.post('/api/auth/login', { email, password }),

  refresh: () =>
    api.post('/api/auth/refresh'),

  logout: () =>
    api.post('/api/auth/logout'),

  me: () => api.get('/api/auth/me'),
};

// Vault

export const vaultApi = {
  list: (params?: { category?: string; search?: string; favourites_only?: boolean }) =>
    api.get('/api/vault', { params }),

  create: (data: {
    name: string;
    category: string;
    encrypted_data: string;
    favicon_url?: string;
    is_favourite?: boolean;
  }) => api.post('/api/vault', data),

  update: (id: string, data: Partial<{
    name: string;
    category: string;
    encrypted_data: string;
    favicon_url: string;
    is_favourite: boolean;
  }>) => api.patch(`/api/vault/${id}`, data),

  delete: (id: string) => api.delete(`/api/vault/${id}`),

  export: () => api.get('/api/vault/export/json'),
};
