import { defineConfig } from '@playwright/test';

// Never run browser mutations against the normal application database.
const database = process.env.E2E_DATABASE_URL;
const parsed = database ? new URL(database.replace('postgresql+psycopg:', 'postgresql:')) : null;
if (!parsed || !['localhost', '127.0.0.1'].includes(parsed.hostname)
    || parsed.pathname !== '/cipheria_import_test') {
  throw new Error('E2E_DATABASE_URL must target the local disposable cipheria_import_test database');
}

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  reporter: 'list',
  // Discard generated failure context and avoid recording the working diff.
  preserveOutput: 'never',
  captureGitInfo: { commit: false, diff: false },
  use: {
    baseURL: 'http://127.0.0.1:3318',
    viewport: { width: 1440, height: 1000 },
    trace: 'off', video: 'off', screenshot: 'off',
  },
  webServer: [
    {
      command: 'uv run --directory api uvicorn index:app --host 127.0.0.1 --port 8018',
      url: 'http://127.0.0.1:8018/health',
      reuseExistingServer: false,
      env: {
        DATABASE_URL: database,
        JWT_SECRET: 'isolated-browser-tests-only-not-production-01234567890123456789',
        ENVIRONMENT: 'development', REDIS_ENABLED: 'false', VERCEL: '', SMTP_HOST: '',
        ALLOWED_ORIGINS: 'http://127.0.0.1:3318',
      },
    },
    {
      command: 'node scripts/start-e2e.mjs',
      url: 'http://127.0.0.1:3318',
      reuseExistingServer: false,
      env: { CSP_REPORT_ONLY: process.env.CSP_REPORT_ONLY ?? '0' },
    },
  ],
});
