# Cipheria

Cipheria is a web vault for logins, payment cards, notes, and identities. The Next.js frontend encrypts item contents in the browser; the FastAPI backend stores ciphertext and the metadata used to list items.

## Vault features

- Search saved names, login usernames, and website URLs across a category, Favourites, or Trash.
- Generate passwords with length and character options; view a local strength estimate or explicitly check a password against known breaches.
- Keep the last five replaced login passwords inside the item's encrypted history.
- Lock the vault, sign out other browser sessions, change the master password, or explicitly rotate the vault key.
- Import browser password CSVs with column mapping, record selection, local encryption, and duplicate handling through Import Vault beside Export Vault (Import/Export on mobile).
- Download JSON exports containing encrypted item contents and readable listing metadata, and restore Cipheria 1.0 or 2.0 exports through the same import flow.

## Data and privacy

- Item contents use AES-256-GCM. New and upgraded vaults use a random data key protected by a password-derived wrapping key; legacy vaults retain their password-derived data key until upgraded. The API receives a derived authentication verifier, not the raw master password.
- Item names, categories, favourites, timestamps, and account details remain readable to the server.
- Icons are local. Analytics and performance events are limited to the public landing page; auth and vault events are discarded.
- The master password cannot be reset to recover encrypted contents. An older export still requires the password used when that export was made.

The [architecture guide](docs/architecture.md) documents key derivation, session checks, data flows, cache behaviour, and the implementation files for each responsibility.

## Import passwords or restore an export

Unlock the destination vault and select **Import Vault** beside **Export Vault** in the sidebar, or **Import** beside **Export** at the bottom of the mobile item list. Files are limited to 2 MiB and 1,000 records/items. Your name, email address, and email-verification status are grouped under **Settings → Profile**.

- **Browser passwords (CSV):** choose a comma-separated CSV and click **Read CSV**. Confirm or adjust the title, website URL, username, password, and notes columns. Common Chrome/Edge headers are recognized; Firefox/Apple-style and custom headers can be mapped. When the title is absent, a website hostname supplies it. Blank usernames are allowed; passwords retain their original spaces, quotes, and newlines. Review invalid record numbers and explicitly acknowledge any nonempty unmapped columns before preparing the preview. Select which valid records to save. Browser IDs/timestamps/form-action metadata do not transfer; passkeys and authenticator secrets are not imported. Tests use synthetic browser-layout fixtures, not a guarantee for every browser version. CSV files contain readable passwords, so remove the local export when finished.
- **Cipheria backup (JSON):** choose a Cipheria 1.0 or 2.0 export and enter the master password used when it was exported. Restored items retain creation dates, favourites, supported fields, and password history. Included items restore as active items; version 2 payloads are re-encrypted under new destination IDs.

Both inputs use browser-side encryption and a final preview. Source passwords and plaintext payloads are not sent to the API. Titles and listing metadata retain the existing server-readable representation. Matching duplicates in active items or within the file are skipped by default; uncheck that option to import separate copies. Empty optional fields/history are treated like absent fields when comparing duplicates. Existing items are never overwritten, and new IDs are generated for imported items.

The prepared request is limited to 3 MiB and cannot exceed the destination's 1,000 active-item limit. The batch is saved in one transaction. If confirmation fails, use **Retry import** in the same window; it checks the same operation without adding the batch twice. Closing or locking cannot undo a request that has already reached the server. Later work is listed in the [technical roadmap](docs/technical-roadmap.md).

Apply migrations through `0010_vault_key_envelopes` before deploying the updated API. From `api/`, with the intended deployment's `DATABASE_URL` configured, run `uv run alembic -c ../alembic.ini upgrade head`. The schema adds import receipts, item revisions and nullable wrapped-key metadata; it does not convert existing ciphertext or passwords. Deploy the API and frontend together, drain old API writers, and reload existing tabs. Old clients without write preconditions or using a migrated vault's obsolete format are rejected. Production migration and deployment remain separate from local verification.

