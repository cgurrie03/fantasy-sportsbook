# Stage 1 Review

Implemented email-link sign-in, account identity and available balance, a light/dark preference, balance history, admin mapping review and balance adjustments with a required reason. The approved Week 3 import is already live in Supabase; the frontend remains local until deployment approval.

Only confirmed email identities matching approved memberships can load league data. Supabase may create an authentication identity for another email, but that identity receives no league access. Email reassignment is intentionally separate from ordinary name edits. Roster 8 is Nelson / nellyknowsball only; Cooper is the only admin.

The account balance is read from the imported wallet. Historical opening entries, settlements and replenishments are displayed alongside later admin adjustments. Admin balance adjustments do not alter ticket profit or leaderboard betting statistics.

Validation completed: production build, code lint, local PostgreSQL account and import checks, phone and desktop layout review, light/dark persistence, invalid email rejection, and a 390px admin layout without horizontal overflow. Account/admin visual reviews render the actual components with approved data examples and disabled controls; they do not simulate a completed sign-in. Local review HTML is excluded from Git and production output.

Remaining live validation after deployment approval: deliver a sign-in email to Cooper, follow the link to the approved admin membership, verify imported balance and history through authenticated access, and verify sign-out. No test email has been sent and no real balance has been altered for testing.

Home betting screens, ticket placement, bet history and leaderboard screens follow Stage 1. The currently live website still displays the setup placeholder.

Import scripts require preserved source snapshots in ../outputs. They are one-time migration preparation tools, not automatic deployment tasks. The accounts and Week 3 migrations have already been applied; do not rerun them against the live database. Ledger and ticket source uniqueness plus an initialized-wallet guard prevent repeat settlement credits.
