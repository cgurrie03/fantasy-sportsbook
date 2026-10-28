# Promos & Boosts — current development handoff

Updated October 9, 2026. Read `docs/handoffs/PROJECT-CONTEXT.md` first. This document supersedes `docs/promos-boosts-handoff.md` and the earlier prototype-only promo handoff. The runtime feature and category-picker follow-up are **deployed**. The sections below distinguish deployed capabilities, completed validation and work that remains unimplemented or unverified.

## Deployment and verification boundary

| Item | Recorded status |
| --- | --- |
| Production | https://sportsbook.coopergurrie.com |
| Latest verified application commit | `c31910ee414819be0d23b28e7cd542a54c1a2b19` — active quotes only, opposing choices grouped by matchup, corrected team/match total labels |
| Latest Vercel deployment | https://vercel.com/cooper-gurrie-projects/fantasy-sportsbook/ADAtajvvhWvFoHyqN7kY6KEUhuS8 — Ready / Latest / Production / Current, 28-second build |
| Core promo release | `e49f83d80a5d421df8e2aaa735951bc28003c830`; Vercel https://vercel.com/cooper-gurrie-projects/fantasy-sportsbook/9pYPDZbfMkBqpWjuy3YhUjdgvHti |
| Database | `202610090033_promotions.sql` applied successfully through the authenticated Supabase SQL editor |
| Live smoke verification | October 9, 20:26:38 UTC: homepage 200; seven application/admin/promo/report assets byte-matched the isolated tested build; unsigned weekly-worker, generate-markets, place-bet and promo-image requests returned 401 |
| Migration postflight snapshot | 47 existing tickets, 28 OPEN; zero offers and zero promoted tickets; five new tables had RLS; anonymous promo RPC access and direct authenticated image-storage RPC access denied |

The postflight counts describe the deployment check, not a continuously refreshed census. The administrator may have added offers since then. No sample offers, authenticated production bets or bulk test emails were created by this task. The user explicitly approved deployment with “okay lets deploy.” Documentation-only updates do not themselves change runtime configuration or prove a newer application release. Reverify the latest source before future deployment.

## Deployed and functional

### Home and claiming

- On **Home → Matchups**, offers sit below market categories and above matchup lines. One, two or three desktop cards share available width. Mobile uses an accessible swipe carousel with one dot per actual offer; the active dot is darkest.
- Gold buttons say **Claim** and overlay the image's bottom right. Readable titles and terms remain outside images. Public cards omit the “one-use profit boost” and “fixed promo ticket” type labels. Public expiry copy is **Claim by**.
- League members can claim a boost without consuming it. An eligible ordinary slip shows an opt-in toggle and original odds, boosted effective odds, original/extra profit and total payout. A lost qualification, expired offer or detected use in another tab blocks the selected boost instead of silently accepting an ordinary ticket.
- Offer refresh uses polling and a cross-tab notification. Server acceptance is authoritative; client freshness is not the concurrency guarantee.

### Dedicated administration

- **Admin → Promos & Boosts** is a dedicated, separately loaded page for administrators of the selected league. It supports drafts, week and Home-slot assignment, image upload/crop, title/readable terms, fixed or boost configuration, desktop/mobile preview, scheduling, disabling, usage totals and recent audit history.
- Fixed selection entry is **category → selection**, with **category → matchup → selection** for Player Points. Category groups are **Matchups → Player Projections → Weekly Specials**. Matchup categories are ordered **Moneyline, Spread, Match Total, Team Total**. Only active current quotes appear. Matchup categories use matchup headings and keep opposing choices adjacent: home then away, or Over then Under. Team totals name the team; match totals name both teams and show the line. All options include American odds in parentheses. Moneyline labels show team name vs. opponent with no “Win” prefix. Category/matchup/week/draft changes clear the pending choice; added selections are excluded and empty categories cannot add a selection. Latest refinements are deployed in `c31910e`.
- The duplicate/incorrect-total incident came from fetching inactive historical quotes alongside active quotes. Read-only production inspection confirmed 12 inactive and 12 active Moneylines, 24 inactive and 24 active team totals, and 12 inactive and 12 active match totals for the current board. Historical rows remain for snapshots; the picker now filters `active=true` in its query and defensively in its option lists. No market generation, saved offer, acceptance or settlement rules changed.
- Boost criteria are allowlisted: minimum/exact Player Points count, distinct-matchup spreads, compatible standard parlay, approved category or designated matchup. Admins can set percentage, count, maximum wager and an optional advertised code. There is **no extra-profit-cap field or pricing branch**.
- Usage includes claims, redemptions, extra profit paid, open bonus liability and recent events. It is league-admin reporting, not a public balance report.
- PNG/JPG/WebP inputs up to 5 MB are cropped/re-encoded to a 1200×522 raster PNG with focal-position controls. The server independently validates base64, signature, chunk CRCs, dimensions, metadata, decompressed scanline layout and trailing content. Private image payloads are stored in the league-scoped database, not a public Storage bucket. Rendering uses authorized image RPCs/data URLs.

