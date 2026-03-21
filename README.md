<div align="center">

# Cipheria

### Zero-Knowledge Password Manager

*Your master password never leaves your device.*

[![License: GPL-3.0](https://img.shields.io/badge/License-GPL%203.0-blue.svg)](LICENSE)
[![Live Demo](https://img.shields.io/badge/Live-cipheria.vercel.app-brightgreen)](https://cipheria.vercel.app)

</div>

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
|-- api/                        # FastAPI backend
|   |-- index.py                # App entry point
|   |-- database.py             # SQLAlchemy models and DB session
|   |-- crypto.py               # JWT and password helpers
|   |-- deps.py                 # Auth dependencies
|   |-- routes/
|   |   |-- auth.py             # /api/auth/*
|   |   `-- vault.py            # /api/vault/*
|   |-- pyproject.toml          # Python dependencies
|   `-- uv.lock                 # Locked Python dependency graph
|-- frontend/                   # Next.js app
|   |-- app/
|   |-- components/
|   |-- lib/
|   `-- package.json
|-- alembic/                    # Database migrations
|-- alembic.ini
`-- vercel.json                 # Single-project Vercel routing
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

### Frontend: `frontend/.env.local`

```env
NEXT_PUBLIC_API_URL=http://localhost:8000
```

## Local Development

### 1. Install frontend dependencies

```bash
cd frontend
npm install
cd ..
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
cd frontend
npm run dev
```

Open `http://localhost:3000`.

## Vercel Deployment

This repo is deployed as a single Vercel project from the repository root.

Set these environment variables in Vercel:

- `DATABASE_URL`
- `JWT_SECRET`
- `ALLOWED_ORIGINS`
- `NEXT_PUBLIC_API_URL` set to your deployment URL
- `REDIS_URL` if Redis is enabled
- SMTP variables if email sending is enabled

The root [vercel.json](/c:/Sundaram%27s%20Workspace/Cipheria/vercel.json) routes:

- `/api/*` to the FastAPI backend
- everything else to the Next.js frontend

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

Interactive docs are available only outside production:

- `http://localhost:8000/api/docs`
- `http://localhost:8000/api/redoc`

## Useful Commands

### Frontend

```bash
cd frontend
npm run dev
npm run lint
npm run typecheck
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
