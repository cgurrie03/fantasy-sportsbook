# BOFF design direction: research and concrete choices

November 8, 2026 • Three private design studies; no design is approved yet

[Open the interactive comparison](boff-design-studies.html). Switch Atlantic / Signal / Club, Desktop / Phone, and Markets / Profile / League setup. Select prices, open the mobile slip, and inspect the receipt summary. No bets, messages, accounts, or production settings are created. This is a private design tool, not the public product demo removed from scope.

## What the research establishes

Professional quality is supported by coherent hierarchy, typography, grouping, contrast, and behavior. Nielsen Norman Group describes [scale, hierarchy, balance, contrast and grouping](https://www.nngroup.com/articles/principles-visual-design/) as useful principles. Its [consistency guidance](https://www.nngroup.com/articles/consistency-and-standards/) supports repeated interaction rules across the product. These principles help usability; they do not scientifically identify whether a site was AI-generated.

[Digital.gov typography guidance](https://digital.gov/resources/an-introduction-to-typography) emphasizes type size, spacing, contrast, and testing letterforms at real screen sizes. [WCAG 2.2](https://www.w3.org/TR/WCAG22/) provides concrete targets for contrast, visible focus, touch targets and focus remaining unobscured. These are useful checks for the owner's complaints about clipped content and oversized fixed panels.

[DraftKings explains the selection–slip–receipt flow](https://support.draftkings.com/dk/en-us/what-is-a-bet-slip?id=kb_article_view&sysparm_article=KB0010510), and its [changing-price guidance](https://support.draftkings.com/dk/en-us/why-do-the-odds-sometimes-change-before-i-place-a-bet?id=kb_article_view&sysparm_article=KB0010798) supports explicit confirmation of changed terms. [FanDuel explains temporary market pauses](https://support.fanduel.com/s/article/What-does-the-lock-mean-on-FanDuel), and [profit-boost qualification inside the slip](https://support.fanduel.com/s/article/Profit-Boosts-with-FanDuel). These support familiar task flows rather than copying another brand's identity.

Visual-reference limits: a current Fanatics public marketing page rendered, demonstrating a compact brand/nav system and expressive condensed headline type; it is a marketing page, not evidence of the signed-in betting UI. DraftKings' sportsbook blocked headless access. FanDuel support/search content was available, while its app page required JavaScript and some support pages rendered poorly. No complete signed-in national sportsbook comparison was claimed. The studies are independently designed from the research and BOFF's tasks. Do not import marketing banners or cash offers simply because a reference sportsbook uses them.

## How to minimize a generic generated appearance

This is an art-direction judgment, not a detector score. The practical decisions are:

Research specifically supports the concern about generic defaults. [NN/G's evaluation of AI prototyping tools](https://www.nngroup.com/articles/ai-prototyping/) found that detailed context, explicit visual requirements, and interaction states improved results over broad prompts. A [92-participant interface-prototype study](https://arxiv.org/abs/2605.15124) reported stronger pragmatic evaluations than originality/innovation evaluations. A separate [web-design homogenization paper](https://arxiv.org/abs/2603.13036) proposes deliberate review and challenges to default outputs as mitigation. The latter is a risk/mitigation analysis, not an experimental guarantee; paper descriptions here are based on their published abstracts. These sources motivate specific art direction, real content, rendered comparison and owner judgment—not a promise that swapping colors makes a design original.

The [WebCompat study abstract](https://arxiv.org/abs/2608.12518) also highlights layout/scale problems across environments in generated webpages. This supports reviewing real rendered phone/desktop behavior rather than trusting that responsive CSS exists. BOFF's small Chromium study checks are narrower than that paper's multi-browser/device evaluation.

- Begin with the league market board, not a marketing hero, oversized balance, or three identical metric cards.
- Use actual team names and real archived market values to reveal long-name and numeric-alignment issues early. Do not design only around convenient fictional short names.
- Spend brand expression on a distinctive wordmark, display/body type pairing and restrained action color; keep price comparisons quiet and regular.
- Match components to function: compact price controls, grouped matchup blocks, a single offer strip, clear receipt, simple form controls. Avoid one radius/shadow/card treatment applied to everything.
- Use deliberate spacing and alignment rather than decorative gradients, glowing panels, glass layers, oversized pill controls, animation on every card, or thin-rule newspaper styling as a shortcut to originality.
- Write direct product copy. Label states with “Updated,” “Preparing next week,” “Price changed,” “Claimed,” or “Used” as appropriate. Do not add vague labels such as “AI-powered insights” or claim a live feed from a recent browser poll alone.
- Keep one consistent icon language. External Sleeper actions use the same icon position and a readable label; any final official Sleeper asset and team-link behavior still need verification.
- Review rendered screens, selected/empty/unavailable states and phone interactions before treating a token list as a finished design.

## Palette options

| Role | Atlantic | Signal — recommended starting direction | Club |
| --- | --- | --- | --- |
| Main background | Deep blue `#142D40` | Cool gray `#F1F4F7` | Cool gray/lilac `#F2F1F4` |
| Surface | Blue `#1D3B50` | White `#FFFFFF` | White `#FFFFFF` |
| Primary text | Ice `#EEF5F8` | Deep ink `#142C3D` | Plum ink `#2E2234` |
| Secondary text | Blue gray `#A6BBC8` | Slate `#536777` | Gray plum `#655C6D` |
| Action/selected | Sea blue `#70CEE0` | Royal blue `#204FBC` | Berry `#7B2855` |
| Offer text/accent | Sand `#E8BA73` | Warm brown `#855018` | Warm brown `#855018` |

Atlantic is a focused dark interface with more subtle separation between surfaces. Signal gives the clearest light-board contrast and preserves a strong dark product masthead. Club has the most independent color personality and desktop side navigation, but its navigation rail uses horizontal space. These are design judgments to compare visually, not claims from a source study.

Semantic win/loss/warning colors will be specified independently after direction selection. An accent color must not carry result meaning by itself. The prototype concentrates on brand/selection colors; it is not a complete semantic-state system or accessibility certification.

## Typography

- **Atlantic / Signal:** Barlow Condensed 700 for BOFF and selected section headlines; Public Sans 400/500/600/700 for actual team names, prices, inputs, instructions, and metadata.
- **Club:** Archivo Narrow 700 for BOFF/headlines; Public Sans for controls and data.
- Display type is deliberately limited to identity and hierarchy. Odds use readable tabular lining numerals, not monospace or condensed price columns.
- Planned production type scale: 12px metadata, 14–15px controls/team data, 16px body/forms, 20px compact titles, 28–32px section headings, 36–42px wordmark. The comparison study also contains smaller contextual labels; those need final readability review before production.
- Embedded study fonts are packaged locally so comparison works without external font requests. Licenses are supplied in `design-font-licenses.txt`. Final implementation should subset/package only the selected families and necessary weights rather than carrying all three directions.

## Layout and controls to apply consistently

| Area | Proposed design rule |
| --- | --- |
| Brand/league switcher | BOFF remains recognizable; league identity is subordinate and opens an accessible connected-league menu. No hover-only interaction. |
| Navigation | One short primary navigation, separate market categories. Remove controls that do not serve the current screen. Use tap/keyboard behavior on phones. |
| Market comparison | Left-aligned team identity; stable spread/total/winner columns. Long names wrap without covering prices. Projections and explanation are secondary. |
| Desktop slip | Compact side panel with selected terms, wager and return; do not cover the market board with a large fixed overlay. |
| Phone slip | Small bottom trigger; expand to a bounded sheet with one controlled scroll region. Restore focus after dismissal; account for keyboard and safe areas during implementation. |
| Post-placement summary | Compact accepted-ticket facts with Share / View ticket / Done. Confirmation follows acceptance, not a timer or optimistic assumption. |
| Offers | Reusable text-first strip/card, theme, legs, old odds crossed out beside boosted odds, eligibility and expiry. No uploaded hero/promo images. |
| Profile preferences | Per-type communication controls within Profile, league scope stated, same form/action system as other screens. |
| Setup | Commissioner sees source teams/managers, mapping completion, approval state and activation; unregistered owners are not represented as active bettors. |
| Spacing | Base rhythm 4/8/12/16/24/32px. Use consistent grouping and column alignment; avoid arbitrary per-page spacing tweaks. |
| Radius | Atlantic controls 6px/groups 10px; Signal 4px/8px; Club 8px/12px. Larger modal grouping is purposeful. Final values remain selectable. |
| Motion | Brief feedback after selection/open/close only; reduced-motion preference respected. No autoplay offer carousel or blanket reveal animations. |

## Checks completed on these studies

- Headless Chromium: all three directions render 24 market price controls and eight team rows without JavaScript errors or horizontal page overflow at a 1440px viewport.
- Phone viewport: no document or app horizontal overflow at 390px; market-price controls are 48px high.
- Final Signal reflow checks also found no document/app horizontal overflow at 320, 768 and 1440px. The phone close action was moved inside the sheet header and its bounds verified.
- Mobile slip opens, amount field is present, Escape closes; receipt summary and four profile preference toggles render; setup renders the intended mapping sample.
- Computed main text/selection/button/offer color pairs meet 4.5:1 normal-text contrast in all three directions. Selected-state contrast: Signal 6.26:1, Atlantic 4.92:1, Club 7.42:1. Primary-button contrast: 7.23:1, 7.92:1, 9.22:1 respectively.
- Screenshots were visually reviewed. A misleading featured label was corrected to the actual archived source, and internal roster-number labels were removed.

Limits: this is not a full keyboard/screen-reader audit, actual iPhone keyboard test, physical-device acceptance, backend integration, or proof all text/control contrast states pass. Scene buttons intentionally show component studies rather than implementing every product category. Balances/wager and receipt outcomes are explicitly illustrative; team names and base market data are real historical production content. The offer is a computed study from archived available choices, not a published production offer.

## Decision requested

Choose the direction to refine: **Atlantic**, **Signal**, or **Club**. Mixing one direction's color palette with another's navigation is possible, but first select the overall character. Then lock the primary/default theme, type pairing, spacing/radii, selection state, and desktop/mobile navigation/slip rules. Do not treat three palette options as a commitment to maintain three themes in production.
