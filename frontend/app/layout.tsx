import type { Metadata } from 'next';
import '../styles/globals.css';
import { Toaster } from 'react-hot-toast';

export const metadata: Metadata = {
  title: 'KeyVault — Secure Password Manager',
  description: 'Zero-knowledge encrypted password vault. Your secrets, forever yours.',
  icons: [
    { rel: 'icon', type: 'image/svg+xml', url: '/favicon.svg' },
    { rel: 'shortcut icon', url: '/favicon.svg' },
  ],
};

export default function RootLayout({ children }: { readonly children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <div style={{ position: 'relative', zIndex: 1 }}>
          {children}
        </div>
        <Toaster
          position="bottom-right"
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
