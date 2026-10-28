# Expanded audit: implementation directions and second-league gates

October 28 implementation clarification: the owner has confirmed independent user wallets, including users on the same fantasy team. Treat bettor identity and fantasy-team association separately; balances/tickets/credits are per user and per league. See handoff 13 for local implementation evidence and remaining work. The historical co-owner/shared-wallet question below is superseded by this decision.

October 28, 2026. Read handoffs 08, 09, 11 and 12 alongside this document. The original audit is in `C:/Users/coope/Documents/Codex/2026-10-28/th/outputs/boff-audit-2026-10-28/`. A01–A17 preserve its finding IDs; A18–A25 cover added workstreams and investigations. No finding is resolved merely because instructions now exist.

## Confirmed product decisions

Efficiency and staying within free allowances come first. If capacity still does not fit, present further measured optimization/feature options; do not upgrade automatically. Development is owner-only with independent accounts/data, and every production release requires owner approval. Recommended architecture is one repository, dev/feature branches and an isolated test database; a second repository is unnecessary.

Cooper enters a Sleeper league ID and reviews imported settings. All sportsbook policy settings should be configurable, starting with the same defaults. Initially Cooper alone changes configuration or activates leagues. Commissioner distribution of invitations does not grant administrative access. Managers can use one verified account across leagues, with a visible authorized league selector and independent league balances/tickets.

Import and display all fantasy teams even when managers have not signed up. Cooper supplies a signup link to the commissioner, who distributes it to league members. Public Sleeper responses do not supply member email addresses. Populate known approved email/team mappings already held by this system where appropriate; collect missing emails through verified signup. A league signup link grants a request to join, not authority to claim an arbitrary team. Team-name selection is a claim that requires owner-approved mapping (or an existing trusted mapping), not proof of ownership. Never expose private member emails or a global league directory.

Support is specified in handoff 11: button immediately left of `?`, automatic error reporting, manual reports, optional Add details, receipt/status with no conversation initially. **Do not deploy support yet.**

## How to implement each finding

Every implementation must record baseline/reproduction, selected design, changed contracts/migrations, meaningful tests, dev screenshots where relevant, measured usage impact, owner approval and deployed SHA. Keep findings separate from unverified hypotheses. Integrate shared schema/worker changes sequentially and preserve unrelated dirty files. Rollback must account for data migrations; a frontend rollback alone does not undo them.

### A01 — P1: storage and egress exceed allowance

**Problem and consequence:** Eight monthly users already coincide with 217% database and 110% egress usage. Approximately 948 MiB is concentrated in full model runs, published snapshots and stage quotes. Adding users/leagues without changing data lifecycles compounds avoidable growth.

**Implementation:** Follow handoff 08 in full. Stop default permanent per-refresh archives, migrate supported reports to compact horizon samples/summaries, expire working/debug payloads, fetch changed boards only, and put TTL/byte caps on every temporary table. Instrument before cleanup; confirm recovery and ticket references, then summarize useful old history and batch-delete expired payloads. Do not move unlimited raw history into another paid storage service.

**Acceptance:** Two-week temporary-data plateau; unchanged-board download reduction; measured combined dev/production egress; protected tickets/ledger unchanged. Target production database ≤350 MB and shared egress forecast ≤3 GB, with development reserve and capacity gates, not a promise based on estimates. Restore/checkpoint evidence precedes historical removal. Dependents: A06, A11, A12, A07; blocks second-league activation.

### A02 — P1: non-playing oversight cannot be represented

**Problem:** Membership currently requires `team_id`, and the application gates on member plus team. Cooper cannot administer league two without being modeled as a player. A fabricated team/wallet would corrupt league identity and communications.

**Implementation:** Add staff grants independent of participant memberships and a separately verified platform-owner identity. Define capabilities (view/admin/configure/bet) explicitly; only owner configures initially. Update RPC authorization, API service-role entry points, UI, workers and email recipient selection together. Betting always requires an actual approved team membership and wallet; staff capability never implies it. Preserve historical actor IDs/reasons.

