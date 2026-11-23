---
name: boff
description: Forest & Ivory visual frontend with restrained editorial headings and aligned markets.
colors:
  canvas: "#f7f8f5"
  surface: "#fff"
  raised: "#f0f3ee"
  text: "#173d32"
  body: "#273e34"
  muted: "#637469"
  line: "#e0e6df"
  green: "#173d32"
  sage: "#dce8db"
  sage-ink: "#173d32"
  gold: "#e5c78d"
  gold-ink: "#58401b"
  red: "#a23e34"
  boost-price: "#8a5a13"
  rival-field-border: "#798b7e"
  dark-rival-field-border: "#789487"
  focus: "#a06d20"
  rail: "#173d32"
  rail-text: "#d7e2d8"
  dark-canvas: "#102b24"
  dark-surface: "#17392f"
  dark-raised: "#214438"
  dark-text: "#f1f4ee"
  dark-body: "#e2e9df"
  dark-muted: "#b2c4b7"
  dark-line: "#345046"
  dark-green: "#e0ebda"
  dark-sage: "#dce8db"
  dark-sage-ink: "#173d32"
  dark-gold: "#e5c78d"
  dark-gold-ink: "#302710"
  dark-red: "#f4a295"
  dark-focus: "#e5c78d"
  dark-rail: "#0d251e"
  dark-rail-text: "#c5d5c9"
  selected-border: "#a7bfa5"
typography:
  headline:
    fontFamily: "Newsreader, Georgia, serif"
    fontSize: "34px"
    fontWeight: 500
    lineHeight: 1.12
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Newsreader, Georgia, serif"
    fontSize: "28px"
    fontWeight: 500
    lineHeight: 1.12
    letterSpacing: "-0.025em"
  body:
    fontFamily: "Public Sans, sans-serif"
    fontSize: "14px"
    lineHeight: 1.5
  label:
    fontFamily: "Public Sans, sans-serif"
    fontSize: "13px"
    fontWeight: 500
  odds:
    fontFamily: "Public Sans, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.4
rounded:
  badge: "5px"
  control: "6px"
  field: "7px"
  panel: "10px"
  offer: "12px"
  dialog: "13px"
spacing:
  compact: "7px"
  control-gap: "10px"
  row: "17px"
  panel: "23px"
  workspace-gap: "30px"
  workspace: "34px"
components:
  button-primary:
    backgroundColor: "{colors.green}"
    textColor: "{colors.canvas}"
    rounded: "{rounded.control}"
    padding: "11px 17px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "11px 17px"
  field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.field}"
    padding: "10px 12px"
  filter-chip:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.badge}"
    padding: "8px 12px"
  odds-selected:
    backgroundColor: "{colors.sage}"
    textColor: "{colors.sage-ink}"
    rounded: "{rounded.control}"
    padding: "5px 10px"
  panel:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.panel}"
---

# Design System: boff

## Overview

**Creative North Star: "Forest & Ivory"**

Forest & Ivory pairs a quiet off-white canvas and white panels with a persistent forest identity. Restrained Newsreader headings give league content an editorial character; Public Sans carries navigation, market labels, prices, and forms.

The identity is lowercase boff with the provisional serif B monogram. Market rows favor aligned prices, real team names, and compact borders. This records the visual frontend as implemented; desktop review precedes later owner mobile iteration.

**Key Characteristics:**
- Forest rail and off-white canvas.
- Newsreader headings with Public Sans operations.
- Sage selection plus a checkmark.
- Flat bordered panels and contextual overlays.

## Colors

### Primary
Forest identity appears in the rail, light-theme text, and primary actions. Sage and sage ink mark selected odds and positive badges. The frontmatter's unprefixed tokens describe light mode; `dark-` tokens are the corresponding overrides under `data-theme=dark`. Sage selection retains its light fill and forest ink in dark mode.

### Secondary
Brass highlights offers, offer badges, navigation counts, and selected rail icons. Red marks warning or result states; the focus color provides a distinct keyboard outline.

### Neutral
Canvas sits behind surface panels; raised provides quieter inset and hover areas. Body, muted, and line distinguish content, supporting text, and hairline separation. Dark mode uses deeper green canvas and rail surfaces with light text and softened green borders.

**The Selection Rule.** Use sage with forest ink and a checkmark for selected prices, preserving the selection cue in both themes.

