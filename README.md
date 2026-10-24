# Cipheria

Cipheria is a web vault for logins, payment cards, notes, and identities. The Next.js frontend encrypts item contents in the browser; the FastAPI backend stores ciphertext and the metadata used to list items.

## Vault features

- Search saved names, login usernames, and website URLs across a category, Favourites, or Trash.
- Generate passwords with length and character options; view a local strength estimate or explicitly check a password against known breaches.
- Keep the last five replaced login passwords inside the item's encrypted history.
- Lock the vault, sign out other browser sessions, or change the master password and re-encrypt existing items.
- Download JSON exports containing encrypted item contents and readable listing metadata. There is currently no import/restore flow for export files.

## Data and privacy

- Item contents use AES-256-GCM with a key derived locally from the master password. The API receives a derived authentication verifier, not the raw master password.
- Item names, categories, favourites, timestamps, and account details remain readable to the server.
- Icons are local. Analytics and performance events are limited to the public landing page; auth and vault events are discarded.
- The master password cannot be reset to recover encrypted contents. An older export still requires the password used when that export was made.

The [architecture guide](docs/architecture.md) documents key derivation, session checks, data flows, cache behaviour, and the implementation files for each responsibility.

## Requirements

- Node.js 24 and pnpm 12.15.0 (pinned in `package.json`)
- Python 3.14 and [uv 0.13.5](https://docs.astral.sh/uv/) (also pinned in the API Dockerfile)
- Docker Desktop for local PostgreSQL and Redis services

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

The repository's `vercel.json` defines a Vercel Services deployment: Next.js serves `/` and FastAPI serves `/api/*`. Do not set `NEXT_PUBLIC_API_URL` there; the browser should use the same origin. Vercel project settings must use the repository root and the `Services` framework preset.

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
