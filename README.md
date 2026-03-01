# Cipheria — Zero-Knowledge Password Manager

A self-hosted password manager with client-side AES-256-GCM encryption. The server never sees your passwords.

**Stack:** Next.js (Vercel) · FastAPI serverless (Vercel Functions) · Neon PostgreSQL · Browser Extension (MV3)

---

## Architecture

```
Browser / Extension
    │
    ├── Web Crypto API — PBKDF2 key derivation + AES-256-GCM
    │       Master password → 256-bit key (never leaves device)
    │
    ├── Next.js Frontend (Vercel)
    │       Encrypts data client-side before sending to API
    │
    └── FastAPI Backend (Vercel Serverless)
            Stores only ciphertext in Neon PostgreSQL
```

---

## Quick Start

### 1. Clone & install

```bash
git clone https://github.com/sundaramrai/Cipheria
cd Cipheria
cd frontend && npm install && cd ..
```

### 2. Neon database

1. Create a project at [neon.tech](https://neon.tech)
2. Copy the connection string — tables are created automatically on first API call

### 3. Environment

**`api/.env`**

```
DATABASE_URL=postgresql://user:pass@ep-xxx.neon.tech/neondb
JWT_SECRET=<run: python -c "import secrets; print(secrets.token_hex(32))">
```

**`frontend/.env.local`**

```
NEXT_PUBLIC_API_URL=http://localhost:8000
```

### 4. Run locally

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

# Set env vars
vercel env add DATABASE_URL
vercel env add JWT_SECRET
vercel env add NEXT_PUBLIC_API_URL   # set to your Vercel URL after first deploy
```

`vercel.json` routes `/api/*` to FastAPI and everything else to Next.js.

---

## Browser Extension

### Load in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** → select the `extension/` folder

### Configure for production

Edit `extension/popup.js` line 1:

```js
const API_URL = "https://cipheria.vercel.app";
```

### Package

```bash
cd extension
zip -r cipheria-extension.zip . -x "*.DS_Store"
```

---

## Security Model

| Layer           | Protection                                          | Method                         |
| --------------- | --------------------------------------------------- | ------------------------------ |
| Auth password   | Hashed (bcrypt cost 12)                             | Never stored in plain text     |
| Master password | Never sent to server                                | PBKDF2-SHA256, 600k iterations |
| Vault data      | AES-256-GCM                                         | Unique 12-byte IV per item     |
| Transport       | TLS 1.3                                             | Vercel enforced                |
| Tokens          | Short-lived JWTs (30 min) + rotating refresh tokens | Refresh tokens stored hashed   |

A complete database breach exposes no plaintext passwords.

---

## Project Structure

```
cipheria/
├── api/                    # FastAPI serverless backend
│   ├── index.py            # Entry point (Mangum adapter)
│   ├── database.py         # SQLAlchemy models + Neon connection
│   ├── crypto.py           # JWT, bcrypt, token utilities
│   ├── schemas.py          # Pydantic request/response schemas
│   ├── deps.py             # Auth dependency injection
│   ├── routes/
│   │   ├── auth.py         # /api/auth/*
│   │   └── vault.py        # /api/vault/*
│   └── requirements.txt
│
├── frontend/               # Next.js app
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx        # Landing page
│   │   ├── auth/page.tsx   # Login / Register
│   │   └── dashboard/page.tsx
│   ├── lib/
│   │   ├── crypto.ts       # Web Crypto API (PBKDF2 + AES-256-GCM)
│   │   ├── api.ts          # Axios client + auto-refresh interceptor
│   │   └── store.ts        # Zustand state
│   └── styles/globals.css
│
├── extension/              # Browser extension (MV3)
│   ├── manifest.json
│   ├── popup.html
│   ├── popup.js
│   ├── background.js       # Service worker (key storage)
│   └── content.js          # Autofill injection
│
├── vercel.json
└── .env.example
```

---

## API Reference

**Auth** — `/api/auth/`

- `POST /register` · `POST /login` · `POST /refresh` · `POST /logout` · `GET /me`

**Vault** — `/api/vault/`

- `GET /` — list (supports `?search=`, `?category=`, `?favourites_only=true`)
- `POST /` · `GET /:id` · `PATCH /:id` · `DELETE /:id`
- `GET /export/json`

Interactive docs: `https://cipheria.vercel.app/api/docs`

---

## Roadmap

- [ ] TOTP two-factor authentication
- [ ] Passkey / WebAuthn support
- [ ] Secure sharing (public-key encrypted)
- [ ] Password health dashboard (HIBP breach detection)
- [ ] iOS / Android app (React Native)
- [ ] Team / organization vaults

---

## License

GPL-3.0