**Acceptance:** Staff-only Cooper sees/administers league two without balance/My Bets/replenishment/team emails; member in A/staff in B behaves correctly; revoked grants fail server-side; cross-tenant actions fail. Existing bettors retain access. Rollback cannot remove the owner's last working oversight path. Inspect `202610050001_accounts.sql`, owner constraints and App gating before migration. Prerequisite for A03/A09.

### A03 — P1: no reusable league importer/activation workflow

**Problem:** The legacy seed script hardcodes the original identity and overwrites an old migration. Reusing it risks mixing leagues and replaying historical imports.

**Implementation:** Build an owner-only idempotent draft importer with fresh IDs and a unique provider-league identity. Fetch actual teams, owners, scoring, positions, schedule and playoffs; show a versioned capability review. Import teams independently of manager signup. Default jobs/publication/mail off. Keep default sportsbook policy plus explicit league overrides. Provide a revocable signup link for commissioner distribution; existing approved users can request/access the second league using the same account. Activate only after rules, access, preview and capacity checks pass.

**Acceptance:** Re-import resumes safely without duplicate teams/wallet events/invites; incomplete drafts stay disabled; unregistered managers do not prevent team projections/display; no original league rows change. Activation is staged/idempotent and its pause reverses publication/mail without undoing accepted transactions. Use fixtures with different league settings. Depends A01/A02/A07/A13.

### A04 — P1: weekly specials assume 12 teams

**Problem:** Direct probes with 8/10/14 teams throw; 12 works. A single incompatible family can prevent a coordinated refresh.

**Implementation:** Derive scorer fields and display counts from eligible participants, with explicit odd-field/tie/bye rules. Keep high/low selections and settlement definitions consistent. Remove labels implying fixed six/six groups. Validate capability during onboarding. Keep atomic publication coherent when a family is deliberately unavailable; do not mask a generation exception by silently publishing inconsistent partial results.

**Acceptance:** Pricing/display/acceptance/settlement fixtures for 8/10/12/14/16 plus supported bye/odd cases; impossible contradictory picks remain rejected; missing provider data produces an accurate family state. Inspect `api/_lib/line-model.ts` weekly scorer logic and its consumers. Keep a versioned policy so existing tickets retain old terms.

### A05 — P1: reloaded futures cannot reliably be republished

**Problem:** Futures admin loads the compact member board, which omits `roster_id`. A later save fails authoritative roster validation. The database guard correctly rolls back; the editor roundtrip loses data.

**Implementation:** Prefer a narrow admin patch RPC for approved price/status edits against league/board/expected revision. Preserve server-owned settlement/model identity. If a full editable snapshot is needed, authorize it separately and never reuse the compact display DTO for saving. Validate bulk edits atomically; surface revision conflicts before overwriting another change.

**Acceptance:** Reload → edit → publish, close/reopen and unchanged-save succeed without regeneration; tampered roster IDs/cross-league edits fail; concurrency rejects stale revisions; accepted futures settle with saved terms. Inspect SeasonFutures admin and `src/lib/markets.ts`. Preserve the protective constraint. Keep compatible reader/patch rollout order and a reversible UI fallback.

### A06 — P1: automatic model review fails and repeats expensive reads

**Problem:** Eighteen failed jobs were observed; latest sampled errors are statement timeouts. Broad full-archive reads are a likely contributor, not a traced diagnosis of the exact failing statement.

**Implementation:** Instrument query duration/bytes and locate the failing statement. Replace archive-wide `*` reads with designated compact samples, final outcomes and bounded version-scoped review chunks. Store idempotent weekly sufficient statistics and checkpoint progress. Retry transient failures only; avoid replaying completed work. Retention deadlines and unresolved futures need bounded explicit handling.

**Acceptance:** Hosted dev review on production-sized synthetic data completes within function/statement budgets; repeating it produces identical summaries without duplicates; timeout/recovery tests preserve coverage; weekly metrics agree with independent calculations. No blanket timeout increase or complete raw archive requirement. Inspect `api/_lib/model-pipeline.ts`; depends on 08 and A07 before historical cleanup.

