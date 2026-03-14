'use client';
import { useState, useCallback } from 'react';

/**
 * useSignOut
 * Wraps an async logout handler with loading state, preventing double-clicks.
 */
export function useSignOut(handleLogout: () => Promise<void>) {
    const [signingOut, setSigningOut] = useState(false);

    const handleSignout = useCallback(async () => {
        setSigningOut(true);
        try {
            await handleLogout();
        } finally {
            setSigningOut(false);
        }
    }, [handleLogout]);

    return { signingOut, handleSignout };
}