## Typography

**Display Font:** Newsreader, Georgia, serif. Locally served variable font, weights 400–600.
**Body Font:** Public Sans, sans-serif. Locally served variable font, weights 400–700.

### Hierarchy
- **Headline:** page headings use the headline token; at narrower desktop widths they reduce to 33px.
- **Title:** standard section headings use the title token. Slip titles instead use Public Sans at 15px and weight 600.
- **Body:** the root body token sets the base; most operational content uses 11–13px. Page descriptions use 13px on desktop.
- **Label:** labels use the label token; metadata commonly uses 10px. Tabs and team names use 13px on desktop.
- **Odds:** desktop price emphasis uses the odds token; market descriptors use 11px. Numeric fields and prices use tabular numerals.
- **Wordmark:** Newsreader, weight 500, line-height 1, tracking -0.04em; the main header uses 36px.

**The Operational Type Rule.** Use Public Sans for prices, navigation, labels, and controls; reserve Newsreader for editorial headings and the wordmark.

## Layout

The desktop shell has a 28px preview strip and an 82px sticky header. A fixed 210px left rail begins below them. The workspace offsets by the rail width, has 34px horizontal padding and a 30px gap, and caps at 1900px. Screens that use a slip add a 282px right column; the slip is sticky at 133px from the top. Market rows align a flexible team column with three price columns.

At 1600px and above the slip grows to 310px and the workspace uses 46px horizontal padding. At 1250px and below the rail reduces to 184px, workspace padding to 24px, and slip to 250px. At 1060px and below the right slip becomes a fixed compact handle. At 760px and below the rail disappears, a four-item bottom navigation appears, and each team spans a row above three labeled prices. At 390px and below the header and search compact further. These mobile rules exist in code; owner mobile review remains pending.

Spacing is role-based rather than a complete mathematical scale. Preserve compact control gaps and larger panel/workspace separation. Form inputs reach 44px minimum height; mobile buttons do too.

## Elevation & Depth

Depth comes primarily from tonal surfaces and one-pixel borders. Dropdowns and toast feedback use the shared ambient shadow; dialogs use a stronger diffuse shadow and dark translucent backdrop. No hard offset shadows occur.

**The Flat Panel Rule.** Keep market and form panels flat; use shadows for floating menus, dialogs, and feedback.

## Shapes

Small rounded rectangles define badges, prices, and fields. Panels use the panel radius, offers and dropdowns the offer radius, and dialogs the dialog radius. Profile and team avatars are circular. Thin borders organize dense content without enclosing each text item.

## Components

### Buttons
Primary actions use green over canvas text; secondary actions use surface with a line border. Standard padding is recorded in frontmatter, with a 42px desktop minimum height. Primary hover increases brightness to 1.13; secondary hover uses raised. Disabled buttons have half opacity and a disabled cursor. Pressing enabled buttons shifts them down 1px. Keyboard focus is a 3px focus-color outline offset 3px. State colors transition over 0.16s; reduced motion disables transitions and animation.

### Chips
Filter chips use a line border and surface fill; active chips use sage, sage ink, and the selected-border token. Status badges are compact, with neutral raised, sage positive, brass offer, and outlined red variants.

### Cards / Containers
Market and general panels use surface, a one-pixel line border, and panel rounding without shadows. Market panels have 16px 17px 0 padding at standard desktop width; content panels commonly use 23–27px padding. Offer cards use larger corners and editorial headings, including a forest-filled featured variant.

### Inputs / Fields
Fields use surface fill, a line border, field rounding, and the padding in frontmatter. Search is a compact icon-and-input wrapper. Fields share visible focus treatment; placeholders use muted. Toggle rows use a real checkbox over a custom pill, with a white thumb and a translated checked state; keyboard focus is also drawn on the pill.

### Navigation
Rail links pair outline SVG icons with Public Sans labels. Hover and active states add translucent white fills; active icons receive brass. Tabs use a two-pixel underline. The bottom navigation replaces the rail on mobile, while horizontal tab lists can scroll.

### Market prices and contextual slip
Price buttons stack a descriptor and emphasized price. Hover changes the border and raised fill; selected prices use sage and a small checkmark at the top right. Desktop controls reach 47px minimum height. The contextual slip has a bordered title row, independently scrollable selections capped at 40vh, stake controls, and an empty guide. On mobile, market type is repeated above each price and the slip opens from its bottom handle.

