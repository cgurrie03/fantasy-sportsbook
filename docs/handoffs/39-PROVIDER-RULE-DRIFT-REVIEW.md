# Owner provider-rule comparison

Milestone 16 progress; counter stays **17 complete / 7 remaining**. This delivers
the read-only observation/comparison step, not capability approval or activation.
Full clean-source qualification and protected DEV rollout are pending below.

## Behavior

League Settings exposes an explicit owner-only comparison for the selected league.
The server verifies current confirmed sign-in and platform ownership before any
provider request, reads the retained imported contract and original provider roster
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
