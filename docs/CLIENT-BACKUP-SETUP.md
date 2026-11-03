# Portable owner-run database backup

Prepared November 3, 2026. The owner selected free client-only setup here.

PostgreSQL 17.11 matches both hosted databases. The four clients and required DLLs occupy 62,124,186 bytes under ignored `work/postgres-client-17.11/bin`. The 381,531,864-byte vendor ZIP was removed after extraction/hash/version verification. No database server, service, admin installation, Docker, global PATH or persistent execution-policy change was made. Tools came from the [PostgreSQL Windows download page](https://www.postgresql.org/download/windows/) → [EDB binaries](https://www.enterprisedb.com/download-postgresql-binaries), file1260616. The tracked receipt pins the locally measured HTTPS archive SHA-256 and each extracted file. It is not an independently published checksum or Authenticode-signature claim. The setup script can reproduce the same pinned extraction.

## First run: Development

1. Open [Development Database Settings](https://supabase.com/dashboard/project/whlcnlacueweaqpsupqs/database/settings). Download the project's **SSL CA certificate** from SSL Configuration and keep its full file path. Do not change SSL enforcement or reset the password merely to follow these instructions.
2. Open the project's **Connect** panel. Note the direct connection **host** and **user**. Defaults are `db.whlcnlacueweaqpsupqs.supabase.co` and `postgres`. If direct IPv6 is unavailable, use the **Session pooler**, port5432, with the exact host/user shown there (`postgres.whlcnlacueweaqpsupqs`). Its certificate chain must verify against the supplied CA; do not disable verification to bypass an error. The transaction pooler on6543 is not supported for this export.
3. Open Windows Terminal or Command Prompt and run this exact command:

```text
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File "C:\Users\coope\Documents\Codex\2026-10-28\co\work\fantasy-sportsbook\scripts\start-platform-backup.ps1"
```

4. Type `development` to confirm the source. Enter the host/user from Connect (or press Enter for direct defaults), paste the CA certificate path, then enter the **database password** at the hidden prompt. It is not an API key or project ID. Never paste it in chat. `RemoteSigned` applies only to this PowerShell process; it does not change your machine's saved policy.
5. The launcher verifies pinned client hashes, enforces TLS hostname/CA checking and read-only sessions, checks the expected application/Auth/migration schemas, and streams exports into encryption using the **existing public recovery key**. No password file, plaintext dump, private-key read or database restore is performed. It prints a private output folder under `work/platform-backups`. Reply **“Development export complete”**, or provide only the non-secret error description. Do not attach backup files or secrets in chat.

The output folder grants access only to the current Windows owner and SYSTEM. It contains encrypted `database.dump.pgp`, encrypted `roles.sql.pgp` and a manifest. An error leaves any partial ciphertext for review and never emits a successful manifest. Empty exports, wrong versions, unexpected endpoints, permission failures and missing certificate verification do not silently fall back to partial public-schema backups. Native error bodies are suppressed to prevent accidental disclosure; a failed connection may need local troubleshooting.

## What completion means

This is a raw native PostgreSQL recovery archive, not the Supabase CLI's filtered three-file managed-service migration format. The single database archive uses a consistent database snapshot and includes accessible Auth records, application schemas, storage metadata and migration history; role definitions are exported in a separate transaction without role passwords. Permission errors fail the run. A successful dump/header/hash is not proof of a usable restore, complete managed-service configuration or zero warnings. Any stderr marks warnings for additional review.

The manifest deliberately retains `restore_verified:false` and `full_platform_complete:false`. Missing coverage includes object bodies if storage is nonempty, Auth settings/templates/providers, encryption-root/Vault custody, deployment configuration/secrets and custom role passwords. Preserve needed recovery material independently in your password manager. Do not send it through chat. The full independent computer restore remains owner-deferred; existing key import/phone-access confirmation is not repeated.

After reviewing coverage, only ciphertext plus its manifest should go to the existing private Drive recovery folder, with downloaded-byte SHA-256 verification. No automatic upload, sharing, restore, production change or cleanup is included. A production export uses `-Target production` and an explicit `production` confirmation; prepare it only after the Development route is verified and production backup read scope is reviewed. The production project reference is `bmvjcdgxwxqalaohpsnw`.

## Capacity and tests

Setup adds zero hosted rows/storage and no recurring job. An actual backup reads the database, consumes outbound transfer and creates compressed encrypted local/Drive files; size and time remain unmeasured until the actual export. Plan ciphertext retention after measuring it. Streaming avoids a second full plaintext copy but does not make the exported archive free of storage/egress cost.

`node scripts/test-native-platform-backup.mjs` uses generated ephemeral test keys and synthetic subprocesses only: strict target/host/user/CA, sanitized PG environment, read-only settings, 2-MiB encrypted round-trip, hashes/header, exclusive-file overwrite denial, secret stderr suppression and nonzero-exit rejection. `node scripts/export-platform-backup.mjs --check` verifies all pinned binaries and four actual version executions and the existing public recovery key without connecting to a database. PowerShell setup execution and launcher syntax are verified. No owner password, private key or actual database export was accessed during preparation.

References: [Supabase backup/restore and managed-service caveats](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore), [PostgreSQL pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html), [role export](https://www.postgresql.org/docs/17/app-pg-dumpall.html), [SSL configuration](https://supabase.com/docs/guides/platform/ssl-enforcement). No restore is authorized by this setup.
