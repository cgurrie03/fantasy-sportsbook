# Image Promos and One-Use Profit Boosts

Read [shared context](PROJECT-CONTEXT.md). This expands and supersedes the earlier `docs/promos-boosts-handoff.md`. Status: implemented and tested; user explicitly authorized production deployment October 9. Latest decisions and release notes below supersede the original recommendations.

## Home Placement and Two Offer Types

On **Home > Matchups**, place three image-backed offer boxes immediately below the betting-category menu and above matchup lines. Desktop: equal-height three-card row. Mobile: readable stack or accessible carousel with visible navigation, consistent image aspect ratio and no essential text available only inside the image. Preview both themes and long titles.

Admins associate each image with one of these types:

1. **Fixed Ticket Promo.** A predefined list of selections with advertised terms fills a dedicated bet slip. The user cannot add/remove legs or edit lines. Wager remains editable unless the administrator defines a fixed stake. Show “Fixed Promo Ticket,” all legs, expiry and payout. If another slip already contains picks, confirm replacement; do not silently erase it.
2. **Claimable One-Use Profit Boost.** The image advertises an offer that a user claims, optionally with a code. Eligibility is evaluated as the user builds an ordinary slip. When qualified, show a concise offer message and an on/off toggle. Preview original odds, boosted effective odds, stake, original profit, extra profit and total payout. Claiming does not consume the boost; successful ticket acceptance does.

Both types disappear Thursday **8 PM America/New_York**, enforced by the server as well as UI. Do not carry stale offers into the next week. New images/offers are supplied in the admin area for the next week. Existing tickets and redemption history remain visible after expiration.

Show the eligibility prompt once per relevant slip/offer transition, with an unobtrusive eligible-offer control after dismissal; do not repeatedly interrupt every pick. Scope a one-use entitlement to league + user + offer so changing teams, browser tabs or devices cannot multiply uses. Claimable does not imply consumed, and applying the toggle remains a choice until acceptance.

## Admin Workflow

Create a dedicated Promos & Boosts page rather than routing back to general line management. Workflow: select week and type → upload/select image → enter accessible title/description → configure ticket or choose boost criteria → set percentage/limits → preview desktop/mobile → save draft → activate/schedule → see status and usage. Three home slots are assigned deliberately; drafts are never public.

Use an allowlisted dropdown of criteria instead of arbitrary formulas or executable text. Initial choices:

- At least N Player Points selections; the user's example is N=5 with a 50% profit boost.
- Exactly N Player Points selections.
- At least N distinct-matchup spread selections.
- A qualifying standard parlay with N or more compatible legs.
- A designated featured matchup or approved market category.

Enforce existing compatibility rules after applying criteria. A criterion cannot enable an otherwise forbidden ticket. Store market-family allowlists, minimum/exact leg count, minimum odds if needed, expiry, stake/profit cap, per-user usage limit, eligible league users, and stacking policy. V1 recommends one claimed boost per ticket and no stacking with featured boosts, fixed-ticket promos or teasers. Make restrictions visible before users claim.

For an advertised code, scope uniqueness to the league/offer and limit claim attempts. A user may claim via the image without typing a code. Track draft, scheduled, active, expired, disabled and exhausted states with audit history. Admin edits affect future quotes only. Image storage must be league-scoped; validate type/size, use safe image formats, and never render uploaded executable HTML/SVG as trusted markup.

## Correct Profit Math

For a $10 stake, base decimal odds 3.00, and a 50% profit boost:

- Base profit: `$10 × (3.00 − 1) = $20`.
- Boosted profit: `$20 × 1.50 = $30`.
- Total payout: `$10 + $30 = $40`.
- Effective decimal odds: `1 + (3.00 − 1) × 1.50 = 4.00`.
- American odds therefore change from +200 to +300.

Do not boost returned stake or multiply American odds directly. Store monetary values in the existing precise currency representation and distinguish display rounding from contractual payout. Caps must show a truthful payout preview. Resolve how published odds increments apply to a capped promotional effective price; do not round a displayed contractual price independently of payout.

## Atomic Redemption and Acceptance

