# Technical roadmap

Updated 22 November 2026. Release verification completed.

## Current release

Implemented: CSV/JSON import, request-origin protection and nonce CSP, item revision conflicts, random vault keys, password rewrapping and legacy upgrades/rotation.

## Planned features

| Priority | Feature | Acceptance |
| --- | --- | --- |
| Next | Passkey login and optional recovery | Verify single-use challenges, origin/RP ID and user verification. Use WebAuthn PRF for local key unlocking where supported; retain master-password fallback. A recovery secret may wrap the data key; email alone must not decrypt the vault. |
| Then | Independently protected backups | Encrypt metadata and contents under a separate backup passphrase/key. Restore into a fresh account, reject tampering before writes and retain existing export readers. |
| Later | Browser autofill | Fill only after user action, with origin/frame checks and minimal permissions. Keep keys out of content scripts; never auto-submit. |

Passkey/PRF compatibility must be checked during implementation. Ordinary WebAuthn signatures and OIDC tokens are not vault keys.
