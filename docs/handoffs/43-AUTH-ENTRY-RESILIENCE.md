# Auth entry retry and privacy review

November 4, 2026. Milestone22/A10/A23 development work; counter18 complete/6 remaining. The owner confirmed the physical iPhone functional checklist and account MFA/recovery/access review. Android is explicitly unverified under the iPhone/Safari-plus-desktop release scope. Backup remains owner-deferred.

## Reproduction and changed behavior

**B015, P2:** the sign-in resend countdown existed only in component state. The intercepted baseline requests one link, reloads and finds the ordinary request button instead of the countdown. A provider429 also previously flowed directly to the general error formatter without starting a local retry delay. The form busy state alone did not provide a synchronous same-turn submission fence. Development requested create_user:true despite owner-only/closed signup.

The sign-in component now keeps a synchronous in-flight reference, uses an absolute60-second retry deadline after successful requests, neutral identity responses and429s, shares it across tabs and reloads, and counts actual elapsed time instead of timer callbacks. A single origin-local timestamp overwrites one localStorage key; expired/malformed/overly-future values are removed on read. One second of bounded inter-tab clock skew is allowed, while the displayed countdown is capped at60. Blocked storage falls back to the current component deadline. This is a usability/request-reduction aid; browser storage can be cleared and is not an abuse/security boundary. Supabase server rate limits still govern actual requests.

Development sends shouldCreateUser:false for the existing independently created owner. Production's existing verified-signup path remains true; no provider/signup configuration was changed. Redirects remain the environment-guarded current origin root, ignoring external destination parameters. Existing invitation/server approval authority is unchanged.

Success and known identity-related rejection codes use the same conditional Check Your Email message. Rate limits get a bounded retry explanation; unexpected errors get a safe recovery message. Raw provider diagnostics are not rendered. This does not claim the hosted Auth service's network responses are indistinguishable or that actual account enumeration/rate-limit load was tested.

## Verification and boundaries

Pure tests check expiry/rounding, malformed/future values, blocked storage, one timestamp/no address or token, rate-limit and neutral codes and safe unexpected errors. Chromium/desktop and WebKit/phone fixtures execute the actual built app and SDK: synchronous duplicate events→one request; existing-user DEV flag; exact same-origin root redirect; a peer tab observes the cooldown; reload preserves it without issuing another request; time advance enables retry; provider429 survives reload; a known identity rejection renders the same neutral success state; changing email does not erase the cooldown. No real Auth email, user, database, owner session or production call is made.

The mock includes the actual API-version response header and CORS exposure so the installed SDK can read modern error codes; omitting CORS exposure produces a generic error rather than the intended coded branch. Focused failures from incomplete mocks are not qualification. Current documentation was consulted, and the changelog's CLIv3/default-target change does not apply because no CLI/project configuration or database change is needed.

References: [passwordless email/sign-up options](https://supabase.com/docs/guides/auth/auth-email-passwordless), [Auth rate limits](https://supabase.com/docs/guides/auth/rate-limits), [Auth email templates](https://supabase.com/docs/guides/auth/auth-email-templates). Do not use default documentation limits as proof of this project's actual configuration.

New tests join the existing audit suite; stable43-suite count remains. Runtime storage adds only one timestamp/key per browser origin, no Supabase table, email archive or scheduled job. No paid tool/service or dependency added. Application-archive capacity is unchanged by this client-only control; actual metered wire/database limits remain23.

Actual hosted Auth sender/subject/body previews and callback settings remain owner review: the connector has no Auth configuration/template capability, and no owner browser operation is authorized. One async preview question is pending. Hosted peak/settlement/outage/rate-limit measurement and unrequested assistive acceptance remain open; local mocked429 tests are not hosted flood testing. No production release or milestone closure is inferred.

Ignored evidence: work/auth-entry-baseline.log, auth-entry-build.log, auth-entry-pure.log and auth-entry-ux.log. Exact-source release/deployment qualification will be recorded after the final coherent batch passes.

## Delivery and actual metadata receipt

Qualified clean source **659429828b94583467c7a0c6aaae83f03cc784f2** passed **43/43** in **315.778 seconds**, November4 16:42:20–16:47:35 UTC. The existing audit suite includes the new pure and both-engine Auth tests. No new lint error or warning was introduced by the Auth changes; existing project warnings remain.

READY protected Preview **dpl_H4ewLg922XmFBFTACVGap3dMXg1Y**, generated host `fantasy-sportsbook-ieec6tcnj-cooper-gurrie-projects.vercel.app`, serves all three DEV aliases. Hosted identity/owner/signup/capture/manual guards and compiled API runtime passed without TypeScript/error events. Only DEV Preview BOFF_BUILD_SHA was updated; aliases moved sequentially after READY. All three aliases plus generated host return signed-out302 to vercel.com; all-deployment SSO remains enabled. Production READY **dpl_6pkZ3DcTCUEHiWrUBKa6Rt9wevKZ** is unchanged. No migration, GitHub push, real email, financial mutation, activation, backup or new schedule occurred. No new database financial digest/advisor scan is claimed for this frontend-only change.

A read-only metadata snapshot at November4 16:45:20 UTC records DEV physical database **18,233,011B**, production **1,357,018,803B**, combined **1,375,251,814B** (PostgreSQL17.11). These are pg_database_size values, not provider billing/disk allowance or wire usage. The explicit24-hour DEV edge-log window November3 16:43:27→November4 16:43:27 UTC has132 requests (131 status200, one303). Only19 include content_length; the reported270B sum is incomplete and must not be used as transmitted/billed bytes. No personal identifiers, live links, raw Auth content or row payloads were fetched.

The Vercel observability schema returns current metric IDs, but the connector query uses legacy /v2/observability/query and returned400 for the scoped query. No usage value or service entitlement was inferred, and no paid feature was enabled. This remains an unresolved measurement path, not proof of zero traffic or sufficient quota. The single partial physical snapshot is not15 daily samples, two-week plateau, loaded-season forecast or hosted peak/settlement/outage acceptance.

Ignored receipts: `work/auth-entry-completion-receipt.json`, `work/auth-qualified-{provenance,results}-6594298.json`, `work/auth-entry-release.log`, `work/capacity-partial-observation-20261104.json` and the unapproved review at `work/release-reviews/659429828b94583467c7a0c6aaae83f03cc784f2/manifest.json`. Later documentation-only HEAD is not the qualified/deployed app source. **18 complete /6 remaining**; actual Auth previews, remaining assistive evidence and hosted operation/load gates keep22 open. Backup remains owner-deferred.
