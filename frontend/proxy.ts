import { NextResponse } from 'next/server';

/**
 * Pass-through proxy hook.
 *
 * Session validation is handled by the frontend bootstrap + backend refresh
 * flow. Redirecting from here based only on the presence of a refresh cookie
 * can trap users in stale-cookie redirect loops after the server session has
 * expired.
 */
export function proxy() {
    return NextResponse.next();
}

export const config = {
    matcher: ['/auth'],
};
