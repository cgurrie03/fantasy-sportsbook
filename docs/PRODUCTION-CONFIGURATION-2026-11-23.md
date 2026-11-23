# Production configuration review — November 23, 2026

Read-only review. No deployment, settings, credential, billing, scheduled job or email was changed.

## Confirmed live

| Area | Observation |
| --- | --- |
| Supabase | `bmvjcdgxwxqalaohpsnw`, ACTIVE_HEALTHY, PostgreSQL 17.11, SSL and row security on |
| Canonical domain | `sportsbook.coopergurrie.com`, verified, assigned to the existing Production project |
| Rollback deployment | `dpl_6pkZ3DcTCUEHiWrUBKa6Rt9wevKZ`, READY, source `d1ea6c98d200326156aef76f8a8a6318b743f897` on `main` |
| Hosting | Node 24.x; canonical application responds HTTP 200 with HSTS. The immutable rollback application was verified through the authenticated Vercel connector; ordinary requests redirect to Vercel login. |
| Existing environment names | SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY, RESEND_API_KEY, WEEKLY_WORKER_SECRET; values masked and not exported |
| Supabase Auth | Email enabled, automatic email confirmation off, signup enabled, phone disabled |
| Auth site URL | `https://sportsbook.coopergurrie.com` |
| Auth email transport | Custom SMTP enabled, smtp.resend.com, port 465, stored password hidden |
| Existing scheduler | One active `sportsbook-weekly-worker`, every minute; command fingerprint unchanged from the reviewed pause script |
| New runtime | No Production Edge Functions or new schema/release marker installed; expected before cutover |
| Routine delivery | Existing Production notification suppression trigger remains installed |

Credential presence is not proof of successful transport or correct masked values. The service project's strict target checks, real Auth and a controlled email test still need the hosted postflight. No keys/passwords were copied into source.

## Corrections staged for cutover

1. Set `BOFF_RELEASE_TARGET=production` and `BOFF_RELEASE_SCHEMA=boff-person-wallets-2026-11` on the new Production API deployment. They are absent today. Reuse the existing server-only Supabase credential; verify it against the expected project through runtime identity checks. `visual/production.env.example` records the non-secret values.
2. Supabase Auth has **no redirect allow-list entries**. Add the trusted Production-origin application routes required for `/join` invitation acceptance and sign-in continuation, preserving query parameters. A Production-origin-only `https://sportsbook.coopergurrie.com/**` entry supports these routes; do not add Development, arbitrary hosts or an unrestricted host wildcard. Verify the actual returned link redirects during hosted acceptance. Existing site URL remains correct.
3. Auth SMTP sender name is still **Goldy Fantasy Sportsbook**. Change its display name to **Boff**, preserving the existing authorized sender address and encrypted Resend SMTP credential. No credential rotation is necessary merely for branding.
4. Deploy only the explicit Production candidate/config, not a root-app or Development build. The new Vercel configuration carries the reviewed security headers. Neither the canonical old application nor the authenticated immutable rollback application returned CSP. An ordinary request to the protected immutable URL follows a Vercel login page, whose headers are not application evidence. Verify the exact canonical response after deployment.
5. Generate the dedicated refresh credential inside Vault using the reviewed cutover helper, stage the new cron disabled and keep old/new writers mutually exclusive. Routine notifications remain off until their separate delivery acceptance.

These are concrete pending live changes, not reported as already configured. Applying them remains part of the coordinated cutover so the old application is not mixed with the new runtime.

## Capacity warning to resolve before launch

The organization dashboard displays a previous-cycle **Egress Exceeded** grace-period warning ending **November 29, 2026**, with possible HTTP 402 restrictions under its Fair Use Policy. Current-cycle usage shown at this review is **1.30 GB of 5 GB**, with zero current overage. This is an egress/account enforcement warning, not a new Disk IO measurement.

Confirm the warning/enforcement has cleared or obtain a definite resolution before launch. Current usage below allowance does not prove the displayed warning is cleared; the warning also does not establish that an upgrade is mandatory. No plan upgrade, payment or destructive cleanup was performed. Relevant dashboard: [organization usage](https://supabase.com/dashboard/org/mkagrbbxabchkzkxobgh/usage).

## Release source and verification

The November round and Production tooling are being frozen in the current release branch. Generated `visual/test-results` is ignored, private backups/configuration remain ignored, and the foundation/visual/Production migration profiles are separated. The release runner now builds the actual Production candidate before its visual tests, hashes all migration profiles and runs both the original application suites and the new portable visual/security/storage suites. Native backup and browser acceptance are separately source-bound local evidence.

Both dependency lockfiles were audited during this review: zero reported vulnerabilities. The high-confidence source scan found no embedded private keys or service-role JWTs. This is not a guarantee of no unknown vulnerabilities. Final exact commit, suite results and limitations are recorded in ignored `work/release-checks/` and `work/production-release-20261123/`; no remote push or Production promotion is implied.
