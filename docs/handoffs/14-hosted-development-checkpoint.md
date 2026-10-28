# Hosted development checkpoint — October 28, 2026

The application is deployed in isolated development. The full handoff remains
incomplete; this is not approval to release to production.

- Application source: `b1d4932b61a76f8ea7ae06f04b1868dbe0686254` on
  `codex/boff-handoff-implementation`. No GitHub push. Owner confirmed the
  existing repository should remain public.
- Development URL: https://dev.sportsbook.coopergurrie.com
- Development Vercel project: `prj_X7XPj0svAnCB9TWU7JQ1EvDjSlts`.
- Ready Preview deployment: `dpl_4njseUTf4FKSViUt3n7a9z4nTbHV`.
- Generated URL: `fantasy-sportsbook-7i99jylzv-cooper-gurrie-projects.vercel.app`.
- Both `fantasy-sportsbook-dev.vercel.app` and the team-qualified stable dev
  alias point to this same Preview deployment. All three aliases and the
  generated URL returned 302 to Vercel SSO while signed out. No bypass created.
- DNS is verified; TLS certificate was issued with automatic renewal. Auth
  callbacks remain restricted to the canonical development hostname.
- Vercel gives a new project's first deployment its default production slot.
  The first app attempt was canceled. A protected static placeholder initialized
  that slot, after which the actual app used Preview-only development variables.
  This occurred only in the separate development project, never the live project.
- The hosted build verified the database marker, server credential, fresh
  confirmed owner, closed public signup, mail capture and manual automation.
  API packaging now has a nearest `api/tsconfig.json` extending the server config;
  the final hosted build has no TypeScript packaging errors.
- The source upload contains 125 application/build files; handoff docs,
  migrations, work artifacts, local environment files and secrets are excluded.
  Public browser configuration contains only the intended publishable key.
- All 34 release suites passed. The last API config change also passed server
  TypeScript compilation and the compiled API runtime regression. Schema-only
  restore under Supabase-style default grants passed with 41 empty tables;
  npm audit reports zero vulnerabilities.
- Synthetic fixtures provide owner admin access in an 8-team league and member
  access in a 10-team league. Operations and schedules are disabled; balances
  remain null. They do not implement the pending independent-user-wallet change.
- Owner confirmed successful sign-in, the Development label and switching
  between both synthetic leagues. Authenticated hosted UI verification passed.
- Production still serves `dpl_6pkZ3DcTCUEHiWrUBKa6Rt9wevKZ`, based on
  `d1ea6c98d200326156aef76f8a8a6318b743f897`. No production app or DB release.

See handoff 13 for development migration mappings, isolation work and remaining
product/storage/recovery gates. In particular, production approval enforcement,
financial backup/restore, compact archives/readers, per-user wallets, staff-only
roles, imports/claims/settings, notifications and measured capacity work remain
open. Existing automatic production publication must be resolved before any
main-branch change; no branch was pushed as part of this setup. Support remains
undeployed and experimental ordinary live/teaser acceptance stays disabled.

## Storage investigation after hosted verification

Read-only production measurement at this checkpoint: database 1,105,606,323 bytes;
`model_forecast_runs` 473,718,784 bytes; `forecast_snapshots` 286,695,424 bytes;
`line_refresh_stages` 270,925,824 bytes; `live_forecast_runs` 20,094,976 bytes.
These relation totals include indexes and TOAST; catalog row estimates are not
exact counts. The first three retain 1,031,340,032 bytes combined. There were 99
new model runs and 55 new published snapshots in seven days; 18 model-review jobs
remain failed. No cleanup or physical reclamation is claimed.

Dependency review confirms model assessment still reads whole-season published
snapshots and replay data, live review reads up to 3,000 full payloads, report
futures load every saved version, and account refresh loads all accessible
histories. Archive suppression requires migrating those readers together. Exact
accepted terms live in ticket legs, but report lineup-efficiency and candidate
replay currently depend on fuller pools; removing archives without replacing
those contracts would silently break supported evaluation. No raw archive writes
have been disabled yet. Financial recovery verification and the compact
fixed-horizon sample/summary format are the next storage unit.
