import type { Metadata } from 'next';
import { Cormorant_Garamond, DM_Mono, Outfit } from 'next/font/google';
import '../styles/globals.css';
import { Toaster } from 'react-hot-toast';
import { THEME_STORAGE_KEY } from '@/lib/theme';

const cormorant = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['400', '600'],
  style: ['normal', 'italic'],
  variable: '--font-display',
  display: 'swap',
});

const dmMono = DM_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono',
  display: 'swap',
});

const outfit = Outfit({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600'],
  variable: '--font-body',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Cipheria — Secure Password Manager',
  description: 'Zero-knowledge encrypted password vault. Your secrets, forever yours.',
  icons: [
    { rel: 'icon', type: 'image/svg+xml', url: '/favicon.svg' },
    { rel: 'shortcut icon', url: '/favicon.svg' },
  ],
};

export default function RootLayout({ children }: { readonly children: React.ReactNode }) {
  const themeInitScript = `
    (function () {
      try {
        var stored = window.localStorage.getItem('${THEME_STORAGE_KEY}');
        var theme = stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
        var resolved = theme === 'system'
          ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
          : theme;
        document.documentElement.dataset.theme = theme;
        document.documentElement.dataset.resolvedTheme = resolved;
      } catch (e) {
        document.documentElement.dataset.theme = 'system';
        document.documentElement.dataset.resolvedTheme = 'dark';
      }
    })();
  `;

  return (
    <html lang="en" suppressHydrationWarning className={`${cormorant.variable} ${dmMono.variable} ${outfit.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body suppressHydrationWarning>
        <div style={{ position: 'relative', zIndex: 1 }}>
          {children}
        </div>
        <Toaster
          position="bottom-right"
          containerStyle={{ zIndex: 9999 }}
          toastOptions={{
            style: {
              background: 'var(--bg-card)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-hover)',
              fontFamily: 'Outfit, sans-serif',
              fontSize: '0.875rem',
            },
            success: { iconTheme: { primary: 'var(--success)', secondary: 'var(--status-ink)' } },
            error: { iconTheme: { primary: 'var(--danger)', secondary: 'var(--status-ink)' } },
          }}
        />
      </body>
    </html>
  );
}