Within one server/database transaction, validate membership, offer availability, claim ownership, eligibility, expiry, quote revision, wallet balance, ticket compatibility and caps. Accept ticket, debit wallet, snapshot offer/pricing terms, and consume redemption once. Concurrent tabs cannot redeem twice. Request retries return the same ticket and cannot debit or consume a second time. A rejected/stale ticket does not consume the offer.

Fixed tickets store an immutable offer composition and pricing version. Scheduled line changes must not silently modify advertised selections/price. If an underlying leg becomes invalid or resolved, suspend that offer and explain the reason; creating a new advertised version is an explicit admin action. A fixed promo linked to expired pregame quotes must not bypass live freshness controls.

Preserve original boost terms through settlement. Define how pushed/voided legs affect eligibility and capped payout before launch. Recommended baseline: evaluate eligibility at acceptance, then reprice the remaining valid ticket using saved rules; a later push should not arbitrarily erase a promised boost. Confirm whether a full admin void restores a one-use entitlement; any restoration must also be idempotent. Do not assume this decision from ordinary stake-refund behavior.

## Delivery and Reporting

Optional opening-email promo content reads only active offers from the successfully published board. No new mass email is sent merely for changing an image or refreshing odds. Track claims, redemptions, expiry, incremental profit liability, void/refund restoration and offer performance per league. Avoid exposing private balances in public promotion reporting.

## Acceptance Gates

Test eligibility appearing/disappearing as picks change, exact versus minimum counts, contradictory props, five props across distinct players, empty/busy slip replacement, toggle price preview, expired/code-disabled offers, manual pause, stale quotes, two-tab redemption races, retries, full refund and partial pushes, image isolation, non-admin access, and Thursday expiry through DST. Verify mobile slip still shows legs and wager controls. Do not enable ordinary profit boosts until redemption and settlement checks pass.

Recommended installed skills: Frontend Design, React Best Practices, Supabase Postgres Best Practices, React Email. Add Webapp Testing for complete claim-to-ticket regression journeys.

## October 9 review phase — user decisions supersede recommendations above

User requested many clarifying questions and previews, with **no deployment until explicit approval**. A standalone interactive review package is saved at `C:/Users/coope/Documents/Codex/2026-10-09/build-the-dedicated-promos-boosts-administration/outputs/`: `promos-preview.html`, `implementation-plan.md`, four viewport/theme journeys in `preview-checks.json`, and Home/Admin/fixed-slip/boost-slip PNGs. This is a prototype, not production feature integration.

Confirmed: at least five distinct players, all legs Player Points; $20 maximum wager with no extra-profit cap; one boost per ticket, no stacking with featured/fixed/teaser offers; acceptance-time eligibility preserved after partial pushes; full admin void restores boost once without extending expiry; full push refunds but never restores its boost. League admins manage offers, every active member eligible by default. Wednesday successful publication activates newly supplied offers; Thursday 8 PM Eastern ends visibility and redemption. Mobile accessible carousel; one/two offers expand rather than requiring three.

Fixed promos map to existing markets with manual advertised line/odds overrides and one acceptance per user/offer. **User explicitly chose to keep these independent of ordinary quote suspension, available until Thursday 8 PM cutoff**, superseding the earlier suspension recommendation. Do not silently reinterpret that choice. Ordinary market compatibility, ticket snapshots, refunds and email behavior remain protected; the implementation plan calls for an explicit separate fixed acceptance path. Fixed-promo usage restoration after full void still needs confirmation.

PNG/JPG/WebP up to 5 MB, landscape crop/focal point and readable external terms approved. Server image-content validation, private league-scoped storage and cropping are planned, not implemented. Emails remain unchanged for first release.

Tests completed: standalone headless Chromium at 1440x1000 and 390x844, both themes; equal desktop cards, accessible carousel controls, no page overflow, long titles, claim/toggle presentation, 3.00 decimal/$10/50% profit calculation, eligibility transitions, $20 maximum, replacement confirmation/cancel, locked-leg UI, expiry, slot counts and draft feedback. No external requests, live bets or email. This is not evidence of atomic redemption, league isolation, database expiry, refund or two-tab concurrency. Webapp Testing skill exists; Python Playwright unavailable, used repository Node Playwright and existing Chromium.

