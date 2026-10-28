# Development environment and owner-approved releases

October 28, 2026. Companion to handoffs 08 (Supabase efficiency) and 10 (expanded implementation backlog). This document is a setup specification; record actual hosted setup separately below.

## Confirmed requirements

- Development is accessible only to Cooper, with separate test accounts and data.
- Every production release requires Cooper's approval after testing in development.
- Initially only Cooper configures additional leagues and sportsbook settings.
- All supported sportsbook settings start from shared defaults and can be overridden per league. Owner-led import plus commissioner-distributed signup links is the confirmed onboarding flow; teams exist before manager signup. Use one account with an authorized league selector for users belonging to both leagues.
- If free capacity remains too small, present further optimization/feature-limiting options to stay within it. Do not purchase an upgrade.
- Suggested development address: `https://dev.sportsbook.coopergurrie.com`.
- Preserve the current production service and its accepted bets. Development must not use production database credentials, email recipients or worker secrets.

## Recommended architecture

Use the existing private GitHub repository. A second repository is not necessary for environment isolation and would introduce duplicated fixes/migrations and synchronization work. A separate repository remains an available preference, not a prerequisite. Use a persistent development branch and feature branches; keep the current production branch behind the owner-controlled release process.

| Resource | Development | Production |
| --- | --- | --- |
| Git | Feature branches → development branch | Owner-approved release/PR → main |
| Web deployment | Branch preview, proposed dev subdomain | Existing production deployment/domain |
| Database/Auth/Storage | Separate Supabase test project | Existing Supabase production project |
| Accounts | Owner plus owner-operated synthetic role fixtures | Real approved members/staff |
| Data | Reproducible synthetic two-league fixtures and read-only public Sleeper inputs | Real league records and transactions |
| Mail | Capture by default; explicitly owner-allowlisted delivery only for a focused email test | Approved production sender/recipient rules |
| Scheduler | Manual or bounded test runs by default | Existing shared scheduler |
| Secrets | Independent dev keys and worker secret | Production-only keys |

A preview frontend pointed at the production database is not an isolated development environment. A different hostname or repository does not provide data isolation. Two leagues in production still share the production infrastructure with strict tenant isolation; the second Supabase project is for development, not specifically for league two.

Vercel supports branch previews and a persistent branch-assigned domain. Its Local Development environment-variable scope is different from a hosted preview: the hosted dev branch needs Preview-scoped variables, ideally explicit branch overrides. Avoid importing production secrets. If the existing project cannot provide the required owner-only domain protection or clear release controls, use a separate Vercel project linked to the same repository; that still does not require a separate repository.

Provider documentation was checked October 28. Supabase documents two free active projects across organizations where the account is Owner/Administrator, and organization-level shared egress; an unused project slot and actual quota must be verified in the account. The new project has its own database footprint, but development traffic must still be included in relevant shared allowances. Do not select paid branching, trials or upgrades as a hidden setup dependency.

## Setup steps, in execution order

### 1. Capture the deployment baseline and prevent accidental releases

Record production commit/deployment, current production branch, custom domain, schema fingerprint and enabled scheduler target. Inspect all workflows and deployment hooks before pushing a new branch. Preserve the dirty checkout's unrelated changes and do not push them as an environment setup commit.

Select the development branch after the owner repository preference is answered. Configure preview deployment for it. Do not change the production branch/domain. CI results alone must not authorize a production release. Branch rules and GitHub environment review capabilities vary by account/repository plan: verify actual availability before claiming a hard approval gate. If unavailable, use a release workflow that requires explicit owner dispatch of an exact SHA and isolate deployment credentials from untrusted jobs. Identify remaining owner-admin bypass capability clearly.

Vercel currently deploys production automatically on production-branch changes. Ensure the chosen policy actually stops unapproved changes: either protect all writes/merges to main with the available enforced rules, or disable automatic production publication and use the owner-controlled release action. Do not leave a second route such as an unrestricted deployment hook, direct CLI deployment or auto-deploy from another branch. A preview “Promote” action may carry the wrong build-time database URL: rebuild the approved source with production environment variables and verify target identity.