### Dialogs and feedback
Dialogs use native modal dialog behavior, restore prior focus when unmounted, close on Escape or backdrop click, and contain their own scrolling. Toasts sit above content; their bottom offset increases on mobile to clear navigation. Icons are inline outline SVGs with rounded ends and joins, normally 20px at stroke width 1.65.

## Do's and Don'ts

### Do:
- **Do** preserve lowercase boff and the provisional B identity.
- **Do** align market prices and use tabular numerals for numeric controls.
- **Do** allow long real team names to wrap.
- **Do** preserve visible keyboard focus and reduced-motion behavior.

### Don't:
- **Don't** substitute a system display font for Newsreader.
- **Don't** use brass as the default selected-price fill.
- **Don't** give ordinary market panels overlay shadows.
- **Don't** present local preview actions as completed backend operations.

### Owner Review Refinements

- Use plain page titles: Matchups, Offers & Boosts, Futures, My Bets, All Bets, The League, Profile and role-workspace names. No taglines or decorative supporting copy.
- Title Case applies to UI headings/tabs, not imported league/team/player names or lowercase boff.
- Keep the source league avatar next to its name; use consistent Guide and Feedback icons.
- Player rows combine a small real headshot, player/position/NFL matchup, league-scored average and prices. Filters stay compact and default to the participant's team.
- Continuous Weekly Specials/Futures use sticky jump navigation; active state follows all section positions relative to the actual sticky boundary and preserves explicit jump intent.
- Offers reveal all legs without opening a modal; main-board variants abbreviate context and retain specific expiry date/time/zone. Keep expiry text readable.
- Same-matchup selections share a game header; source market context is not repeated on every leg.
- Guide/Walkthrough owns projection explanations. Feedback submission remains a visual placeholder.
- Retain mobile access to all destinations and utilities in More; detailed mobile aesthetics remain pending owner review.
- Compact metadata introduces 9–10px details and compact-panel 8px radii. These are review-stage data details, not an assertion that all inherited CSS literals align with the original narrow typography ramp. The source detector surfaced alignment advisories; browser readability and the owner's next review remain authoritative for refinement.


### Desktop Review 3

Weekly Slate retains the approved typography and palette. Offers lead below the heading, shared by all slate tabs. Matchup projections are explicit metadata; Tank Bowl uses the existing red token and a thin complete outline. H2H uses mirrored team/avatar/manager headers over source lineup slots. Points/milestones carry fantasy team labels. Weekly special families are paired in equal desktop columns with four sticky group links; pairs stack on phone widths. Standings headers use actual buttons, aria-sort and chevron indicators, with green/red streak states and participant/team avatar identity.


### Desktop Review 4

Supersedes the red Tank Bowl panel treatment: use a filled brass badge like Game Of The Week, retaining the ordinary panel border. Display original/boosted featured prices together. Futures use paired desktop market columns and two grouped jump links. Feedback uses the existing outline icon style with a message bubble. Notifications open a compact anchored surface with actionable ticket rows and preferences in its footer. boff standings have one identity column. Streak badges use filled green/red states. Placed ticket legs use explicit state labels and final-result text; lost tickets have a red outcome band, pushes a neutral refund band, and selected draft picks retain their normal selection state.


### Desktop Review 5

Use clean league paths, a minimal Your Leagues root, and the same Forest & Ivory identity. Price pairs put struck-out original odds immediately left of boosted odds within a fixed-height price button. Projected score metadata has no left padding or auto margin. Receipts use one small status badge, compact grouped legs with status/selection/price on one row, final result below, and horizontal stake/odds/return. Notifications progressively disclose metadata, leg results and ticket/share actions. Profile balance history starts with four recent movements. Feedback captures context and demonstrates a bounded owner inbox without claiming delivery.


### Desktop Review 6

Keep ticket status under its ID inside the card. Use the same compact selection/price rows for drafts and receipts, one rule per matchup, and parallel odds/return figures. Move the boost marker into the slip header to avoid an extra row. Give notification event titles more emphasis than metadata, separate handicaps from team names, and use explicit outcome badges. Profile has four linked, keyboard-accessible tabs, with two-column optional communication choices on desktop. Ticket list controls use compact native selects. Share cards use scoped approved dark tokens in either outer theme.