### Scheduling and expiry — exact current behavior

**Schedule offer has no second menu and no separate appearance-date picker.** During the selected week, an offer becomes visible once its weekly board has been successfully published and its opening time has passed. Scheduling against an already-open, published current-week board makes it available immediately. Otherwise, it waits for the matching publication/opening. The existing Wednesday publication flow supplies that event; the promo feature does not add another scheduler. There is no automatic reuse of last week's offers.

The admin chooses **Expires and disappears (Eastern)**. That time ends visibility, new claims and redemption, while accepted-ticket history remains. This explicitly supersedes the original universal Thursday 8 PM deadline. Eastern conversion accounts for DST and rejects ambiguous/nonexistent clock-change times. Published terms cannot be silently edited; disable an offer and create a new one for changed advertised terms.

### Fixed tickets and atomic boosts

- Fixed promos map to existing markets, with manual advertised line/odds overrides frozen into the offer and accepted ticket. Users cannot add/remove legs or edit selections/lines. Wager is editable unless explicitly fixed. Replacing a nonempty slip requires confirmation. One acceptance per user per offer.
- **User-directed exception:** manual fixed offers remain independent of ordinary quote suspension/start until their configured expiry. Do not reintroduce a suspension/start cutoff into this path without a new product decision. Ordinary tickets retain existing compatibility, revision, freshness and availability gates. Fixed tickets still require league/week mappings, compatible composition, valid prices/stake and sufficient wallet balance.
- Acceptance takes wallet/offer/claim locks, validates the applicable rules, snapshots terms, creates the ticket and ledger debit, queues the existing confirmation message and consumes use atomically. Retries return the original ticket; fixed/boost/ordinary request identity cannot be interchanged. Offer availability uses server wall-clock expiry rather than transaction-start `now()`.
- Profit pricing is `1 + (baseDecimal − 1) × (1 + boostPercent / 100)`. Returned stake is never boosted; American odds are never multiplied directly. Decimal/payout calculations are contractual; boosted American odds are approximate display values.
- The confirmed example is **50%, at least five selections, all Player Points, distinct players, maximum $20 wager**. The maximum is a wager limit; extra profit is permanently uncapped. Larger boosted wagers are rejected.
- One claimed boost per ticket; no stacking with featured boosts, fixed offers, teasers or futures. Eligibility is evaluated at acceptance and preserved through partial pushes; remaining winning legs are repriced with saved boost terms. A fully pushed ticket refunds stake but **never** restores its boost. A full admin void refunds and restores the boost once, without extending expiry. Fixed-offer use remains consumed after a full void.
- Existing ticket snapshots, refund behavior and email templates/delivery flow are retained. Changing offers does not send a new bulk email.

## Completed tests and what they establish

