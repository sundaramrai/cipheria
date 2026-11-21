import { cp } from 'node:fs/promises';

// Exercise the same standalone output used by Docker, including its assets.
await cp('public', '.next/standalone/public', { recursive: true });
await cp('.next/static', '.next/standalone/.next/static', { recursive: true });
process.env.PORT = '3318';
process.env.HOSTNAME = '127.0.0.1';
const server = new URL('../.next/standalone/server.js', import.meta.url);
await import(server.href);
