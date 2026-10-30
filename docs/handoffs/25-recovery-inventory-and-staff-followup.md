# Recovery inventory and staff-operation consistency

October 29, 2026. Markdown + chat is now the selected canonical queue workflow.
Stable handoff counter remains **14 complete / 10 remaining**. This work advances
F001 and fixes B007 in isolated development; it does not close all of 16 or 20.

## Fresh production inventory — read-only

At `2026-10-29T23:52:29Z`, production project `bmvjcdgxwxqalaohpsnw` was Active/Healthy
on PostgreSQL 17.11. The read-only inventory reports **1,289,098,931 database bytes**
(about 1.29 decimal GB). The leading physical relations, including indexes/TOAST:

| Relation | Bytes |
|---|---:|
| model_forecast_runs | 547,119,104 |
| forecast_snapshots | 339,722,240 |
| line_refresh_stages | 323,158,016 |

The three total 1,209,999,360 bytes, about 94% of the database footprint. There are
11 Auth identities, zero Storage objects/buckets, zero Edge Functions and one
database cron job. Custom application/private function count is 85. No passwords,
session/token bodies, scheduler command/secret or financial row bodies were read
for this inventory. Estimated row counts are not treated as exact live counts.

The prevention/compact-writer changes remain development-only; production still
uses its old writers. No production pause, cleanup, schema/config update, deployment
or paid plan change occurred. Current egress/dashboard remaining quota was not
measured in this inventory. Full export/restore scope and transfer budget must be
reviewed before downloading large archives; do not materialize a gigabyte-scale
JSON export into a connector response as a supposed backup.

## Off-site financial checkpoint and custody preparation

The owner's selected private Drive folder was created at My Drive root, verified
as unshared with only the owner permission, and received the existing October 28
encrypted financial checkpoint (494,361 bytes) plus a self-contained restore ZIP
(553,540 bytes). Both were downloaded again and compared byte-for-byte by SHA-256.
No private key/DPAPI wrapper/password was uploaded. The ZIP contains exactly 11
allowlisted ciphertext/schema/source/metadata/dependency files; its financial
records remain encrypted. It is not an encrypted container for arbitrary files.

The minimal two-dependency restore package installed from its lock and inspected
the checkpoint successfully. A new owner-run hidden-input helper re-encrypts the
old key with an independent password and verifies the original fingerprint/hash.
Its portable verification path uses no DPAPI and restores only to local memory.
Synthetic tests exercise actual CLI export/restore, overwrite prevention, wrong
or weak password, digest tampering, FK/privacy checks and non-secret receipts.
See [owner steps](../financial-recovery-custody.md). Actual password-manager import
and independent-device drill await the owner; no such attestation is inferred.

F001 remains open for current complete data/schema/platform/Auth/configuration
recovery, independent key custody, full restore evidence and an off-site lifecycle.
The existing old financial checkpoint cannot cover later production transactions.

## B007 — staff operations used legacy participant-only checks

Reproduction before the fix: an approved B operator with a participant identity
in A could not read a legitimate B wallet (`0` visible versus `1` expected).
`can_view_wallet`, promo-image storage and the worker actor resolver still used
legacy participant-admin checks. The original teamless UI fixture had no B wallet,
so it did not expose this remaining database inconsistency.

CLI migration `20261029235622_staff_operations_consistency.sql` maps to managed dev
`20261030001240_staff_operations_consistency`. It:

- Uses the existing admin capability for wallet/ledger visibility, while ordinary
  participants retain their actual own-team scope and viewers stay excluded.
- Allows service-only promo-image storage for a verified owner/operator or legacy
  participant admin, using the server-authenticated user ID.
- Resolves a verified independent owner/operator for worker operations when a league
  has no participant admin; inserts no fabricated member or wallet.
- Rejects activation of an unverified staff identity inside the existing private
  audit boundary. Revocation still works; no Auth-table client grant or new public
  security-definer API is introduced.

The baseline regression fails before the migration and passes afterward. Full
release run: **36/36 passed**; the expanded portable custody CLI tests were also
rerun after their final additions. Hosted rollback-only checks cover owner B
wallet visibility after removing its participant mapping, betting still false,
service image authorization and worker fallback. Financial/record fixtures were
rolled back, with no actual email/job/activation/betting operation. Security
advisory counts remain the existing 37/2/1 WARN and 11 INFO findings.

The deployed application source remains compatible; this correction is a database
authorization change. No production patch or GitHub push is authorized by this
development verification. Routine log/email/media retention (F003) and exact release
enforcement (F002) remain ready engineering work while custody is owner-pending.
