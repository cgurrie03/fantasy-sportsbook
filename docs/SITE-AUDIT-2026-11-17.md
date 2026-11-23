# Development Site Audit — November 17, 2026

**November 18 AUD-12/AUD-13 resolution:** Real commissioner activity and persistent private support workflow deployed to Development `dpl_HdbGrYbxcNR4UhHSEqmtT7GtdwCg`. SQL/HTTP authorization and hosted desktop/mobile workflows passed; test fixtures removed. See `docs/AUD-12-13-DELIVERY-2026-11-18.md`. AUD-15 is deferred until member password rollout, with the existing Development password form noted. This supersedes earlier remaining-item counts below.

**November 18 AUD-10/AUD-11/AUD-14/AUD-16 resolution:** Paginated history/on-demand archives, explicit reward recipient controls, browser security headers and request validation implemented. Development delivery `dpl_7F1ZG1xgNALZ7o3SGNdX7gK54bWo`; verification and limits in `docs/AUD-10-11-14-16-DELIVERY-2026-11-18.md`. Remaining audit implementation: AUD-12, AUD-13, AUD-15.

**November 18 AUD-07/AUD-08/AUD-09 resolution:** Independent offer summary layout, unique stake input labels and legacy source authentication/membership checks deployed to Development `dpl_98Ysxbm63RwL3uewMjDF1kx5UrjC`. Sixteen local browser/viewport/theme cases and actual hosted authorization/removal checks passed. See `docs/AUD-07-08-09-DELIVERY-2026-11-18.md`.

**November 18 AUD-02 resolution:** Add League crash and empty hosted API repaired; linked-Sleeper discovery, duplicate protection, and explicit Solo/Primary/Co-Manager roles deployed to Development `dpl_AT7fURaBJHF4ESTS2AK23xWc5URG`. Local/hosted desktop/mobile and database regressions passed. See `docs/AUD-02-DELIVERY-2026-11-18.md`. Original findings below remain the audit-time record.

The audit found functional blockers, two account/data isolation problems, and remaining mobile layout defects. The tested financial and role guards held: the probes did not obtain administrative access or change another user's balance. This is a bounded audit of Development, not a certification that every possible vulnerability is absent.

No application fixes were implemented or deployed during this audit. Production was not changed.

## Resolution Update — AUD-01 and AUD-06

Fixed after the audit and deployed to Development as `dpl_GuE2WV7PBGFtLQmHbF4Q38LUG4sT` (November 17 Eastern / November 18 UTC). Other findings remain open.

- **AUD-01:** Personal history reads only the exact signed-in user's wallet entries, using their authenticated request. Unattributed team legacy rows are no longer merged into personal history. The legacy-ledger read policy now preserves administrative archive access without transferring history to replacement managers. Historical records and balances were not rewritten.
- **AUD-06:** Profile defaults use the authenticated account's name and verified email. Display-name storage and browser preferences are scoped by user ID. Shared legacy profile records are discarded; cached email values cannot override Auth. The verified email is read-only with an explanation. Sign-out/account changes unmount account UI, clear loaded account data, and clear the departing account's saved profile. Header avatars and feedback context no longer fall back to another team's primary-manager identity when a live account name is available.
- **Verification:** API regression cases for member, co-manager, replacement, owner, and missing wallet; browser storage isolation cases; desktop/mobile browser account switching and sign-out; live rolled-back RLS probe; real hosted desktop/mobile checks with two temporary co-manager accounts; TypeScript/build and API runtime tests passed.
- **Cleanup:** Temporary users, sessions, links, wallets, and local credentials removed. Original wallet digest unchanged; 91 tickets and 261 legs preserved. No new tables, polling jobs, email sending, or Production changes.

## Target and coverage

