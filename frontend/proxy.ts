import { NextRequest, NextResponse } from 'next/server';

/**
 * Pass-through proxy hook.
 *
 * Authoritative rate limiting is enforced by the backend's Redis-backed
 * slowapi limiter. We intentionally avoid duplicating an in-memory limiter
 * here because it would only be per-instance and could drift from backend
 * policy.
 */
export function proxy(request: NextRequest) {
    if (request.nextUrl.pathname === '/auth') {
        const mode = request.nextUrl.searchParams.get('mode');
        const hasRefreshCookie = Boolean(request.cookies.get('refresh_token')?.value);

        if (!mode && hasRefreshCookie) {
            return NextResponse.redirect(new URL('/dashboard', request.url));
        }
    }

    return NextResponse.next();
}

export const config = {
    matcher: ['/auth'],
};
