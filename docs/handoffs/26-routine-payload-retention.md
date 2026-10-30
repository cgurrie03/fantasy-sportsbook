# Routine operational payload retention — development

Milestone 19 / F003. The canonical queues remain project Markdown, updated through
chat. Financial off-site custody is separately tracked in handoff 25 and
`docs/financial-recovery-custody.md`; password-manager import and independent-device
restore are still owner-pending. No scheduled continuation is configured.

## Prospective policy

CLI migration `20261030002655_routine_payload_retention.sql` introduces version-one
admission and expiry. Existing version-zero records are not automatically converted
or expired. All existing payload bytes count toward admission budgets.

| Family | Row / league / shared budget | Expiry |
|---|---|---|
| Outbox bodies | 256 KiB / 8 MiB / 32 MiB JSON text | Seven days after successful terminal delivery/capture/skip, excluding active leases |
| Job diagnostic detail | 64 KiB / 4 MiB / 16 MiB JSON text | Thirty days after `done`, excluding active leases |
| Stored promotion image text | Existing per-image validation / 32 MiB and 128 images / 64 MiB | Seven-day-old orphan images only |
| Routine last-error text | 256 characters, at most 1 KiB UTF-8 | Removed with eligible retired details |

Email body capacity rejects persistence before the provider call. Existing retry
payloads are never truncated. Pending, sending, failed and needs-review bodies stay
available for investigation/retry. Retirement keeps the event key, recipient,
provider ID, attempt timestamps and status; a retired body cannot be regenerated or
resent. Revoked membership cannot block retirement of an unchanged recipient's
terminal body. A later real terminal transition starts a fresh retention period.

Oversized/exhausted job detail becomes a small explicit unavailable-detail receipt
with original byte length and diagnostic MD5. This digest is an observability
identifier, not a security signature or a substitute for financial evidence.
Compaction does not fail authoritative settlement. Job IDs, event keys and model
references remain valid. Failed/running/pending job detail does not expire on a
timer; writer admission bounds its payload. Compact receipts and duplicate keys
still grow per event and are included in the separate capacity forecast.

Every referenced promotion image is retained, including expired offers whose art
still forms part of historical records. Only orphan media is removed. A full media
budget rejects new uploads; it does not silently remove referenced art.

## Execution and authority

Global transaction locks serialize each family's admission; byte columns and
partial indexes avoid serializing large JSON merely to measure it. The cleanup
batch locks at most 10 rows per family by default (hard maximum 25), uses
`SKIP LOCKED`, and has server/client deadlines. It runs after financial work and
mail in the existing worker. Maintenance failure is returned as a small failure
status and does not turn completed financial work into a retry. No new cron,
polling loop, live mail, betting, or experimental market activation is introduced.

The fixed private cleanup runs as a non-login role with specific routine-table
privileges and RLS policies. It cannot read financial tables, update job status,
delete outbox rows, mutate offers or touch delivery confirmation/weekly financial
audits. Image row locking requires an unused timestamp UPDATE privilege, exposed
only to that isolated role. The public service-only wrapper checks the worker JWT.

`routine_retention_status(league_uuid)` is an authenticated invoker RPC restricted
to league operators. It returns selected-league logical bytes, budgets, unresolved
email count, due counts and last actual retirement. Image size-column grants do not
expose PNG bodies. This RPC performs no cleanup and starts no background traffic.

## Verification and remaining limits

Synthetic tests cover terminal expiry, bounded batches, legacy/lease/unresolved
preservation, revoked recipient retirement, duplicate/provider receipt persistence,
image references, email row/league admission, diagnostic fallback, operator status
scope and cleanup-role ACLs. Financial tables and saved offer terms compare equal
before and after maintenance. The local API fixture includes the new compiled
module; maintenance network errors are nonfatal.

Hosted application/database identifiers, final checks and rollout evidence are
recorded below once verified. Production remains unchanged. This does not assert
physical space reclamation, a two-week plateau, complete off-site platform recovery,
or owner approval for historical production conversion/cleanup.

## Hosted database evidence

DEV identity was checked before migration. Local `20261030002655` maps to hosted
`20261030003728_routine_payload_retention`; local `20261030003807` maps to hosted
`20261030003830_routine_retention_wrapper_grant`. The latter restores the wrapper's
explicit private-function EXECUTE after ownership transfer, using temporary role
membership and then revoking that membership. Managed postgres is not a superuser;
the initial rollback probe caught this difference before the worker deployment.

The corrected rollback-only hosted probe retired one synthetic terminal email and
one synthetic completed diagnostic, removed one orphan image and verified narrow
ACLs. No provider, financial execution or real scheduling action ran. All fixtures
rolled back; outbox/jobs/images remain zero. The before/after financial digest is
`d0274d9641a5954673be2e62be23cb59` for canonical wallets/tickets/ledger JSON.
The earlier B007 financial postflight is also covered by this subsequent unchanged
inventory (18 wallets, zero tickets/ledger). No production mutation occurred.
