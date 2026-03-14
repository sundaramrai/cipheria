'use client';
import { useEffect, useRef } from 'react';
import { IDLE_MS } from '../types';
import { toastService } from '../../../lib/toast';

const IDLE_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'] as const;

/**
 * useIdleTimer
 * Auto-locks the vault after IDLE_MS of inactivity.
 * No-ops when the vault is already locked.
 */
export function useIdleTimer(isVaultLocked: boolean, lockVault: () => void) {
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (isVaultLocked) return;

        const reset = () => {
            if (timerRef.current) clearTimeout(timerRef.current);
            timerRef.current = setTimeout(() => {
                lockVault();
                toastService.notify('Vault auto-locked after 5 min of inactivity', { icon: '🔒' });
            }, IDLE_MS);
        };

        IDLE_EVENTS.forEach((e) => globalThis.addEventListener(e, reset, { passive: true }));
        reset();

        return () => {
            if (timerRef.current) clearTimeout(timerRef.current);
            IDLE_EVENTS.forEach((e) => globalThis.removeEventListener(e, reset));
        };
    }, [isVaultLocked, lockVault]);
}
