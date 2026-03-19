export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'cipheria-theme';

function isThemePreference(value: string | null): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

export function getStoredThemePreference(): ThemePreference {
  if (globalThis.window === undefined) return 'system';
  const stored = globalThis.window.localStorage.getItem(THEME_STORAGE_KEY);
  return isThemePreference(stored) ? stored : 'system';
}

export function resolveThemePreference(theme: ThemePreference): ResolvedTheme {
  if (theme === 'light' || theme === 'dark') return theme;
  if (globalThis.window === undefined) return 'dark';
  return globalThis.window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function syncThemePreference(theme: ThemePreference) {
  if (typeof document === 'undefined') return;
  const resolved = resolveThemePreference(theme);
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.resolvedTheme = resolved;
}

export function applyThemePreference(theme: ThemePreference) {
  if (globalThis.window === undefined) return;
  syncThemePreference(theme);
  globalThis.window.localStorage.setItem(THEME_STORAGE_KEY, theme);
}
