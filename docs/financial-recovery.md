# Financial recovery checkpoint

This is an application financial export and a disposable restore drill, not a
full Supabase platform backup or an authorization to delete production data.

The October 28 snapshot contains all tickets, legs, wallets, ledger and balance
events, memberships, promotion use, financial administration, outbound delivery
deduplication and the foreign-key dependencies enumerated by
`scripts/financial-recovery.mjs`. It includes the 90 quote rows referenced by
accepted legs, every board/reopening approval required by those references, and
the historical import batch. Auth exports contain only IDs, email addresses and
confirmation dates needed to validate those relationships.

It excludes Auth passwords, sessions and provider secrets; full current unbet
markets, model/forecast archives, transient refresh queues, most operating
configuration and platform roles/settings/schedulers. Storage objects are not
covered. It cannot recreate a working hosted site by itself. A full platform
backup and owner-controlled off-site key escrow remain separate release gates.

## Produce and verify a checkpoint

Run `node scripts/financial-recovery.mjs prepare work/<new-folder>` locally on
Windows. Preparation exclusively creates its key directory, an RSA 3072-bit
OpenPGP key, a schema copy and an export query. The private key is encrypted with
a random passphrase; that passphrase is wrapped with Windows DPAPI CurrentUser.
Neither is logged. Do not replace keys for an existing export.

Review the generated `export.sql`, then execute it through the authorized
production SQL integration. It is one repeatable-read, read-only transaction.
Postgres encrypts and compresses the snapshot using only the public key before
returning it. The connector receives ciphertext and a checksum, not account
records or private keys. Write the decoded ciphertext to `snapshot.pgp` and the
returned `plaintext_bytes`/`plaintext_sha256` to `manifest.json` in that folder.

Run `node scripts/financial-recovery.mjs verify work/<folder>`. It decrypts in
memory, checks the document hash and exact schema hash, restores into an
in-memory PGlite database and closes that database afterward. No hosted client
is present in the restore code. It preserves original numeric JSON rather than
round-tripping amounts, bigint IDs or probabilities through JavaScript numbers.
Import triggers are disabled only in that disposable transaction. It then checks
every exported table's canonical checksum and row count, all 82 baseline foreign
keys independently, and anonymous/unrelated-user denial. When an eligible open
ticket exists, it refunds it twice only in the disposable restored database and
verifies exactly one credit. Real production data
must never be used as hosted-development fixtures.

`npm run test:financial-recovery` uses synthetic data only, works without these
keys or a production export, and rejects missing dependencies and schema changes.
It is part of the maintained release suite.

## Key custody and present limits

### Wallet-aware v2 — November 1 local verification

`boff-financial-recovery-v2` adds independent wallets/entries/approvals, financial
routing mode, staff grants/audit and both owner/launch dependencies: 32 relations.
Its export selects only Auth identities referenced by those records, using the
actual FK catalogue, and normalizes timestamps to UTC. No passwords or sessions
are exported. The original v1/23-relation contract and October 28 package remain
unchanged and restore-compatible.

The synthetic wallet suite restores all 32 relations against a schema-only dump,
checks all 116 current-schema FKs, opening/ledger conservation, paired legacy
transfers and wager/payout/refund receipts. It verifies outsider/anonymous denial
and refunds an open user-wallet ticket twice for one credit. Deliberately changed
cash, missing approval, missing transfer debit and missing Auth dependencies are
rejected even after their counts and checksums are recomputed. These checks run in
`npm run test:user-wallets`; the original custody/restore checks remain in
`npm run test:financial-recovery`.

Future v2 preparation requires an explicit reviewed schema-only artifact:
`node scripts/financial-recovery.mjs prepare-v2 work/<new-folder> <schema-file>`.
Do not substitute the original baseline or concatenate migrations containing seed
data. Review against the actual source schema before an authorized export. New
restore packages must include `scripts/lib/recovery-wallet-checks.mjs` beside the
updated recovery source and dependency lockfile. Never replace the existing v1
off-site package or create/copy owner keys as part of an agent test.

This is local format/readiness work: no new real financial export, off-site
checkpoint, full-platform backup or independent-device drill was performed.

The private key and DPAPI-wrapped passphrase remain together in the ignored local
working directory. The encrypted recovery output contains no private key. The
current wrapper requires the same Windows account/profile: copying the output
alone to another computer is insufficient for recovery. A portable encrypted key
with independent owner-controlled recovery material must be escrowed separately
before relying on this as an off-site or disaster-recovery backup. Never paste
that recovery material into chat, Git, deployment variables or public artifacts.

Do not run this schema artifact against an existing hosted project. The tested
restore is a financial integrity drill using the reviewed application baseline,
not a managed-platform restoration procedure. No production mutation, provider
request, real bet or email is performed by this tool.

References: [Supabase backup scope](https://supabase.com/docs/guides/platform/backups),
[PostgreSQL OpenPGP functions](https://www.postgresql.org/docs/current/pgcrypto.html),
[OpenPGP.js key/decryption APIs](https://docs.openpgpjs.org/).