### A07 — P1: schema tracking and restoration are unproven

**Problem:** No managed migration ledger was observed, and the audit did not establish a managed/external backup. A folder of SQL files and passing local replay are not a production recovery plan.

**Implementation:** Inventory deployed schema/function/RLS fingerprints, reconcile deployed migrations without executing historical seeds again, and build a reviewed schema-only clean-install path. Create a supported export/restore process including required auth/storage/config references; store backups securely with bounded retention and never commit them. Use the dev project for a restoration drill before destructive archive cleanup.

**Acceptance:** Isolated restore has correct functions/RLS and consistent transactional counts, no production cron target or real mail; document actual recovery time and missing external assets. A failure leaves production unchanged. Record rollback constraints for each migration. Depends on dev setup, blocks historical cleanup and second-league launch.

### A08 — P2: account history can reset league selection

**Problem:** Delayed history loading can silently switch B back to A. Multi-league users could view or act in a context they did not choose.

**Implementation:** Keep selected authorized league in a stable state separate from load completion. Honor a validated scoped link, then last authorized selection; use an intentional fallback only when access changes. Cancel or ignore stale in-flight responses using account/league/request versions. Namespace client caches and slips by league; switching must not submit A's picks to B. Include league context in receipts, invites and deep links.

**Acceptance:** Slow history, concurrent tab changes, signout/relogin, revoked access and stale network responses cannot reset a valid choice or leak content. The selector exists only for authorized leagues and clearly shows current context/role. Inspect App account-load effects and route/email builders. Depends on selected-league fetching, not a local-storage-only patch.

### A09 — P2: signup/invitations and team claims are incomplete

**Problem:** Auth may create an account, but verified email alone does not grant membership. “Membership Pending” lacks a complete admission path. Public Sleeper identity/team names cannot prove an email owns a team.

**Implementation:** Commissioner shares a scoped opaque, expiring/revocable league signup link. Manager verifies email, requests a team mapping, and owner approves an unmapped claim. Reuse a trusted existing mapping where valid; handle multiple leagues/co-owners explicitly. Keep unclaimed teams visible in fantasy markets. Separate staff admission, invite claim and auth identity. Prevent double claims/races atomically. Provide pending, rejected, wrong-email, expired and revoked states plus rate limiting.

**Acceptance:** One auth user joins two leagues without duplicate account; team-name spoofing does not grant access; teams remain present before signup; unknown emails reveal no member directory; owner approval governs mapping/configuration. An invitation is never a self-assigned admin grant. Rollback retains approved identities and historical access/audit evidence. Depends A02/A03/A08.

### A10 — P2: first-league auth branding and redirects

**Problem:** Magic-link branding references the original league, and redirects do not yet cover safe dev and scoped onboarding paths. Users may return to the wrong environment/league.

**Implementation:** Separate product identity, league identity and environment identity. BOFF is a proposed name, not a confirmed rename. Parameterize safe server-owned template content and use exact dev/prod callback origins in their separate auth projects. Persist intended league/invite safely through auth; reject external redirect targets. Review sender, subject, links, resend cooldown and failure messages as one flow.

**Acceptance:** Dev auth returns to dev; prod to prod; two-league login retains destination; expired links recover clearly; no public account enumeration or open redirect. Owner reviews actual template previews; tests need not send bulk mail. Do not rename the public product until the naming decision is finalized.

### A11 — P2: polling multiplies bandwidth and provider work

**Problem:** Both boards download every 30 seconds, approximately 845 KB raw per round; starter requests repeat per viewer and persist in hidden tabs. More users amplify identical work.

**Implementation:** Authorized tiny revision/status manifest, on-change category downloads, shared client request deduplication, hidden-tab pause and immediate resume checks. Separate price, score and suspension freshness. Coalesce league starter lookups and cache shared public NFL data with bounded TTL. Keep per-request authorization for private output. Do not shift full upstream downloads into every browser as a supposed saving.

