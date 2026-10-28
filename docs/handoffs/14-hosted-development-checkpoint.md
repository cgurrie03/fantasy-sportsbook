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
- The owner has been asked to verify the Development label and both synthetic
  leagues after signing in. That authenticated hosted UI check remains pending.
- Production still serves `dpl_6pkZ3DcTCUEHiWrUBKa6Rt9wevKZ`, based on
  `d1ea6c98d200326156aef76f8a8a6318b743f897`. No production app or DB release.

See handoff 13 for development migration mappings, isolation work and remaining
product/storage/recovery gates. In particular, production approval enforcement,
financial backup/restore, compact archives/readers, per-user wallets, staff-only
roles, imports/claims/settings, notifications and measured capacity work remain
open. Existing automatic production publication must be resolved before any
main-branch change; no branch was pushed as part of this setup. Support remains
undeployed and experimental ordinary live/teaser acceptance stays disabled.
