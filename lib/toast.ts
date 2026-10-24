/**
 * Reuses a toast ID while vault operations encrypt, save, or re-encrypt items.
 * API error messages are extracted through parseApiError.
 */

import { createElement } from 'react';
import { Info } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { parseApiError } from '@/lib/errors';

const infoToastIcon = createElement(Info, { size: 16, strokeWidth: 2.25 });

export const toastService = {
    success: (msg: string, toastId?: string) =>
        toast.success(msg, toastId ? { id: toastId } : undefined),

    info: (msg: string, toastId?: string) =>
        toast(msg, {
            ...(toastId ? { id: toastId } : {}),
            icon: infoToastIcon,
        }),

    error: (msg: string, toastId?: string) =>
        toast.error(msg, toastId ? { id: toastId } : undefined),

    /** Returns the toast ID for subsequent progress or result updates. */
    loading: (msg: string, toastId?: string): string =>
        toast.loading(msg, toastId ? { id: toastId } : undefined),

    update: (toastId: string, msg: string) => {
        toast.loading(msg, { id: toastId });
    },

    notify: (msg: string, options?: Parameters<typeof toast>[1]) =>
        toast(msg, options),

    /**
     * Displays progress and catches failures, resolving to undefined on error.
     * Callers reset their saving/deleting state in their own finally blocks.
     */
    async withProgress<T>(
        loadingMsg: string,
        fn: (update: (msg: string) => void) => Promise<T>,
        successMsg: string,
        options?: {
            getError?: (err: unknown) => string;
            fallbackError?: string;
        },
    ): Promise<T | undefined> {
        const id = toast.loading(loadingMsg);
        const update = (msg: string) => toast.loading(msg, { id });
        try {
            const result = await fn(update);
            toast.success(successMsg, { id });
            return result;
        } catch (err: unknown) {
            const msg = options?.getError
                ? options.getError(err)
                : parseApiError(err, options?.fallbackError ?? 'Operation failed');
            toast.error(msg, { id });
            return undefined;
        }
    },
};
