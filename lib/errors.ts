type ApiErrorLike = {
    message?: string;
    response?: {
        status?: number;
        data?: {
            detail?: unknown;
        };
    };
};

type ValidationErrorLike = {
    msg?: unknown;
};

function getApiErrorDetail(err: unknown): unknown {
    return (err as ApiErrorLike)?.response?.data?.detail;
}

/**
 * Extract the best error message from a FastAPI / axios error.
 *
 * FastAPI can return:
 *   - `{ detail: "string" }` plain 4xx/5xx
 *   - `{ detail: [{msg, loc, ...}] }` pydantic validation errors
 *
 * Falls back to `fallback` when no detail is present.
 */
export const parseApiError = (err: unknown, fallback: string): string => {
    const detail = getApiErrorDetail(err);
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail) && detail.length > 0) {
        return detail
            .map((entry) => {
                const validationEntry = entry as ValidationErrorLike;
                return String(validationEntry.msg ?? entry).replace(/^Value error,\s*/i, '');
            })
            .join('; ');
    }
    return fallback;
};

export const getSessionAwareError = (err: unknown, fallback: string): string => {
    const status = (err as ApiErrorLike)?.response?.status;
    const detail = parseApiError(err, fallback);
    if (status === 401 && detail === 'Could not validate credentials') {
        return 'Session expired - please sign in again';
    }
    return detail;
};

/**
 * Human-readable error for vault item load / decrypt failures.
 * Used by `handleSelectItem` and similar item-fetch flows.
 */
export const getItemLoadError = (err: unknown): string => {
    const e = err as ApiErrorLike;
    if (e?.message === 'CRYPTO_FAIL') return 'Decrypt failed - wrong master password?';
    if (e?.message === 'BAD_FORMAT') return 'Item data is corrupted';
    if (e?.message === 'NO_KEY') return 'Vault is locked - please re-enter master password';
    if (e?.response?.status === 404) return 'Item not found';
    if (e?.response?.status === 401) {
        return getSessionAwareError(err, 'Session expired - please sign in again');
    }
    return 'Failed to load item';
};