## Desktop Review 7

My Bets and All Bets expand tickets inline without navigation or scroll movement; multiple disclosures may stay open. Explicit sharing alone opens a dialog. Status, week, participant, sort and search controls share one desktop row and wrap responsively. Single tickets identify the matchup and omit an oversized Single title.

Won uses gold, Lost red, Open neutral and Push a neutral dashed circle. Larger accessible icon circles identify each leg, with scores, remaining production and forecasts attached to that leg. Win-total futures show current wins in a track marker and the accepted target at the end. Avoid duplicated ticket-wide progress. Archived scores remain labelled; missing player progress is not replaced with team scores. Notifications include matchup context and consistent outcomes. No progress snapshots are persisted.


## Desktop Review 8

Collapsed parlays show selection labels and market types only, without leg outcome icons, final scores or progress. Expansion reveals per-leg outcomes and match finals. The parlay type appears once at the top left; All Bets preserves participant identity below it. Singles and single futures are nonexpandable and display results/progress directly, without a redundant leg outcome icon. Lost tickets omit return values on cards, share views and copied summaries. Leg circles are 25px (21px in notifications).

Matchup details have Markets and Season Comparison tabs, with points for and recent form beneath team records. Season Comparison includes points against, points per game, scoring rank, streak, last five, rostered byes and earlier meetings. The small archived team-score fixture reconciles to the existing source totals. Historical injury reports and ATS lines are unavailable and must not be invented or mixed with current injury snapshots. Future ATS should use one consistent pregame benchmark per team/week, not the many accepted live ticket prices. No historical player snapshots or progress samples are persisted.

Additional market tabs have 26px clearance above them. The matchup page omits its redundant All Markets action; slate cards retain it. External links use explicit Sleeper Matchup / Sleeper League / Sleeper Team text and the shared external icon. Rejected-selection feedback stays visible five seconds, fades over 350ms, and resets its lifetime on repeated identical rejection. Reduced motion removes the transition.

Proposed team markets, not implemented without owner selection: alternate team totals, score bands, and team win plus points target. These can settle from the same final fantasy score; related selections require correlation/combination rules rather than naive parlay multiplication. Do not add event-timed race markets without suitable source event history.


## Desktop Review 9

The matchup header has three equal-height rotating views, replacing the separate season comparison tab: (1) team avatars, names and record only; (2) current seed, points for/against, points per game, scoring rank and ATS placeholder; (3) last five, current streak, rostered byes, earlier meetings and the archived injury-source gap. Seed uses the same archived wins/points-for order as the existing standings preview. Backend integration still needs the league's actual seed/tiebreak rules.

Three bottom-right circular controls identify the current view with a darker fill and allow direct selection. Advance every five seconds. Pause during hover or keyboard interaction, provide a pause/resume control, and begin paused for reduced motion. Reserve consistent panel height so changing views does not move betting controls. Inactive slides are hidden and inert.

Recent-form W/L/T controls show a small source-backed popover on hover, keyboard focus or tap, with week, opponent names and exact final scores. Keep it within the viewport, allow hovering its content, close on Escape/blur/scroll and remove Oldest First copy.

Sleeper Matchup uses its text hyperlink alone without an external icon. Put the week label first in matchup headings and align it exactly with the Matchup column, including featured games. Expanded notifications put action/result summaries below their selections, with bold high-contrast outcome colouring. Feedback messages remain fully visible for four seconds, fade linearly over the final second and are removed at five seconds; repeated messages restart the full lifetime. This supersedes iteration 8 timing. No database or historical-data storage additions.


## Desktop Review 10

Use the same avatar/name/record header across all matchup carousel views. Detail views add current seed beside the record. Group six statistics into separated rows: win percentage, points for, points per game, points against, potential points and ATS. Ranks are small muted #N values next to the numbers, not a separate Scoring Rank field. Equal metric values share ranks; lowest points against ranks first, other metrics rank highest first. ATS is explicitly an example based on synthetic historical lines. Seed keeps the existing archived standings order.

Hide earlier-meeting content completely if none exists. The third view groups recent form, streak, byes and two illustrative injury rows per team, with player headshots, reasons and Out/Questionable status styling. Sample Injury Report and Not Actual Player Status labels are mandatory for these invented statuses. They do not update any player source data.

