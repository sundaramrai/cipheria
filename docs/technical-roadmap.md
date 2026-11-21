# Technical roadmap

Updated 22 November 2026. Finish release verification before adding features.

## Current release

Implemented: CSV/JSON import, request-origin protection and nonce CSP, item revision conflicts, random vault keys, password rewrapping and legacy upgrades/rotation.

## Release checklist

- [x] Implementation pushed to `master`; Vercel reports Production deployment `2fa3fc6`.
- [x] Local application database at `0010`; fresh/populated legacy test migrations verified.
- [x] Local baseline: 37 frontend tests, 74 backend tests, five Chromium checks, lint, typecheck, Ruff and build passed on 21?22 November.
- [ ] Push CI fixes and confirm GitHub CI passes. Fresh-copy lint/typecheck/frontend tests pass locally.
- [ ] Run the new modal-toast browser assertions; the fix has manual verification only, plus lint/typecheck/build.
- [ ] Verify production database migration through `0010`, backups and retirement of old API writers. [Deployment steps](../README.md#configuration-and-deployment).
- [ ] Smoke-test deployed registration/login, import, conflicts, Trash, password changes, key upgrade/rotation and export/restore with a disposable account.

## Planned features

| Priority | Feature | Acceptance |
| --- | --- | --- |
| Next | Passkey login and optional recovery | Verify single-use challenges, origin/RP ID and user verification. Use WebAuthn PRF for local key unlocking where supported; retain master-password fallback. A recovery secret may wrap the data key; email alone must not decrypt the vault. |
| Then | Independently protected backups | Encrypt metadata and contents under a separate backup passphrase/key. Restore into a fresh account, reject tampering before writes and retain existing export readers. |
| Later | Browser autofill | Fill only after user action, with origin/frame checks and minimal permissions. Keep keys out of content scripts; never auto-submit. |

Passkey/PRF compatibility must be checked during implementation. Ordinary WebAuthn signatures and OIDC tokens are not vault keys. Independent cryptographic review and physical-device performance measurements remain outstanding.

Other candidates need a concrete user requirement before implementation: encrypted titles, session/activity UI, full item history, offline access or an OIDC provider. No enterprise identity, team sharing or new services are currently planned.