- Site: https://dev.sportsbook.coopergurrie.com
- Deployment: `dpl_Ba2GDaD2LzuG9r61LvbXPZrNNnoC`, frontend bundle `index-2W8tfwsK.js`.
- Roles: verified member/co-manager, commissioner, platform owner, unrelated signed-in user, signed-out user, and an unverified account.
- Browsers: actual hosted Chromium/Edge at 1440 px and 390 px; focused hosted WebKit checks at 390 px. WebKit automation is not a physical iPhone test.
- Pages: Weekly Slate and its four market tabs; player matchups, position groups, fantasy points, milestone ladders, Weekly Specials; matchup details/slides; futures; My Bets and All Bets; league standings/managers; profile/account/preferences/communications/history; guide; all eight commissioner tabs; all six owner tabs; Add League; sign-in/access-denied states.
- Actions: market selection/clearing, offer dialogs, slip input validation, searches, ticket expansion, popovers, guide navigation, owner navigation, commissioner confirmations and settings saves, credit claims/retries, and deliberate API/RPC misuse.
- The interaction pass exercised 164 UI actions. Two label-based mobile stake interactions failed because of the duplicate-ID defect below; direct input validation subsequently passed in both engines. There were 88 backend authorization/validation checks and nine isolated commissioner RPC checks. A further 24 commissioner UI checks completed.
- Commissioner settings writes used an isolated audit league. Because the native book API cannot select that league, its UI pass supplied a league-scoped book fixture while forwarding settings RPCs to the real Development backend. Those UI results do not prove native multi-league navigation.
- Existing local API-runtime, settlement-coverage, line-model, and futures suites also passed. They do not replace hosted integration or model calibration tests.

## Fix first

**November 18 update:** AUD-03, AUD-04 and AUD-05 are implemented on Development. The final AUD-05 requirement is Tuesday 5 AM Eastern rollover without scheduled downtime, replacing the prior closure recommendation. See [delivery and verification details](C:/Users/coope/Documents/Codex/2026-10-28/co/work/fantasy-sportsbook/docs/AUD-03-04-05-DELIVERY-2026-11-18.md). AUD-02 remains open.

| Ticket | Priority | Finding | Impact |
| --- | --- | --- | --- |
| AUD-01 | P1 | New co-managers receive the primary team's legacy financial history | Wrong personal history and disclosure of another participant's historical ledger |
| AUD-02 | P1 | Add League crashes on desktop and mobile | Owner onboarding cannot proceed |
| AUD-03 | P1 | Immediate futures refresh calls an unsupported API action | Approved rules cannot reliably trigger the promised immediate board run |
| AUD-04 | P1 | Commissioner mapping does not complete the invitation flow | New accounts cannot be invited through this action; existing-account mappings do not queue an invitation |
| AUD-05 | P1 | Published weekly board contradicts the displayed closed/reopening schedule | Bets can be accepted during the interval the site describes as closed |
| AUD-06 | P2 | Saved profile values carry between accounts on the same browser | Incorrect identity and local disclosure of the previous account's name/email |
| AUD-07 | P2 | Weekly offer cards clip and overlap | Mobile offers and their action buttons are partly inaccessible |
| AUD-08 | P2 | Mobile Stake label targets a hidden desktop input | Broken label/focus association and assistive access |
| AUD-09 | P2 | Legacy live-book endpoint does not require Boff sign-in | Inconsistent membership boundary for league metadata/scores |

P1 means address before treating the affected workflow as ready. P2 means a substantive defect. P3 items below are hardening or efficiency work. These priorities are not claims of demonstrated account takeover.

### AUD-01 — Scope financial history to the signed-in participant

**Observed:** A newly created co-manager with no betting history received 21 legacy ledger entries belonging to the primary team. After its own test claim, it received 22 entries: the same 21 legacy rows plus its own claim.

**Cause:** The book endpoint reads legacy `wallet_ledger` by `member.team_id` with its service credential, then merges those entries with the participant's own `user_wallet_entries`. Sharing a fantasy team does not make the primary manager's old ledger the new co-manager's personal history.

**Required fix:** Establish explicit ownership for legacy history. Return personal history only to its owner, with any team history presented separately and only where authorized. Cover primary-manager replacement and co-manager addition in regression tests. Do not delete historical ledger entries to solve the display problem.

Evidence: `targeted-results.json`, test “New co-manager financial history”; [book API source](C:/Users/coope/Documents/Codex/2026-10-28/co/work/fantasy-sportsbook/visual/api/book.mjs:50).

### AUD-02 — Repair Add League