### 2. Create isolated test infrastructure

Confirm a free Supabase slot, quota and region. Create a dedicated test project; use a distinct project name, database credentials and worker secret. Never reuse production service-role credentials. Secret creation/login steps must use the provider's supported owner workflow; never paste credentials into source or handoffs.

Reconcile the schema and its migration history before assuming a clean project is reproducible. Several old migrations contain first-league seeds/imports; do not blindly replay them into hosted dev and copy production users or historical tickets. Produce a reviewed clean-install path: preserve historical deployed migration identity, separate environment-specific data seeding, and document how schema-only bootstrapping reaches the same current schema. Prove schema/function/RLS equivalence in an isolated database. Never amend old production migrations to make a new environment convenient.

### 3. Add bounded reproducible fixtures

Create two fictitious leagues with overlapping roster numbers and distinct rules. Include 8/10/12/14/16-team parameterized tests, bye/odd-field behavior where supported, different scoring/playoff configurations and staff-only oversight. Use fresh deterministic internal IDs and test-only recipient addresses. Cooper can operate several synthetic identities without granting access to other people.

Fixtures must include open/settled tickets, replenishment, futures, boosts, featured games, incomplete lineups, failed jobs, an interrupted publication and delayed provider data. Keep fixtures small and resettable. Reset must refuse the production project reference, require an explicit development target, and validate that identity again on the server before mutation. Do not rely on a cosmetic “DEV” banner as the safety boundary.

### 4. Wire environment configuration and runtime safeguards

Inventory actual environment variable names in `src/lib/supabase.ts`, APIs, worker and mail modules. The browser's Vite Supabase URL/publishable key are compiled into the frontend; server `SUPABASE_URL`/keys must refer to the same test project. All service-role and worker secrets stay server-only. Do not print values in logs or build artifacts.

Add a fail-closed environment identity check before dev builds and privileged server operations: expected project reference, allowed app origin, deployment environment and database environment marker must agree. Never allow a non-production deployment to initialize with the known production database. Validate worker/email targets separately. These guards must execute, not just exist as unchecked environment flags.

Use separate auth site URL/redirect allowlist and owner-only application authorization. Review tokens/callback origins, local session keys, redirect validation, CORS and magic-link destination. No broad wildcard redirects into arbitrary previews. All alternative deployment aliases need equivalent access protection. Show a persistent Development badge and build SHA after authentication.

Prevent dev delivery at the central mail send boundary; merely omitting `RESEND_API_KEY` leaves retrying failures and is not a complete capture mode. Capture messages as bounded test artifacts; an explicit test-delivery mode must validate the owner recipient independently of a generated email body. Configure test auth mail separately. Never send copied real-member emails from dev.

Do not register a production-style minute cron by default. Manual tests use a unique dev secret and dev endpoint; simulate time and provider states for settlement/rollover tests. An explicitly enabled short soak test needs a duration, cleanup and traffic budget. Do not perform an unbounded load test against Sleeper or production.

### 5. Assign the domain and verify privacy

Assign the suggested subdomain to the dev branch, inspect DNS ownership/records, and add only the DNS record Vercel actually requests. Verify HTTPS without changing production records. Do not assume the provider's record value or that adding a hostname automatically protects it.

Enable the available Vercel authentication protection and restrict access to the owner's account. Provider docs and release notes can differ: verify actual account controls and anonymous behavior rather than relying on a plan label. Test the custom dev hostname, generated deployment URL and prior aliases while signed out; all must meet owner-only access. Keep app-level owner authorization and test-project RLS as separate checks. Do not publish a public share/bypass link.

### 6. Test and release the exact approved source

Run lint/build plus the maintained critical suites, including isolation, accounts, pricing, refresh/recovery, settlement/replenishment, futures, promotions, receipts, email scoping and active UI. Fix the stale Monday harness before including it. Produce a compact owner review with changes, screenshots, test results, capacity impact, schema migrations and rollback constraints.

