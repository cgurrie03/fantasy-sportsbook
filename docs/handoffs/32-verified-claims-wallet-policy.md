# Verified invitations and versioned financial policy

Milestone 16 remains in progress. The stable count is **16 complete / 8 remaining**.
This batch completes the scoped invitation/claim implementation and the first
shared policy runtime slice; it does not complete every setting/provider adapter.

## Invitations and claims

Owner-only League Settings creates a revocable seven-day league signup link for
commissioner distribution. Optional team/email restrictions narrow it. Distribution
never grants staff access. The browser generates 256-bit tokens; the database stores
only SHA-256 digests. Tokens are removed from the URL and retained only in a bounded,
one-hour browser-tab hint for same-tab sign-in/navigation. Successful submission
clears that hint. A different tab or blocked browser storage may require reopening
the original invitation. No invitation email is sent by this flow.

A verified account can inspect only the invited league's team names, request an
owner-reviewed mapping and see its own request history. No global league/email
directory is exposed. Targeted links bind the freshly verified Auth email; public
Sleeper IDs, team selection and user metadata establish no authority. The owner
approves/rejects with a reason and revision check. Approval creates a separate NULL-
funded per-user wallet, including co-owners, without fabricating a legacy team
membership. Rejection, expiry and revocation grant no access. Approved revocation
uses the existing wallet-status CAS and preserves financial records. Existing
independent staff grants remain separate.

Admission: at most 32 unexpired open links and 256 link/claim rows per league;
at most 128 claims per verified user; one live pending request per league/user.
Expired pending requests do not block a fresh invitation. Direct table access is
revoked for anon/authenticated/service roles; narrow RPCs enforce fresh identity.
Private rows and hashes are omitted from public directories and mail payloads.

## Wallet/ticket policy v1

Shared SQL/TypeScript defaults: minimum wager $1, maximum 10 picks, weekly target
$100 and futures cash floor $25. Typed league overrides can raise the minimum
($1–$10,000), reduce the pick limit (2–10), and set a whole-cent cash target
($1–$10,000) and floor (0 through target). Other rule keys are rejected.

Only the verified platform owner can save a policy, with a reason, CAS revision,
before/after review and acknowledged effective NFL season/week. Operations and
automation must be paused. Versions advance in period order, are immutable, and
are capped at 64 per league. Accepted weekly tickets prevent a retroactive period
change. Future versions leave current policy unchanged. Tighter limits may make
existing offers ineligible; opening funds still need an explicit separate decision.

The existing authorized tiny board manifest carries current policy without a new
poll loop or category-body reload. The core capability response supplies the same
policy to the guide. Wager UI and selection conflicts consume its limits; database
insert/deferred-leg guards enforce them for every placement path. New tickets save
an immutable server-owned policy snapshot; historical imports are not backfilled.
Both legacy/user replenishment engines and the weekly API preview use the same
period-specific target/floor. Higher balances and once-only receipts remain intact.
Pricing, settlement and accepted odds retain their existing contracts.

## Recovery and capacity

Recovery v1/v2 readers remain supported. New financial recovery v3 adds effective
policy versions, validates their supported values during restore, and preserves
accepted ticket policy snapshots. v3 requires an explicitly reviewed schema artifact;
no real private key was opened or recreated. Financial recovery still excludes full
Auth credentials, pending invitations/claims, storage and hosting/account settings.
The existing owner password-manager import is complete; do not repeat it.

Policy snapshots add a small fixed JSON object to each newly accepted ticket;
existing rows stay NULL. Policy histories and claim directories have explicit row
and byte caps. The claims and policy screens are lazy-loaded. Directory reads are
bounded (claims 256 records/400 KB client admission, policy 64 versions/128 KB).
These are logical admission limits, not proof of production quota or a plateau.

## Validation and deployment checkpoint

Focused SQL tests cover verified owner/member/outsider/anonymous/service boundaries,
scoped digest-only links, retries, stale reviews, changed verification, shared and
email-bound links, separate co-owner/two-league wallets, expiry/rejection/revocation,
admission limits, and no funds/staff/legacy-membership fabrication. Phone/desktop
fixtures intercept every request and verify token clearing, requests and review.

Policy tests compare SQL/TypeScript defaults and contrasting leagues, reject invalid
keys/dependencies/periods, enforce actual ticket minimum/pick limits, preserve frozen
terms, compare both replenishment engines, and check guide/UI/API consumers.
Financial restore checks exercise v1/v2 compatibility and v3 policy preservation,
including rehashed invalid-policy rejection. Full clean-source qualification and
hosted migration/rollback/advisor/deployment receipts are recorded after validation.

