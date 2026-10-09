# Initial Audit, Mobile Quality and Multi-League Roadmap

Current implementation and evidence: [9 October audit/release review](06-audit-release-review.md). Deployment awaits user approval. The original provider-ID finding below is superseded; the worker already reads verified league configuration.

Read [shared context](PROJECT-CONTEXT.md). Scope: targeted source inspection and earlier reported visual issues. This is not a completed production security audit, a complete browser regression suite, or proof of mobile rendering. Perform measured viewport/device checks during implementation.

## Initial Source Findings

Priority: P1 before live betting/multiple-league launch; P2 important quality; P3 refinement. These are observed code/design gaps, not claims of an exploitable vulnerability.

### `api/weekly-worker.ts`

- `api/weekly-worker.ts:270` — P1: roster refresh uses one hardcoded Sleeper league while updates are scoped to the job's league. Derive the provider ID from that league's verified configuration before scheduling other leagues.
- `api/weekly-worker.ts:7` — P1: current 60-second function budget and one-job execution need capacity testing before adding frequent simulations and multiple leagues; prioritize essential weekly jobs and avoid overlapping worker backlog.

### `src/App.tsx`

- `src/App.tsx:31` and `src/App.tsx:37` — P2 now / P1 for multi-league rollout: sign-in season/week defaults and period lookup are hardcoded. Resolve league context without disclosing inaccessible league data; avoid an incorrect default display when the request fails.
- `src/App.tsx:23` — P3: avatar images omit intrinsic width/height attributes. Match actual CSS sizing with reserved dimensions and verify fallback behavior to reduce layout shifts.
- `src/App.tsx:119` — P3: email input has type/autocomplete but lacks a name and explicit spellcheck policy. Preserve its label and improve browser/form conventions.
- `src/App.tsx:532` — P2: main navigation is local state. Design URL-backed pages/report filters so refresh, back navigation and shared admin report links preserve context; evaluate existing routing before a broad rewrite.

### `src/components/Sportsbook.css`

- `src/components/Sportsbook.css:1` — P2: large compressed CSS rules and later responsive overrides make cascade behavior difficult to inspect. Format and organize the existing stylesheet before changing dimensions; avoid a redesign that unintentionally changes desktop.
- `src/components/Sportsbook.css:1` and `:59` — P2: bottom slip/dialog layout uses fixed offsets and layered height/gap adjustments. Verify mobile safe-area padding, keyboard-open height, leg scrolling and pinned submit controls. A forced small dialog can bury selections; simply increasing height can bury submission controls.
- `src/components/Sportsbook.css:7` — P2: dense responsive overrides include small text and hidden team images. Review on actual small viewports with long names. Preserve essential balance/team information rather than fitting everything by shrinking type.

### Existing Good Patterns to Preserve

`src/components/Sportsbook.tsx:948` provides a named native dialog, and removal/collapse buttons have accessible names. `src/App.tsx:654` uses native details/summary with Escape handling. Do not report these as missing merely because they need mobile verification. Existing league membership selection is a useful multi-league foundation; audit backend isolation rather than replacing it blindly.

## Mobile and Accessibility Work

Create a visual checklist at real 360, 390, 430, 768, 1024 and 1440-pixel viewports. Test portrait/landscape, iOS/Android browser behavior, keyboard-open bet slip, dark/light themes, zoom/reduced motion, long names, missing avatars, loading/error/empty/suspended states and slow data. Verify the browser's actual viewport; a requested emulation size that did not apply is not a mobile test.

Allow deliberate wrapping: mobile season/week should occupy two balanced lines; opening/cutoff each gets its own line; monetary values and short odds stay together. Desktop retains its existing structure. Avoid forcing every desktop one-line sentence into one mobile line with tiny type. Use `min-width: 0`, clear grid breakpoints, compact metadata hierarchy, safe-area insets and internal scrolling only where needed.

Keep profile balance visible. Align card headers, rows and action areas using shared layout tokens. Use consistent touch targets with approximately 44-pixel interaction space, visible focus, sufficient light/dark contrast, labeled icon actions and live-region announcements for important completion/errors. Keep the strongest hierarchy for main navigation, then market categories, then card metadata. Respect reduced motion and prevent live refresh from jumping focused controls.

Test complete journeys: sign-in → league selection → market selection → quote update → accept/reject revised price → ticket history; claim boost → eligible slip → redemption; admin generation → pause/publication → logs; report filtering → image/PDF export. Use test wallets/fixtures, not live bet placement. Capture before/after screenshots and genuine overflow/readability checks rather than only checking CSS text.

