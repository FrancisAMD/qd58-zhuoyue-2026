# D1 backup, restore and privacy recovery runbook

This runbook is an operational procedure, not a claim that a backup has been taken or a restore has been rehearsed. It deliberately contains no production credentials or real user data.

## 1. Two separate recovery layers

1. **D1 Time Travel** is the first response for accidental writes and migration mistakes. It is provider-managed point-in-time recovery, not an independent off-account backup. Before relying on it, inspect the target database with `npx wrangler d1 info qd58-zhuoyue-db` and confirm its storage version and the Time Travel window available to the account plan. Cloudflare currently documents up to 7 days on Workers Free and up to 30 days on Workers Paid; verify the actual account entitlement at the time of launch.
2. **Encrypted external export** protects against loss of access to the Cloudflare account and provides a separately retained recovery copy. `wrangler d1 export` produces a SQL export containing personal data. Treat it as highly sensitive plaintext until encrypted; do not place it in Git, a Pages asset directory, a public bucket, chat, or an unencrypted workstation backup. Store the encrypted copy in a private location outside the Cloudflare account, with access limited to named operators and the decryption key stored separately.

D1 Time Travel restores in place and overwrites the current database. Never use a restore command as a routine test. Rehearse exports against a disposable test database only.

## 2. Before a schema migration or bulk catalog import

Run these read-only checks first:

```powershell
npx wrangler d1 info qd58-zhuoyue-db
npx wrangler d1 time-travel info qd58-zhuoyue-db
npx wrangler d1 migrations list qd58-zhuoyue-db --remote
```

Record the database name, storage version, current bookmark, and applied migration names in the restricted change record. Do not paste bookmarks or export contents into public issues.

Create an export only when an authorized operator is ready to handle the resulting personal data:

```powershell
New-Item -ItemType Directory -Force private-backups
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
npx wrangler d1 export qd58-zhuoyue-db --remote --output "private-backups/qd58-$stamp.d1-export.sql"
python scripts/verify-d1-export.py "private-backups/qd58-$stamp.d1-export.sql" --expected-migration 0014_university_catalog_import_staging.sql
```

The verifier restores the SQL into a temporary local SQLite database and checks SQLite integrity, foreign keys, required application tables, the expected migration marker, and that anonymized account tombstones contain no direct profile/authentication fields. It prints only a digest and aggregate checks; it never prints row values. A successful local SQLite check is necessary but does not prove that Cloudflare D1 will accept every statement.

Encrypt the export immediately with the organization-approved tool (for example, age or GPG), verify the encrypted artifact can be decrypted by a second authorized operator, then securely remove the plaintext working copy. Do not commit either artifact. Record the SHA-256, encryption method/key identifier (never the key), storage location, operator, and retention expiry in the restricted change record.

## 3. Restore rehearsal (test database only)

1. Create or select a disposable D1 database dedicated to restore testing. Confirm its database ID is not the production ID in `backend/wrangler.toml`.
2. Decrypt a copy of the export into a restricted temporary directory.
3. Restore only into that disposable database, using the D1 import/execute procedure supported by the installed Wrangler version. Never use `time-travel restore` or `d1 migrations apply --remote` against production for a rehearsal.
4. Run the verifier locally before import, then compare key table counts and `PRAGMA foreign_key_check` results between the export and test restore. Exercise login, directory, team/transfer, admin RBAC, CSV/XLSX export, and account-deletion behavior with synthetic accounts only.
5. Delete the disposable test database only after recording the rehearsal result and confirming no production binding was used.

A restore rehearsal is not complete merely because the import command exits successfully; application queries and privacy invariants must also pass.

## 4. Deleted-account privacy after restore

A point-in-time restore can bring back personal data that had been anonymized after the selected bookmark. The current `account.deleted` audit record is stored in the same D1 database and therefore is not, by itself, a durable deletion ledger across a restore to an earlier point.

**This is a launch blocker for any recovery procedure that could restore a pre-deletion snapshot.** Before real users are onboarded, implement and test an append-only deletion/tombstone ledger outside the D1 restore domain (for example, a separately permissioned, encrypted R2 object or another independently backed-up store), and replay all post-bookmark deletion tombstones before the restored database is returned to service. Do not claim deletion is complete across backups until this control exists and has been rehearsed.

## 4.1 Deletion-intent ledger implementation (R2)

The Worker now writes a create-once deletion intent to a private R2 binding before the D1 anonymization batch. The object key is derived from the pseudonymous 32-hex user ID and contains only the schema version, pseudonymous user ID, request timestamp, random event ID, and SHA-256 checksum; it does not contain phone, name, school, password, or profile fields.