Historical result popovers pair team avatars/names with unchanged actual scores, followed by the covering team/spread, winning team's moneyline odds and winning total side/line plus final combined score. Quotes are deterministic design examples in a UI-only helper, never accepted terms or settlement inputs. They reconcile between both team perspectives, use half-point spread/total lines, and respect odds-format preferences. No historical quote rows are stored.

One nonfeatured matchup displays Rivalry with an Example qualifier. This is a design fixture, not a claim about a real rivalry; it does not receive an implicit moneyline boost. Future rivalry selection needs commissioner-defined pairs or a validated automatic rule. Other proposed featured categories, not implemented: Playoff Race, Championship Rematch, Streak Showdown and Upset Watch.

The Guide & Walkthrough icon is a plain question-mark path, with no enclosing circle; accessibility labels and behaviour remain.


## Desktop Review 11

Reduce desktop carousel height from approximately 445px to roughly 315px in the reviewed matchup while keeping all three views the same height. Use denser header/metric spacing and place form/byes beside compact injury rows. Preserve names and status readability; phones stack those subgroups. Historical result popovers have tighter score/market spacing and omit their standard -110 spread/total prices. Moneyline odds remain; actual market and ticket odds elsewhere stay explicit, including exceptions and boosts. Half-point lines are not a universal guarantee of -110.

Use ordinal seeds (1st Seed, 2nd Seed, 11th Seed, etc.), including teen exceptions and larger leagues. The first guide slide omits Previous, and the last has an enabled Let's Go! action that closes the guide.

Slate matchup backgrounds are native links to their additional markets, with border/background and arrow cues on hover/focus; coarse-pointer devices retain the arrow. Remove All Markets text links. Keep actual odds buttons, team buttons and the external Sleeper link independently actionable above the background link. Detail pages have no redundant overlay.

Playoff Race, Championship Rematch, Upset Watch, Revenge Game and Winning Streak Clash are added to commissioner manual preview labels. Automatic eligibility and boost values are explicitly pending owner decisions. These example labels must not silently change quoted prices. Existing established featured pricing remains. The owner received a review sheet covering all bonus types, recommended triggers, markets/percentages, overlap/use/expiry proposals and additional ideas; no proposed rule or bonus is activated without the decision.


## Desktop Review 12 — Owner-Approved Featured Rules

Replace the prior draft with this priority: Championship Rematch, Playoff Race, Rivalry, Revenge Game, Upset Watch, Streak Breaker, Tank Bowl, Game Of The Week. No category has a reserved weekly slot. Automatic non-rivalry assignments are capped at floor(actual weekly matchups / 2); rivalry games are exempt and may cover the full slate. One category wins each matchup by priority; no stacking. Game Of The Week is at most one of the remaining highest-rated games, not a forced reservation. Other qualifying categories may fill available places in priority order. Commissioner manual assignments/removals override the automatic result, can exceed the cap, and do not trigger backfilling after removal.

Remove Closest Matchup and High-Scoring Matchup. Tank Bowl defaults to the first week after halfway through the regular season, combined weighted win percentage rounded to one decimal at or below 33.3%, and only a 25% profit boost on the match-total Over. Rivalry is a 35% moneyline boost on both sides when saved participants' opposing teams meet. Up to three reciprocal rivals per participant; no same-team pairs or duplicates. Seed balanced same-division suggestions once from validated Sleeper divisions, without overwriting commissioner choices. The current source league has no divisions, so it starts empty.

Playoff Race defaults to the last four regular-season weeks and within one win of the final playoff place, with verified qualification status required. Both teams racing: both moneylines get 35%. One team racing: only its opponent gets a 35% spoiler moneyline boost. Mark the racing team; use Playoff Spoiler for the latter case. Unknown qualification status skips automatic selection, rather than inventing eligibility. The worker supplying verified live qualification status is not connected in this frontend. Manual context explicitly selects both racers or the team racing.

