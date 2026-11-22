# Security boundaries

| Threat | Controls | Limits |
| --- | --- | --- |
| Database/cache/export theft | Browser AES-256-GCM; password derivation at 600,000 PBKDF2-SHA-256 iterations; hashed verifiers and tokens. [Key formats](key-management.md). | Names, categories, account details and activity metadata remain readable. Weak passwords can be guessed offline. |
| Session theft | In-memory access token, HttpOnly refresh cookie, database session checks and revocation; password verification for sensitive operations. | A session can retrieve ciphertext/metadata. Revocation cannot erase downloaded data or copied keys. |
| Cross-site requests | Unsafe requests require `X-Requested-With: XMLHttpRequest`; explicit origins must match `ALLOWED_ORIGINS`; cross-site Fetch Metadata without Origin is rejected. | Allowed origins must be trusted. Non-browser clients may omit Origin; the header is not authentication. |
| Injected code/device access | Nonce CSP, in-memory keys and lock clearing; no token persistence in Web Storage. | Compromised scripts, extensions or an unlocked device can access secrets. Non-extractable keys do not prevent malicious use; locking cannot guarantee memory erasure. |
| Tampering/concurrent writes | GCM authentication; version 2 binds vault/item/key IDs. Revisions and account locks coordinate writes and key changes; imports have retry receipts. | Legacy items lack context binding until upgraded. The API cannot validate opaque ciphertext or detect a malicious server's complete snapshot rollback. |
| Lost password/service | JSON exports can restore locally with their export-time password. | No passwordless recovery or independent backup key exists. Password changes cannot revoke old exports. |

## Deployment contract

Serve the frontend and `/api` on one HTTPS origin. Set `ENVIRONMENT=production` and exact `ALLOWED_ORIGINS`, including explicitly trusted previews. Refresh cookies are host-only, HttpOnly, `SameSite=Lax` and Secure in production. Browser-origin trust comes from the allowlist, not Host/forwarded headers.

[proxy.ts](../proxy.ts) supplies per-request nonce CSP; documents are dynamically rendered. Scripts use nonce/`strict-dynamic`, styles allow inline CSS, and production connections permit same-origin APIs and explicit HIBP checks. `CSP_REPORT_ONLY=1` is for staging inspection; no report collector is configured. API responses use `no-store`.

Icons are local. Explicit breach checks send only a five-character SHA-1 prefix to HIBP. Analytics/performance events are restricted to the public landing page. SMTP receives verification messages; absent SMTP does not log bodies/tokens. Do not enable SQL parameter logs or browser recordings for real vaults; CSV exports contain plaintext passwords.

No independent security audit has been completed.
