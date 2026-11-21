# Cipheria architecture

Cipheria keeps vault keys and decryption in the browser, authenticates requests through FastAPI, stores account-owned ciphertext in PostgreSQL, and caches derived responses in Redis. This guide follows those boundaries through the source files. Setup and commands are in the [README](../README.md).

## Contents

- [System overview](#system-overview)
- [Security and data boundaries](#security-and-data-boundaries)
- [Code organisation](#code-organisation)
- [Authentication and vault state](#authentication-and-vault-state)
- [Vault operations and search](#vault-operations-and-search)
- [Master password changes and exports](#master-password-changes-and-exports)
- [Persistence and caching](#persistence-and-caching)
- [Deployment and failures](#deployment-and-failures)
- [Where to change a behaviour](#where-to-change-a-behaviour)

## System overview

Cipheria has a Next.js frontend and a FastAPI backend. PostgreSQL stores durable application data. Redis supports caching and shared rate limiting. Vault encryption and decryption run in the browser through the Web Crypto API.

```mermaid
flowchart LR
    Browser["Browser: React UI, vault key, decrypted contents"]
    Web["Next.js: pages and assets"]
    API["FastAPI: authentication and vault API"]
    DB[(PostgreSQL)]
    Redis[(Redis)]
    Mail["SMTP: email verification"]
    HIBP["HIBP password range API"]
    Metrics["Vercel Analytics and Speed Insights"]

    Browser -->|Load application| Web
    Browser -->|Same-origin /api requests| API
    Web -.->|API rewrite in local development| API
    API -->|Durable records| DB
    API -->|Cache and rate-limit storage| Redis
    API -->|Verification messages| Mail
    Browser -->|Explicit password check: hash prefix| HIBP
    Browser -->|Public landing page events only| Metrics
```

The routing layer exposes the frontend and API under one browser origin. In development, Next.js rewrites `/api/*` to the API origin. On Vercel, the service configuration routes `/api/*` directly to FastAPI. FastAPI's own routes begin with `/auth` and `/vault`; they do not add a second `/api` prefix.

## Security and data boundaries

### What is encrypted

| Data | Representation and location |
| --- | --- |
| Login credentials, website URL, card fields, notes, identity fields, previous login passwords | JSON encrypted in the browser; stored as `vault_items.encrypted_data` |
| Item name, category, favourite state, deletion state, timestamps | Unencrypted metadata in PostgreSQL; some responses are cached in Redis |
| Email, full name, master hint, vault salt, verification state | Server-readable account data; [user_cache.py](../api/user_cache.py) also caches ID, active state, and creation time, while excluding the verifier hash |
| Master password | Used locally to derive the vault key and authentication verifier; not sent as the raw password to the API |
| Authentication verifier | Sent to the API over HTTPS; stored as a bcrypt hash, not included in the profile cache |
| Access token | Browser memory; sent in the `Authorization` header |
| Refresh token | HttpOnly browser cookie; its SHA-256 hash is stored in PostgreSQL |
| Audit records | Server-readable action, account ID, IP address, user agent, and timestamp |

`list_items()` filters item names and categories in SQL; `compute_sidebar_counts()` aggregates category, favourite, and trash counts without decrypting anything. Those queries depend on the unencrypted columns above. Cipheria's encryption covers the contents inside `encrypted_data`.

### Key derivation and payload format

Legacy accounts in [lib/crypto.ts](../lib/crypto.ts) retain this format until upgrade:

1. PBKDF2-SHA-256 derives 256 bits from the master password and the account's vault salt using 600,000 iterations.
2. The browser imports those bits as a non-extractable AES-256-GCM `CryptoKey` for vault encryption and decryption.
3. The authentication verifier is the hexadecimal SHA-256 digest of the derived bits. The API bcrypt-hashes that verifier with cost 12; see [api/crypto.py](../api/crypto.py).
4. Each encryption uses a fresh random 12-byte IV. The stored string is `base64(iv).base64(ciphertextWithAuthenticationTag)`.

The salt is available to the server and is not a secret. A new salt is generated when the master password changes. Changing these derivation parameters or the ciphertext format requires a migration strategy for existing encrypted items and exports.

New accounts use the [version 2 key hierarchy](key-management.md): a random AES-256-GCM data key protected by a password-derived wrapping key, with separate authentication derivation. The nullable `users.key_envelope` holds validated KDF parameters, vault/key IDs and wrapped key. Item authenticated data binds the vault, expected item ID, version and key ID. Ordinary password changes rewrap the same key; explicit rotation or legacy upgrade re-encrypts the complete vault, including Trash, with revision checks. Both export formats remain importable with their original credentials.

The non-extractable key is held in `useAuthStore.cryptoKey`. Browser code with access to the unlocked application can still use that key to decrypt items. `lockVault()` drops the active key and list references; it cannot guarantee erasure of previously allocated JavaScript memory.

### External requests

- Website icons use local Lucide icons. Saved website domains are not automatically sent to a favicon provider.
- A user-triggered password exposure check hashes the password locally and sends only the first five hexadecimal SHA-1 characters to HIBP. Matching the remaining suffix happens locally. This is a lookup protocol, not the algorithm used to store passwords.
- [app/page.tsx](../app/page.tsx) mounts analytics on the public landing page. Its event filter checks both the event URL and current page, removes query strings, and discards auth and dashboard events even after client navigation.
- SMTP receives verification-message data. It does not receive vault payloads or master passwords.

## Code organisation

| Responsibility | Implementation |
| --- | --- |
| Public and authentication pages | [app/page.tsx](../app/page.tsx), [auth page](<../app/(auth)/auth/page.tsx>) |
| Registration and login submission | [useAuthForm.ts](../components/dashboard/hooks/useAuthForm.ts) |
| Dashboard orchestration and mutations | [dashboard/page.tsx](<../app/(dashboard)/dashboard/page.tsx>) |
| Dashboard presentation, forms, settings | [components/dashboard](../components/dashboard/) |
| Session restoration, lock, logout, idle handling | [useDashboardSession.ts](../components/dashboard/hooks/useDashboardSession.ts), [useIdleTimer.ts](../components/dashboard/hooks/useIdleTimer.ts) |
| View loading, pagination caches, search coordination | [useVaultViews.ts](../components/dashboard/hooks/useVaultViews.ts), [vaultView.ts](../components/dashboard/vaultView.ts) |
| Browser state and tab synchronisation | [lib/store.ts](../lib/store.ts), [lib/authSync.ts](../lib/authSync.ts) |
| Browser encryption, generation, strength estimation, search | [lib/crypto.ts](../lib/crypto.ts), [lib/passwordStrength.ts](../lib/passwordStrength.ts), [lib/vaultSearch.ts](../lib/vaultSearch.ts) |
| HTTP client, token attachment, refresh retries | [lib/api.ts](../lib/api.ts) |
| API assembly, middleware, health endpoint | [api/index.py](../api/index.py) |
| Authentication and authorisation | [api/routes/auth.py](../api/routes/auth.py), [api/deps.py](../api/deps.py) |
| Vault ownership, CRUD, export, response contracts | [api/routes/vault.py](../api/routes/vault.py), [api/schemas.py](../api/schemas.py) |
| Database, cache, counts, audit, rate limiting | [database.py](../api/database.py), [cache.py](../api/cache.py), [vault_counts.py](../api/vault_counts.py), [audit.py](../api/audit.py), [limiter.py](../api/limiter.py) |
| Schema evolution | [alembic/versions](../alembic/versions/) |

`CurrentSubject` validates the access token and its database session for reads. `DBUser` additionally loads the active `User` ORM object for write routes. Item routes constrain queries with both the requested item ID and the authenticated user's ID. The Next.js `proxy()` hook does not perform these checks.

## Authentication and vault state

### Registration and login

Registration generates a random data key and password-protected envelope in the browser and sends the account details, envelope, salt, and derived verifier to the API. Login first obtains the salt and derivation version through `/auth/login/challenge`, then derives the verifier locally. After verifier validation, the API creates a session and returns an access token and profile, and sets the refresh cookie. The browser unwraps the version 2 key using the returned envelope, or derives the legacy key, and retains it in memory.

Authentication and decryption state are separate:

| State in `lib/store.ts` | Dashboard behaviour |
| --- | --- |
| `isAuthenticated=false` | Bootstrap attempts session restoration or redirects to `/auth` |
| `isAuthenticated=true`, `isVaultLocked=true`, `cryptoKey=null` | Shows `LockedVaultScreen`; the user must enter the master password |
| `isAuthenticated=true`, `isVaultLocked=false`, `cryptoKey` present | Shows `MainDashboard`; item contents can be decrypted locally |

A page reload loses the in-memory access token and key. A valid refresh cookie can restore authentication, but does not recover the key or automatically unlock the vault. [useVaultUnlock.ts](../components/dashboard/hooks/useVaultUnlock.ts) verifies the entered password, decrypts the initial item batch locally, and populates the first page before exposing the unlocked dashboard.

`useIdleTimer()` resets a five-minute timer on mouse, keyboard, touch, and scroll events. Locking clears the active key and vault list, and the dashboard clears selection and view/search caches. Logout also clears authentication state. [lib/authSync.ts](../lib/authSync.ts) publishes lock, logout, and profile events through the `cipheria-auth` BroadcastChannel and `cipheria:auth-event` localStorage key. Events include IDs, tab IDs, and optionally the user profile; they do not contain the vault key or item contents.

### Session rotation and revocation

Each `refresh_tokens` row represents one stable session. Access JWTs contain `sub` (account ID), `sid` (session-row ID), token type, and expiry. They last 15 minutes. Refresh JWTs last 30 days; successful rotation replaces the stored token hash and expiry on the same row.

The refresh cookie uses path `/`, is host-only and HttpOnly, and uses `SameSite=Lax` in all environments. Production also sets `Secure`. Browser/API traffic is served through the same origin; configure the intended environment explicitly. Unsafe requests require `X-Requested-With: XMLHttpRequest` and any supplied Origin must exactly match the configured allowlist. Failed refresh responses expire the cookie on the actual 401 response. See [the threat model](threat-model.md) for CSP, deployment requirements and remaining risks.

```mermaid
sequenceDiagram
    participant Browser
    participant API as FastAPI
    participant DB as PostgreSQL
    Browser->>API: Protected request with access JWT
    API->>API: Verify JWT signature, type, and expiry
    alt Access token expired
        API-->>Browser: 401
        Browser->>API: Refresh using HttpOnly cookie
        API->>DB: Validate hash and conditionally replace hash and expiry
        DB-->>API: Rotation succeeds for one caller
        API-->>Browser: New access JWT and refresh cookie
        Browser->>API: Retry original request once
    else JWT valid
        API->>DB: Check active account and unrevoked, unexpired session
        DB-->>API: Session state
        API-->>Browser: Protected response if authorised, otherwise 401
    end
```

[api/deps.py](../api/deps.py) checks the session in PostgreSQL before protected data access, even when the response itself comes from Redis. This database lookup makes revocation effective before the access JWT's 15-minute expiry. Refresh uses a conditional update against the previous hash and active session state, so an old cookie cannot rotate twice or revive a revoked session. `lib/api.ts` shares `_refreshPromise` among concurrent failed requests within a tab; it is not shared across tabs.

Settings can revoke every other session after master-password verification. Logout revokes the current session. Revocation denies subsequent protected access and refresh; it does not erase information already viewed on another device. The dashboard rechecks its session when the browser window regains focus. Legacy refresh cookies can acquire a session-bound access token on refresh; legacy access tokens without `sid` do not authorise protected requests.

## Vault operations and search

### Create, read, update, and delete

- **Create/edit:** the browser builds the category-specific JSON payload, encrypts it, and sends ciphertext with listing metadata. Every vault mutation carries `X-Vault-Salt`, bound to the key used by that browser. Existing-item mutations also require a strong `If-Match` value `"<item UUID>:<revision>"`; detail/create/update/restore responses expose that ETag, and list/unlock responses include revisions. A missing precondition returns 428, a stale item revision returns 412, and an obsolete salt returns 409. Ownership is checked before revealing item revision conflicts.
- **List:** normal list responses contain metadata. Queries apply account ownership, category, favourite, trash, and optional name filters before pagination. Sorting is by `updated_at` descending and item ID ascending to resolve ties.
- **Open:** clicking an item fetches ciphertext when needed and decrypts it locally. Initial dashboard loads and category changes do not select an item automatically.
- **Favourite:** changing only favourite state preserves the content timestamp while incrementing the item revision.
- **Delete/restore:** deletion normally moves an item to trash. Permanent deletion removes it. Trash is still part of the encrypted account data when changing the master password.

All item writers acquire the same account row lock as import and master-password changes, then check the item revision under that lock. Every mutation that retains the item advances its revision; deletion and restoration cannot silently succeed against an outdated item. Permanent deletion requires the item to be in Trash. Write responses are serialized before releasing the transaction lock, so a later writer's revision cannot be attached to an earlier browser's plaintext draft. Vault list/item cache keys use a new namespace to avoid pre-migration entries without revisions. Conflict reloads bypass the item cache using `fresh=true`; a cached old revision can cause a rejected save, but cannot authorize overwriting newer data.

The edit form retains the snapshot and revision from when editing began. A 412 or deleted-item 404 keeps its draft in memory and offers an explicit discard-and-reload or a separately encrypted copy. Locking, logout or an account/key change clears the form and conflict state. Profile changes that replace the account or salt atomically clear the old key; unlock results also check that their source account/salt is still current before installing a key.

The shared store contains the current vault list and key. View caches and the search index belong to `useVaultViews`; selected item and mutation state belong to the dashboard page. Mobile panel navigation belongs to `MainDashboard`. The page's `currentSelectionRef` guards item responses, while `activeViewRef` prevents an older mutation from replacing the list after a category, search, or page change.

`hydrateViewFromLocalData()` derives another view from the cached All Items list only when that cache contains every active item and its total agrees with the sidebar count. A single page of All Items cannot represent a complete category. Incomplete caches and uncached Trash views require an API request.

### Search boundary

The API can search unencrypted item names. Searching encrypted usernames or website URLs must happen in the browser:

1. The browser requests all pages of the selected category, Favourites, or Trash with `include_encrypted_data=true`, in batches of up to 100.
2. Pages are fetched sequentially; login items within a page decrypt in parallel. Cancellation is checked between requests and completed batches.
3. The in-memory index retains username and URL search fields, without retaining the decrypted password or password history in that index.
4. Name, username, and URL matching is literal and case-insensitive. Results are paginated locally. Note contents, card fields, identity fields, and passwords are not searched.

Encrypted search batches bypass the normal metadata-list cache. The index is tied to its view and active key and is discarded on locking or invalidating the view. This supports private field matching at the cost of downloading and decrypting more data than a metadata-only list request.

### Password generation and history

Password generation uses Web Crypto randomness, rejection sampling to avoid modulo bias, and enabled character groups. Length is validated from 8 to 128, and each enabled group must appear in the result. Strength estimation uses the locally executed zxcvbn libraries; it does not send passwords to a scoring service.

Changing a login's saved password prepends the replaced password and replacement timestamp to `password_history`, retaining five entries. History is part of the existing encrypted payload, so it needs no additional database table. Editing an unchanged password does not add an entry. Revealing or copying history happens locally. Changing a vault entry does not change credentials on the corresponding website.

## Master password changes and exports

For an ordinary version 2 password change, the browser unwraps the same data key using the current password and rewraps it using a fresh salt and the new password. It submits the new wrapper/verifier without item ciphertext; item revisions remain unchanged. Legacy upgrades and explicit data-key rotations instead fetch every item including Trash, decrypt with the active old key, and encrypt under a newly generated data key while preserving IDs, fields and history.

The API verifies the current-password verifier under the account lock. For full migrations/rotations it verifies exact item coverage and every source revision before changing ciphertext. A concurrent edit makes the migration fail with 412. Successful migrations atomically replace ciphertext, revisions, wrapper, salt, verifier and other-session revocation. Ordinary rewrapping skips payload queries and item updates while still rotating the salt/verifier and revoking other sessions. Waiting old-key writers recheck the salt after acquiring the lock and are rejected. The API cannot decrypt ciphertext to verify its contents. The initiating browser stays authenticated and locks to require the current password; lost successful responses refresh key metadata before another operation.

Export produces JSON containing the salt, account email, item metadata and ciphertext. Version 2 exports also include the protected key envelope; legacy exports retain version 1. Normal exports exclude Trash; full key migrations include it. Exporting does not decrypt payloads or encrypt surrounding metadata. An earlier export still requires its export-time password and captured salt/envelope after a live password change.

### Import and restore

The vault navigation opens `ImportVaultModal` through Import Vault beside Export Vault on desktop, or Import beside Export in the mobile list footer. Account email and verification controls are grouped with the name under Settings → Profile. The import modal accepts password CSVs or Cipheria 1.0 and 2.0 JSON exports up to 2 MiB and 1,000 records/items. `lib/csvImport.ts` uses Papa Parse with string values and a fixed comma delimiter, bounds headers/records, suggests mappings, and reports invalid records without their values. Nonempty unmapped columns require explicit acknowledgement, except documented browser ID/timestamp/form-action metadata. CSV mapping state contains plaintext in browser memory until encryption finishes or the modal is closed; lock/account/key changes cancel processing. Passwords are never trimmed or interpreted as numbers/formulae. Passkeys and OTP secrets are not imported.

For JSON, `lib/vaultImport.ts` validates the file, derives its source key, and decrypts and validates supported payloads locally. Both formats feed `prepareImportItems`, the shared duplicate/encryption pipeline. The final preview retains destination ciphertext and listing metadata rather than plaintext payloads or the entered password. Duplicate comparison happens locally against active destination items and earlier source records; creation dates and favourite state do not affect it, while nonempty password history does. Empty optional fields/history compare equally to absent values. Selection is evaluated before skipping source duplicates, so excluding the first copy does not exclude a later selected copy. No existing item is updated by an import.

`POST /vault/import/json` accepts up to 3 MiB, with an account-scoped operation UUID, expected destination salt, and destination-encrypted items. FastAPI enforces the route body limit while reading, including chunked bodies, before JSON parsing. The endpoint locks the account row, refreshes the ORM user state, validates the expected salt and active-item capacity, and commits new items, a receipt, and an audit event together. IDs are generated for the destination. Export timestamps are preserved, but trash state is not encoded in the legacy file, so restored items are active.

`vault_imports` stores the operation ID, owner, request hash, count, and timestamp. Repeating an identical committed operation returns its count without inserting more items. Reusing its ID with different content returns 409. Receipts contain no source password or decrypted payload and remain until account deletion. The client keeps the exact prepared request for retries after a lost response. Aborting browser work cannot retract a request that has already committed.

Password changes and account deletion share the account-row lock with imports. Item creation and trash restoration also take that lock to serialize capacity increases. If a password change commits first, an old-salt import is rejected. If import commits first, a password change prepared without those items fails its complete-item coverage check. Exports take the same lock to obtain a matching salt/ciphertext snapshot during password rotation. Per-item revision checks also reject stale edits, favourites, trash, restore and permanent deletion.

Preparation is cancelled on modal close, lock, logout, or account/key changes. Abort checks after asynchronous work discard late results. Only destination ciphertext and the existing listing metadata are transmitted. Both CSV and JSON submit the same JSON request to the same endpoint; CSV adds no backend table or route. Independently password-protected backup formats remain future work; restoring an item from Trash is a different operation.

## Persistence and caching

[api/database.py](../api/database.py) defines the durable records:

| Table | Purpose |
| --- | --- |
| `users` | Account profile, verifier hash, vault salt, verification state |
| `vault_items` | Account-owned listing metadata, opaque ciphertext, trash state |
| `refresh_tokens` | Stable sessions, hashed refresh tokens, expiry, revocation |
| `auth_tokens` | Hashed, expiring action tokens such as email verification |
| `audit_logs` | Account security actions and request metadata |
| `vault_imports` | Account-scoped receipts that prevent import retries from inserting duplicate batches |

[Pydantic schemas](../api/schemas.py) separate `VaultItemSummary` from `VaultItemResponse`, which adds `encrypted_data`. `UnlockedVaultResponse` adds required sidebar counts to the paginated response. PostgreSQL changes live in [alembic/versions](../alembic/versions/); for example, [0007_remove_favicons.py](../alembic/versions/0007_remove_favicons.py) drops the persisted `favicon_url` column, and its downgrade recreates the column without recovering deleted URLs.

Redis is a cache, not the durable store or the source of session authorisation:

| Cached data | Redis key | TTL in `api/cache.py` |
| --- | --- | --- |
| User profile, excluding verifier hash | `user:{user_id}` | 15 minutes |
| Metadata list responses | `vault:list:{user_id}:{version}:{params_hash}` | 5 minutes |
| Sidebar counts | `vault:sidebar:{user_id}:{version}` | 5 minutes |
| Individual item responses, including ciphertext | `vault:item:{user_id}:{item_id}` | 10 minutes |

`vault:list:ver:{user_id}` holds the version used by list and sidebar keys. Mutations increment it and invalidate the individual item as needed. Master-password changes invalidate the account profile and all vault caches. Cache reads return a miss when Redis is disabled or a handled Redis operation fails, so the caller reads PostgreSQL. `api/limiter.py` configures its storage separately from the cache client: it uses the Redis URL from `get_redis_url()`, or `memory://` when no URL is configured.

## Deployment and failures

- [vercel.json](../vercel.json) describes separate Next.js and FastAPI services with shared-origin routing.
- [next.config.js](../next.config.js) supplies API rewrites for host or Docker development. [proxy.ts](../proxy.ts) passes through auth navigation rather than treating cookie presence as proof of an active session.
- [Dockerfile](../Dockerfile) and [api/Dockerfile](../api/Dockerfile) build the frontend and backend independently. [Compose development overrides](../docker-compose.dev.yml) add local PostgreSQL, Redis, hot reload, and startup migrations.
- [api/database.py](../api/database.py) uses SQLAlchemy `NullPool`, with a default five-second connection timeout when the URL does not specify one. API requests do not share a retained application connection pool across Vercel instances.
- `JWT_SECRET` must remain configured across instances and deployments. Missing configuration fails startup rather than silently generating a new signing secret.
- Database connection failures are mapped to HTTP 503. `/health` reports Redis state but is not a full database readiness check. Missing SMTP configuration prevents verification-message delivery; the account's verification state still exists independently.
- In production, `get_client_ip()` checks `x-forwarded-for`, then `x-real-ip`, then the direct client address. Audit logging and the rate limiter use that result. `api/index.py` reads browser origins from `ALLOWED_ORIGINS` and enables credentialed CORS.

Use the [README deployment instructions](../README.md#configuration-and-deployment) for environment variables and migration commands.

## Where to change a behaviour

| Change | Connected implementation and verification |
| --- | --- |
| Add an encrypted item field | Update `DecryptedPayload` in [lib/types.ts](../lib/types.ts), `ItemForm` and `emptyForm` in [dashboard/types.ts](../components/dashboard/types.ts), the field definition and category form in [ItemModal.tsx](../components/dashboard/ItemModal.tsx), `buildPayload()` in [utils.ts](../components/dashboard/utils.ts), and `handleOpenEdit()` in the [dashboard page](<../app/(dashboard)/dashboard/page.tsx>). Item details read `ITEM_FIELDS`. Payload-only fields do not require a new PostgreSQL column. |
| Change password generation, history, or derivation | Start in [lib/crypto.ts](../lib/crypto.ts) and [passwords.test.mjs](../tests/passwords.test.mjs). Derivation or ciphertext-format changes must also account for existing items, the server verifier, and exports made with the old format. |
| Change searchable fields | Update `itemMatchesSearch()` and `loadSearchItems()` in [lib/vaultSearch.ts](../lib/vaultSearch.ts), and the retained `search_fields` shape in [lib/types.ts](../lib/types.ts). [vaultSearch.test.mjs](../tests/vaultSearch.test.mjs) checks matching, later pages, cancellation, and exclusion of decrypted passwords from the index. |
| Change session validation or revocation | Keep [api/deps.py](../api/deps.py), the session helpers in [auth.py](../api/routes/auth.py), and refresh handling in [lib/api.ts](../lib/api.ts) aligned. `SessionTests` in [test_vault_updates.py](../api/tests/test_vault_updates.py) covers rotation, replay, revocation, legacy-cookie upgrade, and disabled/deleted accounts. |
| Change item metadata or list responses | Coordinate [api/database.py](../api/database.py), [api/schemas.py](../api/schemas.py), [vault.py](../api/routes/vault.py), and the browser types. `VaultUpdateTests` in [test_vault_updates.py](../api/tests/test_vault_updates.py) checks timestamps, filtering, counts on unlock, response shapes, and cache bypass for encrypted batches. |
| Change how `/api` reaches FastAPI | Check [next.config.js](../next.config.js), [vercel.json](../vercel.json), and [docker-compose.dev.yml](../docker-compose.dev.yml) together. Host development, Docker development, and Vercel mount the same API through different routing configurations. |

Update the affected section of this guide when one of these changes alters the documented behaviour. Commands remain in the [README development checks](../README.md#development-checks).