Championship Rematch uses verified previous finalists and 50% on either moneyline. Prior Sleeper finalists were owner-mapped to current roster IDs and only the compact result retained. Revenge uses the most recent earlier current-season meeting, previous loss margin at most 10 by default, and 35% only on the previous loser. No earlier result means no invented recipient. Upset Watch uses a lower-seeded moneyline underdog outside the top half against a top-quarter opponent, with pre-scoring projection gap at most 10% by default; 35% only to the underdog. Streak Breaker replaces Winning Streak Clash: a winning streak of at least five by default gives the opponent 25%, not the streak holder.

Commissioner controls expose numeric eligibility cutoffs and category enablement. Logic, ordering, market targeting, maximum rivals, cap formula and boost percentages have no editable UI fields. These are frontend controls, not a claim of server-enforced authorization; backend rules and role checks are required before actual participant use. Manual assignments may override automatic eligibility cutoffs, but the named market/recipient logic and fixed percentage remain. New assignment maps are limited to the current week; rival pairs and cutoff settings persist by league, with participant IDs rather than usernames. Division suggestions are computed once, not on each price render.

Use a restrained palette of brass, bronze, clay, sage and lavender, with dark forest icon/text and explicit fixed percentages so colour is not the only meaning. Feature badges meet 4.5:1 text contrast in both themes. Commissioner has separate Featured Matchups and Rivalries tabs. The main slate keeps compact feature badges and struck-out original/new prices only on eligible markets. Historical accepted ticket terms and premade offer base quotes remain unchanged. No weekly odds/progress history, database writes or production migration is added.


## Desktop Review 13 — Planning and Rivalry Suggestions

This revision supersedes review 12's current-week-only preset retention and automatic initial division seeding. Keep one explicit assignment/context preset per scheduled fixture for the current season, including a No Boost override; no versions or quotes. The frontend bounds weeks to the actual regular season. Stored fixtures contain only week/pair IDs: 14 weeks and 84 games in about 1 KB for this league. The real shared backend must additionally scope configuration by league and season and archive/delete it at season rollover.

Commissioner Featured Matchups uses a compact fixture/feature/assignment grid with aligned headings, adjacent team avatars and week selection. Eligibility Cutoffs opens a separate dialog with Save/Cancel; cutoff saves do not inadvertently commit unsaved weekly drafts. Save Presets saves all edited weeks. Past fixture weeks are read-only. Future dynamic recipients/eligibility wait until opening; verified championship identity or saved rivalries can preview, without inventing future projections or quotes. Active slate prices use only the active week's configuration; existing accepted tickets stay immutable.

Rivalries are a single league-wide table showing all participants and three reciprocal rival slots. Default pairings are blank. Auto-Populate is a one-time, commissioner-initiated replacement of the draft, not a source toggle: Sleeper Divisions, Competitive History, or Similar Standings. Divisions is disabled when absent (as in this source league). History uses completed meetings, favouring close margins, even results and repeat meetings; standings uses win percentage and scoring similarity. Both produce deterministic balanced suggestions and respect the three-person cap, same-team exclusion and reciprocal links. All resulting fields stay editable; Save Rivalries commits and Clear All supports starting from scratch. No additional source snapshots or pairing versions are retained.

All eight featured categories have unique SVG icons. Badges say % Profit Boost throughout and retain explicit category labels and accessible contrast in both themes. This remains local browser preview configuration; shared commissioner persistence, season scoping and server role enforcement are future backend requirements.


## Desktop Review 14 — Team Rivalries and Compact Context

Rivalries belong to fantasy teams, not individual managers. Supersede prior participant pairing requirements with one reciprocal team-ID pair per relationship, at most three rival teams each. A shared-manager team appears once; team names and team avatars lead both rows and choices. Manager names are available as a title on the team identity, avoiding long labels. Existing browser participant pairs migrate through owner-to-roster mapping into team IDs, collapsing duplicates and same-team pairs and retaining only valid bounded relationships. New saves carry an explicit team scope marker. This changes no participant balances or leaderboard membership.

The rivalry editor uses wider horizontal cell gutters, stronger control boundaries, alternating rows, larger team labels, and one unified league view. The always-visible bonus badge is removed; How It Works explains the 35% automatic moneyline boost and exemption from the default 50% automatic cap. The gear icon is redrawn symmetrically and presented at 18px.

