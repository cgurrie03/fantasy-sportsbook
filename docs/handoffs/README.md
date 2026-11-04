# Development Handoffs — priority updated October 28, 2026

Latest November4 update: [41 Fair automation dispatch](41-FAIR-AUTOMATION-DISPATCH.md),43/43 on1e6d1b8, compatible DEV database-only migration; protected frontend/production deployments unchanged. Counter18 complete/6 remaining. Actual backup deferred by owner; continue independent development.


## Latest verified checkpoint — November 2, 2026 ET

**18 complete / 6 remaining.** Start with [handoff 40](40-SHARED-POLICY-AND-CAPABILITY-GATES.md), [consolidated continuation](../NEXT-SESSION.md) and [remaining gates](../REMAINING-MILESTONES.md). Qualified/deployed source e5ee1e2 passed43/43; protected READY Development dpl_DbHMid37bWgGwLMbfgVKexFgLQy2. Milestone16 is complete for the declared supported profile; production remains unchanged. Wallet17 and notification18 are complete DEV. Full platform recovery, historical production cleanup, external release controls, final audit/capacity and approved production release remain open. Owner key import/phone access are complete; full restore drill is owner-deferred. No GitHub push, production action, second real league or new scheduled continuation is authorized.

The earlier preparation/status narrative below is historical and does not override this checkpoint or the user's later decisions. Original handoff documents specify work; they do not grant production or external-publication approval.

## Historical context


**First priority: [Supabase efficiency](08-supabase-efficiency.md).** The October 28 audit measured database storage at 217% and billing-cycle egress at 110% of the current allowance, with eight monthly active users. Complete the storage, fetching, bounded-query and recovery work before enabling another league or expanding features. Handoff 08 supersedes earlier instructions to retain repeated complete payloads indefinitely. Its dated measurements and implementation gates take precedence over the historical ordering below; this update deploys no runtime changes.

This bundle began as specifications for separate development chats. Workstream handoffs now record both deployed work and remaining gates; read each current status instead of treating the entire bundle as planned. Promos & Boosts and its category-picker follow-up are deployed at `84d9ce6`, with migration 033 applied; handoff 03 records implementation, completed tests, production evidence and limitations. This latest documentation cleanup changes no runtime configuration or production data.

## Start Here

Latest addition: [handoff 12](12-email-lifecycle-and-season-storylines.md) revamps all notifications around actual betting/settlement windows, removes obsolete Thursday closing reminders under Monday-close policies, and evolves factual seasonal storylines and market spotlights using compact weekly references. Older Thursday-specific messaging instructions are superseded; verify the actual runtime betting lifecycle rather than changing it to match email copy.

Read [current handoff status](00-current-handoff-status.md) first for completed preparation, remaining implementation gates, uncommitted/local-only files and the next-developer prompt. The handoff is ready to transfer; the dev site and second-league launch are not yet ready.

October 28 follow-up: [handoff 09](09-development-and-release-environments.md) specifies isolated owner-only development and owner-approved production releases. [Handoff 10](10-expanded-audit-implementation.md) expands every audit finding into implementation directions and second-league gates, including commissioner-shared signup, team claims, multi-league selection and shared defaults/overrides. [Handoff 11](11-support-and-automatic-bug-reports.md) specifies automatic/manual support reports; **do not deploy support yet**.

The user has confirmed **temporary storage by default**, not indefinite deduplication of every refresh. Handoff 08 supersedes any earlier requirement to preserve every published revision or complete projection/model input. Keep current state and accepted-ticket/financial evidence; use expiring compact evaluation samples and durable small summaries. Its proposed retention/capacity budgets must be implemented and measured before declaring the issue resolved.

Read [Project Context](PROJECT-CONTEXT.md), then copy the corresponding section from [Chat Prompts](PROMPTS.md) into the new chat. Each prompt tells the next developer to inspect the current checkout before making changes; the repository may have advanced since this snapshot.

| Workstream | Handoff | Priority and dependency |
| --- | --- | --- |
| Supabase Efficiency and Capacity | [08](08-supabase-efficiency.md) | First priority. Reduce repeated payload storage/downloads, bound reads, verify recovery and measure two-league headroom. |
| Isolated Development and Release Approval | [09](09-development-and-release-environments.md) | Establish before implementing fixes against production; independent test data, owner-only access and explicit production approval. |
| Expanded Audit Implementation Backlog | [10](10-expanded-audit-implementation.md) | Detailed A01–A25 directions, tests, dependencies, confirmed requirements and additional investigations. |
| Support and Automatic Bug Reports | [11](11-support-and-automatic-bug-reports.md) | Specification only. Automatic error occurrence capture, manual reports, notes and status; do not deploy yet. |
| Email Lifecycle and Evolving Storylines | [12](12-email-lifecycle-and-season-storylines.md) | All-notification revamp: actual-window schedule, season phases, varied factual highlights, compact weekly futures comparisons, preferences and queue migration. |
| Automatic Line Refresh and Live Betting | [01](01-scheduled-lines-and-live-betting.md) | Critical before live betting opens. Build data freshness, market suspension, quote acceptance, and tenant scoping first. |
| Model Assessment and Controlled Improvement | [02](02-model-evaluation-and-calibration.md) | Forecast archiving and honest assessment are critical foundations. Automatic parameter promotion comes later, after enough evidence. |
| Image Promos and One-Use Profit Boosts | [03](03-promos-and-boosts.md) | Deployed, including atomic redemption and organized selection picker. Read current operation, test limits and remaining optional work. |
| Fantasy Spread Teasers | [04](04-teasers.md) | Optional expansion. Depends on quote snapshots, settlement rules, and tested joint probability pricing. |
| Mobile Audit and Multi-League Readiness | [05](05-audit-mobile-and-multi-league.md) | Critical readability and transaction issues first; broad multi-league rollout and extra features later. |

