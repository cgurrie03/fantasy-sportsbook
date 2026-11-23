# AUD-02 — Add League And Manager Status

Delivered November 18, 2026 to Development deployment `dpl_AT7fURaBJHF4ESTS2AK23xWc5URG`, assigned to `dev.sportsbook.coopergurrie.com`. Production untouched.

## Changes

- Fixed Add League by deduplicating React/React DOM and injecting the application's existing Supabase client into the shared form. Removed shared runtime account-module imports; added a recoverable error boundary.
- Replaced the empty deployed intake endpoint with the actual reviewed-preview API.
- Discover current-season NFL leagues from numeric Sleeper account IDs already linked to the authenticated platform owner. Missing links retain manual league-ID entry. Discovery runs on entry/explicit refresh without polling or persistent provider-response storage.
- Mark Already Connected choices and reject duplicate manual previews before provider calls. Database duplicate checks, unique provider ID and import transaction lock protect direct/repeated requests.
- Reuse unchanged active previews; expire changed previews. Import replay returns the original inactive league, without granting access or publishing markets.
- Populate Solo Manager, Primary Manager with co-managers, and Co-Manager from Sleeper. Each co-manager is listed independently. Roles appear in intake, commissioner members, invitation choices, pending invitations, invitation emails and acceptance pages. These labels do not grant Boff administrator permissions.

## Verification

- Production build/type checking, intake API tests, existing API runtime and invitation API tests passed.
- Production-bundle browser tests at 1440/390 px passed: Add League renders, discovery selection, duplicate rejection, all three manager roles, no page errors or horizontal overflow.
- Hosted authenticated tests passed using real Sleeper discovery and a historical provider preview. Every rendered role was compared with the provider source. Screenshots: `work/aud02-check`.
- Development SQL tests passed and rolled back: preview reuse/replacement, inactive import, replay, duplicate rejection, no access grant and Solo/Primary/Co role derivation.
- Existing invitation SQL regressions passed and rolled back: verified recipient binding, acceptance/replay, independent co-manager identity, cooldown, resend and cancellation.
- Removed all temporary users, sessions, grants, links, preferences and preview drafts. Baseline restored: 1 auth user, 3 leagues, 14 memberships, 0 temporary co-manager links, 0 intake drafts, 91 tickets and 261 legs.

## Limits

Add League remains platform-owner reviewed intake. Full league activation, billing, renewals and multi-league rollout remain separate work. Discovery uses linked identities and the current NFL season; public Sleeper data alone never proves a Boff account claim. Development invitations continue to capture mail rather than use live SMTP.