## Transaction and Data Audit

Review server-side membership/admin checks, service-role usage, RLS, league-specific cache keys, trusted quote pricing, balance debit idempotency, void/refund, settlement corrections, email recipient isolation and scheduler secrets. Privileged functions must validate the league of every market/ticket/offer ID. A client-hidden admin icon is not authorization. Verify function cold starts and runtime imports, given earlier FUNCTION_INVOCATION_FAILED incidents.

Audit future simulations for scoring compatibility, playoff settings/tiebreakers, current pick ownership, future schedule coverage, injury/bye effects, unavailable inputs and reproducibility. Record limits rather than describing estimates as guaranteed accurate. Expand reporting definitions where archived versus reconstructed projections could be confused.

## Disconnected-League Architecture

League-scoped entities include provider IDs, season/week, scoring/lineup/playoff/draft rules, boards/quotes, wallets, tickets, offers/redemptions, schedules, model versions, files, email brand/config and reports. A single signed-in user can have different memberships and admin rights in each league.

Parameterize hardcoded branding/URLs and provider league lookups. Keep provider credentials and service-role secrets server-only. Require explicit league authorization on all APIs and constrained database functions, including exports and image storage. Never rely on a global current league variable or broad cache that leaks between requests.

Before rollout, seed two leagues with overlapping user identities and deliberately overlapping roster numbers. Test: admin in A/member in B cannot administer B; A ticket/offer IDs cannot be submitted to B; images/reports/emails stay isolated; switching leagues clears or safely scopes the bet slip; workers cannot refresh another league's standings. Keep per-league failure and spending budgets, configuration migration and backup/restore procedures. No global leaderboard, shared wallet, or cross-league betting without a separate product decision.

## Feature and Market Backlog

| Proposal | Benefit | Priority / prerequisites |
| --- | --- | --- |
| Quote-update review and freshness badges | Users understand changed live lines | Critical for live launch |
| Market suspension reasons and reopen status | Removes ambiguous locked buttons | Critical |
| Automation health with last/next run and retry reason | Makes unattended operation inspectable | Critical |
| Admin approval/review queue for unresolved results | One place for missing data and settlement decisions | Critical |
| Ticket search/filter and shareable receipt | Easier tracking of open, won and voided bets | Important; redact sensitive fields |
| Model-version and line-movement history | Explains changing prices and forecast performance | Important; quote archive first |
| Notification preferences and digest frequency | Better email experience | Important; required confirmations remain supported |
| Personal betting dashboard | Clear results by category and week | Important; final/push/void definitions |
| Responsible pretend-currency stake limits | Prevents accidental large stakes and confusing exposure | Important; server validation |
| Weekly league total score over/under | New understandable aggregate market | Nice to have; correlated league simulation |
| Number of close fantasy games | Another exact-count special | Nice to have; define a margin threshold and equality |
| Winning margin bands | Alternatives to a standard spread | Nice to have; exclusive bands and compatible parlays |
| Number of underdogs winning | League storyline special | Nice to have; freeze favored-team benchmark |
| Closest or biggest blowout matchup | Engaging weekly result | Nice to have; tie settlement and joint simulation |
| Playoff-seed bands or division winner | Longer-term futures | Nice to have; verify actual league structure |
| Multi-league onboarding/configuration preview | Repeatable setup for disconnected leagues | Later; isolation, provider validation and operational limits |

Some aggregate ideas overlap existing average/highest/count markets. Avoid duplicate exposure disguised by another name; apply correlation and contradiction rules before enabling parlays. Each market needs pricing, acceptance, history, settlement, reports and email labels—not merely a new home button.

## Skills and Verification

Installed: Frontend Design, Web Design Guidelines, React Best Practices, Supabase Postgres Best Practices, Validate Data, Build Dashboard, Data Visualization and React Email. Add [Webapp Testing](https://github.com/anthropics/skills/tree/main/skills/webapp-testing) before broad UI regression work, following the runtime's allowed browser tooling. Add Statistical Analysis for model-related findings. Do not install extra skills solely because they mention dashboards or scheduling.

Reference: [Vercel Web Interface Guidelines](https://github.com/vercel-labs/web-interface-guidelines/blob/main/command.md). Re-fetch the current guidelines during the actual audit. Final delivery should include findings with file/line, severity, fix/test evidence, screenshots, deployment status and remaining risks.
