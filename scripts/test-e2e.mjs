import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../node_modules/@playwright/test/cli.js', import.meta.url));
// Each journey keeps the real per-IP limits, with fresh test-server state.
const specs = readdirSync(new URL('../tests/e2e/', import.meta.url)).filter(file => file.endsWith('.spec.mjs')).sort();
if (!specs.length) throw new Error('No browser spec files found');
for (const spec of specs) {
  const result = spawnSync(process.execPath, [cli, 'test', `tests/e2e/${spec}`,
    ...process.argv.slice(2), '--pass-with-no-tests'], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
