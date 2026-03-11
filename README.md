<div align="center">

# 🔐 Cipheria

### Zero-Knowledge Password Manager

*Your master password never leaves your device. Ever.*

[![License: GPL-3.0](https://img.shields.io/badge/License-GPL%203.0-blue.svg)](LICENSE)
[![Live Demo](https://img.shields.io/badge/Live-cipheria.vercel.app-brightgreen)](https://cipheria.vercel.app)
![TypeScript](https://img.shields.io/badge/TypeScript-53%25-3178c6)
![Python](https://img.shields.io/badge/Python-23%25-3776ab)

</div>

---

Cipheria is a self-hosted, zero-knowledge password manager. All encryption and decryption happens entirely in your browser — the server stores only ciphertext and never sees your master password or vault contents.

**Stack:** Next.js · FastAPI (Vercel Serverless) · Neon PostgreSQL · Browser Extension (MV3)

---

## How It Works

```
Browser / Extension
    │
    ├── Web Crypto API
    │       Master password → PBKDF2-SHA256 (600k iterations) → 256-bit key
    │       Key never leaves your device
    │
    ├── Next.js Frontend  (Vercel)
    │       Encrypts vault data client-side with AES-256-GCM
    │       Sends only ciphertext to the API
    │
    └── FastAPI Backend  (Vercel Serverless)
            Stores ciphertext + metadata in Neon PostgreSQL
            Cannot decrypt — no key, ever
```

A complete database breach exposes **no plaintext passwords**.

---

## Security Model

| Layer | Protection | Implementation |
|---|---|---|
| Auth password | bcrypt (cost 12) | Never stored in plain text |
| Master password | Never sent to server | PBKDF2-SHA256, 600k iterations |
| Vault data | AES-256-GCM | Unique 12-byte IV per item |
| Transport | TLS 1.3 | Enforced by Vercel |
| Session tokens | Short-lived JWTs (30 min) | Rotating refresh tokens, stored hashed |

---

## Features

- 🔑 **Zero-knowledge encryption** — server sees only ciphertext
- 🌐 **Browser extension** — autofill credentials on any site (MV3)
- 🗂️ **Vault management** — search, categorise, and favourite entries
- 📤 **JSON export** — full encrypted vault export
- 🔄 **Auto token refresh** — seamless session management
- 📱 **Responsive UI** — works on desktop and mobile

---

## Project Structure

```
cipheria/
├── api/                        # FastAPI serverless backend
│   ├── index.py                # Entry point (Mangum adapter)
│   ├── database.py             # SQLAlchemy models + Neon connection
│   ├── crypto.py               # JWT, bcrypt, token utilities
│   ├── schemas.py              # Pydantic request/response schemas
│   ├── deps.py                 # Auth dependency injection
│   ├── routes/
│   │   ├── auth.py             # /api/auth/*
│   │   └── vault.py            # /api/vault/*
│   └── requirements.txt
│
├── frontend/                   # Next.js app
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx            # Landing page
│   │   ├── auth/page.tsx       # Login / Register
│   │   └── dashboard/page.tsx  # Vault dashboard
│   ├── lib/
│   │   ├── crypto.ts           # Web Crypto API (PBKDF2 + AES-256-GCM)
│   │   ├── api.ts              # Axios client + auto-refresh interceptor
│   │   └── store.ts            # Zustand state management
│   └── styles/globals.css
│
├── extension/                  # Browser extension (Manifest V3)
│   ├── manifest.json
│   ├── popup.html
│   ├── popup.js
│   ├── background.js           # Service worker (key storage)
│   └── content.js              # Autofill injection
│
├── alembic/                    # Database migrations
├── vercel.json                 # Routes /api/* → FastAPI, rest → Next.js
└── alembic.ini
```

---

## Quick Start

### Prerequisites

- Node.js 18+
- Python 3.11+
- A [Neon](https://neon.tech) PostgreSQL database

### 1. Clone & install

```bash
git clone https://github.com/sundaramrai/cipheria
cd cipheria

# Install frontend dependencies
cd frontend && npm install && cd ..
```

### 2. Set up environment variables

**`api/.env`**
```env
DATABASE_URL=postgresql://user:pass@ep-xxx.neon.tech/neondb
JWT_SECRET=<run: python -c "import secrets; print(secrets.token_hex(32))">
```

**`frontend/.env.local`**
```env
NEXT_PUBLIC_API_URL=http://localhost:8000
```

> Tables are created automatically on the first API call. No manual migration step needed.

### 3. Run locally

```bash
# Backend
cd api
pip install -r requirements.txt
uvicorn index:app --reload --port 8000

# Frontend (separate terminal)
cd frontend
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

---

## Deploy to Vercel

```bash
npm i -g vercel
vercel login
vercel

# Add environment variables
vercel env add DATABASE_URL
vercel env add JWT_SECRET
vercel env add NEXT_PUBLIC_API_URL   # set to your Vercel deployment URL
```

`vercel.json` automatically routes `/api/*` requests to FastAPI and everything else to Next.js.

Interactive API docs are available at: `https://<your-deployment>.vercel.app/api/docs`

---

## Browser Extension

### Load in Chrome (Development)

1. Navigate to `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** → select the `extension/` folder

### Configure for Production

Edit line 1 of `extension/popup.js`:

```js
const API_URL = "https://cipheria.vercel.app";
```

### Package for Distribution

```bash
cd extension
zip -r cipheria-extension.zip . -x "*.DS_Store"
```

---

## API Reference

**Auth** — `/api/auth/`

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/register` | Create a new account |
| `POST` | `/login` | Authenticate and receive tokens |
| `POST` | `/refresh` | Rotate access token |
| `POST` | `/logout` | Invalidate refresh token |
| `GET` | `/me` | Get current user info |

**Vault** — `/api/vault/`

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/` | List vault items (supports `?search=`, `?category=`, `?favourites_only=true`) |
| `POST` | `/` | Add a new vault item |
| `GET` | `/:id` | Get a single item |
| `PATCH` | `/:id` | Update an item |
| `DELETE` | `/:id` | Delete an item |
| `GET` | `/export/json` | Export full vault as JSON |

---

## Roadmap

- [ ] TOTP two-factor authentication
- [ ] Passkey / WebAuthn support
- [ ] Secure credential sharing (public-key encrypted)
- [ ] Password health dashboard with HIBP breach detection
- [ ] iOS / Android app (React Native)
- [ ] Team / organisation vaults

---

## License

Distributed under the [GPL-3.0 License](LICENSE).
