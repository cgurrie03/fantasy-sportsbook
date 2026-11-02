# Notification preferences and routine budget — milestone 18, task group 3

November 2, 2026 ET. Verified and deployed to protected DEV; final evidence below.
**16 complete / 8 remaining milestones**.

## Completed implementation in this task

- Account preferences belong to the verified user and selected league, including
  independent co-owners. Each type can inherit, opt in or opt out. Revoked/unapproved
  accounts cannot read/save choices or receive routine messages. The owner controls
  league defaults; operators can inspect them. Existing disabled schedule flags
  and disabled league types cannot be overridden by personal opt-in. Saves use
  revision checks and current authorization, not cached display permission.
- Opening, reminder, recap, Monday watch and reopening messages share **three
  routine dispatch admissions per user/league Tuesday–Monday Eastern week**.
  Accepted-bet receipts, Auth/security messages and staff attention remain separate.
  A retry reuses its original admission. Unknown/ambiguous provider attempts keep
  their slot, so failures cannot create extra routine messages. Later types are
  skipped when the cap is full; users can disable a type to leave room for another.
- Preferences and budget are checked before composition and immediately before
  capture/provider dispatch. Disabled, capped, stale and unbound legacy frozen
  routine messages are retired without rewriting their payloads. Ambiguous prior
  attempts stay in review. Delivery checks execute with no signed-in owner claim;
  a regression explicitly exercises the actual service-role public RPC.
- Monday watch requires open personal weekly tickets and its useful Monday window.
  A nearby eligible closing reminder takes the standalone watch slot and carries
  a compact, timestamped count of the recipient's own open tickets plus My Bets
  link. It does not copy another co-owner's tickets or archive provider responses.
  An already frozen combined message is blocked if watch preference is disabled.
- Existing account and league settings screens expose the controls. They load
  lazily, fence delayed league responses, show disabled types and stale-revision
  recovery, and distinguish routine mail from essential messages. Phone/desktop
  fixtures cover personal and owner controls without operating the owner browser.

## Storage and capacity

Three private RLS-protected tables, accessible only through scoped functions:
one mutable defaults row per league; at most 128 mutable personal preference rows
per league; compact immutable dispatch identities with **at most three per user
and 128 distinct recipients per league per calendar week**. That is at most 384
dispatch rows per league per period, or 20,352 over 53 periods. Only IDs, period,
purpose, merge flag and timestamp are retained; no message bodies or provider data.
Actual row/index bytes and shared allowances remain unmeasured milestone 23 work.

Frozen composition adds at most **512 JSON bytes per routine outbox row**, within
existing bounded body storage. Existing seven-day terminal body retirement clears
that context; compact dispatch identities remain so cleanup cannot reset a cap.
No new cadence, paid service, tracking board or raw archive. Opt-outs are checked
before body creation, limiting work and avoiding needless frozen bodies. The two
admission RPCs per routine delivery replace no receipt path; actual wire/peak load
still needs measurement. Preview calls do not reserve credits.

## Verification and boundaries

Local migration `20261102150512_routine_notification_preferences.sql`. Tests use
the real preference/default/admission functions, active local synthetic wallets,
three-credit retry/rollover/retention, 128-recipient high-water rejection, tenant/
co-owner/revocation/ACL/CAS negatives, existing disabled flags, frozen opt-outs and
Monday collision/personal counts. Compiled API tests prove initial/final rejection,
lookup failure and foreign scope fail closed, fresh/frozen content behavior,
timestamped merged copy, and independent essential receipt delivery. Intercepted UI
tests cover both widths, inheritance, CAS/reload, selected-league save fencing and
owner defaults. Full release plan remains 43 suites with these cases incorporated.

DEV stays capture-only/manual, operations off, closed signup and owner protected.
No real mail, production change, funding, GitHub push or automation activation.
Full recovery drill remains deferred by owner; do not repeat completed key/phone
checks. Production adoption requires exact owner-reviewed source/migrations and
review of old routine outbox payloads; do not silently rewrite/resend them.

## Milestone progress, separate from completed task

Notification task groups delivered through this stage: actual-window delivery
guards (35), relative scheduling/preview/expiry/deduplication (36), personal/league
preferences and routine budget/collision handling (37, qualification below).

Milestone 18 still requires **factual evolving season storylines**, **verified
staff-only alert scope/cooldowns**, and the **complete notification lifecycle,
phase-aware preview and consecutive-week/race matrix**. This task does not close
the whole milestone. Other remaining milestone IDs: 13, 16, 20, 21, 22, 23, 24.

## Verified DEV checkpoint

- Exact clean source **`f7750bd569c34b8df1a71cd34a8b7e7964e24bde`**, **43/43** in
  **233.963 seconds**. The build now explicitly type-checks the mail dependency
  graph as well as executing transpiled fixtures. An earlier unaliased candidate
  exposed two API narrowing errors in hosted logs despite READY; corrected before
  any alias move. The final build has zero API TypeScript errors. The exact-source
  release review remains **unapproved**; later docs-only HEAD is not qualification.
- Local migration **20261102150512 -> hosted 20261102153321**, immutable. Hosted
  rollback probes passed personal opt-out, league isolation, owner defaults, CAS,
  essential-type rejection, outsider/ACL denial, no-user-claim paused worker and
  actual restricted-role composition retirement. Active cap/collision/admission
  and co-owner behavior were exercised locally without bypassing hosted rollout.
- Existing two leagues/two pending wallets, zero tickets/entries/emails and
  operations/automation off remain unchanged. New preference/default/dispatch
  tables contain zero rows after rollback. Five-table financial digest unchanged:
  **`5bae6ca0b50de30a40ee058fa53d9173`**.
- Advisor review: **65** authenticated-definer WARN (four scoped personal/owner
  RPCs added), **2** anonymous-definer WARN, **1** Auth WARN, **18** no-policy INFO
  (three private tables intentionally have no direct grants or policies). All prior
  finding metadata unchanged. Authorization, private-table denial and service-only
  admission were tested; no anonymous entry point was added.
- Protected Preview **`dpl_CTk19be3RsNWaBL2dZEiCgYNHC4f`**, READY, on all three DEV
  aliases. [Development](https://dev.sportsbook.coopergurrie.com) and generated URL
  redirect signed-out requests to Vercel sign-in; all-deployment protection remains.
  Hosted guard confirms independent owner, closed signup, captured mail and manual
  automation. Production canonical stays READY **dpl_6pkZ3DcTCUEHiWrUBKa6Rt9wevKZ**.
- Ignored evidence: `work/preferences-completion-receipt.json`,
  `work/preferences-hosted-probe.sql`, `work/preferences-release.log`, release
  provenance/exact review and phone/desktop `notification-preferences-*.png`.
