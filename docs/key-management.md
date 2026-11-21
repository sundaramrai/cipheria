# Version 2 vault keys

New accounts use a random 256-bit AES-GCM data key. Existing accounts remain readable with their legacy password-derived key until an explicit upgrade or password change. The API stores only the password-protected key envelope; passkey and recovery wrappers remain future work.

## Derivation and formats

`users.key_envelope` is null for legacy accounts. A version 2 record contains exactly `version: 2`, `vault_id`, `key_id`, `kdf: "PBKDF2-SHA256"`, `iterations: 600000`, `salt`, and `wrapped_key`. IDs are lowercase UUIDs; the salt is 32 random bytes encoded as 64 lowercase hex characters. Unsupported fields, types, algorithms and work factors are rejected before running a KDF.

PBKDF2-HMAC-SHA-256 derives 256 bits using 600,000 iterations and the UTF-8 salt string `cipheria:v2:wrap:<salt>` for wrapping, or `cipheria:v2:authenticate:<salt>` for authentication. The authentication result is sent as hex and bcrypt-hashed by the API. These purposes do not share derived bits. Legacy derivation remains unchanged.

`wrapped_key` is `base64(iv).base64(ciphertextAndTag)`, with a random 12-byte IV and 128-bit GCM tag protecting the raw 32-byte data key. Its additional authenticated data is the UTF-8 encoding of compact JSON:

```text
["cipheria-key",2,vault_id,key_id,"PBKDF2-SHA256",600000,salt]
```

The active data key is non-extractable. Generation and rewrapping use a temporary extractable key because Web Crypto requires extractability for wrapping; that temporary key never enters application state. This cannot protect against injected code using the active key or observing a password during entry.

Version 2 items use `v2.base64(iv).base64(ciphertextAndTag)` and this authenticated context:

```text
["cipheria-item",2,vault_id,item_id,key_id]
```

The reader constructs context from the authenticated key envelope and expected API item ID. Substituting ciphertext into another item or vault fails authentication. Create/import/copy generate destination IDs before encryption. Imports decrypt using the source key and IDs, then re-encrypt with new destination IDs. Legacy payloads are accepted only by legacy keys; version mismatches fail explicitly.

## Changes and migration

| Operation | Behavior |
| --- | --- |
| Ordinary version 2 password change | Rewrap the same data key using a new password and salt. Item ciphertext and revisions stay unchanged; the update handler does not fetch item payloads. |
| Legacy upgrade | Generate a data key, decrypt every item including Trash, and re-encrypt under the existing item IDs. The current password can be retained. |
| Legacy password change | Perform the upgrade while protecting the new key with the newly selected password. |
| Explicit key rotation | Retain the vault ID, generate a new key ID and data key, and re-encrypt every item including Trash. This control retains the current password; change the password too if it was exposed. |

Migration and rotation reuse account locking, exact item coverage and revision checks before any ciphertext is changed. One transaction replaces the data, envelope and verifier and revokes other sessions. An interrupted preparation can be restarted; there are no partially migrated batches or checkpoints. A lost successful response is recovered by refreshing the profile and returning to the unlock screen.

Every rewrap, upgrade or rotation changes the random vault salt, which also identifies the current wrapper state in write preconditions. Waiting writers recheck it under the account lock. Account, salt or key-identity profile changes discard the active key and decrypted state; obsolete unlock results are rejected. The API validates structure and ownership but cannot prove that opaque ciphertext uses the claimed key. These protections depend on an honest server and do not prevent replay of an older complete server snapshot.

## Exports and rollout

Legacy accounts export `1.0`; version 2 accounts export `2.0`, including the envelope and original item IDs. Both are importable using the password from export time. Old exports remain readable after upgrades or password changes. Rewrapping cannot revoke copied data keys or old backups. Titles and other listing metadata remain readable, and independently protected portable backups remain a separate milestone.

Migration `0010_vault_key_envelopes` adds nullable metadata without converting existing ciphertext. Actual upgrades happen in an unlocked browser. Coordinate frontend/API deployment and drain old API writers after applying schema migrations. Schema downgrade is refused because dropping envelopes can strand encrypted data; restore a complete compatible backup for rollback. Only the disposable local test database was migrated during development.

Checks cover context substitution, tampering, wrong passwords, invalid KDF parameters, unchanged data on rewrap, rotation, old/new backup compatibility, stale migration snapshots, real PostgreSQL rewrap/edit races, and browser recovery from a lost migration response. Independent cryptographic review and low-memory/mobile performance measurements remain outside these checks.

References: [OWASP encrypted key storage](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html#encrypting-stored-keys), [Web Crypto wrapping and unwrapping](https://www.w3.org/TR/webcrypto/).