- Binding: `DELETE_LEDGER`; proposed bucket name: `qd58-account-deletion-ledger`.
- The bucket must be created and kept private by an authorized operator before any deployment that includes this code.
- R2 writes use a conditional create-only operation. A retry reuses and validates the existing record rather than overwriting it.
- If the R2 write fails, the Worker returns a service-unavailable response and does not start the D1 anonymization batch.
- If the R2 intent is written but D1 later fails, the intent remains. Treat it as a deletion request that must be reconciled during recovery; it may be replayed even if the original D1 transaction did not complete.
- The module includes paginated listing and checksum validation. A local replay tool is now available, but no real R2 export or D1 restore rehearsal has been performed. During recovery, do not reopen traffic until the replay-ready export has been restored and verified in a disposable D1.

The ledger is pseudonymous, not anonymous: the user ID remains linkable to an account in older backups. Restrict bucket access to named recovery operators, do not attach a public domain, and retain the bucket separately from D1 Time Travel. R2's create-once behavior is an application control; it is not protection against an operator or account-level deletion of objects.

## 4.2 Deletion-ledger export and local replay preparation

The recovery snapshot can be exported through an owner-only Worker endpoint and a local CLI. This is disabled by default and is not a routine public endpoint.

- Endpoint: GET /api/admin/account-deletion-ledger/export, with opaque pagination.
- Feature flag: ACCOUNT_DELETION_LEDGER_EXPORT_ENABLED=true. Keep it disabled except for a controlled recovery window, then disable it again.
- Access: same-origin request, active independent admin session, owner role, and the account:deletion:recovery permission. Each page is audit-logged with only aggregate count and digest metadata.
- CLI output is created exclusively under private-backups, with restrictive file permissions. It contains pseudonymous user IDs and timestamps, is ignored by Git, and must be encrypted or securely handled as a sensitive recovery artifact.

Export the complete ledger snapshot only after an authorized operator has enabled the flag and confirmed the recovery target:

    npm run export:deletion-ledger -- --api-base https://api.58er.eon21.space --app-origin https://58er.eon21.space --out private-backups/deletion-ledger-YYYYMMDD.json

The CLI prompts for admin credentials without echoing the password, fetches every page, validates each record checksum, rejects duplicate user/event IDs, writes a complete snapshot digest, and attempts logout. It never prints ledger rows or stores credentials/session cookies. Do not enable this feature flag or run the CLI against production as part of an unattended task.

Prepare a local replay-ready SQL export from the private D1 backup and complete ledger snapshot:

    $env:RATE_LIMIT_HMAC_SECRET = "<retrieve through an approved secret-handling channel>"
    python scripts/replay-deletion-intents.py --backup private-backups/qd58-backup.d1-export.sql --ledger private-backups/deletion-ledger-YYYYMMDD.json --out private-backups/replay-ready.sql --expected-migration 0014_university_catalog_import_staging.sql

The replay tool is local-only. It validates the source backup and complete ledger snapshot, restores the backup in temporary SQLite, then replays all applicable deletion intents atomically. It removes sessions, phone OTP challenges, rate-limit keys derived from the restored phone and secret, expires pending transfers, releases a leader only when no other active team member exists, anonymizes the user, and inserts the correlated account.deleted audit event. It verifies the replay-ready export before creating the output file.

Fail-closed cases:

- A restored active user who still leads a team with other active members requires manual review; the tool refuses automatic replay.
- A ledger event ID that conflicts with an existing audit row, an already-tombstoned account without the correlated audit row, invalid/incomplete snapshot, missing migration, damaged backup, or missing HMAC secret is rejected.
- A user ID absent from the restored snapshot is counted but not modified.
- The tool does not connect to Cloudflare, execute SQL against D1, or deploy anything. The replay-ready SQL is a full export, not a patch. Restore it only into a disposable D1 rehearsal database.

After restoring the replay-ready export into a disposable D1, run the backup verifier and synthetic-only application checks before any recovery approval. The real R2 snapshot export, replay, and cloud restore rehearsal remain pending.

## 5. Retention and launch gates

The organization must decide and publish, before launch:

- active account/profile retention after the event;
- audit-log retention and authorized readers;
- encrypted external-backup retention and secure expiry/deletion;
- the privacy contact/rights-request mailbox and responsible controller;
- the D1 Time Travel window available under the actual Cloudflare plan;
- the recovery objective and the owner responsible for each restore.

Do not copy the previously suggested 30-day backup period as an approved policy. Provider Time Travel retention and the organization's personal-data retention policy are different things. Until the controller, contact, retention periods, independent deletion ledger, and restore drill are confirmed, production launch remains blocked.

## 6. Current implementation boundary

- `scripts/verify-d1-export.py` is local-only and has no Cloudflare credentials or network access.
- `backend/tests/d1-backup-restore-smoke.py` uses synthetic rows and the repository migrations; it does not touch a remote D1 database.
- No backup/export, encryption, upload, remote migration, restore, deployment, or real-person-data access is performed by CI.
