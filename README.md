<!-- markdownlint-disable MD033 MD041 -->
<div align="center">

# Cipheria

## Zero-Knowledge Password Manager

*Your master password never leaves your device.*

[![License: GPL-3.0](https://img.shields.io/badge/License-GPL%203.0-blue.svg)](LICENSE)
[![Live Demo](https://img.shields.io/badge/Live-cipheria.vercel.app-brightgreen)](https://cipheria.vercel.app)

</div>
<!-- markdownlint-enable MD033 MD041 -->

Cipheria is a zero-knowledge password manager built with Next.js and FastAPI. Encryption and decryption happen in the browser, and the server stores only ciphertext plus metadata.

## Stack

- Frontend: Next.js 16, React 19, TypeScript
- Backend: FastAPI, SQLAlchemy, Redis cache, SlowAPI rate limiting
- Database: PostgreSQL
- Deploy: Vercel

## Security Model

- Master password never leaves the client
- Vault data is encrypted client-side with AES-256-GCM
- Key derivation uses PBKDF2-SHA256 with 600k iterations
- Auth verifier is stored with bcrypt
- Access tokens are short-lived JWTs: 15 minutes
- Refresh tokens are rotated and stored hashed

## Main Features

- Client-side encrypted vault
- Login, card, note, and identity vault items
- Search, favourites, trash, restore, and permanent delete
- Email verification flow
- Encrypted JSON vault export
- Automatic access-token refresh
- Optional Redis-backed caching and rate limiting

## Project Structure

```text
cipheria/
|-- app/                        # Next.js App Router pages
|-- components/                 # Frontend UI and hooks
|-- lib/                        # Frontend store, API client, crypto helpers
|-- public/                     # Static assets
|-- styles/                     # Global styles
|-- api/                        # FastAPI backend at /api/*
|   |-- index.py                # App entry point
|   |-- database.py             # SQLAlchemy models and DB session
|   |-- crypto.py               # JWT and password helpers
|   |-- deps.py                 # Auth dependencies
|   |-- routes/
|   |   |-- auth.py             # /api/auth/*
|   |   `-- vault.py            # /api/vault/*
|   |-- pyproject.toml          # Python dependencies
|   `-- uv.lock                 # Locked Python dependency graph
|-- alembic/                    # Database migrations
|-- package.json                # Root Next.js app
|-- next.config.js              # Next config; optional local API proxy
`-- alembic.ini
```

## Requirements

- Node.js 18+
- Python 3.14
- [uv](https://docs.astral.sh/uv/)
- PostgreSQL database

## Environment Variables

### Backend: `api/.env`

Required:

```env
DATABASE_URL=postgresql://user:pass@host/db
JWT_SECRET=your-long-random-secret
ALLOWED_ORIGINS=http://localhost:3000
```

Optional:

```env
REDIS_URL=redis://localhost:6379/0

SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USERNAME=your-user
SMTP_PASSWORD=your-password
SMTP_FROM=no-reply@example.com
SMTP_STARTTLS=true
```

### Frontend: `.env.local`

Only needed for local development when the Next app runs on `3000` and the API runs separately on `8000`. The Next dev server rewrites `/api/*` to this origin.

```env
NEXT_PUBLIC_API_URL=http://localhost:8000
```

In production on Vercel, the frontend and backend are same-origin, so `NEXT_PUBLIC_API_URL` is not needed.

## Local Development

### 1. Install frontend dependencies

```bash
pnpm install
```

### 2. Install backend dependencies

```bash
cd api
uv sync --group dev
cd ..
```

### 3. Run database migrations

```bash
cd api
uv run alembic upgrade head
cd ..
```

### 4. Start the backend

```bash
cd api
uv run uvicorn index:app --reload --port 8000
```

### 5. Start the frontend

```bash
pnpm dev
```

Open `http://localhost:3000`.

## Vercel Deployment

This repo is deployed as a single Vercel project from the repository root.

The repository uses [vercel.json](/c:/Sundaram%27s%20Workspace/Cipheria/vercel.json) with `experimentalServices` so Vercel can serve:

- the Next.js app from `/`
- the FastAPI backend from `/api/*`

Dashboard requirements:

- set the project Framework Preset to `Services`
- make sure your Vercel account/project has access to Services
- keep the project Root Directory as the repository root

Set these environment variables in Vercel:

- `DATABASE_URL`
- `JWT_SECRET`
- `ALLOWED_ORIGINS` set to your production origin
- `REDIS_URL` if Redis is enabled
- SMTP variables if email sending is enabled

Do not set `NEXT_PUBLIC_API_URL` in production. The Services config keeps frontend and backend on the same origin, and the local dev rewrite is disabled in production.

## API Overview

### Auth

Base path: `/api/auth`

- `POST /register`
- `POST /login/challenge`
- `POST /login`
- `POST /refresh`
- `POST /logout`
- `POST /verify-email`
- `POST /verify-email/request`
- `POST /unlock`
- `PATCH /profile`
- `PATCH /master-password`
- `DELETE /account`
- `GET /me`

`/forgot-password` and `/reset-password` exist but intentionally return an error because master-password reset is not supported in zero-knowledge mode.

### Vault

Base path: `/api/vault`

- `GET /export/json`
- `GET /`
- `GET /{item_id}`
- `POST /`
- `PATCH /{item_id}`
- `DELETE /{item_id}`
- `POST /{item_id}/restore`
- `DELETE /{item_id}/permanent`

List endpoint supports:

- `category=login|card|note|identity`
- `search=...`
- `favourites_only=true`
- `deleted_only=true`
- `page`
- `page_size`

### Health

- `GET /api/health`

### Docs

Interactive docs are available only outside production. In local backend development they are served directly from FastAPI:

- `http://localhost:8000/docs`
- `http://localhost:8000/redoc`

## Useful Commands

### Frontend

```bash
pnpm dev
pnpm lint
pnpm typecheck
```

### Backend

```bash
cd api
uv sync --group dev
uv run ruff check .
uv run alembic upgrade head
uv run uvicorn index:app --reload --port 8000
```

## License

Distributed under the [GPL-3.0 License](LICENSE).