Files changed in production checkout: this handoff only. No migrations written/applied, no app integration, no commit/push/deployment. Checkout HEAD `bbfbe07`; remote verification failed due to name resolution. Latest Git/Vercel source must be reverified before integration. User-facing preview and plan capture proposed files, transaction/settlement design, test gates, pending exact effective-odds display and artwork decisions. Rollback: remove review files/this appended section; no runtime state changed.

### Subsequent design revisions — current user instructions

Extra-profit caps will **never** exist: exclude the setting and logic entirely, remove cap-related public wording. The previously confirmed $20 maximum wager remains. Admin now chooses expiry/disappearance date and time in Eastern time; this supersedes the fixed Thursday cutoff. Public offer wording is “Claim by” the chosen deadline. Current preview uses a single expiry for both visibility and new claims/use, with accepted-ticket history retained.

Mobile carousel now uses dots (three for three offers), with the active dot darkest, instead of numeric position. Gold buttons say only “Claim” and overlay the bottom right of the image. Public cards omit “one-use profit boost”/“fixed promo ticket” labels. Admin retains a type selector for configuration. User likes the admin direction; this is not deployment authorization.

Updated standalone preview and implementation plan; reran all four browser journeys in both themes at desktop/mobile dimensions. Added checks for active dots, image-overlay Claim buttons, absent public type/cap labels, and admin-selected expiry updating “Claim by” copy. Production feature integration, schema work and deployment remain pending; no bets or emails.

## October 9 approved production release

The user explicitly said “okay lets deploy.” Implemented the dedicated league-admin page, private validated raster images, drafts/scheduling/disable/history/liability, equal Home cards and accessible mobile dots, immutable fixed slips and opt-in claimed boosts. Admin-selected Eastern expiry governs disappearance and redemption. No extra-profit-cap setting or pricing branch exists. Image claims support an optional advertised code; there is no typed-code redemption endpoint. Emails use the existing acceptance outbox and unchanged templates.

Migration `202610090033_promotions.sql` applied to production successfully. Postflight: 47 existing tickets, 28 OPEN, zero offers and zero promo tickets; all five new tables have RLS; anonymous promo RPC access and client image-storage RPC access are denied. No sample offers, real bets or bulk emails were created. Admins must supply their actual images and terms. Successful weekly publication activates matching scheduled offers; scheduling on an already-published matching board also activates when its opening time permits.

Acceptance locks the wallet then offer/claim, keeps precise profit math, records immutable promotion terms, and atomically consumes use. Retry checks distinguish fixed/boost/ordinary tickets. Expiry uses wall-clock time after lock acquisition. A hosted isolated-schema race accepted one ticket, rejected the competitor, debited once and retained balance $990 from $1,000; production stayed at 47 tickets. Test schemas are unexposed and their schema access was revoked from anon/authenticated after testing; their fixture mail queues are separate from production.

Verified PGlite authorization, minimum/exact eligibility, stale rejection, $20 limit, payout math, retries, partial pushes, full pushes, full-void restoration, fixed overrides through suspension/refresh, one-use protection, immutable snapshots and expiry. Integrated browser journeys cover desktop/mobile both themes, image-overlay claims, dots, eligibility transitions, replacement, fixed immutability, fixture acceptance, league switch, image upload validation and draft/schedule. Existing browser regression covers six widths, account/dialog/revised quotes, futures/specials, league roles, history, CSV/PNG/PDF exports and load/error states. Build/API checks, weekly execution, futures and isolation pass. Lint has advisory warnings, no errors. Screenshot evidence is in the chat outputs/integrated directory; final deployment evidence is in outputs/release-evidence.md.

Full admin void restores a boost once with its original expiry; a fully pushed ticket refunds but never restores. Fixed tickets remain consumed after an admin void (conservative default; user has not requested fixed-offer reuse). Manual fixed offers remain independent of ordinary quote suspension/start until their selected expiry, as explicitly instructed. Ordinary ticket gates remain intact. Disable an offer to stop new use. Do not drop promo audit tables or revert settlement handling after accepting promoted tickets: those snapshots must remain settleable and refundable.
