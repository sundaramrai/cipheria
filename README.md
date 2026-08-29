# Cipheria

Cipheria is a password manager with browser-side vault encryption. The API stores encrypted vault payloads and the metadata required to list them.

## Security boundary

- The browser derives a vault key from the master password with PBKDF2-SHA-256 (600,000 iterations) and encrypts vault payloads with AES-256-GCM.
- The master password is not sent to the API. The API stores a bcrypt-hashed verifier, encrypted payloads, and unencrypted item metadata such as name, category, favourite state, and timestamps.
- Access tokens last 15 minutes. Refresh tokens last 30 days, are rotated, and are stored hashed.
- Losing the master password means encrypted vault data cannot be recovered.

## Requirements

- Node.js 22 and pnpm 10 (the versions used by the Docker image and lockfile)
- Python 3.14 and [uv](https://docs.astral.sh/uv/)
- Docker Desktop for the recommended local PostgreSQL and Redis services

## Run locally

This is the recommended development mode: PostgreSQL and Redis run in Docker; FastAPI and Next.js run on the host with hot reload.

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

`127.0.0.1` is intentional. The Compose services bind to IPv4 loopback; using `localhost` can cause a slow IPv6 fallback on Windows.

SMTP is optional. Add these only when testing email verification:

```env
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USERNAME=your-user
SMTP_PASSWORD=your-password
SMTP_FROM=no-reply@example.com
SMTP_STARTTLS=true
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

```bash
pnpm install
cd api
uv sync --group dev
uv run alembic -c ../alembic.ini upgrade head
```

### 4. Run the API

Keep this terminal open:

```bash
cd api
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

To run the UI and API in containers too:

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

The repository's `vercel.json` defines a Vercel Services deployment: Next.js serves `/` and FastAPI serves `/api/*`. Do not set `NEXT_PUBLIC_API_URL` there; the browser should use the same origin. Vercel project settings must use the repository root and the `Services` framework preset.

The `Dockerfile` and `api/Dockerfile` build separate production UI and API images. They are not the local Compose runtime. Inject deployment configuration at runtime; do not copy `api/.env` into an image.

## Development checks

```bash
pnpm lint
pnpm typecheck
pnpm build

cd api
uv run ruff check .
```

## Repository layout

```text
app/                 Next.js App Router pages
components/          Dashboard and auth UI
lib/                 Browser crypto and API client
api/                 FastAPI application
alembic/             PostgreSQL migrations
docker-compose*.yml  Local Docker infrastructure and development stack
```

## License

[GPL-3.0](LICENSE)