Record owner approval against the tested commit and migration set. Any code/migration change after approval invalidates the release approval. Release only that source using production configuration, with a migration-before/after compatibility plan. Use expand/contract migrations where needed; application rollback does not undo destructive database changes. Verify deployed commit, environment identity, auth, a read-only board and worker health. Do not place real bets or trigger bulk mail as release smoke tests.

## Completion criteria

Development URL loads only for Cooper; test identities/data are independent; synthetic two-league workflows work; dev cannot access production DB or send member mail; production does not move on a dev push; owner approval is required for an exact release; schema installs/restores are reproducible; dev activity fits shared usage budgets. Record screenshots and checks without secrets. Until these pass, label the environment “setup incomplete,” not “ready.”

## Official references

- [Vercel branch domain assignment](https://vercel.com/docs/domains/working-with-domains/assign-domain-to-a-git-branch)
- [Vercel environment variable scopes](https://vercel.com/docs/environment-variables)
- [Vercel deployment protection](https://vercel.com/docs/deployment-protection)
- [September 2026 Vercel protection announcement](https://vercel.com/changelog/protect-production-deployments-for-free-on-every-plan)
- [Supabase managing environments](https://supabase.com/docs/guides/deployment/managing-environments)
- [Supabase allowances and shared billing](https://supabase.com/docs/guides/platform/billing-on-supabase)

## Setup record

### Owner-created project verified October 28

The owner completed project creation. Verified in Supabase: **fantasy-sportsbook-dev**, project reference `whlcnlacueweaqpsupqs`, Healthy, Free organization, East US / North Virginia (`us-east-1`), Nano. This is distinct from production `bmvjcdgxwxqalaohpsnw`. The overview shows no migrations or repository integration; these are setup tasks, not reasons to create another GitHub repository. Do not connect automatic schema deployment until the reviewed clean-install/migration path is ready.

Created local `development` branch from the verified application baseline `d1ea6c98d200326156aef76f8a8a6318b743f897`, without switching the dirty checkout or including unrelated local changes. It has not been pushed: preview target identity, safe credentials and runtime guards must be configured before a hosted build can run. No production changes, DNS assignment, mail configuration or support deployment occurred. The recommended source remains the existing `cgurrie03/fantasy-sportsbook` repository.

Next setup sequence: schema-only bootstrap and synthetic fixtures → independent auth/mail and runtime identity checks → branch-scoped Preview configuration → protected dev domain → clean CI and approval/release verification. The database exists; the hosted dev application is **not yet ready**. The older creation-pending notes below describe the earlier checkpoint and are superseded by this verification.

Earlier checkpoint, now superseded by verified project creation above: owner-only development, separate test accounts/data, explicit approval for every production release and owner-controlled league configuration were confirmed. Vercel showed standard Preview available and paid Custom Environments unnecessary. The account initially had one Free project and the new-project form was prepared for owner password entry. No DNS assignment or application deployment occurred at that checkpoint or during subsequent verification.

Local preparation added `docs/development.env.example`, `scripts/check-development-environment.mjs` and `scripts/test-development-environment.mjs`. Run the latter for offline safety checks; run the preflight with development-only environment variables before hosted setup. These scripts detect wrong/missing/mismatched project targets, production URLs, live mail keys, unsafe mode flags and frontend secret exposure without printing values. They do not authenticate against Supabase, prove key ownership, enforce Vercel protection or implement runtime mail capture. BOFF mode flags in the example are a contract still requiring runtime wiring. Do not deploy the application to dev merely because this offline check passes.

Verified locally: the preflight test passes one valid synthetic configuration and rejects 18 unsafe configurations; both script syntax checks and targeted lint pass. No application build was needed for these standalone scripts/document changes. Hosted identity/access/approval gates remain unverified. The owner-created Free Supabase project has since been verified; continue with schema/fixtures, safe environment configuration and protected hosting.
