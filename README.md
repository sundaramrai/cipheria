# Cipheria

A password manager built with Next.js, FastAPI, PostgreSQL and Redis. Vault contents are encrypted in the browser with AES-256-GCM; item names, categories and account details remain server-readable.

- Logins, cards, notes and identities, with search, favourites and Trash.
- Password generation, local strength estimates, optional breach checks and encrypted password history.
- Browser CSV import and encrypted Cipheria JSON export/restore.
- Vault locking, session revocation, conflict-safe edits and master-password/key changes.

The master password cannot be reset to recover vault contents. See [security boundaries](docs/threat-model.md).

## Run locally

Requires Node.js 24, pnpm 12.15.0, Python 3.14, uv and Docker for PostgreSQL/Redis.

Create `api/.env`:

```env
ENVIRONMENT=development
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5434/cipheria
REDIS_ENABLED=true
REDIS_URL=redis://127.0.0.1:6379/0
JWT_SECRET=replace-with-a-long-random-secret
ALLOWED_ORIGINS=http://localhost:3000
```

Create `.env.local` at the repository root:

```env
NEXT_PUBLIC_API_URL=http://127.0.0.1:8000
```

From the repository root, install dependencies and start the API:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d db redis
pnpm install --frozen-lockfile
cd api
uv sync --frozen --group dev
uv run alembic -c ../alembic.ini upgrade head
uv run uvicorn index:app --reload --port 8000
```

In another terminal at the repository root, run `pnpm dev` and open `http://localhost:3000`. On Windows, use `pnpm.cmd` if PowerShell blocks `pnpm.ps1`.

To run the API and frontend in Docker instead, use `docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build`. Stop the host processes first to free ports 3000 and 8000.

## Import and export

Unlock the vault and choose **Import** beside **Export**. CSV imports support column mapping for title, URL, username, password and notes. JSON restores accept Cipheria 1.0/2.0 exports and require the export-time master password.

Files must contain 1-1,000 records/items and fit within 2 MiB. Imports preview duplicates, create new items and never overwrite existing ones. Passkeys and authenticator secrets do not transfer. Delete plaintext browser CSVs after importing. [Import details](docs/architecture.md#import-and-export).

## Configuration and deployment

Provide production secrets through the hosting platform, not committed `.env` files:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL`, `JWT_SECRET` | Required database connection and signing secret |
| `ENVIRONMENT=production` | Production cookie settings; disables API docs |
| `ALLOWED_ORIGINS` | Exact trusted browser origins, comma-separated |
| `REDIS_URL` | Recommended cache and shared rate-limit storage |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM`, `SMTP_STARTTLS` | Optional verification-email delivery |
| `APP_BASE_URL` | Public frontend URL for verification links |

Vercel uses the repository root and **Services** preset: Next.js at `/`, FastAPI at `/api/*`. Leave `NEXT_PUBLIC_API_URL` unset there. For Docker production builds, set the frontend's `INTERNAL_API_ORIGIN` build argument to the API origin.

Production migrations run separately from deployment:

1. Verify CI/preview, back up the database and pause writes before schema/key changes.
2. From `api/`, with the intended `DATABASE_URL`, run `uv run alembic -c ../alembic.ini upgrade head`, then `uv run alembic -c ../alembic.ini current`. The current head is `0010_vault_key_envelopes`.
3. Coordinate frontend/API deployment, retire old API writers and reload old tabs. Smoke-test a disposable account before resuming writes.

Migration `0010` preserves existing ciphertext; users upgrade legacy encryption in Settings or when changing their master password. Its downgrade is refused; rollback requires a compatible full backup.

## Development checks

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
cd api
uv run ruff check .
uv run python -m unittest discover -s tests -v
```

PostgreSQL integration and browser checks require a disposable database; see [test setup](docs/architecture.md#test-setup). CI configuration is in [checks.yml](.github/workflows/checks.yml).

[Architecture](docs/architecture.md) | [Key formats](docs/key-management.md) | [Roadmap](docs/technical-roadmap.md) | [GPL-3.0](LICENSE)
