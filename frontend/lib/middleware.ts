import { NextRequest, NextResponse } from "next/server";

// Simple in-edge rate limiter using Vercel's built-in edge runtime.
// Tracks request counts per IP using a Map (resets per edge instance,
// but combined with Redis slowapi this is a strong first line of defense).

const RATE_LIMITS: Record<string, { max: number; windowMs: number }> = {
    "/api/auth/login": { max: 10, windowMs: 60_000 },
    "/api/auth/register": { max: 5, windowMs: 60_000 },
    "/api/auth/refresh": { max: 20, windowMs: 60_000 },
};

// ip:path -> { count, resetAt }
const counters = new Map<string, { count: number; resetAt: number }>();

export function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl;
    const rule = RATE_LIMITS[pathname];

    if (!rule) return NextResponse.next();

    const ip =
        request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
        request.headers.get("x-real-ip") ??
        "unknown";

    const key = `${ip}:${pathname}`;
    const now = Date.now();
    const entry = counters.get(key);

    if (!entry || now > entry.resetAt) {
        // First request or window expired — reset
        counters.set(key, { count: 1, resetAt: now + rule.windowMs });
        return NextResponse.next();
    }

    if (entry.count >= rule.max) {
        const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
        return NextResponse.json(
            { error: `Rate limit exceeded. Try again in ${retryAfter}s.` },
            {
                status: 429,
                headers: {
                    "Retry-After": String(retryAfter),
                    "X-RateLimit-Limit": String(rule.max),
                    "X-RateLimit-Remaining": "0",
                    "X-RateLimit-Reset": String(Math.ceil(entry.resetAt / 1000)),
                },
            }
        );
    }

    entry.count += 1;
    return NextResponse.next();
}

export const config = {
    matcher: [
        "/api/auth/login",
        "/api/auth/register",
        "/api/auth/refresh",
    ],
};