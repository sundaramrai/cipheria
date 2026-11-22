import assert from 'node:assert/strict';
import test from 'node:test';
import { contentSecurityPolicy } from '../lib/securityHeaders.ts';

test('production CSP authorizes the nonce without inline scripts or eval', () => {
  const directives = new Map(contentSecurityPolicy('test-nonce', false).split('; ').map(value => {
    const [name, ...sources] = value.split(' ');
    return [name, sources];
  }));
  assert.ok(directives.get('script-src').includes("'nonce-test-nonce'"));
  assert.ok(directives.get('script-src').includes("'strict-dynamic'"));
  assert.ok(!directives.get('script-src').includes("'unsafe-inline'"));
  assert.ok(!directives.get('script-src').includes("'unsafe-eval'"));
  assert.deepEqual(directives.get('frame-ancestors'), ["'none'"]);
  assert.deepEqual(directives.get('connect-src'), ["'self'", 'https://api.pwnedpasswords.com']);
  assert.ok(directives.has('upgrade-insecure-requests'));
});

test('development CSP supports HMR without forcing local HTTPS', () => {
  const policy = contentSecurityPolicy('test-nonce', true);
  assert.ok(policy.includes("'unsafe-eval'"));
  assert.ok(policy.includes('ws: wss:'));
  assert.ok(!policy.includes('upgrade-insecure-requests'));
});
