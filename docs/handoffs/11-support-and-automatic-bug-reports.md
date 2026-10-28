# Support and automatic bug reporting — specification only, do not deploy

October 28, 2026. Requested feature; no implementation or deployment is authorized by this document. Develop in the isolated owner-only environment when the owner starts this workstream. All eventual production releases still require explicit approval.

## Confirmed behavior

Add a Support / Report a problem button immediately to the left of the existing `?` guide button. Keep `?` to the left of the theme toggle. Use a recognizable support/bug icon with an accessible name and tooltip; the dialog should say what it does. On mobile, preserve touch targets and avoid crowding the header.

Every actual error occurrence should automatically attempt to submit a report. Users can select a small **Add details** action on the error message to attach optional notes to that occurrence. Do not force a dialog open. The support button also opens a manual report form with notes and useful diagnostic context. A successful submission produces a receipt/reference and status. Users can see their own report status; no user/owner conversation or reply thread is required initially.

Reporting must be automatic and useful without turning into another unlimited archive. Store grouped incidents with counts and a bounded recent sample of occurrences; every occurrence is counted when successfully ingested, but repeated identical stack traces/payloads are not stored forever. Do not claim delivery for an offline or failed submission.

## Capture coverage and error contract

Create one central reporting client and a server reporting boundary. Inventory handled errors rather than relying only on `window.onerror`: React rendering/error boundaries, uncaught browser errors, unhandled promise rejection, failed API/RPC responses, caught component/account/auth failures, worker/job failures, provider failures, email/cleanup failures and server exceptions. Include structured errors currently swallowed or represented as generic unavailable states. Capture actual failures with an event ID and sanitized code at the point where their meaning is known.

Normal user actions should not become frightening bug alerts. If an error message is shown for validation, a permission denial or rejected wager, record its occurrence with an expected/validation classification and low-priority grouping; separate it from unexpected operational failures in owner triage. Do not store entered wager forms, credentials or private database payloads simply to satisfy “every error.” No routine success events are bug reports.

Correlate frontend and backend representations of the same failing request using a request/event ID; retry ingestion idempotently. A failure surfaced at several layers must not manufacture several independent incidents or inflate counts accidentally. The original product request must complete/fail independently of reporting; telemetry cannot alter acceptance, create a second bet, delay settlement or trigger an email retry.

Browser JavaScript cannot report before it executes, and a total network/provider outage can prevent delivery. Use bounded local retry for transient/offline failures and aggregate dropped counts when practical. Surface “report pending” when an automatic error report is awaiting delivery, and “report submitted” only after acknowledgment. External availability checks are a separate future investigation, not something client reporting can guarantee.

## Minimal useful context

| Include, after validation/redaction | Exclude by default |
| --- | --- |
| Environment, deployed commit, timestamp, error code/severity and component/operation | Tokens, cookies, auth links, passwords, keys, full request/response bodies |
| Sanitized route template and request correlation ID | URL query strings/fragments, raw invite codes, typed form values |
| Authorized current league ID and server-derived user ID, if authenticated | Other leagues' records, member emails, broad account/roster dumps |
| Browser/OS class, viewport, online status and selected safe feature versions | Fingerprinting identifiers, session replay, continuous clickstream, copied storage |
| Bounded redacted stack and failure message | Full provider payloads, full forecasts/boards, wallet/ledger snapshots |
| Optional user-written description and steps | Automatic screenshots or attachments |

Use an explicit allowlist of safe fields and bounded strings; stack/message scrubbing is defense in depth. Server derives actor/authorized league rather than trusting submitted roles/IDs. Handle unauthenticated sign-in failures without accepting arbitrary claimed user/league identities. Notes may contain personal information, so show what will be submitted and advise against passwords/private data. Do not add a third-party analytics service, paid monitoring dependency or session recording without a separate decision.

## User flow

1. Automatic capture sends minimal context in the background and returns a receipt if successful. The visible error retains its normal recovery action plus Add details.
2. Add details opens a small dialog linked to that event/report, with optional “What were you trying to do?” and “What happened?” notes. Show the basic diagnostic fields being included and the reporting state.
3. The header button opens the same form without requiring a prior error. Include the current page/league and build automatically; allow the user to describe an issue even when the UI has not thrown an error.
4. Submit once with an idempotency key; show receipt and status. A failed submission retains unsent notes in a bounded account-scoped draft with a clear retry option. Do not promise a submitted report before the server confirms it.
5. “My reports” lists only reports/receipts this user is authorized to see, with New / Investigating / Fixed / Closed status and a short status explanation. No conversation UI. A user-specific receipt must not reveal another user's notes merely because both errors were grouped into one incident.