## Remaining work

Milestone 16 still needs the broader shared schema/runtime consumers for supported
pricing/boost/market/featured/schedule/notification/branding settings, provider
capability approval, drift and renewal. Imported leagues remain quarantined; this
batch does not activate a real league, send mail, fund wallets or change production.
Milestone 18 remains downstream. See IMPLEMENTATION-CHECKLIST.md for all eight
remaining milestones and their external/elapsed-time gates.

Release harness maintenance: fixtures that load the current schema now apply every
post-baseline migration, including the tiny board manifest dependency. The account
module harness resolves the actual shared policy parser instead of dropping it.
The failed/interrupted pre-fix run is not release qualification.


## Bounded release concurrency

Release checks now run lint and the fixture build as barriers, then at most two
isolated suite processes. `RELEASE_JOBS=1` selects serial operation. A failed build
prevents browser suites from reading stale output. Results retain plan order;
per-suite logs/output/timeouts stay bounded and exact clean-source provenance is
unchanged. Runner tests check barriers, the concurrency ceiling, failure/timeout
propagation and log bounds. Isolated futures/extra-market module loaders now include
the real shared policy dependency. Earlier failed runs do not qualify a release.


## Verified DEV checkpoint — November 1 ET

- Clean source `44f113677324d71302c507b287b95d5891f33feb` passed **42/42**
  suites with valid provenance in 322.267 seconds using the bounded two-job runner.
  Its exact-source release review remains explicitly unapproved for production.
- READY deployment `dpl_VyWiGNuK9qVR4NhSW766i8JWzDEN` serves the canonical DEV
  hostname and both existing DEV aliases. Generated hostname:
  `fantasy-sportsbook-2djvlw0rj-cooper-gurrie-projects.vercel.app`.
  All four URLs returned signed-out 302 to Vercel SSO; protection remains all.
- Hosted build verified the independent DEV project/server key/owner, closed
  signup, captured mail and manual automation. No owner browser was operated.
- Local `20261102011224` maps to hosted `20261102015001`; local `20261102012217`
  maps to hosted `20261102015018`. Both migrations are now immutable.
- Hosted rollback-only shared invitation, verified claim/approval, unfunded wallet,
  revocation, scoped policy/preview/manifest and outsider/ACL probes passed.
  No fixture league, invitation, claim, override, staff membership or cash persisted.
- Postflight: two existing leagues, two pending wallets, zero user entries/tickets/
  legacy ledger; operations and automation disabled; original two wallet modes active.
  The same canonical before/after financial digest is
  `277b6de5223808d846be3136c7f9c3c6` (this query differs from older handoff digests).
- Advisor baseline/delta: 58 authenticated-definer warnings (was 49), two anonymous
  definer warnings unchanged, one password-protection warning unchanged, and 15
  RLS/no-policy INFO (was 12). Nine new RPCs enforce owner/verified-token/member
  scope; the existing finance wrapper delegates its original operator gate. Three
  private tables intentionally deny direct API access. No anonymous endpoint added.
- DEV physical database 17,299,123 bytes; app relations 3,301,376 bytes. Compared
  with the prior intake observation, increases are 360,448 / 212,992 bytes, including
  schema/index/catalog and rolled-back fixture allocations. These are empty-feature
  observations, not populated production capacity. Default policy JSON is 228 bytes;
  new lazy chunks are 8.70 KB claims and 4.06 KB editor before compression.
- Production remains on `dpl_6pkZ3DcTCUEHiWrUBKa6Rt9wevKZ`, with its domains intact.
  No GitHub push, production schema/data/configuration change, real mail, bet, funding,
  new Auth account or scheduled continuation occurred.
- Ignored evidence: `work/claims-policy-completion-receipt.json`,
  `work/claims-policy-hosted-receipt.json`, `work/claims-policy-release-qualified.log`,
  release-check provenance/results and the unapproved exact-source review.

Rollback is additive: retain the new tables/columns and financial snapshots. The
previous wallet-aware DEV deployment is source `6c070a8` / `dpl_8qSiLyunfdXCXMTQN7rihYyDXr4A`.
Review UI compatibility before using it after custom policy versions or claims exist;
never switch to a pre-wallet frontend or erase accepted policy/financial records.
Original off-site v1 files/key custody stay intact. No new real v3 snapshot was
exported; full platform backup/independent-device recovery remains milestone 20.
