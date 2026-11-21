# Version 2 vault keys

New accounts use a random 256-bit AES-GCM data key, stored server-side only inside a password-protected envelope. Existing accounts retain their legacy format until upgrade or password change. Implementation: [vaultKeys.ts](../lib/vaultKeys.ts), [crypto.ts](../lib/crypto.ts) and [auth.py](../api/routes/auth.py).

## Derivation and formats

`users.key_envelope` is null for legacy accounts. A version 2 record contains exactly `version: 2`, `vault_id`, `key_id`, `kdf: "PBKDF2-SHA256"`, `iterations: 600000`, `salt`, and `wrapped_key`. IDs are lowercase UUIDs; the salt is 32 random bytes encoded as 64 lowercase hex characters. Unsupported fields, types, algorithms and work factors are rejected before running a KDF.

PBKDF2-HMAC-SHA-256 derives 256 bits using 600,000 iterations and the UTF-8 salt string `cipheria:v2:wrap:<salt>` for wrapping, or `cipheria:v2:authenticate:<salt>` for authentication. The authentication result is sent as hex and bcrypt-hashed by the API at cost 12. Legacy accounts use the unprefixed account salt to derive the payload key and SHA-256 of those bits as their verifier; legacy ciphertext is `base64(iv).base64(ciphertextAndTag)`.

`wrapped_key` is `base64(iv).base64(ciphertextAndTag)`, with a random 12-byte IV and 128-bit GCM tag protecting the raw 32-byte data key. Its additional authenticated data is the UTF-8 encoding of compact JSON:

```text
["cipheria-key",2,vault_id,key_id,"PBKDF2-SHA256",600000,salt]
```

The active data key is non-extractable. Generation and rewrapping use a temporary extractable key for Web Crypto wrapping; it never enters application state.

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

Full migrations check exact item coverage and source revisions under the account lock. One transaction replaces ciphertext, envelope and verifier and revokes other sessions; ordinary rewrapping leaves item data unchanged. Lost successful responses refresh the profile and return to unlock.

Every rewrap, upgrade or rotation changes the salt. Waiting writers recheck it under the account lock. Account, salt or key-identity changes clear the active key/decrypted state and reject obsolete unlock results. [Security limits](threat-model.md).

## Exports and rollout

Legacy accounts export `1.0`; version 2 accounts export `2.0` with the envelope and original IDs. Both remain importable with their export-time password after live upgrades/password changes. Rewrapping cannot revoke copied keys or backups.

Migration `0010_vault_key_envelopes` only adds nullable metadata; account upgrades run in an unlocked browser. Dropping envelopes can strand encrypted data, so downgrade is refused. [Deployment and rollback](../README.md#configuration-and-deployment).
