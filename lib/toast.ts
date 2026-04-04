/**
 * toast.ts — Application-wide toast service.
 *
 * Wraps `react-hot-toast` so that:
 *   - Call-sites never import `react-hot-toast` directly.
 *   - The repeating loading → success / error pattern is a single call.
 *   - Error messages flow through the shared `parseApiError` helper.
 *
 * Usage examples
 * Simple:
 *   toastService.success('Saved!');
 *   toastService.error('Something went wrong');
 *
 * Fire-and-forget loading toast (multi-step):
 *   const id = toastService.loading('Saving…');
 *   toastService.update(id, 'Verifying…');
 *   toastService.success('Done', id);
 *
 * Full lifecycle (recommended for async operations):
 *   await toastService.withProgress(
 *     'Saving to vault…',
 *     async (update) => {
 *       update('Encrypting…');   // optional mid-flight message change
 *       await doWork();
 *     },
 *     'Saved!',                  // shown on success
 *     { fallbackError: 'Save failed' },
 *   );
 */

import { createElement } from 'react';
import { Info } from 'lucide-react';
import toast from 'react-hot-toast';
import { parseApiError } from '@/lib/errors';

const infoToastIcon = createElement(Info, { size: 16, strokeWidth: 2.25 });

export const toastService = {
    /** Persistent success toast. */
    success: (msg: string, toastId?: string) =>
        toast.success(msg, toastId ? { id: toastId } : undefined),

    /** Persistent informational toast. */
    info: (msg: string, toastId?: string) =>
        toast(msg, {
            ...(toastId ? { id: toastId } : {}),
            icon: infoToastIcon,
        }),

    /** Persistent error toast. */
    error: (msg: string, toastId?: string) =>
        toast.error(msg, toastId ? { id: toastId } : undefined),

    /**
     * Show a loading toast.  Returns the toast ID so you can update or
     * resolve it later.  Pass an existing `toastId` to replace a toast
     * in-place without creating a new one.
     */
    loading: (msg: string, toastId?: string): string =>
        toast.loading(msg, toastId ? { id: toastId } : undefined),

    /** Update a loading toast's message without changing its ID. */
    update: (toastId: string, msg: string) => {
        toast.loading(msg, { id: toastId });
    },

    /**
     * Generic notification (no icon override by default).
     * Use for informational messages that don't fit success / error.
     * Accepts a `react-hot-toast` options object (e.g. `{ icon: '🔒' }`).
     */
    notify: (msg: string, options?: Parameters<typeof toast>[1]) =>
        toast(msg, options),

    /**
     * Wraps an async operation with a full loading → success / error
     * toast lifecycle.
     *
     * @param loadingMsg  Message shown while `fn` is running.
     * @param fn          Async work to perform.  Receives `update(msg)` so
     *                    you can change the loading message mid-flight.
     * @param successMsg  Toast shown when `fn` resolves.
     * @param options     Optional error handling overrides:
     *   - `getError`      Fully custom error → string extractor.
     *   - `fallbackError` Passed to `parseApiError` when no detail field exists.
     *
     * Errors are caught internally and surfaced as toast errors. The
     * function always returns `T | undefined` — callers that need
     * guaranteed cleanup should wrap in their own try/finally.
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
