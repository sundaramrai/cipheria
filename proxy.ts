import { NextResponse, type NextRequest } from 'next/server';
import { contentSecurityPolicy } from './lib/securityHeaders';

/**
 * Apply a unique nonce to each rendered document and its Next.js scripts.
 *
 * Session validation is handled by the frontend bootstrap + backend refresh
 * flow. Redirecting from here based only on the presence of a refresh cookie
 * can trap users in stale-cookie redirect loops after the server session has
 * expired.
 */
export function proxy(request: NextRequest) {
    const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
    const policy = contentSecurityPolicy(nonce, process.env.NODE_ENV !== 'production');
    const headers = new Headers(request.headers);
    headers.set('x-nonce', nonce);
    // Next reads the request policy to nonce its framework and hydration scripts.
    headers.set('Content-Security-Policy', policy);
    const response = NextResponse.next({ request: { headers } });
    response.headers.set(
        process.env.CSP_REPORT_ONLY === '1'
            ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy',
        policy,
    );
    response.headers.set('Cache-Control', 'private, no-store');
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set('X-Frame-Options', 'DENY');
    response.headers.set('Referrer-Policy', 'no-referrer');
    return response;
}

export const config = {
    matcher: ['/((?!api(?:/|$)|_next/|favicon\\.svg|robots\\.txt|sitemap\\.xml).*)'],
};