Matchup pages show only the active slide in layout instead of reserving the tallest hidden slide. Identity now occupies about 109px in the representative desktop view; the content slides are roughly 245–255px. Team headers share fixed horizontal anchors and equal top alignment between stats and form; first slide still shows only the team identity and record. Auto-rotation remains five seconds and pauses for focus, hover, reduced motion or the pause control. Injury position/body part/designation share one text line when space permits; sample statuses remain clearly labelled illustrative. Last-five total snapshots display the final actual score to the right of the winning total line.

Offer names are slightly larger in both compact and full versions. Accepted boosted prices use semantic gold: readable bronze-gold on ivory, pale gold on forest. Only market buttons with originalOdds receive a subtle gold border/tint and coloured new price; selected/focus states remain distinct and original quotes stay struck out. Eligible recipient rules, cap, priority and accepted ticket terms are unchanged.


## Desktop Review 15 — Shared Typography and Clear Progress

Rivalry rows retain their approved appearance. Team avatars have at least 14px table-cell inset and the final heading/counts at least 16px; the end column is 70px wide. Remove the contrasting filled header band and use muted UI text on the existing surface.

All three matchup slides show vs and both ordinal seeds. Keep identity compact and existing anchors consistent. The active navigation dot carries a thin SVG progress outline that fills over eight seconds before advancing. Hover, keyboard interaction, explicit pause and hidden tabs pause elapsed time; leaving hover resumes the remaining interval. Reduced-motion users start paused. Manual selection resets elapsed time; no numerical countdown, storage writes or network calls are added. The ring uses local refs and animation frames rather than rendering the entire component each frame.

Last-five total snapshots place the real final score directly after the winning Over/Under line with an 8px gap. Avoid right-edge anchoring. Eligibility Cutoffs is a two-column desktop form in priority order, retaining fixed logic/boosts and all editable fields. Save/Cancel remain fully visible without scrolling at the reviewed 1920x1080, 1440x900, 1366x768, 1280x720 and 1024x768 sizes. Short desktop viewports omit repeated market captions (still in the rule tooltip); smaller screens retain accessible scrolling.

All explicit font-family declarations reference shared UI/display tokens, while @font-face keeps the self-hosted family identities. Newsreader is the display face for page/modal/team/offer titles; Public Sans is used for interface text, controls, shared section headings and odds/account numbers. Shared commissioner, notification and balance headings use the same 15px/600/1.4 role; compact/full offers now share their display family. Forms retain a consistent 16px UI section heading. Responsive size differences remain intentional.

Replace solid gold/red notification result blocks with an unfilled summary beneath the selections: a small status icon, a clear remaining-action heading, settled-leg counts and a short settlement explanation. The summary derives from existing ticket statuses and stores nothing extra. The example reads: 1 Leg Awaiting Confirmation / 1 Won · 1 Pushed / Ticket settles after the final result is confirmed. Ticket and share actions remain intact. Live notification delivery and settlement remain backend work.


## Desktop Review 16 — Stable Slides and Category Boosts

Matchup quote accents follow the featured category: brass/gold, bronze, sage, clay or lavender. Light-theme prices use a darker readable hue; dark-theme prices match badge backgrounds. Selected states use readable corresponding ink. Standalone offer prices remain gold. Only actual boosted selections receive category classes; original/accepted quotes and recipient logic do not change.

Replace injury separators with middle dots. All matchup slides have one fixed responsive outer height: 274px wide desktop, 320px compact desktop, 340px narrow tablet and 520px phone. Keep the header, vs, seeds and eight-second controls. Bounded injury lists accept the entire supplied report and scroll internally after 106px; the two current sample entries are illustrative, not a live injury source. Many injuries do not enlarge the carousel or move the book. Byes and source notes also have bounded readable overflow areas. Preserve access to every injury rather than silently truncating the report.

Rename the button/dialog to Configure Matchup Rules and the commit action to Save Rules. Present all eight categories as one aligned list, never side-by-side category panels. Keep editable inputs aligned across each row and all desktop content visible without scrolling at reviewed sizes; narrow screens can scroll. Rule tooltip captions remain available.

Add a small neutral dev badge immediately left of the balance, controlled by the development build/public environment flag. The current isolated visual app is a dev artifact and sets VITE_APP_ENV=development. Production rollout requires VITE_APP_ENV=production; no backend credentials or private environment values are exposed. Legacy production is unchanged.

