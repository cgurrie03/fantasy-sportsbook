# Owner provider-rule comparison

Milestone 16 progress; counter stays **17 complete / 7 remaining**. This delivers
the read-only observation/comparison step, not capability approval or activation.
Full clean-source qualification and protected DEV rollout are recorded below.

## Behavior

League Settings exposes an explicit owner-only comparison for the selected league.
The server verifies current confirmed sign-in and platform ownership before any
provider request, reads the retained imported contract and stored provider roster
identities under the user's existing RLS, then uses the existing bounded fixed-host
Sleeper reader. A caller cannot supply a provider destination or replacement facts.
Three concurrent provider reads fetch league, public rosters and public users.

The bounded report identifies changed scoring keys, provider settings, lineup-slot
multisets, roster field, public owner/co-owner mapping, NFL season and provider
status. Names, weekly standings and array/key ordering do not create rule drift.
A new NFL season requires renewal review. Missing or mismatched retained contracts
fail closed rather than inventing a baseline. No matching rule changes is explicitly
not an approval or proof of projection/results/market compatibility.

After provider reads the server rechecks owner authorization and both baseline
records. A changed baseline yields a conflict; revoked access yields denial. No
approval, imported contract, team mapping, membership, wallet, board or activation
is written. The existing unconditional import quarantine remains in force.

## Capacity

No migration, persistent table/column, observation archive or scheduled job. One
explicit comparison uses the existing provider response ceilings (256/512/128 KiB)
and 10-second provider timeouts, with bounded existing local contract/roster reads
and a final fresh authorization/baseline check. The report returns field names and
counts, at most 32 keys per changed section, not full values or public owner IDs.
Only the current report lives in component memory. This adds API/UI source bytes,
not recurring database storage. Actual wire/shared capacity remains milestone 23.

## Verification

Pure contrasts cover scoring, playoff settings, slots, roster IDs, co-owners,
provider status, season renewal, harmless ordering/name/standing changes, missing
coverage and bounded report output. Compiled API fixtures cover owner-only reads,
fixed provider destination/no caller body, three reads, authorization revocation and
baseline changes during reads. Phone/desktop fixtures cover owner visibility,
unchanged/changed/renewal states, retry/error and no import/activation side effect.
All fixtures are intercepted, with no real provider reads or hosted writes.

Remaining milestone 16: typed shared pricing/boost/market/featured/schedule/
notification/branding policy and consistent consumers; actual supported capability
approval, durable validity/drift gates and season renewal workflow. This comparison
is a prerequisite view, not those gates. Existing draft/intake/claims/wallet-policy
checkpoints remain in handoffs 31-33. No production change or public Git push.

## Qualified DEV delivery

Clean source **05381e8653f8b20808ca68e01c73b33da8edc896** passed **43/43** release
suites in **243.308 seconds**. API type checking includes the new endpoint. The
Vercel React best-practices review retained lazy owner-only loading, keyed league
scope and parallel independent final baseline/authorization reads. No new lint
warnings. The new frontend chunk measured 2.84 kB / 1.35 kB gzip in the local build.

READY protected Preview **dpl_A2EBtfqXntV2FxYQ6cgFXQpckjBc** serves all three DEV
aliases. Hosted independent-environment and compiled API tests passed; full build
logs contain no TypeScript errors. All four signed-out DEV URLs return 302 to
Vercel SSO, and all-deployment protection remains enabled. Production canonical
remains **dpl_6pkZ3DcTCUEHiWrUBKa6Rt9wevKZ**. No DB migration/write, real provider
fetch, real mail, automation activation, production write or GitHub push.

Ignored evidence: work/provider-review-completion-receipt.json,
work/provider-review-release.log, work/provider-review-api.log,
work/provider-review-pure.log, work/provider-review-ux.log and release provenance /
unapproved exact-source review. The earlier notification qualification was copied
to work/notification-qualified-{provenance,results}-40f19c1.json before replacement.
Fixture server stopped. Later documentation-only HEAD is not the deployed app SHA.

Next coherent milestone-16 work: the typed pricing/featured-boost policy and its
consistent generation/editor/acceptance/display/help consumers. Existing generation
and MarketAdmin still encode their featured boost rules separately; do not expose
new editable values without updating every consumer and retaining accepted facts.
Provider comparison remains read-only until durable owner approval, version
validity and renewal gates are separately implemented. Counter **17 / 7**.