**Acceptance:** Script an unchanged-board hour and a real revision/suspension/score transition; measure actual wire bytes, DB reads, provider calls and perceived freshness. Target ≥90% fewer unchanged full-board fetches. A 304 that still performs a full DB read is insufficient. Test cross-league cache keys and offline recovery. See 08 for safety/acceptance details.

### A12 — P2: broad history/report reads grow without bounds

**Problem:** Account load reads all accessible historical tickets/legs/ledger and futures reports load many versions. Staff overseeing leagues will amplify this.

**Implementation:** Separate core account/context loading from view-specific data; selected-league stable cursor pagination and server aggregates for counts/balances/results. Fetch ticket details only when opened; load only relevant active progress. Replace report archives with finalized summaries and compact current-horizon samples. Use query plans to justify indexes and include RLS cost in measurement.

**Acceptance:** Large synthetic histories produce bounded payloads on login and navigation; deep pagination has stable ordering and no duplicates/skips; balances/report totals match authoritative records; staff grants cannot widen another member's reads. Fix A08 race during this change. Keep existing response consumers compatible or migrate them together.

### A13 — P2: imported rules are not a complete capabilities contract

**Problem:** Reading scoring/playoff fields does not mean generation, ranking and settlement support divisions, median wins, reseeding, multi-week rounds, IDP or custom draft rules.

**Implementation:** Version the normalized imported rules and capability results. Detect each setting required by enabled market families; ask only for missing house rules. Each supported rule must be used consistently by generation, display, acceptance, settlement and reporting. Present unsupported combinations accurately during owner onboarding instead of silently applying first-league behavior. Implement adapters in explicit scope; disabling an unsupported optional family must be an owner-visible decision.

**Acceptance:** Contrasting league fixtures, changed scoring/positions/playoff size, tied standings, byes and configured draft outcomes produce correct results. Rules drift triggers review without altering accepted terms. Keep a small approved rules fingerprint rather than repeated raw settings each refresh. No universal compatibility claim until corresponding cases pass.

### A14 — P2: copy/tutorial and configuration disagree

**Problem:** Fixed playoff/year labels and outdated lineup/rounding descriptions conflict with the actual product. Users cannot reliably infer rules from the help UI.

**Implementation:** Define a typed sportsbook policy schema with shared defaults and per-league overrides. Cover replenishment/cash floors, opening balance, stake/selection rules, enabled markets, pricing/rounding/boost policy, featured games, schedule, notifications, branding and tutorial content. Classify computed provider facts separately from editable sportsbook policy. Apply validation/dependencies and version/effective dates. The owner can configure supported product settings, not arbitrary executable code or silently unsupported rules.

**Acceptance:** Two leagues with different settings render correct labels, tutorial examples, acceptance and settlement. Defaults match current approved behavior. Edits show before/after, impact and effective time; already accepted terms remain fixed. Regression tests verify the same configuration reaches server and client. Initially only Cooper can change policy. Depends A13/A02.

### A15 — P2: release checks omit important tests

**Problem:** Existing CI omits comprehensive isolation, promo, receipt, model and teaser suites; the Monday harness is stale. Passing a subset does not protect cross-league operations.

**Implementation:** Inventory maintained tests and their prerequisites, repair harness-only missing modules/template count, separate research scripts from production release checks and add high-value suites to CI. Add missing tests for staff-only access, claims, environment identity, cleanup races, league switching and shared-cache isolation. Use synthetic providers/time and never production credentials. Preserve logs/screenshots as bounded artifacts.

**Acceptance:** A documented release-check command runs from a clean checkout; intentional tenant/env/membership regression fails it; stale fixtures do not disguise failures. Owner-approved release applies to the tested SHA. CI approval is not owner production approval. See 09.

### A16 — P2: administrative account security

**Problem:** Hosting dashboard reported single-factor owner access. An owner account controls releases and secrets across leagues.

