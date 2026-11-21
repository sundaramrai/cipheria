# Cipheria technical roadmap

Updated 22 November 2026. Initial research: 25 October 2026; baseline: `d6b179e`.

Cipheria should be useful as a personal password manager and demonstrate sound engineering. Finish the current release before adding another feature. This roadmap records scope and acceptance criteria; it is not an independent security audit.

## Current milestone: implemented locally

| Area | Delivered behavior | Migration |
| --- | --- | --- |
| Credential import | Browser CSV mapping, preview, selection, duplicate handling, and Cipheria 1.0/2.0 JSON restoration; local decryption and destination encryption; atomic, retry-safe writes | `0008_vault_imports` |
| Security foundation | Request-origin/header validation, protected refresh cookies, no-store responses, nonce CSP, token-safe mail logging, CI and isolated browser/database checks | None |
| Concurrent edits | Item revisions and write preconditions; conflicting drafts can reload or save separately; stale-key writes fail | `0009_vault_revisions` |
| Key management | Random data keys, password-protected envelopes, password rewrapping, explicit key rotation and atomic legacy upgrades, including Trash | `0010_vault_key_envelopes` |

Import sits beside Export; profile details and email verification live in Settings. Imported credentials preserve supported fields and password history. Existing items are never overwritten by import.

Implementation contracts belong in [architecture](architecture.md), [key management](key-management.md), and the [threat model](threat-model.md). The [README](../README.md) covers setup and user-facing import limits.

## Release checklist

- [x] Local verification on 21-22 November: 37 frontend tests, 74 backend tests including PostgreSQL concurrency, five Chromium checks, lint, typecheck, Ruff and production build.
- [x] Dependency audits reported no advisories; dependency compatibility checks passed.
- [x] Fresh and populated legacy test databases migrated through `0010`, preserving existing ciphertext and salt.
- [ ] Review the final diff and explicitly authorize commits and push.
- [ ] Verify GitHub CI and a preview deployment using an isolated database and the intended origin, cookie and CSP settings.
- [ ] Back up production, apply migrations through `0010`, coordinate frontend/API deployment, drain obsolete API writers and reload old tabs.
- [ ] Smoke-test registration/login, import, edits, conflicts, Trash, password changes, key upgrades/rotation and export/restore using a disposable deployed account.

Only disposable databases have been migrated during this work. Schema rollback requires a complete compatible backup. Desktop Chromium checks with a mobile viewport do not establish performance on low-memory phones; physical-device measurements and independent cryptographic review remain outstanding.

## Next: passkeys and optional recovery

**Outcome:** sign in with a passkey; unlock through WebAuthn PRF where supported, with a master-password fallback.

Use a maintained WebAuthn verification library. Decide the production RP ID and preview-domain policy before registration. Bind short-lived, single-use challenges to each operation; verify origin, RP ID and user verification. Support named credentials, last-used information and removal after recent authentication.

Authentication and vault unlocking remain separate. Ordinary WebAuthn signatures and OIDC tokens are not vault keys. PRF output must stay in the browser and protect a wrapper of the existing data key. Show whether each credential supports unlocking; check browser/authenticator capabilities during implementation.

An optional high-entropy recovery secret can protect another key wrapper. Require a confirmation exercise and distinguish restoring account access from decrypting the vault. Email access alone must not decrypt contents; revocation cannot erase copied keys or plaintext.

**Acceptance:** reject replay and wrong-origin assertions; provide a clear fallback without PRF; keep users with another configured method from being stranded; reject authentication and wrapper retrieval after credential removal.

References: [WebAuthn PRF](https://www.w3.org/TR/webauthn-3/#prf-extension), [Bitwarden passkey behavior](https://bitwarden.com/help/login-with-passkeys/).

## Then: independently protected backups

**Outcome:** restore a backup into a fresh account without depending on the original account's availability or current password.

Add a versioned, authenticated envelope protecting exported metadata as well as item contents. Use a separate backup passphrase or high-entropy key. Reuse existing local preview, validation, duplicate policies, bounded writes and retry receipts. Preserve legacy export readers.

**Acceptance:** restore supported fields and history after deleting a disposable source account; reject a wrong passphrase or modified file before writes; retries add no duplicates; old backups remain readable after a live password change.

Reference: [Portable password-protected exports](https://bitwarden.com/help/encrypted-export/).

## Later: explicit browser autofill

**Outcome:** fill the selected credential on its intended website after a user action.

Start with a Manifest V3 popup and `activeTab`, sharing the existing crypto implementation. Keep vault keys and unrelated credentials out of content scripts. Validate message senders, origins, frames, redirects and fields; never auto-submit. Define extension-specific sessions and safe locking after worker restarts.

**Acceptance:** reject deceptive hosts, unsafe redirects, unexpected frames and hidden fields; locking prevents further fills; worker suspension cannot expose keys or silently resume an unlocked session.

References: [Chrome activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab), [OWASP extension guidance](https://cheatsheetseries.owasp.org/cheatsheets/Browser_Extension_Vulnerabilities_Cheat_Sheet.html).

## Follow-ups, only with a clear user need

| Feature | Scope or dependency |
| --- | --- |
| Simpler onboarding | Keep optional name/hint fields outside initial registration. |
| Encrypted titles | Redesign server-side listing/search; counts and access patterns still leak metadata. |
| Local vault health | Reuse strength estimation and explicit breach checks; never send plaintext or full hashes. |
| Session/activity screen | Reuse session/audit tables with bounded retention and individual revocation. |
| Full encrypted item history | Extend existing password history with bounded revisions and key-migration rules. |
| Read-only offline access | Follow backup/sync work; document weaker immediate revocation. |
| One OIDC provider | Optional convenience with local unlock; validate identity and require authenticated account linking. |

Defer enterprise Okta/SAML/SCIM, team sharing, secret links, TOTP storage and AI over vault contents until there is a justified product requirement. No current requirement calls for new microservices or custom authentication/cryptographic protocols.

## Import compatibility boundary

CSV tests cover synthetic Chrome/Edge layouts and mapped Firefox/Apple-style fields, not native-browser export certification. Preserve password whitespace, quotes, newlines and Unicode; report invalid record numbers without values; require acknowledgement of nonempty omitted columns. Passkeys and authenticator secrets do not transfer. Advertise tested formats rather than blanket browser compatibility.

Newer import formats should reuse the existing preparation and transactional save path. Keep the documented file/item/request bounds, destination-key checks, cancellation on lock/account changes and exact-request retries. Defer automatic replacement, merging and background partial imports.
