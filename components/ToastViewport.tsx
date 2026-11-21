'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Toaster } from 'react-hot-toast';

export function ToastViewport() {
  const [host, setHost] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = document.createElement('div');
    const place = () => {
      const target = document.activeElement?.closest('dialog:modal')
        ?? Array.from(document.querySelectorAll('dialog:modal')).at(-1)
        ?? document.body;
      // Reparent the stable portal host so active toasts and timers survive.
      if (container.parentElement !== target) target.appendChild(container);
    };
    place();
    setHost(container);
    const observer = new MutationObserver(place);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['open'] });
    return () => { observer.disconnect(); container.remove(); };
  }, []);

  return host ? createPortal(
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
    />,
    host,
  ) : null;
}