**Implementation:** Owner completes supported 2FA/recovery-code workflow and reviews GitHub, Vercel, Supabase, email provider, deployment hooks and old access grants. Separate dev/prod keys, keep production credentials inaccessible to untrusted preview code and redact secrets from logs. Identify any bypass of owner release approval.

**Acceptance:** Owner verifies recovery path and least-privilege access inventory; new development has no production key; disabling a compromised preview does not require shutting down production. Credential entry/changes stay owner-controlled. Record completion without passwords/recovery codes. Do not rotate production secrets blindly and break scheduler/email.

### A17 — P3: mobile usability and unfinished previews

**Problem:** Some mobile text is 8–10 px; layout automation does not prove readable real-device flows. Teasers/live functionality has deliberate limitations that can look unfinished.

**Implementation:** Check physical phone readability, zoom, touch targets, keyboard-open slip, errors, support/guide/theme controls and assistive technology. Use explicit feature availability from capabilities; do not show fixture/sample odds as accepted production offers. Standardize card heights with wrapping/featured banners, avoiding clipped content at larger font sizes. Guide illustrations must reflect active league rules.

**Acceptance:** Owner reviews desktop and narrow-phone captures plus keyboard/screen-reader journeys; no inaccessible control/icon-only ambiguity; no overflow with long names/records and enlarged fonts; unfinished products cannot be accepted accidentally. UX changes must not trigger more full-board polls.

## Additional workstreams and investigations

### A18 — P1: isolated development and controlled releases (confirmed need)

Implement handoff 09 before applying substantive fixes to production. Verify isolation with negative tests, not hostname alone. Owner approval is mandatory for each exact production release. No new repository is required; no purchase or paid custom environment is required by the recommended branch-preview architecture.

### A19 — P2: automatic error reporting and manual support (confirmed requested feature)

Implement only after owner requests development; **do not deploy yet**. Handoff 11 specifies automatic occurrence capture, grouped bounded storage, notes, owner triage, receipt/status and placement left of `?`. Include the reporting system itself in the usage budget. Reporting failure must not create a recursive flood or change bet acceptance.

### A20 — P2: projection/provider efficiency (investigate before changing pricing)

The code already uses Sleeper weekly projected statistics scored with the league's settings. Weekly expected values also apply a small capped history adjustment; season strength blends projections/history and simulates futures. Removing our adjustment may reduce historical fetch/compute but does not solve full archive retention or repeated board traffic. The projection feed used in code is not described in Sleeper's public API reference; validate payload freshness, support and failure behavior rather than asserting an SLA.

First cache finalized weekly result statistics compactly rather than refetch every prior matchup week for every family/cycle. Share identical season/week projected-stat inputs across leagues; apply each league's scoring separately. Compute once per relevant input/rules/model revision, then reuse across families. Recalculate affected families when inputs change; do not serve stale prices merely because a cache exists. Keep distribution/uncertainty, matchup correlation and settlement logic: a projected mean alone is not a win probability or fair sportsbook price.

Test a Sleeper-centered baseline against the current adjustment at identical fixed horizons using compact paired metrics. Compare MAE/bias/probability quality, data coverage, runtime and provider calls. Adopt simpler logic only if measured quality is acceptable or better; do not promise capacity gains as a percentage without profiling. Never use a live-updating mean as remaining-points pricing without validated live semantics.

### A21 — P2: operational controls and bounded workload (additional investigation)

Inventory per-league pause controls, queue fairness, scheduled overlap, lease duration, idempotent execution and provider failure isolation. The current one-job/minute claim gives two leagues eight pricing dispatch slots per active 15-minute interval before other work. Measure queue age and settlement delay under two-league peaks; use priority/fairness/jitter or bounded concurrency only after query/load measurement. One broken league must not starve the other's settlement. Add owner health view for stalled refreshes, failed cleanup, usage forecast and recurring errors. This is not a claim that all these failure modes have occurred.