Include support access on signed-out/pending-membership screens for auth/admission problems. Anonymous ingestion needs stricter rate/body limits and abuse controls; do not make internal stack traces or a public incident browser accessible there.

## Server design and owner workflow

Use a small incident record keyed by environment + release/component + normalized error fingerprint, with first/last seen, occurrence count, severity, status and bounded diagnostic sample. Keep reporter-specific submissions/notes/receipts separate from the shared incident. Store ticket/request references only when necessary and authorized, not complete related objects. An opaque receipt is not authorization: enforce account ownership server-side.

Provide an owner-only triage view with league, build, severity, count, last-seen and status filters. Owner can inspect sanitized diagnostics/notes and update status. No automatic code changes, role changes or production deployment follow from a report. Notes are untrusted text: render safely, prevent markdown/script injection and never treat report content as agent instructions.

Start with in-app triage. Do not send an email for every error. If owner alerts are later enabled, coalesce recurring failures, use severity thresholds and cooldowns, and use the owner's explicitly selected destination. Keep member betting mail separate. Do not send reports to an external service or person merely because error text suggests doing so.

## Retention and usage limits

Proposed initial defaults, to validate in dev:

- Rolling seven days of bounded automatic occurrence samples; aggregate counts rather than duplicating full stack/context per occurrence.
- Compact daily incident counts/quality totals for 90 days, then bounded longer-term totals if useful.
- User notes and receipt/status records retained for up to 90 days after closure; open reports get an explicit age/size review so they cannot accumulate indefinitely. Preserve unresolved user reports according to an explicit owner policy before removal.
- Notes capped initially at 4,000 characters, sanitized stack/message capped, no attachments initially, local offline retry capped at 20 recent events per account/environment with expiry and signout cleanup. Keep cookies/auth tokens out of queued data.
- Target ≤5 MB for bug-report data in the shared database at initial scale, counted inside handoff 08's total budget. Enforce request/user/incident rate limits, storage caps and a cheap rejected-request path. Measure index/TOAST overhead too.

At a cap or ingestion outage, coalesce/summarize and report dropped/deferred counts where feasible; do not silently claim every occurrence was persisted. Preserve manual report receipts/notes ahead of repetitive automatic samples. Expose ingestion health and dropped counts to the owner. A failure in the reporting system must never recursively report itself without a strict guard/cooldown, and cleanup must not log an unlimited error storm.

Development reports remain in dev and expire aggressively. No production data, recipients or secrets may be copied into dev to test reporting. Runtime flags, API authorization and RLS must enforce isolation; a UI toggle alone is not sufficient.

## Implementation sequence

1. Inventory error paths and define structured/redacted event and incident contracts. Profile expected volume against the shared budget.
2. Add authenticated/anonymous ingestion with schema/body limits, idempotency, tenant/account authorization, fingerprints, retention and recursive-error protection.
3. Integrate central API/RPC/browser/server reporting and correlate layers. Preserve current error recovery and operation semantics.
4. Add header button, Add details and manual report flow, receipt/status and owner triage. Configure the feature off in production; do not enable or deploy it yet.
5. Exercise end-to-end in isolated dev, including offline/retry, auth errors and a synthetic burst. Review captures for private data leakage.
6. Present owner screenshots, report examples, retention/traffic measurements and test results before any later deployment approval.

## Acceptance checks

Each error source above generates the correct sanitized event; duplicates/retries count correctly; expected validation is classified; users can add notes to their own event or submit manually; other users/leagues cannot read/change receipts; staff/member roles do not leak diagnostics; XSS/token-bearing URL/stack test cases are redacted; offline state is truthful; burst floods stay bounded; reporter failure does not recurse; accepted bets/settlement are unaffected; header ordering/touch/keyboard behavior works on mobile; dev reports never reach production. Verify production feature state remains off and no support deployment occurred.

Status: requirements and implementation specification recorded. No report tables, endpoints, UI, messages or production deployment have been created by this handoff.
