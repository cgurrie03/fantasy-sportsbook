# Branding Consistency — November 18, 2026

Development delivery: `dpl_2UaAviGuvzp6qV5WcmwNiAJEc5Nf`, assigned to https://dev.sportsbook.coopergurrie.com. Production and backend services were not changed.

## Changes

- Shared Boff account shell: existing mark/wordmark, development badge, theme colors, Newsreader headings, Public Sans body text, consistent card margins, controls and virtual-credit footer.
- Real password/email-link sign-in, validation, busy, success and error states use the shell. Saved light/dark theme applies before the account screen renders. Rejected requests release busy controls; a network failure has a readable message.
- Invitations use the same shell for signed-out guidance, loading, errors and accepted manager context. Existing password/link, acceptance and wallet-approval behavior remains.
- Startup loading, account-access errors and league outages have branded panels and recovery actions. Internal startup error text is not displayed.
- Shared empty states, commissioner/owner access denial, league activity loading/errors, email-reader states and intake error boundary use consistent icons, typography and spacing.
- Actual unknown URLs and unavailable leagues now have distinct branded screens with return links, instead of the old combined unavailable screen.
- The signed-in /sign-in route now renders the existing real authentication component instead of a disconnected preview-only form. Removed duplicate account branding and obsolete design-preview copy from that path and the league home note.
- Loading animation respects reduced-motion settings; form labels, status/alert semantics and keyboard focus remain accessible.

## Verification

- TypeScript/production build passed.
- Local Chromium and WebKit: 1440, 390 and 320 pixels, light/dark, 12 combinations. Verified branded sign-in, invalid email focus, controlled OTP success, password service failure, startup errors without raw diagnostics, account-access guidance, invitation context, commissioner denial, missing pages, loading and reduced motion. No horizontal overflow or page errors.
- Actual hosted deployment: Chromium/WebKit at 390 pixels in both themes, four combinations, passed the same flows. Auth/API responses were intercepted; no real credentials were used, invitations accepted, accounts changed or emails sent.
- Existing account isolation, history/request validation, refresh/push regressions passed.
- Visually reviewed desktop sign-in and mobile dark invitation screenshots. Physical-device visual acceptance remains separate.

Evidence: `visual/scripts/test-branding-browser.py`, `work/branding-check`. The first local run emitted fixture teardown warnings for held requests after its assertions passed; the test now explicitly aborts those requests, and the hosted run passed cleanly.

No migrations, database writes, refresh jobs, analytics calls or media dependencies were added. Existing fonts and logo are reused. The shared startup UI adds a small amount of frontend code/styles.