Market/UX ideas are documented separately in CANDIDATE_MARKETS.md. They are proposals, not new active markets. Prioritize reuse of existing scores/standings and accepted terms rather than additional historical snapshots.


## Desktop Review 17 — Approved Market Previews

Configure Matchup Rules includes verified prior championship context from Sleeper: 2025 champion earkin (current roster 6), runner-up AJ Brown’s Twitter (current roster 4, now Nelson is fat and phat), and the pair's scheduled Week 11 meeting. Retain the compact result/name mapping and compute meeting weeks from the existing 84-fixture schedule. The preparation script preserves winner/runner-up and season facts on refresh; no full historical bracket/roster dump is retained.

The five-player injury design example is on The 20 Year Rebuild vs Nelson is fat and phat (Week 8). Use real roster identities: Brock Purdy, Josh Jacobs, Chris Olave, Jaylen Warren and Jeremiyah Love, with clearly illustrative Out/Doubtful/IR designations and body parts. Show the report count and retain internal scrolling so the carousel stays fixed. These are not actual injury statuses.

Additional Matchup Markets adds Alternate Lines and Position Groups. Alternate spreads/totals use half-point targets and different indicative prices along five two-sided rungs. The base rung preserves the corresponding main quote; a lower/higher difficulty changes payout monotonically. All total Over rungs receive a Tank Bowl boost when that market is eligible, using the existing category accent; spreads have no extra featured boost. Alternate picks share the underlying market/matchup conflict group with main selections.

Position groups include all actual starters at that NFL position, including flex slots, excluding K/DEF. Only positions present on both teams are shown. Display real starter names and summed season averages as context; no average is a weekly forecast. If either group has a missing average, show Price Unavailable rather than using zero. This applies to Joe Fagnano in the sample's QB group. New quote math is illustrative pending calibrated projections. Accepted group contracts identify the team and position; settlement must use the actual final lineup locked at NFL kickoff. Same-game position-group selections cannot combine with another selection from that matchup; groups across independent games remain possible under the normal slip rules. Group-ticket progress waits for its own source, never showing full-team totals as group points.

Futures add Regular-Season Points Leader and Regular-Season Top Seed under Season Leaders. Both are single-ticket markets and exclude playoffs; top seed requires official league tiebreaks in settlement. Division winner panels are generated only for real sourced divisions, with co-manager rosters deduplicated. The current sample has none, so no artificial division option appears. The close-game-count weekly special is excluded.

Use the existing odds buttons, typography, team identity rows, slip grouping, price confirmation and ticket rendering. No new backend settlement or notification services are represented as live. UX_IMPROVEMENTS.md separates current capability, limitations, frontend changes, backend requirements and storage impact for the four proposed UX improvements. Those UX additions remain unimplemented proposals.


## Iteration 18

Real current-week source refreshing is running in dev, with five-minute active-game, fifteen-minute game-day/confirmation, and hourly idle league cadence. Source status/current scores are separate from archived illustrative prices; pricing/acceptance/settlement remain disconnected. See LIVE_REFRESH.md for storage measurements and limits.

Position Groups moved to Player Head-To-Head. Alternate lines use half-point sliders with no featured boosts. Injury order is Questionable, Doubtful, Out, IR. Optional `?review=interactions` shows tap-explained muted conflicts and a specific-prop Favorites shortlist; account persistence is not approved. `?view=live` and `?view=postseason` select connected current scores and historical bracket review. See UX_IMPROVEMENTS.md for ticket-follow recommendations and research.


## Iteration 19

Alternate Lines return to five preset paired rows at offsets -10, -5, 0, +5, +10 from the current main target. Spread columns show the corresponding team name/avatar; totals explicitly show Over and Under. Headers and buttons share a two-column grid, with Public Sans 15px panel headings at all widths. Alternate quotes remain unboosted and half-point targets. The slider is removed. See ONE_LEAGUE_STORAGE.md for measured current storage and full-season one-league estimates.


## Iteration 20

Alternate panel titles are 18px; team/Over–Under column headers are 14px on desktop and 13px on mobile, with larger avatars. Preset selection behaviour is unchanged. Dev source refresh now omits an unchanged payload from database PATCH updates while retaining truthful successful-check timestamps. Object-key ordering is normalized for comparison. Ticket compaction was audited read-only and remains future backend work; see STORAGE_EFFICIENCIES.md.
