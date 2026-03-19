'use client';

type AuthDebugDetails = Record<string, unknown>;

function getLocationDetails() {
  if (globalThis.window === undefined) {
    return {
      origin: 'server',
      href: 'server',
      pathname: 'server',
    };
  }

  return {
    origin: globalThis.window.location.origin,
    href: globalThis.window.location.href,
    pathname: globalThis.window.location.pathname,
  };
}

export function logAuthDebug(event: string, details: AuthDebugDetails = {}) {
  if (typeof console === 'undefined') return;

  console.info('[auth-debug]', event, {
    at: new Date().toISOString(),
    ...getLocationDetails(),
    ...details,
  });
}
