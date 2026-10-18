'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { authApi } from '@/lib/api';
import { emitAuthEvent, subscribeToAuthEvents } from '@/lib/authSync';
import type { AuthSyncEvent } from '@/lib/authSync';
import { useAuthStore } from '@/lib/store';
import { useIdleTimer } from './useIdleTimer';

export function useDashboardSession() {
  const router = useRouter();
  const { isAuthenticated, isVaultLocked, restoreSession, logout, lockVault, setUser } = useAuthStore();
  const [sessionLoading, setSessionLoading] = useState(true);

  const handleLockVault = useCallback(() => {
    lockVault();
    emitAuthEvent('lock');
  }, [lockVault]);

  useIdleTimer(isVaultLocked, handleLockVault);

  useEffect(() => {
    let active = true;

    if (isAuthenticated) {
      setSessionLoading(false);
      return () => {
        active = false;
      };
    }

    void restoreSession().then((ok) => {
      if (!active) return;
      setSessionLoading(false);
      if (!ok) router.replace('/auth');
    });

    return () => {
      active = false;
    };
  }, [isAuthenticated, restoreSession, router]);

  useEffect(() => {
    return subscribeToAuthEvents((event: AuthSyncEvent) => {
      if (event.type === 'logout') {
        logout();
        router.replace('/auth');
        return;
      }

      if (event.type === 'lock') {
        lockVault();
        return;
      }

      if (event.type === 'user-updated') {
        if (event.user) {
          setUser(event.user);
          return;
        }
        void authApi.me()
          .then(({ data }) => setUser(data))
          .catch(() => {
            // A later restore or me request can recover a transient sync failure.
          });
      }
    });
  }, [lockVault, logout, router, setUser]);

  const handleLogout = useCallback(async () => {
    try { await authApi.logout(); } catch { /* Ignore network errors on logout. */ }
    logout();
    emitAuthEvent('logout');
    router.replace('/auth');
  }, [logout, router]);

  return { sessionLoading, handleLockVault, handleLogout };
}