| Check | Completed evidence and limits |
| --- | --- |
| Build / API runtime | `npm run build`: TypeScript, compiled API imports/auth checks, unchanged opening/confirmation mail behavior and Vite build passed. |
| Lint | `npm run lint`: no errors; eight advisory warnings remain, including state-in-effect warnings. Vite retains its large-main-bundle advisory; PromoAdmin is separately loaded. |
| Promo database | `npm run test:promos`: PGlite applied migrations and tested admin/member/image isolation, min/exact counts, repeated claims without consumption, $20 maximum, stale rollback, profit math, retries, ordinary/promo request separation, partial/full pushes, void/restoration retries, fixed frozen overrides through suspension/refresh, one use, immutable snapshots and expiry. These are isolated fixtures, not production member bets. |
| Hosted Postgres race | Two independent transactions against isolated hosted test schemas competed for one boost: one ticket accepted, competitor rejected, one wager debit, balance $990 from $1,000. Retry returned the same ticket; production ticket count stayed 47. This validates the core acceptance lock/redemption path, not a real member transaction. |
| Integrated promo UI | `npm run test:promos:ux`: 390×900 and 1440×900, both themes; placement/dots/image Claim, claim/toggle, qualification transitions, payout/wager limit, replacement cancel/confirm, fixed immutability, intercepted acceptance, league switching, draft/schedule and actual canvas output passed through the server PNG validator; damaged CRC and appended content rejected. All network writes intercepted. |
| Picker follow-up | Latest integrated run additionally checks active-only query and defensive exclusion of inactive fixtures, opposing Moneyline adjacency, two match-total groups with Over/Under adjacency and matchup names, current team totals with proper labels, Moneyline-first category order, signed parenthesized odds, Player Points matchup groups, resets, duplicate exclusion, empty category disabling and no overflow in both viewports/themes. Build/lint and all four integrated promo journeys passed. The release was built/tested in an isolated archive copy to exclude concurrent unfinished teaser work in the shared checkout. |
| Existing UI regression | `npm run test:ux`: six widths (360/390/430/768/1024/1440), both themes; long names/balance, dialogs, reduced-height keyboard-space approximation, revised-price approval, fixture ticket/history, futures/specials, league roles, CSV/PNG/PDF exports and loading/empty/suspended/error retry passed. Downloads required Chromium outside the download-restricted sandbox. Report implementation was preserved. |
| Existing transaction checks | Weekly execution, futures and league isolation suites passed for the core release. The picker-only follow-up did not change database/settlement code; build/lint and the integrated promo journeys were rerun for it. |
| Production smoke | Latest commit/alias verified in Vercel; live assets matched tested files and four protected endpoints returned 401 without authentication. No authenticated production acceptance, image upload or settlement was exercised. |

Webapp Testing is installed. Its Python Playwright package was unavailable in this environment, so the repository's Node Playwright and installed Chromium were used. This is a browser-emulation check, not physical iOS/Android testing or a complete screen-reader audit. The hosted database race is separate evidence from the browser fixture journeys; the browser suite does not itself create a real simultaneous-tab database race.

## Remaining issues, decisions and work not implemented

- **Operational setup:** admins must supply actual artwork, readable terms and offers. Fixture previews are not automatically published examples. Production smoke did not test an authenticated member bet or send a confirmation email.
- **Fixed full-void reuse:** current conservative behavior keeps the offer consumed. The user confirmed restoration for boosts but has not requested reuse for fixed offers. Any change needs an explicit decision and idempotency tests.
- **Separate start-time picker:** not implemented or requested as a confirmed change. The user asked how Schedule offer works and was told the current publication/opening behavior. Do not describe a separate scheduling menu as deployed.
- **Advertised codes:** the optional code is stored metadata; image Claim is the entry point. There is no typed-code redemption endpoint, code uniqueness/rate-limited attempt workflow, or automatic code text on the public card. Put advertised codes in supplied artwork/readable terms if desired. A code-entry feature would be additional work.
- **Email promotion content:** deliberately deferred by the user. Existing opening/confirmation templates remain; no offer section or new bulk notification workflow was added.
- **Other optional extensions:** selected-member targeting, minimum-odds eligibility, an image-library browser, advanced performance charts and editable/new-version cloning UI are not implemented. Do not infer these from the original general specification. A changed active offer currently requires disabling it and creating a new offer.
- **Validation gaps:** physical-device behavior, comprehensive accessibility audit and an authenticated production administrator/member journey remain unobserved. Do not place a real user bet or send bulk test emails to close these gaps. Lint/bundle advisories remain. Promo UI polling is not instantaneous across devices; the server still prevents duplicate use/expired acceptance.
- **Minor UI/maintenance debt:** admin status timestamps refresh when the page is loaded/reloaded rather than continuously ticking; image-load failures show an artwork placeholder; success and error notices share styling. These do not establish a transaction failure but can be improved separately.
- **Unrelated project boundaries:** this feature does not enable ordinary live betting, owner-only onboarding, a second live league, teasers or automatic model promotion. Their handoffs retain their own launch gates.

