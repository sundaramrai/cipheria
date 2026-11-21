import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { Cormorant_Garamond, DM_Mono, Outfit } from 'next/font/google';
import '../styles/globals.css';
import { ToastViewport } from '@/components/ToastViewport';
import { ThemeSync } from '@/components/ThemeSync';
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
  description: 'Store logins, cards, notes and identities in Cipheria with browser-encrypted item contents.',
  icons: [
    { rel: 'icon', type: 'image/svg+xml', url: '/favicon.svg' },
    { rel: 'shortcut icon', url: '/favicon.svg' },
  ],
};

export default async function RootLayout({ children }: { readonly children: React.ReactNode }) {
  const nonce = (await headers()).get('x-nonce') ?? undefined;
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
    <html
      lang="en"
      suppressHydrationWarning
      data-scroll-behavior="smooth"
      className={`${cormorant.variable} ${dmMono.variable} ${outfit.variable}`}
    >
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body suppressHydrationWarning>
        <ThemeSync />
        <div style={{ position: 'relative', zIndex: 1 }}>
          {children}
        </div>
        <ToastViewport />
      </body>
    </html>
  );
}