## Confirmed Product Decisions

- Fast refresh means **while at least one NFL game is actually in progress**, not the entire span from first kickoff to last final. Use 15-minute refreshes then, two-hour refreshes otherwise.
- **Add live betting during games.** This changes the product beyond pregame refreshes and requires a separate live market lifecycle.
- Automatic regeneration and publication need no administrator involvement. Runtime updates publish to the database; they do not require Git pushes.
- Tuesday alone retains the established week rollover. Accepted tickets keep their original terms.
- Teasers support **three or more distinct fantasy matchups**, with a small adjustment range around a model-tested center.
- Up to three image slots advertise fixed, uneditable tickets or claimable one-use profit boosts. Admin-selected Eastern expiry supersedes the original Thursday promo deadline. Mobile uses dots; gold Claim buttons overlay images.
- Example boost: 50% additional profit, at least five selections, all Player Points with distinct players; $20 maximum wager and no extra-profit cap. Claim does not consume use; successful acceptance does. Partial pushes retain saved boost terms, full pushes never restore use, and full admin void restores a boost once without extending expiry.
- Schedule offer has no second menu or separate appearance-date picker. During the selected week it becomes visible when its board is published and open; a current already-open board makes it visible immediately.

## Original Implementation Order — use current handoff status

1. Establish shared quote revisions, atomic ticket acceptance and league-scoped authorization. Use handoff 08's temporary samples and compact summaries; the original full-archive instruction is superseded.
2. Fix the highest-impact mobile issues and add end-to-end regression coverage.
3. Connect unattended intervals in shadow mode; verify actual scheduler runs, retries, cost, and source freshness.
4. Enable live markets individually only after each market has reliable inputs, suspension rules, and settlement coverage.
5. Fixed promos/one-use boosts and model-assessment infrastructure are now deployed. Use handoffs 03/02 for remaining validation and optional extensions, rather than restarting their original implementations.
6. Add teasers after simulation and settlement verification. Expand into separate leagues after isolation tests pass.

The chats may investigate independent areas concurrently, but changes to shared ticket, pricing, worker, and migration files should be integrated sequentially. Keep migration numbers unique and record deployment state after every feature.

## Skills to Add Before Their Corresponding Work

- [Webapp Testing](https://github.com/anthropics/skills/tree/main/skills/webapp-testing): repeatable browser journeys, screenshots, and regression checks. Recommended before the mobile audit and live/promo ticket workflows. Its browser tooling must follow the execution environment's supported browser-control rules.
- [Statistical Analysis](https://github.com/anthropics/knowledge-work-plugins/tree/main/data/skills/statistical-analysis): distributions, uncertainty, outliers, and cautious statistical comparisons. Recommended before automatic calibration and teaser pricing research. It is general statistical guidance, not a ready-made fantasy betting model.

Already installed skills cover frontend design, React performance, interface review, Supabase/Postgres, React Email, dashboards, data visualization, and data validation. No additional scheduling skill is necessary to use the existing worker. A project-specific operations skill could later consolidate league rules using the installed Skill Creator; maintain these handoffs as the source of truth first.

The original bundle did not install its recommended skills. Webapp Testing is available and was used for the promo/browser regression; repository Node Playwright was used because Python Playwright was unavailable. In a new chat, verify the actual skill/tool availability. If a required skill is missing, complete independent inspection/planning and wait before its dependent work, consistent with the user's preference.

## Remaining Decisions to Resolve in the Relevant Chat

- Reliable live schedule/status/statistics/projection provider, availability, latency, and any costs. Sleeper's documented API alone does not establish that complete live inputs exist.
- Teaser push/void treatment. Recommended: remove pushed/voided legs and reprice from the saved pricing version; refund if too few legs remain and none lose. Confirm before enabling tickets.
- Remaining promo choices/extensions: whether a fully voided fixed offer may be reused, a separate appearance-date picker or typed-code claim workflow. These are not shipped features. Current wager, eligibility and boost push/void rules are settled in handoff 03; extra-profit caps must never be introduced.
- Exact teaser adjustment and maximum leg count after model testing. The provisional range in handoff 04 is not an approved production payout table.

For ordinary live betting, preserve the existing Thursday pregame cutoff and open a separately defined live phase only after its gates pass. Promo visibility/redemption uses each admin-selected expiry, and manual fixed offers follow the user-directed exception in handoff 03. Do not disable the Thursday board close job to implement either feature.