No unresolved decision blocks the shipped promo version; the items above are operating steps, conservative defaults, optional additions or validation gaps, not claims of completed future work.

## Files, commands and safe next steps

Checkout: `C:/Users/coope/Documents/Codex/2026-10-05/i/fantasy-sportsbook`; local branch `stage-1-accounts`, production `main`. Existing Git push → Vercel flow was used. Supabase project: `bmvjcdgxwxqalaohpsnw`. Migration 033 is already applied; use a new migration number for future SQL and do not rerun this create-table migration on production.

- UI: `src/components/PromoAdmin.tsx`, `OfferCards.tsx`, `Promotions.css`, `AdminHub.tsx`, `Sportsbook.tsx`.
- Client rules/pricing/API selection: `src/lib/promotions.ts`, `src/lib/markets.ts`.
- Server: `api/promo-image.ts`, `api/_lib/promo-image.ts`, `api/place-bet.ts`.
- Database: `supabase/migrations/202610090033_promotions.sql`; tables `promo_images`, `promo_offers`, `promo_claims`, `ticket_promotions`, `promo_events`; public save/pause/list/image/claim/usage/fixed/boost RPCs and private availability/activation/eligibility/restoration functions.
- Tests: `scripts/test-promotions.mjs`, `scripts/test-promos-ux.cjs`, `scripts/test-ux.cjs`, `scripts/test-api-runtime.mjs`. Run build before UI scripts because they serve the compiled `dist` fixtures. Set `PLAYWRIGHT_BROWSERS_PATH=C:/Users/coope/AppData/Local/ms-playwright` on this machine; optional `PROMO_UX_OUTPUT` / `UX_OUTPUT` choose evidence destinations.
- Skills used: Frontend Design, React Best Practices, Supabase Postgres Best Practices and Webapp Testing. React Email is required if a later task changes email templates; no templates changed here. Load Supabase practices before any future SQL/schema/RLS work.

Hosted test schemas `promos_test`, `promos_test_private`, `promos_test_auth` remain as isolated fixtures. They are not exposed in PostgREST; schema access was revoked from anon/authenticated. Their mail queues are separate from live worker tables. Do not run workers against them, mistake them for live tables, or assume they were deleted.

The checkout has unrelated pre-existing changes/untracked files (other handoffs/context, data and work scripts). Inspect `git status`; preserve them and stage only intended task changes. The documentation cleanup that creates this handoff is a local documentation update, not another runtime deployment.

For rollback/pause, disable offers to stop new use. Once promoted tickets exist, keep their snapshots/audit data and promo-aware settlement/refund functions. Dropping promo tables or reverting settlement handling can strand accepted tickets. A frontend rollback alone is not evidence that already-accepted promotions will settle correctly.

## Evidence location

All user-facing artifacts for this chat are under `C:/Users/coope/Documents/Codex/2026-10-09/build-the-dedicated-promos-boosts-administration/outputs/`:

- `active-quotes-picker/production-verification.json`, `deployment-ready.png`, `integrated-checks.json` and screenshots: latest `c31910e` release proof and fixture journeys. The isolated source/build copy is in `work/active-quotes-release`; it reuses installed dependencies but omits unrelated uncommitted teaser changes.
- `matchup-picker/`: previous `1a4c692` release proof and fixture journeys; isolated build in `work/matchup-release`.
- `categorized-picker/`: previous `84d9ce6` category-picker release proof and fixture journeys.
- `production-migration.png`, `production-postflight.png`, `hosted-race.png`: database/race evidence.
- `integrated/` and `regression/`: core promo and existing regression screenshots/measurements/fixture exports.
- `release-evidence.md`: core release record; `active-quotes-picker/` is the latest picker release evidence.
- `promos-preview.html`, `preview-checks.json` and `implementation-plan.md`: historical standalone review prototype/plan. **These are not the deployed app and must not be used as proof of database behavior.** Current source and the deployed/tested records above take precedence.
