import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { ESLint } from 'eslint';

const eslint = new ESLint({ cwd: fileURLToPath(new URL('..', import.meta.url)) });

async function lint(source, filePath = 'app/page.tsx') {
  const [result] = await eslint.lintText(source, { filePath });
  assert.equal(result.fatalErrorCount, 0, JSON.stringify(result.messages));
  return result;
}

test('ESLint 10 retains accessibility diagnostics for JSX', async () => {
  const result = await lint(`
    export default function Example() {
      return <div>
        <img src="/example.png" />
        <button aria-invalid-property="true">Save</button>
        <div onClick={() => {}}>Open</div>
        <a href="#">Link</a>
      </div>;
    }
  `);
  const rules = new Set(result.messages.map(message => message.ruleId));
  for (const rule of [
    'jsx-a11y/alt-text',
    'jsx-a11y/aria-props',
    'jsx-a11y/click-events-have-key-events',
    'jsx-a11y/no-static-element-interactions',
    'jsx-a11y/anchor-is-valid',
  ]) {
    assert.ok(rules.has(rule), `Missing accessibility diagnostic: ${rule}`);
  }
});

test('import checks reject unresolved modules', async () => {
  const result = await lint(
    "export { missing } from './does-not-exist.mjs';",
    'tests/eslint.test.mjs',
  );
  assert.ok(result.messages.some(message => message.ruleId === 'import-x/no-unresolved'));
});

test('TypeScript path aliases and accessible JSX still pass', async () => {
  const result = await lint(`
    import { encryptData } from '@/lib/crypto';
    export { encryptData };
    export default function Example() {
      return <button type="button">Save</button>;
    }
  `);
  assert.equal(result.errorCount, 0, JSON.stringify(result.messages));
  assert.equal(result.warningCount, 0, JSON.stringify(result.messages));
});

test('React Hooks checks remain active', async () => {
  const result = await lint(`
    import { useState } from 'react';
    export default function Example({ enabled }: { enabled: boolean }) {
      if (enabled) useState(0);
      return <button type="button">Save</button>;
    }
  `);
  assert.ok(result.messages.some(message => message.ruleId === 'react-hooks/rules-of-hooks'));
});