New accounts use a random vault key protected by the master password. Ordinary password changes rewrap that key without replacing saved ciphertext. Existing accounts can choose **Upgrade vault encryption** in Settings using their current password, or upgrade when changing the password. **Rotate vault key** explicitly re-encrypts every item including Trash. Old and new JSON exports remain importable with their export-time password; names and listing metadata remain server-readable. See the [key-management design](docs/key-management.md) for formats, rollback requirements and security limits.

Item changes use revisions to prevent overwriting work saved in another tab or device. A conflicting edit stays open with its unsaved fields; choose **Save as a separate item**, or explicitly **Discard edits and reload**. Favourite, trash, restore and permanent-delete operations also check revisions. Password changes verify the revision of every item before replacing any ciphertext. Requests prepared under an old vault salt are rejected, and a profile update that changes the account or salt locks the local vault.

## Requirements

- Node.js 24 and pnpm 12.15.0 (pinned in `package.json`)
- Python 3.14 and [uv 0.13.5](https://docs.astral.sh/uv/) (also pinned in the API Dockerfile)
- Docker Desktop for local PostgreSQL and Redis services

Install the pnpm version pinned in `package.json`. The workspace sets `pmOnFail: ignore`
to keep `pnpm-lock.yaml` in a single-document format that GitHub's dependency graph
can read. This disables automatic pnpm version switching; dependency verification
and security auditing remain enabled. See the [upstream compatibility issue](https://github.com/dependabot/dependabot-core/issues/15904).

`pnpm typecheck` explicitly runs the stable TypeScript 7 compiler through the `typescript-native` alias. Next.js and ESLint use the TypeScript 6 API compatibility package; the experimental native ESLint backend is not enabled.

## Run locally

The commands below run PostgreSQL and Redis in Docker, with FastAPI and Next.js on the host for hot reload.

### 1. Configure the API

Create `api/.env`. Never commit it.

```env
ENVIRONMENT=development
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5434/cipheria
REDIS_ENABLED=true
REDIS_URL=redis://127.0.0.1:6379/0
JWT_SECRET=replace-with-a-long-random-secret
ALLOWED_ORIGINS=http://localhost:3000
```

The addresses match the IPv4 loopback bindings in `docker-compose.dev.yml`.

SMTP is optional. Add these only when testing email verification:

```env
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USERNAME=your-user
SMTP_PASSWORD=your-password
SMTP_FROM=no-reply@example.com
SMTP_STARTTLS=true
APP_BASE_URL=http://localhost:3000
```

Create `.env.local` at the repository root so the Next.js development server proxies browser requests to FastAPI:

```env
NEXT_PUBLIC_API_URL=http://127.0.0.1:8000
```

### 2. Start local infrastructure

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d db redis
```

PostgreSQL is exposed only at `127.0.0.1:5434`; Redis is exposed only at `127.0.0.1:6379`. Both are separate from any managed database. A fresh local PostgreSQL volume has no users or vault items.

### 3. Install dependencies and migrate

From the repository root:

```bash
pnpm install
cd api
uv sync --group dev
uv run alembic -c ../alembic.ini upgrade head
```

### 4. Run the API

Continue in the `api` directory from step 3 and keep this terminal open:

```bash
uv run uvicorn index:app --reload --port 8000
```

Verify it with `http://127.0.0.1:8000/health`.

### 5. Run the frontend

In a second terminal, from the repository root:

```bash
pnpm dev
```

Open `http://localhost:3000`.

On Windows systems where PowerShell blocks `pnpm.ps1`, use `pnpm.cmd` in place of `pnpm`.

## Full Docker development stack

From the repository root, run the UI and API in containers too:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

Do not run this at the same time as the host-based API/UI workflow: both use ports 3000 and 8000. Stop the stack with:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml down
```

To also erase the local PostgreSQL data volume:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml down -v
```

## Configuration and deployment

`api/.env` is only for local development. In a deployment, provide environment variables through the platform's secret manager:

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `JWT_SECRET` | Yes | JWT signing secret |
| `ALLOWED_ORIGINS` | Yes | Comma-separated browser origins allowed by CORS |
| `ENVIRONMENT=production` | Yes | Enables production behavior and hides API docs |
| `REDIS_URL` | Recommended | Cache and shared rate-limit storage |
| `SMTP_*` | Optional | Email verification delivery |
| `APP_BASE_URL` | With email verification | Public frontend URL used in verification links |

The repository's `vercel.json` defines a Vercel Services deployment using `services` and explicit routing rules: Next.js serves `/` and FastAPI serves `/api/*`. Vercel forwards the public path unchanged. When `VERCEL=1`, ASGI middleware sets `root_path="/api"` to match those requests against the existing routes; local Uvicorn and Docker keep the unprefixed paths. Do not set `NEXT_PUBLIC_API_URL` there; the browser should use the same origin. Vercel project settings must use the repository root and the `Services` framework preset. Node.js is restricted to `24.x` in `package.json`, allowing updates within that major version.

The `Dockerfile` and `api/Dockerfile` build separate production UI and API images. Set `INTERNAL_API_ORIGIN` as a frontend build argument when the production UI image must proxy requests to the API; Next.js generates those rewrites during the build. Supply API secrets at runtime. The production API container starts Uvicorn without running migrations, so apply Alembic migrations as a separate deployment step.

## Development checks

ESLint 10 uses `eslint-plugin-import-x` for import checks and
`@htmlacademy/eslint-plugin-jsx-a11y` for the existing JSX accessibility rules.
Both declare ESLint 10 support. The accessibility fork requires Node.js 24 or later.
The frontend tests include lint regression cases for these checks and React Hooks.

From the repository root:

```bash
pnpm lint
pnpm typecheck
pnpm build
pnpm test

cd api
uv run ruff check .
uv run python -m unittest discover -s tests -v
```

Import tests also exercise PostgreSQL row locking when `TEST_DATABASE_URL` is set to a local PostgreSQL database named `cipheria_import_test`. The tests create and remove their own randomly named schemas there. Without this variable, PostgreSQL cases are reported as skipped; isolated unit and routing tests still run. Never point the test variable at the application database.

The GitHub Actions workflow runs these checks with a disposable PostgreSQL service and Chromium browser journeys. To run the browser suite locally, provision a separate local database named `cipheria_import_test`, set both `DATABASE_URL` and `E2E_DATABASE_URL` to its URL, and apply migrations there. Build with `INTERNAL_API_ORIGIN=http://127.0.0.1:8018`, then run `pnpm exec playwright install chromium` and `pnpm test:e2e`. The suite starts its own API on port 8018 and frontend on 3318; leave those ports free. It refuses nonlocal or differently named databases and stores no browser screenshots, traces, or videos. It creates synthetic test accounts in that disposable database.

The application supports same-origin browser/API deployment. State-changing API requests require `X-Requested-With: XMLHttpRequest`, including refresh and logout; the shared frontend client supplies it. Production refresh cookies use Secure, HttpOnly and SameSite=Lax. Configure exact trusted `ALLOWED_ORIGINS`. A nonce CSP is enforced by default; `CSP_REPORT_ONLY=1` enables staging inspection. Per-request nonces make documents dynamically rendered, including the landing page. See the [threat model](docs/threat-model.md) for remaining risks and deployment requirements.

The browser runner discovers `tests/e2e/*.spec.mjs` and restarts its test services between files to isolate per-IP rate limits. Production rate-limit checks remain enabled.

## Repository layout

```text
app/                 Next.js App Router pages
components/          Dashboard and auth UI
lib/                 Browser crypto and API client
api/                 FastAPI application
alembic/             PostgreSQL migrations
docs/                Architecture and design documentation
docker-compose*.yml  Local Docker infrastructure and development stack
```

## License

[GPL-3.0](LICENSE)
