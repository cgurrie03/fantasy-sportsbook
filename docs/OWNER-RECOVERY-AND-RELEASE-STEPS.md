# Owner recovery and release steps

These are the remaining owner-controlled steps, not a request to repeat completed key custody. Your password-manager import and phone access are recorded. See the November 19 migration runbook for the current release scope and gates; older observations below are not current-state verification.

## Full-platform checkpoint (milestone 20)

**November 20:** a fresh encrypted Production export and bounded local application-schema/financial-data restore check succeeded. See `PRODUCTION-MIGRATION-PREPARATION-2026-11-19.md` for the exact checkpoint and coverage. Auth credential/session/runtime/external configuration recovery and the actual application upgrade rehearsal are not verified by that financial check. The previous secure backup connection request is resolved; no password was retained.

**Updated November 19:** an encrypted native Production export succeeded November 5–6 (`production-2026-11-05T23-57-37-993Z-fd7cc94f-4a96-462c-8c70-952777de5ff3`). Its manifest has `restore_verified:false` and `full_platform_complete:false`. A fresh checkpoint and isolated restore/upgrade rehearsal remain gates for the material Production migration. This supersedes the November 4 export deferral.

The owner selected free client-only setup here on November 3. Portable PostgreSQL 17.11 clients are prepared and verified, with no server, service, Docker or global PATH change. Follow [the client export steps](CLIENT-BACKUP-SETUP.md), explicitly selecting Production for this release. The launcher uses a hidden local password prompt, verified TLS, read-only sessions and direct-to-encryption streaming. Native export covered the readable database/Auth schemas; external configuration and a successful restore still need independent verification. Never send credentials in chat.

Before an export, confirm its project name and reference: development `whlcnlacueweaqpsupqs`; production `bmvjcdgxwxqalaohpsnw`. Use the supported Supabase logical backup procedure for that project. Cover schema, roles, data and Auth records explicitly, record tool versions and permissions, and keep all plaintext exports private. A generic public-schema `db dump` alone is not full coverage. Record Auth/site URL/redirect/signup/email configuration separately, plus Vercel settings/domains/schedules, private secret recovery locations and object-storage inventory. Never put credentials in Markdown/Git. Current production Storage has no objects, but recheck at backup time.

Once an owner export exists, the local helper can encrypt it with the existing PUBLIC recovery key:

`node scripts/encrypt-platform-backup.mjs <owner-export> <existing-public.asc> <new-cipher.pgp> <project-ref>`

It preserves the export and refuses replacement of an existing ciphertext. Upload only ciphertext plus its manifest to the private Drive recovery folder, and independently verify downloaded ciphertext SHA-256. The manifest proves encryption integrity, not Auth/config/storage completeness. Keep private key/password in your password manager, separately from Drive. A complete recovery checklist still needs independently reviewed coverage and any owner-approved isolated restore drill. No production restore is authorized by this document.

Official references: [Supabase backup coverage](https://supabase.com/docs/guides/platform/backups), [supported logical migration/restore procedure](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore). Database backups exclude Storage objects and custom-role passwords; external settings need separate custody.

## Review-only GitHub gate (milestone 21)

The workflow is local, with no GitHub push authorized. Before publication, configure the existing Production environment in `cgurrie03/fantasy-sportsbook`: required reviewer `cgurrie03`, self-review permitted for this sole-owner process, administrator bypass disabled, and exactly one custom deployment branch matching the reviewed workflow branch. The helper validates the live metadata and explicit approval history. The currently observed environment has no reviewers and permits bypass.

Publishing these local source/workflow changes requires a separate explicit instruction. After a same-repository push receives successful Project Checks, dispatch Owner Source Review for its exact SHA and CI run ID, review the protected job, and approve that exact source. Its output only attests owner source review; it does not authorize production deployment, schema changes or historical cleanup. The actual production release must separately bind recovery, product/capacity evidence, migration mappings, cleanup candidate checksums, rollback/restore constraints and postflight.

## Real capacity evidence (milestone 23)

Collect compact daily actual measurements under the final deployed source: combined project physical database bytes, shared wire usage and metered allowances. Keep billing/meter export evidence private and link a sanitized receipt. Do not backdate samples or use synthetic tests as observed demand. Include one-/two-league workload, worker fairness/timeouts/outages and season forecast. Fifteen daily samples must span at least fourteen elapsed days with the agreed reserve/growth bounds. No second real league is approved by a projection alone.