### A22 — P2: season renewal and membership drift (additional investigation)

Specify new Sleeper season IDs, roster owner/co-owner changes, archived league views, postseason/offseason schedules and continuing sportsbook balances/futures. Preview identity/rules drift for owner review; never transfer betting access solely because a public owner name changes. Test old-season receipts/settlement after new-season import. Keep only compact final results needed for history and summaries. Do not duplicate the entire previous season as a new league by default.

### A23 — P2: request abuse, support floods and provider resilience (additional investigation)

Measure auth resend/report ingestion/expensive admin endpoint limits and duplicate requests. Introduce scoped budgets, schema/body limits, retry backoff and timeouts; distinguish transient failures from invalid requests. A quota on diagnostic reporting must not block legitimate settlement or sign-in recovery. Simulate provider outages, partial responses and cold starts in dev. Maintain truthful freshness/unavailable states and surface unsupported rules instead of fabricated outputs.

### A24 — P2: customizability without configuration drift (confirmed requirement, implementation missing)

All supported sportsbook settings start from shared defaults and can be overridden per league by Cooper. Store typed small overrides plus an effective policy version; resolve defaults consistently across UI/API/jobs. Validate combinations and show a read-only preview before activation. Distinguish league display choices from financially material changes and provider-owned facts. Provide reset-to-default and safe export/import of policy only. Never make deploys necessary for ordinary supported configuration changes, and never let edits rewrite accepted tickets. Define each setting's units/range/impact in the owner UI.

### A25 — P2: revamp every notification around the current lifecycle and season

Confirmed requested workstream. [Handoff 12](12-email-lifecycle-and-season-storylines.md) is the implementation specification: inventory all notifications, replace obsolete Thursday urgency under a Monday-close policy, derive reminders from actual eligible windows, combine redundant messages, and evolve factual story/market selection throughout the imported fantasy season. Add championship declines, meaningful category-specific futures movement and new #1-pick leaders without inventing narratives. Keep receipts exact, actor/league scope correct, preferences respected and queue retries idempotent. Use only small weekly comparison references and bounded sent-story keys, not permanent per-refresh archives. Validate schedule, season phases, missing/changed data, two-league recipients, email budget and delivery in isolated dev before owner-approved release. This request does not itself change production acceptance windows or send mail.

## Implementation order and second-league readiness

Prepare isolated development and recoverable schema first while instrumenting efficiency. Address A01/A06/A11/A12 with bounded retention/read paths; stop archive accumulation promptly. Then implement staff identity, league settings/import/claims, selector and generic market rules. Repair futures editing, help consistency and release coverage, including handoff 12's notification lifecycle and evolving season content. Support is designed now, developed/tested separately and remains undeployed until requested. Investigations above become confirmed tasks only after evidence or an explicit product choice.

Second league is ready only after: two synthetic contrasting leagues pass current pricing and transaction journeys; team-less oversight works; signup claims/selector preserve access boundaries; shared defaults/overrides reach generation through settlement; bulk data expires and two-league/development load fits the free budget; scheduler completes essential jobs under peaks; restore/release drills pass; owner reviews the actual imported league capability report. Universal Sleeper rule support and free capacity are conclusions to demonstrate, not assumptions.

## Open questions that must not become hidden assumptions

Exact team-claim approval UX and co-owner betting rights; balance/replenishment bounds and change-effective timing; supported custom tiebreak/draft policies; desired seasonal carryover; which optional features to defer if capacity remains tight; final product name. Resolve each when its implementation reaches a concrete review rather than repeatedly asking broad questions.

## References checked October 28

- [Sleeper public API](https://docs.sleeper.com/): read-only league/user/roster data; no documented projection endpoint or member-email field in the relevant responses.
- [Supabase environment workflow](https://supabase.com/docs/guides/deployment/managing-environments)
- [Vercel Git deployment workflow](https://vercel.com/docs/git)

Status: expanded implementation guidance and confirmed requirements recorded. Audit findings remain open; no feature or production fix is deployed by this document.