**Reproduction:** Platform Owner → Add League, or `/leagues/new`. Both tested widths rendered a blank page and raised `Cannot read properties of null (reading 'useState')`.

**Required fix:** Correct the component/runtime integration, investigate duplicate React resolution across the root and visual apps, and add an error boundary so a component failure does not blank the whole site. The exact underlying React-resolution cause remains to be confirmed.

Evidence: [desktop screenshot](C:/Users/coope/Documents/Codex/2026-10-28/co/work/fantasy-sportsbook/work/site-audit-2026-11-17/owner-1440--leagues-new.png), [mobile screenshot](C:/Users/coope/Documents/Codex/2026-10-28/co/work/fantasy-sportsbook/work/site-audit-2026-11-17/owner-390--leagues-new.png), browser errors in `hosted-results.json`.

### AUD-03 — Connect futures approval to a real refresh handler

**Observed:** `FuturesRules.tsx` posts `{action: "refresh_futures", revision}` to `/api/book`. The verified deployed API handles POST as ticket placement and rejects this body with HTTP 400, `Invalid ticket`. The owner-authorized probe confirmed that response without changing rules.

**Impact:** Saving rules and persisting a revision can work, while the immediate board regeneration step fails. A later background run does not satisfy the promised immediate action.

**Required fix:** Implement the explicit authorized action or call the correct refresh endpoint. Validate revision and league, run once, and report publication success/failure separately from rule-save success.

Evidence: `targeted-results.json`, “Owner immediate futures refresh action”; [caller](C:/Users/coope/Documents/Codex/2026-10-28/co/work/fantasy-sportsbook/visual/src/FuturesRules.tsx:67).

### AUD-04 — Complete invitation dispatch from member mapping

**Observed in a rolled-back database probe:** Mapping a new email fails with `The replacement needs an existing verified Boff account`. Mapping an existing verified audit account succeeds, but creates neither a `team_invitations` record nor an `outbound_emails` record. Removal/revocation worked in the same rolled-back probe.

**Impact:** Invitation templates alone do not provide the requested existing/new-user invitation workflow. Verification resends and invitation completion need explicit end-to-end acceptance tests.

**Required fix:** Connect commissioner actions to the invitation service, support new-account verification, distinguish invitation pending from account mapped, and enforce resend limits. General communications must remain blocked for unverified recipients.

Evidence: `rollback-invitation-audit.sql` contains the successful rollback probe. It changed no lasting real membership or email records.

### AUD-05 — Reconcile weekly opening and closing rules

**Observed:** Operations and loading copy describe weekly closure Tuesday at 1 AM Eastern and reopening Wednesday at 6 AM Eastern. The Week 11 board was published at `2026-11-17 05:05:04Z` (Tuesday 12:05 AM Eastern), and a valid placement was accepted in a rolled-back probe during the advertised Tuesday closed interval.

**Required fix:** Confirm one canonical schedule and apply it to publication, placement eligibility, worker cadence, and displayed copy. If Development intentionally bypasses the schedule, show an explicit Development override rather than ordinary closed-window copy.

Evidence: `rollback-finance-audit.sql`; [schedule copy](C:/Users/coope/Documents/Codex/2026-10-28/co/work/fantasy-sportsbook/visual/src/AccountPages.tsx:992).

### AUD-06 — Isolate profile state by account

**Reproduction:** Save a display name/email in Account, then sign into a different account using the same browser storage. The second account displays the first account's saved values. The actual two-account browser probe confirmed both fields.

**Cause:** `boff-visual-profile` is a single global localStorage record. The profile defaults also use the fantasy team's primary manager rather than necessarily the signed-in co-manager. Account edits here are browser state, not an Auth email update.

**Required fix:** Load authenticated identity from the account, scope persisted preferences to user ID, clear sensitive account state at sign-out, and separate verified-email changes from display preferences. This did not grant backend permissions to the second account.

Evidence: [screenshot](C:/Users/coope/Documents/Codex/2026-10-28/co/work/fantasy-sportsbook/work/site-audit-2026-11-17/cross-account-profile.png), [profile initialization](C:/Users/coope/Documents/Codex/2026-10-28/co/work/fantasy-sportsbook/visual/src/AccountPages.tsx:354).

