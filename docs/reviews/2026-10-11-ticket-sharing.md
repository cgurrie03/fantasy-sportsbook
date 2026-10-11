# Ticket Sharing — October 11, 2026

## Released scope

Share Ticket appears after successful placement once the accepted ticket has loaded, and inside expanded ticket history. The dialog previews a navy/gold receipt. Message receipt opens the native share menu with a PNG where supported; Copy text and Save image remain available. The website cannot force Messages to be first in the device's share menu or send an SMS itself.

Receipts use accepted selections, combined odds and potential payout. Settled tickets display actual payout, results and net profit; voided tickets label their payout Refund. Saved promotional profit boosts are identified. Personal balances, email addresses and admin controls are excluded. Exports include every leg, even when the preview scrolls. Sleeper profile images use the existing allowlisted image proxy; unavailable avatars fall back to initials. Image generation is lazy and snapshots the ticket at opening.

Open regular-season win-total legs now display the selected team's current wins, scoped to the ticket's league and season. Missing data is explicitly unavailable; the bettor's record is never substituted.

## Verification

- Production build and API-runtime checks passed.
- Lint passed with existing advisory warnings.
- Receipt browser checks passed at 390px and 1440px in light/dark themes: eight-leg PNG dimensions/signature, share-file fixture, copy privacy, boost label, unsupported native-share fallback, settled payout, correct subject-team win counter, and post-placement sharing.
- Existing UX integration checks passed: revised-price acceptance, ticket history, league switching/admin roles, mobile layout, CSV/PNG/PDF report exports and loading/error states.
- Browser tests intercept backend requests and native sharing; no production bets, emails or messages are sent. Physical-device sharing remains a user review item.

## Remaining features

Head to Head, milestone ladders, winning-margin markets and expanded live ticket progress are specified in handoff 07; they are not enabled by this release.
