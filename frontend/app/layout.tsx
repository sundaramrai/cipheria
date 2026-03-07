import type { Metadata } from 'next';
import { Cormorant_Garamond, DM_Mono, Outfit } from 'next/font/google';
import '../styles/globals.css';
import { Toaster } from 'react-hot-toast';

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
  return (
    <html lang="en" suppressHydrationWarning className={`${cormorant.variable} ${dmMono.variable} ${outfit.variable}`}>
      <body suppressHydrationWarning>
        <div style={{ position: 'relative', zIndex: 1 }}>
          {children}
        </div>
        <Toaster
          position="bottom-right"
          containerStyle={{ zIndex: 9999 }}
          toastOptions={{
            style: {
              background: '#19170f',
              color: '#f5f0e8',
              border: '1px solid rgba(251, 191, 36, 0.2)',
              fontFamily: 'Outfit, sans-serif',
              fontSize: '0.875rem',
            },
            success: { iconTheme: { primary: '#22c55e', secondary: '#0a0908' } },
            error: { iconTheme: { primary: '#ef4444', secondary: '#0a0908' } },
          }}
        />
      </body>
    </html>
  );
}