### AUD-07 — Repair offer-strip sizing and button containment

**Observed:** At 390 px, one summary card collapsed to 26 px wide while its neighbor occupied 364 px, overlapping/clipping content and controls. On desktop, a long-title summary was approximately 188 × 92 px and its action extended below the card. A page-wide overflow check alone misses this because an ancestor clips it.

**Required fix:** Use a consistent nonshrinking mobile card width with horizontal scrolling, reserve action space, and keep desktop rows equal in height without hiding controls. Verify long titles, one offer, multiple offers, and both themes.

Evidence: [mobile screenshot](C:/Users/coope/Documents/Codex/2026-10-28/co/work/fantasy-sportsbook/work/site-audit-2026-11-17/member-390-Matchups.png), offer geometry in `interaction-results.json`.

### AUD-08 — Give the mobile and desktop stake inputs unique IDs

**Observed in Chromium and WebKit:** Opening the mobile slip leaves two `id="stake"` inputs in the document. The visible mobile label's `control` is the hidden desktop input. Directly entering a negative value in the mobile input still disables Place Bet, so this is not a validation bypass.

**Required fix:** Unique IDs per slip instance, or one responsive instance, with correct label association. Verify tap-to-focus and screen-reader naming.

Evidence: `final-browser-results.json`, “Stake label association” and “Direct mobile negative stake”.

### AUD-09 — Apply consistent access policy to live-book

**Observed:** `/api/book` returns 401 without a Supabase token. `/api/live-book` returns 200 without that token and includes league name, teams, matchup scores, season, and week.

**Boundary:** These requests still had access through Development's Vercel protection. This is not a Vercel-protection bypass, and the observed response did not expose wallets or tickets. Some source information is already public on Sleeper.

**Required fix:** Remove the unused endpoint or enforce the intended membership policy consistently. Explicitly document any deliberately public league data.

## Other actionable findings

| Ticket | Priority | Finding and next action |
| --- | --- | --- |
| AUD-10 | P3 | Full book responses are large: the measured response was 1,714,195 bytes of uncompressed JSON, with 1,367 quotes and 91 tickets. Split/paginate ticket history and load heavy sections on demand. A hard `limit=1000` also needs pagination rather than silently losing older results when the league grows. |
| AUD-11 | P2 | Fantasy Rewards does not provide the requested per-award “Allow All” checkbox. Numeric zero can represent unlimited recipients, but the help text refers to a control that is absent. Add the explicit unchecked-by-default choice and preserve the co-manager grouping rule. |
| AUD-12 | P2 | Commissioner Betting Log is still a labeled example list of three Week 8 events, not a real league activity log. Wire it to actual authorized history or remove it from ready-feature claims. |
| AUD-13 | P2 | Support/feedback remains an explicitly labeled browser-only preview saved in localStorage. It is not a shared owner inbox. Complete persistence, ownership, status, and delivery before treating support submissions as received. |
| AUD-14 | P3 | Hosted page responses had HSTS but no observed Content-Security-Policy or X-Frame-Options. Add an appropriate CSP, including framing restrictions and necessary provider origins. Missing headers are a hardening gap; this audit did not demonstrate a clickjacking exploit. |
| AUD-15 | P3 | Supabase's security advisor reports leaked-password protection disabled. Evaluate enabling it and confirm existing sign-in/recovery behavior. The advisor also lists executable security-definer functions; their presence alone is not proof of a vulnerability. The tested protected functions denied unauthorized callers. |
| AUD-16 | P3 | Malformed JSON at the book endpoint returns 503 “Invalid JSON” instead of a client-error response. Return 400 so invalid input does not look like an outage or trigger inappropriate retries. Bound malformed revision parameters rather than falling back to expensive full reads. |

## Already deferred or still needing acceptance

These are not newly completed merely because their screens were visited:

- **Multi-league rollout:** The native book endpoint and some publication/cache/routing paths are hardcoded to the current league. A commissioner who belongs only to the isolated test league cannot load its native book. The owner directory does not yet establish silent viewing of every league. AUD-02 is an immediate crash; broader multi-league acceptance remains the previously deferred project.
- **In-email league switching activation:** AMP sender registration, actual compatible inbox testing, and enabling transport remain intentionally deferred. Ordinary links/web-reader behavior are a separate path.
- **Email delivery acceptance:** This audit did not send real mail or register a physical push device. Template previews and preference screens are not proof of inbox rendering, provider delivery, unsubscribe handling, or iOS push permission behavior. Invitation dispatch is specifically broken as recorded above.
- **Season transition/draft reopening:** No real season-end rollover, payout carryover, or post-draft market reopening was executed. These need controlled time/season fixtures and later operational acceptance.
- **Branding and public pricing:** The requested public landing/pricing page and full sign-in/loading/error branding pass remain next-action items.
- **Live-event and capacity acceptance:** It was not game time for the focused final checks. Actual simultaneous NFL score changes, physical-device animations, peak multi-league traffic, prolonged provider outages, and storage/IO plateau were not stress tested. Passing deterministic line-model tests does not prove probability calibration or every live settlement case.

## What passed

- Signed-out and unrelated users could not enumerate the tested financial/member/market tables. Protected owner logs, administrative summaries, correction controls, publication, settlement, and service-only email RPCs denied unauthorized calls.
- Ordinary members could not change commissioner rules, review members, promote themselves, or directly patch a wallet balance.
- Unverified account sign-in was rejected.
- Negative/zero/excessive/fraction-cent stakes; empty, duplicate, excessive, unknown, and stale selections were rejected by the tested backend paths.
- Same-request ticket retries returned the existing ticket. Altered retries and stale revisions were rejected. These positive placement tests were rolled back.
- Credit claims respected the tested balance-plus-open-stakes threshold, cooldown, 2-hour/24-hour amounts, and request replay protection. One isolated audit wallet claim was committed for the real HTTP test and subsequently removed with the entire audit wallet.
- Malformed/spoofed push endpoints and keys were rejected in the tested cases.
- Display-name markup was escaped in the tested React rendering path; no script execution was observed. This is not a comprehensive XSS proof for every template and input.
- Commissioner reward/futures/feed validation and required confirmation checks worked on the isolated backend. Info popovers opened and dismissed in the tested UI paths.
- The unchanged-board response was only 1,054 bytes. The revision/freshness path is working; it is not repeatedly returning the full quote snapshot when unchanged.

## Storage and performance observations

Development occupied about **28.6 MB** during the final health sample. That is not evidence of disk capacity exhaustion. The five highest dead-row estimates were small (42 or fewer). All 122 cron job records in the sampled two-hour window reported `succeeded`; that only confirms the recorded cron invocations, not every downstream provider operation.

The clear measured efficiency opportunity is the large initial/full book response and unpaginated history. Preserve the working lightweight refresh path while improving those reads. Supabase advisor index suggestions require query-plan and usage review; adding every suggested index would add write/storage cost without proving benefit.

This audit did not measure the current daily Disk IO allowance or run a sustained load test, so it cannot conclude that a previous IO warning is resolved solely from database size or successful cron statuses.

## Cleanup and evidence

Five temporary accounts, their sessions/refresh tokens, the temporary owner grant, isolated league/teams/settings, test links, and test wallets/claim were removed. Original wallet balances matched their pre-audit digest. Final counts returned to **1 Auth user, 14 memberships, 0 co-manager links, 91 tickets, 261 legs, and 2 outbox records**. No real ticket or original balance changed. Temporary local credentials and session files were removed.

Detailed scripts, sanitized results, and screenshots are retained under [the audit evidence folder](C:/Users/coope/Documents/Codex/2026-10-28/co/work/fantasy-sportsbook/work/site-audit-2026-11-17). The initial broad harness included file-encoding failures and heading-only checks that misclassified expected denials; those are not counted as product defects. Later targeted results and the findings above supersede them.

Recommended implementation order: **AUD-01 and AUD-06 → AUD-02/AUD-03/AUD-04/AUD-05 → AUD-07/AUD-08 → AUD-09 and remaining completion/hardening work.** Re-run the relevant hosted tests after each fix rather than treating the current report as post-fix sign-off.
